// Tests of scripts/kit/worktree-setup.mts (K348): the worktree of a row is made from main beside the main checkout, installed from its
// own sources and checked, a second run converges, and no worktree is made under the floor of free disk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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

test('worktree-setup makes the worktree of a row from main, installs it from its own sources and checks it, and a second run converges (K348)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // The install of the fixture writes into the worktree, and its check reads what the install wrote there.
  put(main, { 'Makefile': 'install:\n\techo installed >> installs.txt\nlink-state-check:\n\ttest -f installs.txt\n', '.gitignore': 'installs.txt\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  assert.equal(folder, path.join(parent, 'repo-parser-T1'));
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/parser-T1');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'main'), 'the branch starts at main');
  assert.equal(readFileSync(path.join(folder, 'installs.txt'), 'utf8'), 'installed\n', 'the worktree is installed in itself');
  const listed = git(main, 'worktree', 'list', '--porcelain');
  assert.equal(setupWorktree(folder, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run, also from the worktree, finds the same worktree');
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'and leaves the same worktrees');
  assert.throws(() => setupWorktree(main, { name: 'lexer', id: 'T2', type: 'fix' }, { ...quiet, free: () => WORKTREE_DISK_FLOOR - 1 }), /under the floor of 30 GB for a new worktree/);
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'no worktree is made under the floor');
  assert.throws(() => setupWorktree(main, { name: 'Lexer', id: 'T2', type: 'fix' }, quiet), /is no slug/);
  assert.throws(() => setupWorktree(main, { name: 'lexer', id: 'T2', type: 'merge' }, quiet), /is none of feat, fix/);
});
