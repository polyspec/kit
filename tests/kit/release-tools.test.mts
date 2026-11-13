// The tools of a release (scripts/kit/release-tools.mts): the install-tools that config/release.json needs for its Composer
// packages, wheels and Go modules. No test reaches a registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { needsInstallTools, releaseSteps } from '../../scripts/kit/release-tools.mts';
import { tool } from './kit-tools.mts';
import { initRepository } from './sandbox-repository.mts';
import { readJsonFile } from '../../scripts/kit/schema-validate.mts';
import type { ReleaseConfig } from '../../scripts/kit/release.mts';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture/config/release.json');

test('release-tools runs install-tools for the fixture configuration', () => {
  assert.equal(needsInstallTools(readJsonFile<ReleaseConfig>(FIXTURE, 'release.schema.json')), true);
});

test('release-tools runs install-tools for a Composer package, a wheel and a Go module, and nothing for an npm package, whose npm is the bootstrap', () => {
  assert.equal(needsInstallTools({ packages: [{ kind: 'composer' }], goModules: {} }), true);
  assert.equal(needsInstallTools({ packages: [{ kind: 'wheel' }], goModules: {} }), true);
  assert.equal(needsInstallTools({ packages: [], goModules: { 'packages/go': 'example.com/go' } }), true);
  assert.equal(needsInstallTools({ packages: [{ kind: 'npm' }], goModules: {} }), false);
});

test('K930 a make entry adds no step to releaseSteps', () => {
  // kit installs nothing for a make entry: a repository whose target needs the PHP installs it in its release-prepare rule.
  assert.deepEqual(releaseSteps({ packages: [{ kind: 'npm' }], goModules: {} }), []);
  assert.deepEqual(releaseSteps({ packages: [{ kind: 'npm', generated: [{ kind: 'make', target: 'gen', outputs: ['src/a.h'] }] }], goModules: {} }), []);
  assert.deepEqual(releaseSteps({ packages: [{ kind: 'composer', generated: [{ kind: 'make', target: 'gen', outputs: ['src/a.h'] }] }], goModules: {} }), ['install-tools'], 'the Composer package needs install-tools for itself');
});

test('release-tools reads config/release.json of the repository it runs in, not of the checkout of its module (K71-2)', (t) => {
  // The tools of a package run from node_modules/@polyspec/kit/dist, so the location of the module names no repository: the
  // tool of this checkout, whose own config/release.json is valid, runs in another repository (kit-tools.mts).
  const repository = mkdtempSync(path.join(tmpdir(), 'release-tools-repository-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  initRepository(repository);
  mkdirSync(path.join(repository, 'config'));
  writeFileSync(path.join(repository, 'config/release.json'), '{}');
  const ran = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/release-tools.mts'))], { cwd: repository, encoding: 'utf8' });
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /config\/release\.json: \/ must have required property 'repositoryUrl'/);
});
