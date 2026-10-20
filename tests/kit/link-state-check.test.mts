// Tests of scripts/kit/link-state-check.mts (K305-1): the link counts as the installed released version, so the check compares no
// version and no requirement; while a link exists, an installed polyspec package pinned at 0.0.x is a link that resolves, and
// a plain copy among links is a finding. Composer runs as a stub that answers `vendor` to `config vendor-dir`.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { linkFindings, recipeFindings } from '../../scripts/kit/link-state-check.mts';
import { put, tree } from './tree.mts';

/** A consumer whose Composer vendor records polyspec/y and polyspec/z at 0.0.1; `link` says which of them are links. */
function consumer(t: TestContext, link: Record<string, boolean>) {
  const root = tree(t, {
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1', 'polyspec/z': '0.0.1' } }),
    'vendor/composer/installed.json': JSON.stringify({ packages: ['y', 'z'].map(name => ({ name: `polyspec/${name}`, version: '0.0.1', 'install-path': `../polyspec/${name}`, require: { php: '>=8.5' }, dist: { type: link[name] ? 'path' : 'zip' } })) }),
    'provider/y/composer.json': JSON.stringify({ name: 'polyspec/y', require: { php: '>=8.4' } }),
    'provider/z/composer.json': JSON.stringify({ name: 'polyspec/z' }),
  });
  mkdirSync(path.join(root, 'vendor/polyspec'), { recursive: true });
  for (const name of ['y', 'z'] as const) {
    if (link[name]) symlinkSync(path.join(root, 'provider', name), path.join(root, 'vendor/polyspec', name));
    else put(root, { [`vendor/polyspec/${name}/composer.json`]: JSON.stringify({ name: `polyspec/${name}` }) });
  }
  const stub = path.join(root, 'composer-stub');
  writeFileSync(stub, '#!/bin/sh\necho vendor\n');
  chmodSync(stub, 0o755);
  return { root, env: { ...process.env, COMPOSER_BIN: stub } };
}

test('linked packages pass whatever version and requirement their record holds, since the link counts as the released version (K305-1)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  assert.deepEqual(linkFindings(root, env), []);
});

test('a link over the install of a release archive is a finding: Composer installed the package from a zip, not from its path repository (K318)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  put(root, { 'vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y', dist: { type: 'zip' } }, { name: 'polyspec/z', version: '0.0.1', 'install-path': '../polyspec/z', dist: { type: 'path' } }] }) });
  assert.deepEqual(linkFindings(root, env), ["composer polyspec/y: vendor/polyspec/y is a link over an install from zip, not Composer's own path install; run kit link"]);
});

test('a plain copy among links is a finding that names the package, and a checkout without a link passes (K305-1)', (t) => {
  const mixed = consumer(t, { y: true, z: false });
  assert.deepEqual(linkFindings(mixed.root, mixed.env), ['composer polyspec/z: vendor/polyspec/z is a copy at 0.0.1, not a link, while other packages are linked']);
  const none = consumer(t, { y: false, z: false });
  assert.deepEqual(linkFindings(none.root, none.env), [], 'CI installs the released copies: nothing is linked');
});

test('a link that resolves to no package of that name, an npm copy among links and a go.work use folder without a go.mod are findings (K305-1)', (t) => {
  const root = tree(t, { 'package.json': '{"name": "cons"}', 'go.mod': 'module cons\n', 'go.work': 'go 1.26\n\nuse (\n\t.\n\t../gone\n)\n' });
  mkdirSync(path.join(root, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync(path.join(root, 'missing'), path.join(root, 'node_modules/@polyspec/x'));
  put(root, { 'node_modules/@polyspec/w/package.json': JSON.stringify({ name: '@polyspec/w', version: '0.0.3' }) });
  assert.deepEqual(linkFindings(root, process.env), [
    'go ../gone: the use folder of go.work holds no go.mod',
    'npm @polyspec/w: node_modules/@polyspec/w is a copy at 0.0.3, not a link, while other packages are linked',
    'npm @polyspec/x: the link node_modules/@polyspec/x resolves to no package folder',
  ]);
});

test('the Composer projects that kit writes are no consumer project, so a repository with only those needs no Composer (K320)', (t) => {
  const root = tree(t, { 'config/php-lint/composer.json': '{"name": "polyspec/kit-php-lint"}', 'config/phpunit/composer.json': '{"name": "polyspec/kit-phpunit"}' });
  assert.deepEqual(linkFindings(root, { ...process.env, COMPOSER_BIN: '' }), []);
});

// K349: a vendor installed from the tracked lock demands the platform of that lock, which a polyspec package of another PHP cannot meet.
test('a linked vendor whose platform check demands another PHP than .php-version is a finding (K349)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  put(root, { '.php-version': '8.4\n', 'vendor/composer/platform_check.php': '<?php\nif (!(PHP_VERSION_ID >= 80500)) {\n}\n' });
  assert.deepEqual(linkFindings(root, env), ['composer vendor/composer/platform_check.php: demands PHP id 80500 while .php-version names 80401; the vendor was installed from the tracked lock, run kit link']);
  put(root, { 'vendor/composer/platform_check.php': '<?php\nif (!(PHP_VERSION_ID >= 80401)) {\n}\n' });
  assert.deepEqual(linkFindings(root, env), []);
});

test('a recipe that installs from a lock without the kit link step after it is a finding, and unlink and the link step pass (K349)', () => {
  const makefile = [
    'a-install:', '	composer install', '	$(MAKE) link', '',
    'b-install:', '	npm ci', '	@echo done', '',
    'c-install:', '	uv sync --frozen', '	node kit link --siblings', '',
    'unlink:', '	npm ci', '',
    'd-install:', '	$(MAKE) link', '	composer install', '',
  ].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', 'scripts/kit/kit.mk'], file => (file === 'Makefile' ? makefile : 'x:\n\tnpm ci\n')), [
    'Makefile:6: the recipe b-install installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line',
    'Makefile:18: the recipe d-install installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line',
  ]);
});

// K375: a worktree that links its install directories to the main checkout runs the sources of the main checkout.
test('an install directory that is a symbolic link, and a workspace package that resolves outside the checkout, are findings (K375)', (t) => {
  const other = tree(t, {});
  const linked = tree(t, {});
  symlinkSync(other, path.join(linked, 'node_modules'));
  assert.deepEqual(linkFindings(linked, process.env), ['install directory node_modules is a symbolic link: remove the link and install the worktree from its own sources']);

  const workspace = JSON.stringify({ name: 'root', workspaces: ['packages/a'] });
  const outside = tree(t, { 'packages/a/package.json': JSON.stringify({ name: '@x/a' }) });
  const foreign = tree(t, { 'package.json': workspace, 'packages/a/package.json': JSON.stringify({ name: '@x/a' }) });
  mkdirSync(path.join(foreign, 'node_modules/@x'), { recursive: true });
  symlinkSync(path.join(outside, 'packages/a'), path.join(foreign, 'node_modules/@x/a'));
  const found = linkFindings(foreign, process.env);
  assert.equal(found.length, 1);
  assert.match(found[0] ?? '', /node_modules\/@x\/a/);

  const own = tree(t, { 'package.json': workspace, 'packages/a/package.json': JSON.stringify({ name: '@x/a' }) });
  mkdirSync(path.join(own, 'node_modules/@x'), { recursive: true });
  symlinkSync(path.join(own, 'packages/a'), path.join(own, 'node_modules/@x/a'));
  assert.deepEqual(linkFindings(own, process.env), []);
});
