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
import { check, checkConfig, isSource } from '../../scripts/kit/kit-check.mts';
import { sync } from '../../scripts/kit/kit-sync.mts';
import { tree } from './tree.mts';

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

test('a sync refuses a package that is not the version of package-lock.json, a lock without the package and a missing install', (t) => {
  assert.throws(() => sync(repository(t, { installed: '0.0.9' })), { message: 'node_modules/@polyspec/kit is 0.0.9, but package-lock.json resolves 0.1.0. Fix: make install-packages' });
  assert.throws(() => sync(repository(t, { locked: null })), { message: 'package-lock.json resolves no @polyspec/kit. Fix: add @polyspec/kit to devDependencies and run make install-packages' });
  assert.throws(() => sync(repository(t, { installed: null })), { message: 'node_modules/@polyspec/kit is not installed; package-lock.json resolves 0.1.0. Fix: make install-packages' });
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

test('kit-check fails while the installed package is not the version that package-lock.json resolves', (t) => {
  const root = repository(t, { installed: '0.0.9' });
  assert.deepEqual(check(root), ['node_modules/@polyspec/kit is 0.0.9, but package-lock.json resolves 0.1.0. Fix: make install-packages']);
  assert.deepEqual(check(repository(t, { locked: null })), ['package-lock.json resolves no @polyspec/kit. Fix: add @polyspec/kit to devDependencies and run make install-packages']);
  assert.deepEqual(check(repository(t, { installed: null })), ['node_modules/@polyspec/kit is not installed; package-lock.json resolves 0.1.0. Fix: make install-packages']);
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
  assert.equal(refused.stderr, '[kit-sync] kit-sync takes no argument: the version is the one that package-lock.json resolves. Usage: node scripts/kit/kit-sync.mts\n');
});

test('the package.json of kit declares its copies: the bootstrap, the release workflow and the principles, each a file of kit', () => {
  const ROOT = path.join(import.meta.dirname, '../..');
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const copies: Record<string, string> = manifest.kit?.copies ?? {};
  const bootstrap = readdirSync(path.join(ROOT, 'scripts/kit/bootstrap')).sort().map(name => `scripts/kit/bootstrap/${name}`);
  assert.ok(bootstrap.length > 0, 'scripts/kit/bootstrap holds no file');
  for (const file of ['scripts/kit/kit-bootstrap.mk', ...bootstrap]) assert.equal(copies[file], file, `${file} is not a copy of itself`);
  assert.equal(copies['.github/workflows/release.yml'], 'workflows/release.yml');
  for (const file of ['PRINCIPLES.md', 'PRINCIPLES.ko.md']) assert.equal(copies[file], file);
  assert.deepEqual(Object.values(copies).filter(from => !existsSync(path.join(ROOT, from))), [], 'these copies have no file in kit');
  const files: string[] = manifest.files ?? [];
  assert.deepEqual(Object.values(copies).filter(from => !files.some(entry => entry === from || (entry.endsWith('/') && from.startsWith(entry)))), [], 'these copies are not in files of package.json, so the package lacks them');
  assert.equal(existsSync(path.join(ROOT, 'kit.json')), false, 'kit.json is gone: package.json holds the version and the copies');
});

test('a generated configuration that breaks its schema names the command that writes it as the fix', (t) => {
  const root = tree(t, { 'config/dependency-review.json': `${JSON.stringify({ schema: 1, comment: 'x', reviewed: '2026-01-01T00:00:00.000Z', locks: [], dependencies: [] })}\n` });
  assert.deepEqual(checkConfig(root), ["config/dependency-review.json: / must have required property 'vcs' {\"missingProperty\":\"vcs\"}. Rule: the schema dependency-review.schema.json of @polyspec/kit. Fix: make dependency-review RECORD=1"]);
});
