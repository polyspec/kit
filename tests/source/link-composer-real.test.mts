// The real Composer owns explicit local path repositories, their development lock, installed records and autoload.
// The application declares composer.local.json through COMPOSER; kit creates no shadow manifest or lock (K657-2).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { link } from '../../scripts/kit/link.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { put } from '../kit/tree.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { readJsonFile } from '../../scripts/kit/schema-validate.mts';
import { isJsonObject, readJsonObject } from '../../scripts/kit/bootstrap/files.mts';

const KIT = path.resolve(import.meta.dirname, '../..');

/** The selected Composer manifest and isolated native tool state of one fixture. */
function environment(directory: string, manifest = 'composer.json'): NodeJS.ProcessEnv {
  return { ...toolsEnvironment(KIT), COMPOSER: manifest, COMPOSER_HOME: path.join(directory, 'var/composer/home'), COMPOSER_CACHE_DIR: path.join(directory, 'var/composer/cache'), COMPOSER_DISABLE_NETWORK: '1' };
}

/** Runs `command` in `directory` and fails with its output. */
function run(directory: string, command: string, ...args: string[]) {
  const result = spawnSync(command, args, { cwd: directory, env: environment(directory), encoding: 'utf8' });
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
  const composer = toolCommand(KIT, 'composer');
  const provider = repository(root, 'prov', {
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', version: '0.0.1', require: { php: '>=8.4' }, autoload: { 'psr-4': { 'Y\\': 'lib/' } } }),
    'packages/php/lib/Hello.php': '<?php\n\nnamespace Y;\n\nfinal class Hello\n{\n}\n',
  });
  // The released archive of 0.0.1 requires PHP 99, as a release built for a newer PHP than the one that runs.
  const archives = path.join(root, 'archives');
  mkdirSync(archives, { recursive: true });
  put(root, { 'archive/composer.json': JSON.stringify({ name: 'polyspec/y', version: '0.0.1', require: { php: '>=99.0' } }), 'archive/Y.php': '<?php\n' });
  run(path.join(root, 'archive'), 'zip', '-q', path.join(archives, 'polyspec-y-0.0.1.zip'), 'composer.json', 'Y.php');
  const consumer = repository(root, 'cons', {
    'composer.json': JSON.stringify({ name: 'cons/app', license: 'MIT', require: { 'polyspec/y': '0.0.1' }, repositories: [{ type: 'artifact', url: '../archives' }, { packagist: false }], config: { platform: { php: '8.4.1' } } }),
    '.gitignore': 'vendor/\nvar/\ncomposer.local.*\n',
  });
  // The state before the link: the lock cannot resolve the archive at PHP 8.4.1, so the lock is made with the platform check off.
  run(consumer, composer, 'update', '--no-interaction', '--no-scripts', '--ignore-platform-reqs');
  run(consumer, 'git', 'add', 'composer.lock');
  run(consumer, 'git', '-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', 'commit', '--quiet', '-m', 'lock');
  const tracked = { manifest: readFileSync(path.join(consumer, 'composer.json'), 'utf8'), lock: readFileSync(path.join(consumer, 'composer.lock'), 'utf8') };
  const oldPlatform = spawnSync(composer, ['check-platform-reqs', '--lock', '--no-interaction'], { cwd: consumer, encoding: 'utf8', env: environment(consumer) });
  assert.notEqual(oldPlatform.status, 0, 'the stale released PHP 99 requirements remain invalid');
  const local = { ...readJsonObject(consumer, 'composer.json'), repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }, { type: 'artifact', url: '../archives' }, { 'packagist.org': false }] };
  put(consumer, { 'composer.local.json': JSON.stringify(local) });
  const prepared = spawnSync(composer, ['install', '--no-interaction', '--no-scripts'], { cwd: consumer, encoding: 'utf8', env: environment(consumer, 'composer.local.json') });
  assert.equal(prepared.status, 0, `${prepared.stdout}${prepared.stderr}`);
  const lines: string[] = [];
  assert.equal(link({ checkouts: [provider, consumer], directories: [consumer], check: false, print: text => lines.push(text), env: { ...environment(consumer, 'composer.local.json'), COMPOSER_BIN: composer } }), true, lines.join('\n'));
  assert.equal(lstatSync(path.join(consumer, 'vendor/polyspec/y')).isSymbolicLink(), true, 'the installed folder is a link');
  assert.equal(realpathSync(path.join(consumer, 'vendor/polyspec/y')), path.join(provider, 'packages/php'));
  const record = readJsonFile<{ packages: { name: string; dist?: { type: string } }[] }>(path.join(consumer, 'vendor/composer/installed.json'), 'composer-lock.schema.json');
  assert.equal(record.packages.find(item => item.name === 'polyspec/y')?.dist?.type, 'path', 'Composer installed the package from its path repository, not from the archive');
  assert.doesNotMatch(readFileSync(path.join(consumer, 'vendor/composer/platform_check.php'), 'utf8'), /99/, 'the platform check follows the composer.json of the folder');
  const autoload = spawnSync(toolCommand(KIT, 'php'), ['-r', "require 'vendor/autoload.php'; echo class_exists('Y\\\\Hello') ? 'loaded' : 'missing';"], { cwd: consumer, encoding: 'utf8', env: environment(consumer, 'composer.local.json') });
  assert.equal(autoload.status, 0, autoload.stderr + autoload.stdout);
  assert.equal(autoload.stdout, 'loaded');
  assert.equal(readFileSync(path.join(consumer, 'composer.json'), 'utf8'), tracked.manifest, 'the tracked composer.json is unchanged');
  assert.equal(readFileSync(path.join(consumer, 'composer.lock'), 'utf8'), tracked.lock, 'the tracked composer.lock is unchanged');
  const strictLink = spawnSync(composer, ['validate', '--strict', '--no-check-publish', '--no-interaction'], { cwd: consumer, encoding: 'utf8', env: environment(consumer, 'composer.local.json') });
  assert.equal(strictLink.status, 0, `${strictLink.stdout}${strictLink.stderr}`);
  const publishedValue: unknown = readJsonFile(path.join(consumer, 'composer.json'), 'composer-manifest.schema.json');
  if (!isJsonObject(publishedValue) || !isJsonObject(publishedValue.require)) throw new Error('published composer.json has no require');
  publishedValue.require['polyspec/y'] = 'v1.0.0-p1';
  put(consumer, { 'composer.json': JSON.stringify(publishedValue) });
  const strictPublished = spawnSync(composer, ['validate', '--strict', '--no-check-publish', '--no-interaction'], { cwd: consumer, encoding: 'utf8', env: environment(consumer) });
  assert.notEqual(strictPublished.status, 0, 'strict validation still refuses an ordinary manifest exact-version warning');
  assert.match(`${strictPublished.stdout}${strictPublished.stderr}`, /exact version constraints/);
  put(consumer, { 'composer.json': tracked.manifest });
  const localValue: unknown = readJsonFile(path.join(consumer, 'composer.local.json'), 'composer-manifest.schema.json');
  if (!isJsonObject(localValue) || !isJsonObject(localValue.require)) throw new Error('composer.local.json has no require');
  localValue.require['polyspec/y'] = '^0.0.2';
  put(consumer, { 'composer.local.json': JSON.stringify(localValue, null, 4) });
  const staleLink = spawnSync(composer, ['validate', '--strict', '--no-check-publish', '--no-interaction'], { cwd: consumer, encoding: 'utf8', env: environment(consumer, 'composer.local.json') });
  assert.notEqual(staleLink.status, 0, 'strict validation still refuses a stale development lock');
  assert.match(`${staleLink.stdout}${staleLink.stderr}`, /lock file is not up to date/);
  assert.equal(run(consumer, 'git', 'status', '--porcelain'), '', 'the link files are ignored by Git');
});
