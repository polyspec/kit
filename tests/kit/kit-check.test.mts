// Tests of kit-check.mts: the configuration is read against the schemas of kit, and the names of the targets, the suite, the
// tracked links and the other files of a repository are its own (K810).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { check } from '../../scripts/kit/kit-check.mts';
import { initRepository } from './sandbox-repository.mts';
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

// K1051: the recipes and workflows of a repository are its own; kit-check validates the configuration of kit's utilities
// against their schemas and judges no recipe, link step, workflow, path or tool start.
test('kit-check judges no recipe or workflow of a repository (K1051)', (t) => {
  const root = tree(t, {
    'Makefile': 'link-js:\n\tcd packages/js && npm link\nlint:\n\truff check .\ntest:\n\tnode --test tests\n',
    '.github/workflows/ci.yml': 'name: build\njobs:\n  check:\n    steps:\n      - run: npm exec --yes --package=npm@12 -- npm ci\n      - run: make lint\n',
    '.github/workflows/release.yml': 'on:\n  workflow_run:\n    workflows: [ci]\n',
    'config/paths.json': '{ "sibling": "../other-checkout/config" }\n',
  });
  initRepository(root);
  spawnSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
  assert.deepEqual(check(root), []);
});
