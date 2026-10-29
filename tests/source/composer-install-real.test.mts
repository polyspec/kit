// Composer installs the released lock and autoload; the installed polyspec package is then one plain link to its checkout (K761).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composerInstall } from '../../scripts/kit/composer-install.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { tree } from '../kit/tree.mts';

test('Composer installs the released lock, then the installed package is one plain link to its checkout that the autoload reads (K761)', (t) => {
  const autoload = { 'psr-4': { 'Example\\': 'src/' } };
  const root = tree(t, {
    'composer.json': JSON.stringify({ name: 'example/app', require: { 'example/local': '0.0.1' }, repositories: [{ type: 'artifact', url: 'archives' }, { 'packagist.org': false }] }),
    'archive/composer.json': JSON.stringify({ name: 'example/local', version: '0.0.1', autoload }),
    'archive/src/Value.php': '<?php namespace Example; final class Value { public const TEXT = "released"; }',
    'archives/.keep': '',
    'source/composer.json': JSON.stringify({ name: 'example/local', version: '0.0.2', autoload }),
    'source/src/Value.php': '<?php namespace Example; final class Value { public const TEXT = "first"; }',
  });
  const kit = path.resolve(import.meta.dirname, '../..');
  const env = { ...toolsEnvironment(kit), COMPOSER_BIN: toolCommand(kit, 'composer'), COMPOSER_HOME: path.join(root, 'var/composer/home'), COMPOSER_CACHE_DIR: path.join(root, 'var/composer/cache'), COMPOSER_DISABLE_NETWORK: '1' };
  const archive = spawnSync('zip', ['-qr', path.join(root, 'archives/release.zip'), '.'], { cwd: path.join(root, 'archive'), env, encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stdout + archive.stderr);
  const released = spawnSync(env.COMPOSER_BIN, ['install', '--no-interaction', '--no-scripts', '--no-plugins'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(released.status, 0, released.stdout + released.stderr);
  const releaseState = ['composer.json', 'composer.lock'].map(file => readFileSync(path.join(root, file), 'utf8'));
  const render = () => {
    const result = spawnSync(toolCommand(kit, 'php'), ['-r', 'require "vendor/autoload.php"; echo Example\\Value::TEXT;'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  assert.equal(render(), 'released');
  const install = () => composerInstall({ directory: root, checkouts: [path.join(root, 'source')], env, print: () => {} });
  assert.equal(install(), 'linked');
  assert.equal(readlinkSync(path.join(root, 'vendor/example/local')), '../../source');
  assert.equal(render(), 'first');
  writeFileSync(path.join(root, 'source/src/Value.php'), '<?php namespace Example; final class Value { public const TEXT = "second"; }');
  assert.equal(render(), 'second', 'a source edit needs no release and no reinstall');
  assert.equal(install(), 'linked');
  assert.equal(readlinkSync(path.join(root, 'vendor/example/local')), '../../source', 'a repeated install converges on the link');
  assert.deepEqual(['composer.json', 'composer.lock'].map(file => readFileSync(path.join(root, file), 'utf8')), releaseState, 'the release manifest and lock are unchanged');
});

