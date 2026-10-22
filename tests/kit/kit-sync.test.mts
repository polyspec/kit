// Tests of kit-sync and kit-check (scripts/kit): a repository holds copies of files of the installed package @polyspec/kit,
// which its package.json declares as `kit.copies`. kit-sync writes them from the package of node_modules, and kit-check
// fails while that package is not the version that package-lock.json resolves, or while a copy differs from its file of the
// package. The package here is a stub directory under node_modules; no test runs npm or uses the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { check, checkConfig, isSource, RETIRED_COPIES } from '../../scripts/kit/kit-check.mts';
import { sync } from '../../scripts/kit/kit-sync.mts';
import { validate, type OwnerDeclaration } from '../../scripts/kit/owner-check.mts';
import { globExpression } from '../../scripts/kit/glob.mts';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { tree } from './tree.mts';
import { readFixture } from './json-fixture.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';

const KIT_SYNC = path.join(import.meta.dirname, '../../scripts/kit/kit-sync.mts');
const KIT_CHECK = path.join(import.meta.dirname, '../../scripts/kit/kit-check.mts');
const COPIES = { 'scripts/kit/kit-bootstrap.mk': 'scripts/kit/kit-bootstrap.mk', '.github/workflows/release.yml': 'workflows/release.yml' };
const FILES = { 'scripts/kit/kit-bootstrap.mk': 'KIT := node_modules/@polyspec/kit/dist\n', 'workflows/release.yml': 'on: push\n' };

const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

/**
 * A repository whose package-lock.json resolves @polyspec/kit `locked` (none for null) and whose node_modules holds the package
 * at `installed` (none for null) with `copies` and the files `files`.
 */
function repository(t: TestContext, { locked = '0.1.0', installed = '0.1.0', copies = COPIES, files = FILES }: { locked?: string | null; installed?: string | null; copies?: Record<string, string>; files?: Record<string, string> } = {}) {
  const root = tree(t, { 'package.json': `${JSON.stringify({ name: 'consumer', private: true, devDependencies: { '@polyspec/kit': locked ?? '0.1.0' } })}\n` });
  const packages: Record<string, unknown> = { '': { name: 'consumer' } };
  if (locked !== null) packages['node_modules/@polyspec/kit'] = { version: locked, dev: true };
  write(root, 'package-lock.json', `${JSON.stringify({ name: 'consumer', lockfileVersion: 3, packages })}\n`);
  if (installed !== null) {
    write(root, 'node_modules/@polyspec/kit/package.json', `${JSON.stringify({ name: '@polyspec/kit', version: installed, kit: { copies } })}\n`);
    for (const [file, text] of Object.entries(files)) write(root, path.join('node_modules/@polyspec/kit', file), text);
  }
  return root;
}

test('the first sync writes each copy from the installed package, and a second sync writes nothing', (t) => {
  const root = repository(t);
  assert.deepEqual(sync(root), ['added scripts/kit/kit-bootstrap.mk', 'added .github/workflows/release.yml']);
  assert.equal(readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), 'on: push\n');
  assert.equal(readFileSync(path.join(root, 'scripts/kit/kit-bootstrap.mk'), 'utf8'), FILES['scripts/kit/kit-bootstrap.mk']);
  assert.deepEqual(sync(root), []);
  assert.deepEqual(check(root), []);
});

