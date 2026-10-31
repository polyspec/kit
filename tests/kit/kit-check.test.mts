// Tests of kit-check.mts: the configuration is read against the schemas of kit, and the names of the targets, the suite, the
// tracked links and the other files of a repository are its own (K810).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { check, ciNameFinding } from '../../scripts/kit/kit-check.mts';
import { tree } from './tree.mts';

test('kit-check reads the configuration only: a tracked link, a target of its own name and an old config pass (K810)', (t) => {
  const root = tree(t, {
    'Makefile': 'test-unit:\n\t@true\nCHECK_TARGETS := test-unit\n',
    'config/commits.json': '{}\n',
    'packages/go/go.mod': 'module x\n',
    'a.txt': 'a\n',
  });
  symlinkSync('a.txt', path.join(root, 'link.txt'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(check(root), []);
});

test('kit-check fails on a configuration that breaks its schema', (t) => {
  const root = tree(t, { 'Makefile': 'all:\n\t@true\n', 'config/checklist.json': '{ "schema": 1 }\n' });
  assert.ok(check(root).some(line => line.includes('config/checklist.json')), 'the finding names the file');
});

// K987: release.yml waits for the CI workflow by its name, so kit-check requires the ci.yml of the repository to carry that name.
test('kit-check requires the ci.yml of a repository to be named as the CI workflow that release.yml waits for (K987)', (t) => {
  const release = 'on:\n  workflow_run:\n    workflows: [ci]\n    types: [completed]\n';
  assert.equal(ciNameFinding(tree(t, { '.github/workflows/release.yml': release, '.github/workflows/ci.yml': 'name: ci\non:\n  push:\n' })), null);
  assert.match(ciNameFinding(tree(t, { '.github/workflows/release.yml': release, '.github/workflows/ci.yml': 'name: CI\non:\n  push:\n' })) ?? '', /ci\.yml is named CI, but \.github\/workflows\/release\.yml waits for the CI workflow ci/);
  assert.match(ciNameFinding(tree(t, { '.github/workflows/release.yml': release })) ?? '', /ci\.yml is missing/);
  assert.equal(ciNameFinding(tree(t)), null, 'a repository without the release workflow releases nothing');
});
