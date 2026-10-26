// The native Composer path repository installs its own lock, autoload and source link (K657-2).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composerInstall } from '../../scripts/kit/composer-install.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { tree } from '../kit/tree.mts';
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
