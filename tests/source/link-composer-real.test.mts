// The Composer link on the real Composer of this checkout (K304-1): the polyspec package is installed from its folder through a path
// repository with `symlink`, in a git-ignored composer.link.json that comes before the archive repository of the release, so the
// record, the autoload rules and the platform check come from the composer.json of the folder, Composer checks the versions at that
// install, and the tracked composer.json and composer.lock are untouched. Nothing is stubbed; `make install-tools` installs Composer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { link } from '../../scripts/kit/link.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { put } from '../kit/tree.mts';
import { installedBinary } from './real-tools.mts';
import { readJsonFile } from '../../scripts/kit/schema-validate.mts';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';

/** Runs `command` in `directory` and fails with its output. */
function run(directory: string, command: string, ...args: string[]) {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** A repository `name` below `root` with `files`, tracked and committed. */
function repository(root: string, name: string, files: Record<string, string>): string {
  const directory = path.join(root, name);
  initRepository(directory);
  put(directory, files);
  run(directory, 'git', 'add', '-A');
  run(directory, 'git', '-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', 'commit', '--quiet', '-m', 'files');
  return directory;
}

test('linked exact requirements pass strict validation while stale and published manifests still fail (K481, K304-1)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-composer-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const composer = installedBinary('composer');
  const provider = repository(root, 'prov', {
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', require: { php: '>=8.4' }, autoload: { 'psr-4': { 'Y\\': 'lib/' } } }),
    'packages/php/lib/Hello.php': '<?php\n\nnamespace Y;\n\nfinal class Hello\n{\n}\n',
  });
  // The released archive of 0.0.1 requires PHP 99, as a release built for a newer PHP than the one that runs.
  const archives = path.join(root, 'archives');
  mkdirSync(archives, { recursive: true });
  put(root, { 'archive/composer.json': JSON.stringify({ name: 'polyspec/y', version: '0.0.1', require: { php: '>=99.0' } }), 'archive/Y.php': '<?php\n' });
  run(path.join(root, 'archive'), 'zip', '-q', path.join(archives, 'polyspec-y-0.0.1.zip'), 'composer.json', 'Y.php');
  const consumer = repository(root, 'cons', {
    'composer.json': JSON.stringify({ name: 'cons/app', license: 'MIT', require: { 'polyspec/y': '0.0.1' }, repositories: [{ type: 'artifact', url: '../archives' }, { packagist: false }], config: { platform: { php: '8.4.1' } } }),
    '.gitignore': 'vendor/\nvar/\n',
  });
  // The state before the link: the lock cannot resolve the archive at PHP 8.4.1, so the lock is made with the platform check off.
  run(consumer, composer, 'update', '--no-interaction', '--no-scripts', '--ignore-platform-reqs');
  run(consumer, 'git', 'add', 'composer.lock');
  run(consumer, 'git', '-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', 'commit', '--quiet', '-m', 'lock');
  const tracked = { manifest: readFileSync(path.join(consumer, 'composer.json'), 'utf8'), lock: readFileSync(path.join(consumer, 'composer.lock'), 'utf8') };
  mkdirSync(path.join(consumer, 'var'), { recursive: true });
  // The state that the earlier mechanism left: the installed folder is a symbolic link over the install of the archive.
  rmSync(path.join(consumer, 'vendor/polyspec/y'), { recursive: true, force: true });
  symlinkSync(path.join(provider, 'packages/php'), path.join(consumer, 'vendor/polyspec/y'));
  const lines: string[] = [];
  assert.equal(link({ checkouts: [provider, consumer], directories: [consumer], check: false, print: text => lines.push(text), env: { ...process.env, COMPOSER_BIN: composer } }), true, lines.join('\n'));
  assert.equal(lstatSync(path.join(consumer, 'vendor/polyspec/y')).isSymbolicLink(), true, 'the installed folder is a link');
  assert.equal(realpathSync(path.join(consumer, 'vendor/polyspec/y')), path.join(provider, 'packages/php'));
  const record = readJsonFile<{ packages: { name: string; dist?: { type: string } }[] }>(path.join(consumer, 'vendor/composer/installed.json'), 'composer-lock.schema.json');
  assert.equal(record.packages.find(item => item.name === 'polyspec/y')?.dist?.type, 'path', 'Composer installed the package from its path repository, not from the archive');
  assert.doesNotMatch(readFileSync(path.join(consumer, 'vendor/composer/platform_check.php'), 'utf8'), /99/, 'the platform check follows the composer.json of the folder');
  const autoload = spawnSync('php', ['-r', "require 'vendor/autoload.php'; echo class_exists('Y\\\\Hello') ? 'loaded' : 'missing';"], { cwd: consumer, encoding: 'utf8' });
  assert.equal(autoload.status, 0, autoload.stderr + autoload.stdout);
  assert.equal(autoload.stdout, 'loaded');
  assert.equal(readFileSync(path.join(consumer, 'composer.json'), 'utf8'), tracked.manifest, 'the tracked composer.json is unchanged');
  assert.equal(readFileSync(path.join(consumer, 'composer.lock'), 'utf8'), tracked.lock, 'the tracked composer.lock is unchanged');
  const strictLink = spawnSync(composer, ['validate', '--strict', '--no-check-publish', '--no-interaction'], { cwd: consumer, encoding: 'utf8', env: { ...process.env, COMPOSER: 'composer.link.json' } });
  assert.equal(strictLink.status, 0, `${strictLink.stdout}${strictLink.stderr}`);
  const publishedValue: unknown = readJsonFile(path.join(consumer, 'composer.json'), 'composer-manifest.schema.json');
  if (!isJsonObject(publishedValue) || !isJsonObject(publishedValue.require)) throw new Error('published composer.json has no require');
  publishedValue.require['polyspec/y'] = 'v1.0.0-p1';
  put(consumer, { 'composer.json': JSON.stringify(publishedValue) });
  const strictPublished = spawnSync(composer, ['validate', '--strict', '--no-check-publish', '--no-interaction'], { cwd: consumer, encoding: 'utf8' });
  assert.notEqual(strictPublished.status, 0, 'strict validation still refuses an ordinary manifest exact-version warning');
  assert.match(`${strictPublished.stdout}${strictPublished.stderr}`, /exact version constraints/);
  put(consumer, { 'composer.json': tracked.manifest });
  const generatedValue: unknown = readJsonFile(path.join(consumer, 'composer.link.json'), 'composer-manifest.schema.json');
  if (!isJsonObject(generatedValue) || !isJsonObject(generatedValue.require)) throw new Error('composer.link.json has no require');
  generatedValue.require['polyspec/y'] = '^0.0.2';
  const generated = generatedValue;
  put(consumer, { 'composer.link.json': JSON.stringify(generated, null, 4) });
  const staleLink = spawnSync(composer, ['validate', '--strict', '--no-check-publish', '--no-interaction'], { cwd: consumer, encoding: 'utf8', env: { ...process.env, COMPOSER: 'composer.link.json' } });
  assert.notEqual(staleLink.status, 0, 'strict validation still refuses a stale generated lock');
  assert.match(`${staleLink.stdout}${staleLink.stderr}`, /lock file is not up to date/);
  assert.equal(run(consumer, 'git', 'status', '--porcelain'), '', 'the link files are ignored by Git');
});

