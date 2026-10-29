// Composer installs the released lock and autoload; the installed polyspec package is then one plain link to its checkout (K761).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composerInstall } from '../../scripts/kit/composer-install.mts';
import { prepareWorktreeComposer } from '../../scripts/kit/worktree-setup.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { put, tree } from '../kit/tree.mts';

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
