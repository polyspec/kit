// Tests of scripts/kit/worktree-setup.mts (K348): the worktree of a row is made from main beside the main checkout, linked to the main
// checkout's node_modules with nothing installed (K519) and checked, a second run converges, and no worktree is made under the floor of
// free disk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setupWorktree, WORKTREE_DISK_FLOOR } from '../../scripts/kit/worktree-setup.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('worktree-setup makes the worktree of a row from main, links its node_modules, installs nothing and checks it, and a second run converges (K348, K519)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // An install of the fixture would write installs.txt; the check reads the node_modules that the worktree links.
  // The link rebuild of K482 runs the link tool of the consumer from the linked node_modules, so the fixture has a no-op one.
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'install:\n\techo installed >> installs.txt\nlink-state-check:\n\ttest -f node_modules/@polyspec/kit/dist/link.mjs\n',
    '.gitignore': 'installs.txt\nnode_modules/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  assert.equal(folder, path.join(parent, 'repo-parser-T1'));
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/parser-T1');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'main'), 'the branch starts at main');
  assert.equal(existsSync(path.join(folder, 'installs.txt')), false, 'the worktree installs nothing');
  assert.ok(lstatSync(path.join(folder, 'node_modules')).isSymbolicLink());
  assert.equal(readlinkSync(path.join(folder, 'node_modules')), path.join(main, 'node_modules'));
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the link is excluded, so the worktree has no change');
  const listed = git(main, 'worktree', 'list', '--porcelain');
  assert.equal(setupWorktree(folder, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run, also from the worktree, finds the same worktree');
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'and leaves the same worktrees');
  assert.throws(() => setupWorktree(main, { name: 'lexer', id: 'T2', type: 'fix' }, { ...quiet, free: () => WORKTREE_DISK_FLOOR - 1 }), /under the floor of 30 GB for a new worktree/);
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'no worktree is made under the floor');
  assert.throws(() => setupWorktree(main, { name: 'Lexer', id: 'T2', type: 'fix' }, quiet), /is no slug/);
  assert.throws(() => setupWorktree(main, { name: 'lexer', id: 'T2', type: 'merge' }, quiet), /is none of feat, fix/);
});

// K482: a fresh worktree is built by the link rebuild of its own packages before the link-state-check, so the check never reads a build
// that the new worktree does not have yet (the stale report of a new worktree).
test('worktree-setup rebuilds the packages of the worktree before its link-state-check (K482)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // The install writes no build; the rebuild writes the build that the check reads, so the check fails unless the rebuild ran first.
  // A consumer runs the link of its installed kit: the fixture installs a link tool that writes the build the check reads.
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': "import { mkdirSync, writeFileSync } from 'node:fs';\nconst [, , command, target] = process.argv;\nif (command !== 'rebuild' || target !== '.') process.exit(2);\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/index.d.ts', 'built\\n');\n",
    'Makefile': 'install:\n\ttrue\nlink-state-check:\n\ttest -f dist/index.d.ts\n',
    // The build is ignored at the root only: an unrooted dist/ would also ignore the link tool under node_modules/@polyspec/kit/dist.
    '.gitignore': '/dist/\nnode_modules/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const lines: string[] = [];
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: (text: string) => lines.push(text) };
  const folder = setupWorktree(main, { name: 'builder', id: 'K482', type: 'fix' }, quiet);
  assert.equal(readFileSync(path.join(folder, 'dist/index.d.ts'), 'utf8'), 'built\n');
  assert.ok(lines.some(line => line.includes('link rebuild in')), lines.join('\n'));
});

// K519: a worktree whose node_modules is a folder of its own is refused, since a worktree installs nothing.
test('worktree-setup refuses a worktree that holds node_modules of its own (K519)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, { 'node_modules/.keep': '', 'Makefile': 'link-state-check:\n\ttrue\n', '.gitignore': 'node_modules/\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-own-K519');
  git(main, 'worktree', 'add', '--quiet', '-b', 'fix/own-K519', folder, 'main');
  mkdirSync(path.join(folder, 'node_modules'));
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  assert.throws(() => setupWorktree(main, { name: 'own', id: 'K519', type: 'fix' }, quiet), /node_modules exists and is not the link to .*; remove it, since a worktree installs nothing \(K519\)/);
});
