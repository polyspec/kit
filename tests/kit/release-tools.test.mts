// The tools of a release (scripts/kit/release-tools.mts): the install-tools that config/release.json needs for its Composer
// packages, wheels and Go modules. No test reaches a registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, missingTools, needsInstallTools, releaseSteps } from '../../scripts/kit/release-tools.mts';
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

// K1190: a per-platform package builds with the Rust toolchain of rust-toolchain.toml, which install-tools installs with rustup,
// and with the Python, uv and other tools of mise.lock; an npm-native package also needs the napi CLI of the repository, which
// install-packages installs from its devDependencies, and no tool of kit installs it.
test('K1190: release-tools runs install-tools for each per-platform package kind', () => {
  for (const kind of ['wheel-abi3', 'php-ext', 'npm-native', 'go-static']) {
    assert.equal(needsInstallTools({ packages: [{ kind }], goModules: {} }), true, kind);
    assert.deepEqual(releaseSteps({ packages: [{ kind }], goModules: {} }), ['install-tools'], kind);
  }
});

test('K1190: an npm-native package needs the napi CLI of the repository, and release-tools fails naming the fix before it installs anything', (t) => {
  const repository = mkdtempSync(path.join(tmpdir(), 'release-tools-napi-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  initRepository(repository);
  const config = { packages: [{ kind: 'npm-native' }], goModules: {} };
  const missing = /node_modules\/\.bin\/napi is missing; an npm-native package builds with the napi CLI of the repository: declare @napi-rs\/cli in devDependencies of package\.json and run make install-packages/;
  assert.match(missingTools(repository, config).join('\n'), missing);
  assert.deepEqual(missingTools(repository, { packages: [{ kind: 'go-static' }], goModules: {} }), [], 'no other kind needs it');
  mkdirSync(path.join(repository, 'node_modules/.bin'), { recursive: true });
  writeFileSync(path.join(repository, 'node_modules/.bin/napi'), '#!/bin/sh\n', { mode: 0o755 });
  assert.deepEqual(missingTools(repository, config), []);
  rmSync(path.join(repository, 'node_modules'), { recursive: true, force: true });
  // The command line reads config/release.json and stops before install-tools.
  mkdirSync(path.join(repository, 'config'));
  writeFileSync(path.join(repository, 'config/release.json'), `${JSON.stringify({ schema: 1, repositoryUrl: 'https://github.com/acme/x', changelog: 'CHANGELOG.md', packages: [{ kind: 'npm-native', directory: 'packages/x', name: '@acme/x', product: 'x', runtime: 'ts', platforms: ['darwin-arm64'] }], manifests: { 'packages/x/package.json': 'archive' }, notReleased: {}, goModules: {} })}\n`);
  const lines: string[] = [];
  assert.equal(main([], { root: repository, env: { ...process.env, PATH: '' }, print: line => lines.push(line), error: line => lines.push(line) }), 1, lines.join('\n'));
  assert.match(lines.join('\n'), missing);
  assert.ok(!lines.some(line => line === '[release-tools] install-tools'), 'install-tools did not run');
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
