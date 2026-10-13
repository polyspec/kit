// A package whose directory is the repository root, `.` (K71-2): kit itself is the npm package @polyspec/kit at the root of
// its repository. config/release.json declares it with the directory `.` and the manifest package.json, and the release
// reads that manifest, not `./package.json`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assetNames, context, coverage, loadConfig } from '../../scripts/kit/release.mts';
import { tree } from './tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('a package at the repository root is declared with the directory . and its manifest package.json', (t) => {
  const config = {
    schema: 1, repositoryUrl: 'https://example.com/polyspec/root', changelog: 'CHANGELOG.md',
    packages: [{ kind: 'npm', directory: '.', name: '@polyspec/root' }],
    manifests: { 'package.json': 'archive' }, notReleased: { 'tests/consumer/package.json': 'the consumer project' }, goModules: {},
    consumers: { npm: { directory: 'tests/consumer', smoke: { '@polyspec/root': ['node', '--version'] } } },
  };
  const root = tree(t, { 'config/release.json': JSON.stringify(config), 'package.json': JSON.stringify({ name: '@polyspec/root', version: '1.0.0' }), 'CHANGELOG.md': '# Changelog\n', 'tests/consumer/package.json': JSON.stringify({ name: 'consumer', private: true }) });
  const loaded = loadConfig(root);
  assert.deepEqual(loaded.packages, config.packages);
  assert.deepEqual(coverage(context(root)), []);
});

test('the release configuration of kit declares the package @polyspec/kit at its root and classifies every package file', () => {
  const config = loadConfig(ROOT);
  assert.deepEqual(config.packages, [{ kind: 'npm', directory: '.', name: '@polyspec/kit' }]);
  assert.equal(config.manifests['package.json'], 'archive');
  assert.deepEqual(assetNames(config, '1.2.3'), ['polyspec-kit-npm-1.2.3.tgz']);
  assert.deepEqual(coverage(context(ROOT, { config })), []);
});

test('the release of kit installs the package in a consumer project and smokes its export', () => {
  const config = loadConfig(ROOT);
  const npm = config.consumers?.npm;
  assert.ok(npm, 'config/release.json of kit declares no npm consumer');
  assert.equal(npm.directory, 'tests/release-consumer/npm');
  assert.deepEqual(Object.keys(npm.smoke), ['@polyspec/kit']);
  const manifest = JSON.parse(readFileSync(path.join(ROOT, npm.directory, 'package.json'), 'utf8'));
  // The consumer declares the Node.js floor of the pin, as every package.json does (toolchain-check).
  assert.deepEqual(manifest, { name: 'kit-release-consumer', private: true, engines: { node: '>=26.11.1' } });
});
