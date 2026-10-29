// Tests of kit-sync and kit-check (scripts/kit): a repository holds copies of files of the installed package @polyspec/kit,
// which its package.json declares as `kit.copies`. kit-sync writes them from the package of node_modules, and kit-check
// fails while that package is not the version that package-lock.json resolves, or while a copy differs from its file of the
// package. The package here is a stub directory under node_modules; no test runs npm or uses the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { renameSync, lstatSync, symlinkSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { check, checkConfig, isSource, RETIRED_COPIES } from '../../scripts/kit/kit-check.mts';
import { sync } from '../../scripts/kit/kit-sync.mts';
import { validate, type OwnerDeclaration } from '../../scripts/kit/owner-check.mts';
import { globExpression } from '../../scripts/kit/glob.mts';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { tree } from './tree.mts';
import { COMMIT_MSG, PRE_COMMIT, PRE_MERGE_COMMIT, PRE_PUSH, PREPARE_COMMIT_MSG, REFERENCE_TRANSACTION } from '../../scripts/kit/git-hooks.mts';

// The hooks that make hooks writes into every checkout (K495).
const HOOKS = [PRE_COMMIT, PRE_MERGE_COMMIT, PRE_PUSH, COMMIT_MSG, PREPARE_COMMIT_MSG, REFERENCE_TRANSACTION];
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

// scripts/kit/ of a repository holds the copies of kit only (K133): a file there that the package no longer declares, such
// as scripts/kit/bootstrap/bootstrap-npm.mts after 0.0.39, is removed by kit-sync.
test('kit-sync removes a file of scripts/kit that is no copy (K133)', (t) => {
  const root = repository(t);
  sync(root);
  write(root, 'scripts/kit/bootstrap/bootstrap-npm.mts', 'old\n');
  assert.deepEqual(sync(root), ['removed scripts/kit/bootstrap/bootstrap-npm.mts']);
  assert.equal(existsSync(path.join(root, 'scripts/kit/bootstrap/bootstrap-npm.mts')), false);
  assert.equal(existsSync(path.join(root, 'scripts/kit/bootstrap')), false, 'the emptied directory is removed');
  assert.deepEqual(sync(root), []);
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
  assert.equal(checked.stdout, '[kit-check] the configuration matches its schemas\n');
  const refused = spawnSync(process.execPath, [KIT_SYNC, '--tag', 'v0.1.0'], { cwd: root, encoding: 'utf8' });
  assert.equal(refused.status, 2, refused.stdout);
  assert.equal(refused.stderr, '[kit-sync] kit-sync takes no argument: it writes the copies of the installed package. Usage: node scripts/kit/kit-sync.mts\n');
});

test('kit copies installed shared files and workflows without requiring a sibling checkout (K671-2)', (t) => {
  const ROOT = path.join(import.meta.dirname, '../..');
  const manifest = readFixture<NpmManifest>(ROOT, 'package.json');
  const expected = {
    'PRINCIPLES.md': 'PRINCIPLES.md', 'PRINCIPLES.ko.md': 'PRINCIPLES.ko.md', '.editorconfig': '.editorconfig',
    '.claude/settings.json': 'claude/settings.json', '.github/workflows/release.yml': 'workflows/release.yml',
    '.github/workflows/gates.yml': 'workflows/gates.yml', 'config/layout.kit.yml': 'config/layout.kit.yml',
    'config/pyproject.schema.json': 'config/pyproject.schema.json', 'config/composer.schema.json': 'config/composer.schema.json',
    'config/cargo.schema.json': 'config/cargo.schema.json',
  };
  assert.deepEqual(manifest.kit?.copies, expected);
  const files = Object.fromEntries(Object.values(expected).map(from => [from, readFileSync(path.join(ROOT, from), 'utf8')]));
  const root = path.join(tree(t), 'consumer');
  renameSync(repository(t, { copies: expected, files }), root);
  assert.equal(existsSync(path.join(root, '../kit')), false);
  assert.equal(sync(root).length, Object.keys(expected).length);
  for (const [file, from] of Object.entries(expected)) {
    assert.ok(lstatSync(path.join(root, file)).isFile(), file);
    assert.equal(readFileSync(path.join(root, file), 'utf8'), files[from]);
  }
  assert.deepEqual(sync(root), []);
  const shipped = manifest.files ?? [];
  assert.deepEqual(Object.values(expected).filter(from => !shipped.some(entry => entry === from || (entry.endsWith('/') && from.startsWith(entry)))), []);
});

test('kit-sync migrates matching and stale managed links atomically without changing their provider (K671-2)', (t) => {
  for (const content of ['installed content', 'old provider content']) {
    const root = repository(t, { copies: { 'PRINCIPLES.md': 'PRINCIPLES.md' }, files: { 'PRINCIPLES.md': 'installed content' } });
    write(root, 'provider/principles.md', content);
    symlinkSync('provider/principles.md', path.join(root, 'PRINCIPLES.md'));
    assert.deepEqual(sync(root), ['written PRINCIPLES.md']);
    assert.ok(lstatSync(path.join(root, 'PRINCIPLES.md')).isFile());
    assert.equal(readFileSync(path.join(root, 'PRINCIPLES.md'), 'utf8'), 'installed content');
    assert.equal(readFileSync(path.join(root, 'provider/principles.md'), 'utf8'), content);
    assert.equal(readFileSync(path.join(root, 'node_modules/@polyspec/kit/PRINCIPLES.md'), 'utf8'), 'installed content');
    assert.deepEqual(sync(root), []);
  }
});

