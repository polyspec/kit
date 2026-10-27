// Tests of explicit local branch retention: the declaration is optional in CI, but an existing pinned ref may not move.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { retainedBranches } from '../../scripts/kit/retained-branches.mts';
import { put, tree } from './tree.mts';

const record = (branch: string, commit: string) => JSON.stringify({ schema: 1, branches: [{ branch, commit, reason: 'The user cancelled this development and asked to retain its local backup.', removalCondition: 'The user authorizes removal of the backup branch.' }] }) + '\n';
const git = (root: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('a retained-branch declaration accepts an absent local ref on CI', (t) => {
  const root = tree(t, { 'config/retained-branches.json': record('backup/cancelled-T1', 'a'.repeat(40)) });
  assert.equal(retainedBranches(root)[0]?.branch, 'backup/cancelled-T1');
});

test('a retained-branch declaration rejects an existing ref after it moves from its full pinned commit', (t) => {
  const root = tree(t);
  put(root, { 'file.txt': 'one\n' });
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'first');
  git(root, 'branch', 'backup/cancelled-T1');
  const pinned = git(root, 'rev-parse', 'refs/heads/backup/cancelled-T1');
  put(root, { 'file.txt': 'two\n' });
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'second');
  git(root, 'branch', '-f', 'backup/cancelled-T1', 'HEAD');
  put(root, { 'config/retained-branches.json': record('backup/cancelled-T1', pinned) });
  assert.throws(() => retainedBranches(root), /refs\/heads\/backup\/cancelled-T1 is [0-9a-f]{40}, expected pinned commit [0-9a-f]{40}/);
});