test('a sync writes a copy that differs from the package, and only that copy', (t) => {
  const root = repository(t);
  sync(root);
  write(root, '.github/workflows/release.yml', 'on: pull_request\n');
  assert.deepEqual(sync(root), ['written .github/workflows/release.yml']);
  assert.equal(readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'), 'on: push\n');
});

test('a sync writes the copies of the installed package of any version, such as a linked checkout, and refuses a missing install (K267)', (t) => {
  assert.doesNotThrow(() => sync(repository(t, { installed: '0.0.9' })), 'npm ci enforces the lock at install time; a sync reads what is installed');
  assert.throws(() => sync(repository(t, { installed: null })), { message: 'node_modules/@polyspec/kit is not installed. Fix: make install-packages' });
});

test('a copy whose path leaves its directory is refused, and nothing is written', (t) => {
  const root = repository(t, { copies: { '../outside.txt': 'workflows/release.yml' } });
  assert.throws(() => sync(root), { message: 'kit.copies path "../outside.txt" is not a relative path inside its directory' });
  assert.equal(existsSync(path.join(root, '../outside.txt')), false);
});

test('kit-check names a copy that differs and a copy that is missing, with the version and the fix', (t) => {
  const root = repository(t);
  sync(root);
  write(root, 'scripts/kit/kit-bootstrap.mk', 'changed\n');
  writeFileSync(path.join(root, '.github/workflows/release.yml'), '');
  assert.deepEqual(check(root), [
    'scripts/kit/kit-bootstrap.mk: differs from node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk of @polyspec/kit 0.1.0. Fix: make kit-sync',
    '.github/workflows/release.yml: differs from node_modules/@polyspec/kit/workflows/release.yml of @polyspec/kit 0.1.0. Fix: make kit-sync',
  ]);
  const missing = repository(t);
  assert.deepEqual(check(missing), [
    'scripts/kit/kit-bootstrap.mk: the copy of @polyspec/kit 0.1.0 is missing. Fix: make kit-sync',
    '.github/workflows/release.yml: the copy of @polyspec/kit 0.1.0 is missing. Fix: make kit-sync',
  ]);
});

// scripts/kit/ of a repository holds the copies of kit only (K133): a file there that the package no longer declares, such
// as scripts/kit/bootstrap/bootstrap-npm.mts after 0.0.39, is removed by kit-sync and named by kit-check.
test('kit-sync removes a file of scripts/kit that is no copy, and kit-check names it (K133)', (t) => {
  const root = repository(t);
  sync(root);
  write(root, 'scripts/kit/bootstrap/bootstrap-npm.mts', 'old\n');
  assert.deepEqual(check(root), ['scripts/kit/bootstrap/bootstrap-npm.mts is no copy of @polyspec/kit 0.1.0; scripts/kit holds the copies of kit only. Fix: make kit-sync, which removes it']);
  assert.deepEqual(sync(root), ['removed scripts/kit/bootstrap/bootstrap-npm.mts']);
  assert.equal(existsSync(path.join(root, 'scripts/kit/bootstrap/bootstrap-npm.mts')), false);
  assert.equal(existsSync(path.join(root, 'scripts/kit/bootstrap')), false, 'the emptied directory is removed');
  assert.deepEqual(check(root), []);
  assert.deepEqual(sync(root), []);
});

test('kit-check compares the copies with the installed package of any version, and fails on a missing install (K267)', (t) => {
  const root = repository(t, { installed: '0.0.9' });
  sync(root);
  assert.deepEqual(check(root), [], 'a linked or other installed version is checked by its content');
  assert.deepEqual(check(repository(t, { installed: null })), ['node_modules/@polyspec/kit is not installed. Fix: make install-packages']);
  const unlocked = repository(t);
  rmSync(path.join(unlocked, 'package-lock.json'));
  assert.deepEqual(check(unlocked), ['package-lock.json is missing; it locks @polyspec/kit. Fix: run make install-packages and commit package-lock.json']);
});

test('kit itself is the source of the copies: its check reads its configuration only', (t) => {
  const root = tree(t, { 'package.json': `${JSON.stringify({ name: '@polyspec/kit', version: '0.1.0' })}\n` });
  assert.equal(isSource(root), true);
  assert.deepEqual(check(root), []);
});

test('the commands run in the repository of their working directory and print the changes and the findings', (t) => {
  const root = repository(t);
  const synced = spawnSync(process.execPath, [KIT_SYNC], { cwd: root, encoding: 'utf8' });
  assert.equal(synced.status, 0, synced.stderr);
  assert.equal(synced.stdout, '[kit-sync] added scripts/kit/kit-bootstrap.mk\n[kit-sync] added .github/workflows/release.yml\n[kit-sync] 2 changes from @polyspec/kit 0.1.0\n');
  const again = spawnSync(process.execPath, [KIT_SYNC], { cwd: root, encoding: 'utf8' });
  assert.equal(again.stdout, '[kit-sync] unchanged: @polyspec/kit 0.1.0\n');
  const checked = spawnSync(process.execPath, [KIT_CHECK], { cwd: root, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stdout, '[kit-check] the configuration matches its schemas and the copies match @polyspec/kit 0.1.0\n');
  const refused = spawnSync(process.execPath, [KIT_SYNC, '--tag', 'v0.1.0'], { cwd: root, encoding: 'utf8' });
  assert.equal(refused.status, 2, refused.stdout);
  assert.equal(refused.stderr, '[kit-sync] kit-sync takes no argument: it writes the copies of the installed package. Usage: node scripts/kit/kit-sync.mts\n');
});

test('the package.json of kit declares its copies: the bootstrap, the release workflow and the principles, each a file of kit', () => {
  const ROOT = path.join(import.meta.dirname, '../..');
  const manifest = readFixture<NpmManifest>(ROOT, 'package.json');
  const copies = manifest.kit?.copies;
  assert.ok(copies, 'package.json declares no kit.copies');
  const bootstrap = readdirSync(path.join(ROOT, 'scripts/kit/bootstrap')).sort().map(name => `scripts/kit/bootstrap/${name}`);
  assert.ok(bootstrap.length > 0, 'scripts/kit/bootstrap holds no file');
  for (const file of ['scripts/kit/kit-bootstrap.mk', ...bootstrap]) assert.equal(copies[file], file, `${file} is not a copy of itself`);
  assert.equal(copies['.github/workflows/release.yml'], 'workflows/release.yml');
  for (const file of ['PRINCIPLES.md', 'PRINCIPLES.ko.md']) assert.equal(copies[file], file);
  assert.deepEqual(Object.values(copies).filter(from => !existsSync(path.join(ROOT, from))), [], 'these copies have no file in kit');
  const { files } = manifest;
  assert.ok(files, 'package.json declares no files');
  assert.deepEqual(Object.values(copies).filter(from => !files.some(entry => entry === from || (entry.endsWith('/') && from.startsWith(entry)))), [], 'these copies are not in files of package.json, so the package lacks them');
  assert.equal(existsSync(path.join(ROOT, 'kit.json')), false, 'kit.json is gone: package.json holds the version and the copies');
});

// K166: the build backend of the wheels has one declaration, pythonBackend of config/toolchain.json, so a release with a
// wheel package or the wheel consumer and without it fails kit-check with the fix, not later in the release.
test('kit-check names a wheel release without pythonBackend of config/toolchain.json, with the fix', (t) => {
  const fixture = readFileSync(path.join(import.meta.dirname, 'fixture/config/release.json'), 'utf8');
  const root = tree(t, { 'config/release.json': fixture, 'config/toolchain.json': `${JSON.stringify({ schema: 1 })}\n`, '.php-version': '8.5\n' });
  const [finding, ...rest] = checkConfig(root);
  assert.deepEqual(rest, []);
  assert.match(finding ?? '', /^config\/release\.json: the wheel packages \[kit-fixture\] and the wheel consumer need the build backend of the wheels, pythonBackend of config\/toolchain\.json, which it does not declare\. Fix: declare pythonBackend \{ "requirement": "<name>==<version>", "sha256": "<sha256 of its wheel>" \} in config\/toolchain\.json and run make install-tools$/);
  rmSync(path.join(root, 'config/toolchain.json'));
  assert.equal(checkConfig(root).length, 1);
  const { packages, ...config } = readFixture<{ packages: { kind: string }[] }>(root, 'config/release.json');
  write(root, 'config/release.json', `${JSON.stringify({ ...config, packages: packages.filter(({ kind }) => kind !== 'wheel') })}\n`);
  assert.deepEqual(checkConfig(root).map(line => line.split('. Fix:')[0]), ['config/release.json: the wheel consumer needs the build backend of the wheels, pythonBackend of config/toolchain.json, which it does not declare']);
  write(root, 'config/toolchain.json', `${JSON.stringify({ schema: 1, pythonBackend: { requirement: 'setuptools==84.0.0', sha256: 'a'.repeat(64) } })}\n`);
  assert.deepEqual(checkConfig(root), []);
});

// K193: the release workflow sets up the PHP of .php-version only, so a repository that needs PHP without it released with the
// PHP of the runner; kit-check names it with the fix, and the release workflow runs kit-check before any release step.
test('kit-check names a repository that needs PHP without .php-version: Composer packages, the Composer consumer, php of the toolchain', (t) => {
  const fixture = readFileSync(path.join(import.meta.dirname, 'fixture/config/release.json'), 'utf8');
  const backend = { schema: 1, pythonBackend: { requirement: 'setuptools==84.0.0', sha256: 'a'.repeat(64) } };
  const root = tree(t, { 'config/release.json': fixture, 'config/toolchain.json': `${JSON.stringify(backend)}\n` });
  assert.deepEqual(checkConfig(root), ['.php-version is missing, but the Composer packages [polyspec/kit-fixture] of config/release.json and the Composer consumer of config/release.json need PHP; CI and the release workflow set up the PHP of .php-version, and without it the release runs the PHP of the runner. Fix: declare .php-version with the PHP minor release, such as <major>.<minor>']);
  write(root, 'config/toolchain.json', `${JSON.stringify({ ...backend, php: ['8.5'] })}\n`);
  assert.match(checkConfig(root).join(), /and php \["8\.5"\] of config\/toolchain\.json need PHP; .* Fix: declare \.php-version with the PHP minor release, such as 8\.5$/);
  write(root, '.php-version', '8.5\n');
  assert.deepEqual(checkConfig(root), []);
  rmSync(path.join(root, 'config/release.json'));
  rmSync(path.join(root, '.php-version'));
  assert.deepEqual(checkConfig(root).map(line => line.split(' need PHP')[0]), ['.php-version is missing, but php ["8.5"] of config/toolchain.json'], 'php of the toolchain needs .php-version without a release');
  write(root, 'config/toolchain.json', `${JSON.stringify({ schema: 1 })}\n`);
  assert.deepEqual(checkConfig(root), [], 'a repository without PHP needs no .php-version');
});

test('a generated configuration that breaks its schema names the command that writes it as the fix', (t) => {
  const root = tree(t, { 'config/dependency-review.json': `${JSON.stringify({ schema: 1, comment: 'x', reviewed: '2026-01-01T00:00:00.000Z', locks: [], dependencies: [] })}\n` });
  assert.deepEqual(checkConfig(root), ["config/dependency-review.json: / must have required property 'vcs' {\"missingProperty\":\"vcs\"}. Rule: the schema dependency-review.schema.json of @polyspec/kit. Fix: make dependency-review RECORD=1"]);
});

// K356: kit-sync writes clippy.toml into every repository, so the layout of the repository must declare it among its root files;
// the root files of config/layout.kit.yml must name each root-level key of kit.copies, or make layout-check fails there.
test('every root file that kit-sync writes is declared among the root files of config/layout.kit.yml (K356)', () => {
  const kitRoot = path.join(import.meta.dirname, '../..');
  const manifest: unknown = JSON.parse(readFileSync(path.join(kitRoot, 'package.json'), 'utf8'));
  const layout = readFileSync(path.join(kitRoot, 'config/layout.kit.yml'), 'utf8');
  if (!isJsonObject(manifest) || !isJsonObject(manifest.kit) || !isJsonObject(manifest.kit.copies)) throw new Error('package.json of kit holds no kit.copies object');
  for (const key of Object.keys(manifest.kit.copies)) {
    if (key.includes('/')) continue;
    assert.ok(layout.includes(`"!${key}"`), `${key} is a root file that kit-sync writes, but config/layout.kit.yml does not declare it: add "!${key}" to the root files of layout-root-files`);
  }
});

// K410-1: kit-sync writes the copies of kit.copies into a consumer, and the owner rules that kit ships (kit.owners of its
// package.json) own them, so owner-validate of the consumer passes after a sync with no rule of its own for them.
test('a consumer after kit-sync passes owner-validate with the rules that kit ships, and no rule of its own (K410-1)', (t) => {
  const kit = readFixture<NpmManifest>(path.join(import.meta.dirname, '../..'), 'package.json');
  const copies = kit.kit?.copies ?? {};
  const files = Object.fromEntries(Object.values(copies).map(from => [from, `${from}\n`]));
  const root = repository(t, { copies, files });
  sync(root);
  write(root, '.githooks/prepare-commit-msg', '#!/bin/sh\n');
  write(root, 'config/owner-checks.json', '{}\n');
  const tracked = [...Object.keys(copies), '.githooks/prepare-commit-msg', 'config/owner-checks.json', 'package.json', 'package-lock.json'];
  const own: OwnerDeclaration = { owners: [{ paths: ['package.json', 'package-lock.json', 'config/owner-checks.json'], targets: ['owner-validate'] }] };
  const targets = new Set((kit.kit?.owners ?? []).flatMap(rule => rule.targets ?? []).concat(['owner-validate']));
  const project = { make: { targets: new Map([...targets].map(name => [name, { prerequisites: [], recipe: '' }])), variables: new Map<string, string>() }, scripts: {}, workspaces: [], prefixes: [] };
  const declaration = { owners: [...own.owners, ...(kit.kit?.owners ?? [])] };
  assert.deepEqual(validate(declaration, tracked, project, file => existsSync(path.join(root, file))), []);
});

test('every file that kit-sync writes is owned by a rule that kit ships (K410-1)', () => {
  const kit = readFixture<NpmManifest>(path.join(import.meta.dirname, '../..'), 'package.json');
  const rules = kit.kit?.owners ?? [];
  for (const file of Object.keys(kit.kit?.copies ?? {})) {
    assert.ok(rules.some(({ paths }) => paths.some(glob => globExpression(glob).test(file))), `${file} is written by kit-sync, and no rule of kit.owners in package.json owns it`);
  }
});

// K514: the lint configurations are read from the kit package and no longer copied; a sync removes the copy that an earlier kit
// wrote, and kit.copies of the package names none of them.
test('kit-sync removes the lint configurations that kit no longer copies, and the package copies none of them (K514)', (t) => {
  const root = repository(t);
  for (const file of ['ruff.toml', 'phpcs.xml.dist', 'phpstan.dist.neon', '.golangci.yml', 'clippy.toml', '.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json']) write(root, file, 'an old copy\n');
  const changes = sync(root);
  for (const file of ['ruff.toml', 'phpcs.xml.dist', 'phpstan.dist.neon', '.golangci.yml', 'clippy.toml', '.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json']) {
    assert.equal(existsSync(path.join(root, file)), false, file);
    assert.ok(changes.includes(`removed ${file}`), changes.join('\n'));
  }
  const manifest: unknown = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8'));
  const copies = isJsonObject(manifest) && isJsonObject(manifest.kit) && isJsonObject(manifest.kit.copies) ? Object.keys(manifest.kit.copies) : [];
  assert.deepEqual(copies.filter(file => (RETIRED_COPIES as readonly string[]).includes(file)), [], 'kit.copies names no retired copy');
});

// K514-1: a lint configuration that an earlier kit copied and that kit now reads from its package is named by kit-check in a
// consumer, with kit-sync as its fix, so a stale copy that an editor would still read does not stay in silence.
test('kit-check names each lint configuration that kit no longer copies, and passes after kit-sync (K514-1)', (t) => {
  const root = repository(t);
  sync(root);
  write(root, 'ruff.toml', 'an old copy\n');
  write(root, 'config/api-extractor.kit.json', 'an old copy\n');
  const found = check(root);
  assert.ok(found.some(line => line.startsWith('ruff.toml: ') && line.includes('make kit-sync')), found.join('\n'));
  assert.ok(found.some(line => line.startsWith('config/api-extractor.kit.json: ') && line.includes('make kit-sync')), found.join('\n'));
  sync(root);
  assert.deepEqual(check(root).filter(line => line.includes('no longer copies')), []);
});
