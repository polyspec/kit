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
