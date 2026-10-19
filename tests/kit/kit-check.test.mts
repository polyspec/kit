// Tests of the checks of kit-check.mts that read the tracked files of a checkout: a repository tracks no symbolic link
// that it creates (K254).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { retiredFindings, symlinkFindings } from '../../scripts/kit/kit-check.mts';
import { tree } from './tree.mts';

test('a tracked symbolic link fails with its path, and a tree without one passes (K254)', (t) => {
  const root = tree(t, { 'a.txt': 'a\n', 'docs/b.md': '# B\n' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(symlinkFindings(root), []);
  symlinkSync('../a.txt', path.join(root, 'docs/link.txt'));
  assert.deepEqual(symlinkFindings(root), [], 'an untracked link is no tracked file');
  assert.equal(spawnSync('git', ['add', 'docs/link.txt'], { cwd: root }).status, 0);
  assert.deepEqual(symlinkFindings(root), ['docs/link.txt: a tracked symbolic link; the repository creates no link. Fix: git rm --cached docs/link.txt and track the file it names']);
});

test('a configuration that kit no longer reads is a finding (K243)', (t) => {
  const root = tree(t, { 'config/commits.json': '{}' });
  assert.deepEqual(retiredFindings(root), ['config/commits.json: kit no longer reads it; the commit rules are COMMIT_RULES of check-commits.mts (K243). Fix: git rm config/commits.json']);
  assert.deepEqual(retiredFindings(tree(t)), []);
});
