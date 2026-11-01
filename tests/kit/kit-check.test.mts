// Tests of kit-check.mts: the configuration is read against the schemas of kit, and the names of the targets, the suite, the
// tracked links and the other files of a repository are its own (K810).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { bootstrapCopyFindings, check, ciNameFinding } from '../../scripts/kit/kit-check.mts';
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

// K992: the bootstrap of a CI job is the action that kit-sync vendors; a workflow of the repository with its own copy of the
// bootstrap is named by file and line, and the copies of kit are left to the copy check.
test('kit-check names each workflow line of a repository that copies the bootstrap of kit, and leaves the copies of kit alone (K992)', (t) => {
  const copy = 'jobs:\n  check:\n    steps:\n      - run: |\n          root="$PWD"\n          (cd "$RUNNER_TEMP" && npm exec --yes --package="npm@$version" -- npm --prefix "$root" ci --ignore-scripts --allow-remote=root)\n';
  // The form of an earlier kit, the npm of packageManager without --prefix, is a copy too.
  const earlier = 'jobs:\n  check:\n    steps:\n      - run: npm exec --yes --package="$(node -p \'require("./package.json").packageManager\')" -- npm ci --ignore-scripts --allow-remote=root\n';
  const root = tree(t, { '.github/workflows/ci.yml': copy, '.github/workflows/pages.yaml': copy, '.github/workflows/old.yml': earlier, '.github/workflows/ci-pipeline.yml': copy, '.github/workflows/clean.yml': 'jobs:\n  check:\n    steps:\n      - uses: ./.github/actions/kit-bootstrap\n      - run: npm ci --prefix tools\n' });
  const findings = bootstrapCopyFindings(root, new Set(['.github/workflows/ci-pipeline.yml']));
  assert.deepEqual(findings.map(finding => finding.split(' ')[0]), ['.github/workflows/ci.yml:6', '.github/workflows/old.yml:4', '.github/workflows/pages.yaml:6']);
  assert.match(findings[0] ?? '', /carries a copy of the bootstrap of kit; run the vendored action with `uses: \.\/\.github\/actions\/kit-bootstrap` after the checkout of the job instead \(K992, K996\)/);
  assert.deepEqual(bootstrapCopyFindings(tree(t), new Set()), [], 'a repository without workflows has no finding');
});

// K996: a copy whose npm ci runs through a target of the repository (make bootstrap of hyper) is named by its npm install, the
// step that only the bootstrap runs; the name of that step and a comment that quotes it are no copy.
test('kit-check names a bootstrap copy that runs npm ci through make bootstrap (K996)', (t) => {
  const hyper = 'jobs:\n  check:\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n      - name: make bootstrap\n        run: make bootstrap\n      - name: make install-tools TOOLS=npm\n        run: make install-tools TOOLS=npm\n      - name: make install-packages\n        run: make install-packages\n      - run: |\n          # make install-tools TOOLS=npm\n          make install-tools TOOLS=npm\n';
  assert.deepEqual(bootstrapCopyFindings(tree(t, { '.github/workflows/ci.yml': hyper }), new Set()).map(finding => finding.split(' ')[0]), ['.github/workflows/ci.yml:9', '.github/workflows/ci.yml:14']);
});