// K331: a dependency that a linked package now requires at another constraint is resolved by the link, since the partial update lists
// the linked package with its dependencies (--with-dependencies), while a package it does not need stays at the locked release.
test('the dependency that a linked package raises is resolved by the link, an unrelated package stays locked (K331)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-composer-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const composer = installedBinary('composer');
  const archives = path.join(root, 'archives');
  mkdirSync(archives, { recursive: true });
  const archive = (name: string, version: string, require: Record<string, string> = {}) => {
    const folder = `archive-${name.replace('/', '-')}-${version}`;
    put(root, { [`${folder}/composer.json`]: JSON.stringify({ name, version, require }), [`${folder}/x.php`]: '<?php\n' });
    run(path.join(root, folder), 'zip', '-q', path.join(archives, `${name.replace('/', '-')}-${version}.zip`), 'composer.json', 'x.php');
  };
  archive('dep/a', '1.0.0');
  archive('dep/b', '1.0.0');
  archive('polyspec/y', '0.0.1', { 'dep/a': '^1.0' });
  const provider = repository(root, 'prov', { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', require: { 'dep/a': '^1.1' } }) });
  const consumer = repository(root, 'cons', {
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1', 'dep/b': '^1.0' }, repositories: [{ type: 'artifact', url: '../archives' }, { packagist: false }] }),
    '.gitignore': 'vendor/\nvar/\ncomposer.link.*\n',
  });
  run(consumer, composer, 'install', '--no-interaction', '--no-scripts');
  // Newer releases appear after the lock: the provider needs dep/a 1.1, and dep/b 1.1 is out but nothing needs it.
  archive('dep/a', '1.1.0');
  archive('dep/b', '1.1.0');
  mkdirSync(path.join(consumer, 'var'), { recursive: true });
  const lines: string[] = [];
  assert.equal(link({ checkouts: [provider, consumer], directories: [consumer], check: false, print: text => lines.push(text), env: { ...process.env, COMPOSER_BIN: composer } }), true, lines.join('\n'));
  const locked = (name: string) => readJsonFile<{ packages: { name: string; version: string }[] }>(path.join(consumer, 'composer.link.lock'), 'composer-lock.schema.json').packages.find(item => item.name === name)?.version;
  assert.equal(locked('dep/a'), '1.1.0', 'the dependency of the linked package is resolved');
  assert.equal(locked('dep/b'), '1.0.0', 'a package that the linked one does not need stays locked');
});
