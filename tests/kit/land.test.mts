// Tests of scripts/kit/land.mts (K394): make land merges a rebased branch fast-forward only after the static gates that the
// changed paths of the branch select pass, then removes its branch and worktree; a refused branch leaves main unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { land } from '../../scripts/kit/land.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('make land merges a rebased branch only after the gates it touches pass, and removes its branch and worktree (K394)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // lint-x fails on a file bad.txt under src; docs-check and commits-check are the other kit gates and pass.
  put(main, {
    'Makefile': 'kit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttest ! -f src/bad.txt\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['lint-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const base = git(main, 'rev-parse', 'main');
  const quiet = { print: () => {} };

  // A branch that changes src/a.txt: its gate lint-x runs in its own worktree and the branch lands.
  const folderA = path.join(parent, 'repo-a');
  git(main, 'worktree', 'add', '--quiet', folderA, '-b', 'feat/a', 'main');
  put(folderA, { 'src/a.txt': 'a\n', 'var/install.txt': 'installed\n' });
  git(folderA, 'add', '-A');
  git(folderA, 'commit', '--quiet', '-m', 'a');
  const branchA = git(main, 'rev-parse', 'feat/a');
  land(main, 'feat/a', quiet);
  assert.equal(git(main, 'rev-parse', 'main'), branchA, 'main fast-forwards to the branch');
  assert.equal(existsSync(folderA), false, 'the worktree is removed');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/a'], { cwd: main }).status, 1, 'the branch is deleted');

  // A branch that adds src/bad.txt: lint-x fails in its worktree, so it is refused and main stays where it is.
  const folderB = path.join(parent, 'repo-b');
  git(main, 'worktree', 'add', '--quiet', folderB, '-b', 'feat/b', 'main');
  put(folderB, { 'src/bad.txt': 'bad\n' });
  git(folderB, 'add', '-A');
  git(folderB, 'commit', '--quiet', '-m', 'b');
  const mainBefore = git(main, 'rev-parse', 'main');
  assert.throws(() => land(main, 'feat/b', quiet), /lint-x/);
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'main is unchanged after the refusal');

  // A branch that is not rebased on main: it forks from the base, which main has left behind, and it is refused.
  const folderC = path.join(parent, 'repo-c');
  git(main, 'worktree', 'add', '--quiet', folderC, '-b', 'feat/c', base);
  put(folderC, { 'src/c.txt': 'c\n' });
  git(folderC, 'add', '-A');
  git(folderC, 'commit', '--quiet', '-m', 'c');
  assert.throws(() => land(main, 'feat/c', quiet), /rebased/);
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'main is unchanged after the refusal of a branch not rebased');
});
