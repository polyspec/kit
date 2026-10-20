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

test('a package whose released archive requires a newer PHP is installed from its folder as a link, and autoloads (K304-1)', (t) => {
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
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' }, repositories: [{ type: 'artifact', url: '../archives' }, { packagist: false }], config: { platform: { php: '8.4.1' } } }),
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
  const record: { packages: { name: string; dist?: { type: string } }[] } = JSON.parse(readFileSync(path.join(consumer, 'vendor/composer/installed.json'), 'utf8'));
  assert.equal(record.packages.find(item => item.name === 'polyspec/y')?.dist?.type, 'path', 'Composer installed the package from its path repository, not from the archive');
  assert.doesNotMatch(readFileSync(path.join(consumer, 'vendor/composer/platform_check.php'), 'utf8'), /99/, 'the platform check follows the composer.json of the folder');
  const autoload = spawnSync('php', ['-r', "require 'vendor/autoload.php'; echo class_exists('Y\\\\Hello') ? 'loaded' : 'missing';"], { cwd: consumer, encoding: 'utf8' });
  assert.equal(autoload.status, 0, autoload.stderr + autoload.stdout);
  assert.equal(autoload.stdout, 'loaded');
  assert.equal(readFileSync(path.join(consumer, 'composer.json'), 'utf8'), tracked.manifest, 'the tracked composer.json is unchanged');
  assert.equal(readFileSync(path.join(consumer, 'composer.lock'), 'utf8'), tracked.lock, 'the tracked composer.lock is unchanged');
  assert.equal(run(consumer, 'git', 'status', '--porcelain'), '', 'the link files are ignored by Git');
});