test('kit-sync protects the kit source checkout from consumer copy cleanup (K671-2)', (t) => {
  const root = tree(t, { 'package.json': '{"name":"@polyspec/kit"}', 'scripts/kit/tool.mts': '// source' });
  assert.throws(() => sync(root), /source checkout/);
  assert.equal(readFileSync(path.join(root, 'scripts/kit/tool.mts'), 'utf8'), '// source');
  assert.deepEqual(check(root), []);
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
// PHP of the runner; kit-check names it with the fix in CI, whose passed run the release requires (K755).
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
  // make hooks writes the hooks of kit (K495, K522), which a rule that kit ships owns.
  for (const hook of HOOKS) write(root, hook, '#!/bin/sh\n');
  // Installed copies and the consumer commit identity are regular files owned by the shipped rules.
  const held = ['.github/workflows/release.yml', '.github/workflows/gates.yml', '.claude/settings.json', '.editorconfig', 'PRINCIPLES.md', 'PRINCIPLES.ko.md', 'config/commit-identity.json'];
  for (const file of held) write(root, file, `${file}\n`);
  write(root, 'config/owner-checks.json', '{}\n');
  const tracked = [...Object.keys(copies), ...HOOKS, ...held, 'config/owner-checks.json', 'package.json', 'package-lock.json'];
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

// K514-2: the owner rules that kit ships own no file that kit no longer copies, so a consumer after kit-sync passes owner-validate.
test('the owner rules that kit ships name no lint configuration that kit no longer copies (K514-2)', () => {
  const manifest: unknown = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8'));
  const owners = isJsonObject(manifest) && isJsonObject(manifest.kit) && Array.isArray(manifest.kit.owners) ? manifest.kit.owners : [];
  assert.ok(owners.length > 0, 'kit ships owner rules');
  const paths: unknown[] = owners.flatMap((owner: unknown): unknown[] => (isJsonObject(owner) && Array.isArray(owner.paths) ? owner.paths.map((glob: unknown) => glob) : []));
  assert.deepEqual(paths.filter(glob => (RETIRED_COPIES as readonly unknown[]).includes(glob)), []);
});

// K522: the owner rules that kit ships own every hook that make hooks writes, so a consumer that commits them needs no rule of its own.
test('the owner rules that kit ships own every hook that make hooks writes (K522)', () => {
  const manifest: unknown = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8'));
  const owners = isJsonObject(manifest) && isJsonObject(manifest.kit) && Array.isArray(manifest.kit.owners) ? manifest.kit.owners : [];
  const paths: unknown[] = owners.flatMap((owner: unknown): unknown[] => (isJsonObject(owner) && Array.isArray(owner.paths) ? owner.paths.map((glob: unknown) => glob) : []));
  for (const hook of HOOKS) assert.ok(paths.includes(hook), `${hook} is owned`);
});

// K542: a consumer commits the hooks that it wants, so a glob of a rule that kit ships that matches no tracked path of the consumer is
// no error, while a glob of its own rules that matches nothing still is.
test('owner-validate passes a consumer that tracks some of the paths that the shipped rules own (K542)', (t) => {
  const kit = readFixture<NpmManifest>(path.join(import.meta.dirname, '../..'), 'package.json');
  const root = repository(t, { copies: {}, files: {} });
  const some = HOOKS.slice(0, 3);
  for (const hook of some) write(root, hook, '#!/bin/sh\n');
  const owned = ['package.json', 'config/owner-checks.json'];
  const shipped = (kit.kit?.owners ?? []).map(rule => ({ ...rule, shipped: true as const })).filter(rule => rule.paths.some(glob => glob.startsWith('.githooks/')));
  const targets = new Set(shipped.flatMap(rule => rule.targets ?? []).concat(['owner-validate']));
  const project = { make: { targets: new Map([...targets].map(name => [name, { prerequisites: [], recipe: '' }])), variables: new Map<string, string>() }, scripts: {}, workspaces: [], prefixes: [] };
  const exists = (file: string) => existsSync(path.join(root, file));
  const own = { paths: owned, targets: ['owner-validate'] };
  assert.deepEqual(validate({ owners: [own, ...shipped] }, [...owned, ...some], project, exists), [], 'the hooks that the consumer lacks are no error');
  const stale = { paths: ['ruff.toml'], targets: ['owner-validate'] };
  assert.deepEqual(validate({ owners: [own, stale, ...shipped] }, [...owned, ...some], project, exists), ['config/owner-checks.json: the glob ruff.toml matches no tracked path; remove it or correct it']);
});
