// The native Composer path repository installs its own lock, autoload and source link (K657-2).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composerInstall } from '../../scripts/kit/composer-install.mts';
import { prepareWorktreeComposer } from '../../scripts/kit/worktree-setup.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { put, tree } from '../kit/tree.mts';
import { isJsonList, isJsonObject, readJsonObject } from '../../scripts/kit/bootstrap/files.mts';

test('native Composer keeps path sources live and records their current requirements (K657-2)', (t) => {
  const root = tree(t, {
    'composer.json': '{"name":"example/release","require":{}}',
    'composer.local.json': JSON.stringify({ name: 'example/development', require: { 'example/local': '2.0.0' }, repositories: [{ type: 'path', url: 'source', options: { symlink: true } }, { 'packagist.org': false }] }),
    'source/composer.json': JSON.stringify({ name: 'example/local', version: '2.0.0', require: { php: '>=8.4' }, autoload: { 'psr-4': { 'Example\\': 'src/' } } }),
    'source/src/Value.php': '<?php namespace Example; final class Value { public const TEXT = "first"; }',
  });
  const kit = path.resolve(import.meta.dirname, '../..');
  const env = { ...toolsEnvironment(kit), COMPOSER_BIN: toolCommand(kit, 'composer'), COMPOSER: 'composer.local.json', COMPOSER_HOME: path.join(root, 'var/composer/home'), COMPOSER_CACHE_DIR: path.join(root, 'var/composer/cache'), COMPOSER_DISABLE_NETWORK: '1' };
  const release = readFileSync(path.join(root, 'composer.json'), 'utf8');
  const install = () => composerInstall({ directory: root, checkouts: [path.join(root, 'source')], env, print: () => {} });
  assert.equal(install(), 'linked');
  const render = () => spawnSync(toolCommand(kit, 'php'), ['-r', 'require "vendor/autoload.php"; echo Example\\Value::TEXT;'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(render().stdout, 'first');
  writeFileSync(path.join(root, 'source/src/Value.php'), '<?php namespace Example; final class Value { public const TEXT = "second"; }');
  assert.equal(render().stdout, 'second');
  assert.equal(install(), 'linked');
  assert.equal(realpathSync(path.join(root, 'vendor/example/local')), realpathSync(path.join(root, 'source')));
  const lock = readJsonObject(root, 'composer.local.lock');
  assert.ok(isJsonList(lock.packages));
  assert.deepEqual(lock.packages.map(entry => {
    assert.ok(isJsonObject(entry) && isJsonObject(entry.require) && isJsonObject(entry.dist));
    return [entry.name, entry.version, entry.require.php, entry.dist.type];
  }), [['example/local', '2.0.0', '>=8.4', 'path']]);
  assert.equal(readFileSync(path.join(root, 'composer.json'), 'utf8'), release);
  assert.equal(existsSync(path.join(root, 'composer.lock')), false);
  assert.equal(existsSync(path.join(root, 'var/link/composer')), false);
});

test('Composer selects compatible development sources without releases and converges on repeat (K664-2)', (t) => {
  const root = tree(t, {
    'composer.json': JSON.stringify({ name: 'example/app', require: { 'example/local': '0.0.1' }, repositories: [{ type: 'artifact', url: 'archives' }, { 'packagist.org': false }] }),
    'archive/composer.json': JSON.stringify({ name: 'example/local', version: '0.0.1' }),
    'archive/old.php': '<?php // released',
    'archives/.keep': '',
    'source/composer.json': JSON.stringify({ name: 'example/local', version: '0.0.2', autoload: { 'psr-4': { 'Example\\': 'src/' } } }),
    'source/src/Value.php': '<?php namespace Example; final class Value { public const TEXT = "first"; }',
    'fresh/composer.json': JSON.stringify({ name: 'example/fresh', version: '0.0.1' }),
  });
  const kit = path.resolve(import.meta.dirname, '../..');
  const env = { ...toolsEnvironment(kit), COMPOSER_HOME: path.join(root, 'var/composer/home'), COMPOSER_CACHE_DIR: path.join(root, 'var/composer/cache'), COMPOSER_DISABLE_NETWORK: '1' };
  const composer = toolCommand(kit, 'composer');
  const archive = spawnSync('zip', ['-qr', path.join(root, 'archives/release.zip'), '.'], { cwd: path.join(root, 'archive'), env, encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stdout + archive.stderr);
  const released = spawnSync(composer, ['install', '--no-interaction', '--no-scripts', '--no-plugins'], { cwd: root, env: { ...env, COMPOSER: 'composer.json' }, encoding: 'utf8' });
  assert.equal(released.status, 0, released.stdout + released.stderr);
  const releaseState = ['composer.json', 'composer.lock'].map(file => readFileSync(path.join(root, file), 'utf8'));
  const local = { name: 'example/development', require: { 'example/local': '0.0.1', 'example/fresh': '0.0.1' }, repositories: [
    { type: 'path', url: 'source', options: { symlink: true } }, { type: 'path', url: 'fresh', options: { symlink: true } }, { 'packagist.org': false },
  ] };
  writeFileSync(path.join(root, 'composer.local.json'), JSON.stringify(local));
  const install = () => composerInstall({ directory: root, checkouts: [path.join(root, 'source'), path.join(root, 'fresh')], env: { ...env, COMPOSER_BIN: composer, COMPOSER: 'composer.local.json' }, print: () => {} });
  assert.throws(install, /does not match the constraint/);
  assert.equal(existsSync(path.join(root, 'vendor/example/fresh')), false);
  local.require['example/local'] = '0.0.2';
  writeFileSync(path.join(root, 'composer.local.json'), JSON.stringify(local));
  assert.equal(install(), 'linked');
  const files = ['composer.local.json', 'composer.local.lock', 'vendor/composer/installed.json', 'vendor/composer/installed.php', 'vendor/autoload.php', 'vendor/composer/autoload_psr4.php', 'vendor/composer/autoload_static.php'];
  const state = () => files.map(file => [file, readFileSync(path.join(root, file), 'utf8')]);
  const first = state();
  assert.equal(realpathSync(path.join(root, 'vendor/example/fresh')), realpathSync(path.join(root, 'fresh')));
  assert.equal(realpathSync(path.join(root, 'vendor/example/local')), realpathSync(path.join(root, 'source')));
  const render = () => {
    const result = spawnSync(toolCommand(kit, 'php'), ['-r', 'require "vendor/autoload.php"; echo Example\\Value::TEXT;'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  assert.equal(render(), 'first');
  writeFileSync(path.join(root, 'source/src/Value.php'), '<?php namespace Example; final class Value { public const TEXT = "second"; }');
  assert.equal(render(), 'second', 'source edits need no release or reinstall');
  assert.equal(install(), 'linked');
  assert.deepEqual(state(), first, 'native manifest, lock, metadata and autoload converge');
  assert.deepEqual(['composer.json', 'composer.lock'].map(file => readFileSync(path.join(root, file), 'utf8')), releaseState);
});

/** Captures installation bytes and link targets without following source links into another checkout. */
function composerTreeState(directory: string): Record<string, string> {
  const found: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const file = path.join(relative, entry.name);
      const absolute = path.join(directory, file);
      if (entry.isSymbolicLink()) found[file] = `link:${readlinkSync(absolute)}`;
      else if (entry.isDirectory()) visit(file);
      else found[file] = readFileSync(absolute).toString('base64');
    }
  };
  visit('.');
  return found;
}

test('K690: native Composer worktrees replace legacy projections with their own cached installation', { timeout: 30_000 }, (t) => {
  const root = tree(t);
  const main = path.join(root, 'main');
  const folder = path.join(root, 'worktree');
  const provider = path.join(root, 'provider');
  const archive = path.join(root, 'archive');
  const archives = path.join(root, 'archives');
  put(root, {
    'archive/composer.json': JSON.stringify({ name: 'example/archive', version: '1.0.0', autoload: { 'psr-4': { 'ArchiveValue\\': 'src/' } } }),
    'archive/src/Value.php': '<?php namespace ArchiveValue; final class Value { public const TEXT = "archive"; }',
    'archives/.keep': '',
    'provider/composer.json': JSON.stringify({ name: 'example/shared', version: '1.0.0', autoload: { 'psr-4': { 'SharedValue\\': 'src/' } } }),
    'provider/src/Value.php': '<?php namespace SharedValue; final class Value { public const TEXT = "shared"; }',
  });
  const selected = JSON.stringify({ name: 'example/app', require: { 'example/local': '1.0.0', 'example/shared': '1.0.0', 'example/archive': '1.0.0' },
    repositories: [{ type: 'path', url: 'packages/local', options: { symlink: true } }, { type: 'path', url: '../provider', options: { symlink: true } }, { type: 'artifact', url: archives }, { 'packagist.org': false }],
    autoload: { 'psr-4': { 'AppValue\\': 'src/' } }, config: { 'vendor-dir': 'unused-config-vendor' } });
  for (const [directory, label] of [[main, 'main'], [folder, 'worktree']] as const) {
    put(directory, {
      'composer.json': '{"name":"example/release"}', 'composer.lock': 'released lock stays unchanged', 'composer.local.json': selected,
      'src/Value.php': `<?php namespace AppValue; final class Value { public const TEXT = "${label}"; }`,
      'packages/local/composer.json': JSON.stringify({ name: 'example/local', version: '1.0.0', autoload: { 'psr-4': { 'LocalValue\\': 'src/' } } }),
      'packages/local/src/Value.php': `<?php namespace LocalValue; final class Value { public const TEXT = "local-${label}"; }`,
    });
  }
  const kit = path.resolve(import.meta.dirname, '../..');
  const composer = toolCommand(kit, 'composer');
  const env = { ...toolsEnvironment(kit), COMPOSER: 'composer.local.json', COMPOSER_VENDOR_DIR: 'vendor-native', COMPOSER_HOME: path.join(root, 'home'), COMPOSER_CACHE_DIR: path.join(root, 'cache'), COMPOSER_DISABLE_NETWORK: '1' };
  const zipped = spawnSync('zip', ['-qr', path.join(archives, 'archive.zip'), '.'], { cwd: archive, env, encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stdout + zipped.stderr);
  const prepared = spawnSync(composer, ['update', '--no-interaction', '--no-scripts', '--no-plugins', '--prefer-dist'], { cwd: main, env, encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  copyFileSync(path.join(main, 'composer.local.lock'), path.join(folder, 'composer.local.lock'));
  // A cached archive is the only remaining archive input, so offline worktree installation must use it.
  rmSync(path.join(archives, 'archive.zip'));
  mkdirSync(path.join(folder, 'vendor-native/composer'), { recursive: true });
  mkdirSync(path.join(folder, 'vendor-native/example'), { recursive: true });
  for (const name of ['installed.json', 'installed.php']) copyFileSync(path.join(main, 'vendor-native/composer', name), path.join(folder, 'vendor-native/composer', name));
  for (const name of ['local', 'shared', 'archive']) symlinkSync(path.join(main, 'vendor-native/example', name), path.join(folder, 'vendor-native/example', name));
  const mainBefore = composerTreeState(main);
  const providerBefore = composerTreeState(provider);
  const render = (directory: string) => {
    const result = spawnSync(toolCommand(kit, 'php'), ['-r', 'require "vendor-native/autoload.php"; echo AppValue\\Value::TEXT . ":" . LocalValue\\Value::TEXT . ":" . SharedValue\\Value::TEXT . ":" . ArchiveValue\\Value::TEXT;'], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const options = { main, folder, composer, env, print: () => {} };
  prepareWorktreeComposer(options);
  assert.equal(render(folder), 'worktree:local-worktree:shared:archive');
  assert.equal(render(main), 'main:local-main:shared:archive');
  assert.equal(realpathSync(path.join(folder, 'vendor-native/example/local')), realpathSync(path.join(folder, 'packages/local')));
  assert.equal(realpathSync(path.join(folder, 'vendor-native/example/shared')), realpathSync(provider));
  assert.ok(!lstatSync(path.join(folder, 'vendor-native/example/archive')).isSymbolicLink(), 'the cached release package is natively installed in this checkout');
  assert.equal(existsSync(path.join(folder, 'unused-config-vendor')), false, 'native COMPOSER_VENDOR_DIR overrides manifest config');
  writeFileSync(path.join(folder, 'packages/local/src/Value.php'), '<?php namespace LocalValue; final class Value { public const TEXT = "edited"; }');
  assert.equal(render(folder), 'worktree:edited:shared:archive');
  const first = composerTreeState(folder);
  prepareWorktreeComposer(options);
  assert.deepEqual(composerTreeState(folder), first, 'repeat installation preserves native records, lock, autoload and source links');
  assert.deepEqual(composerTreeState(main), mainBefore, 'main installation and source bytes remain unchanged');
  assert.deepEqual(composerTreeState(provider), providerBefore, 'the shared source provider remains unchanged');
});
