// Tests of scripts/kit/link-state-check.mts (K305-1): the link counts as the installed released version, so the check compares no
// version and no requirement; while a link exists, an installed polyspec package pinned at 0.0.x is a link that resolves, and
// a plain copy among links is a finding. Composer runs as a stub that answers `vendor` to `config vendor-dir`.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { linkFindings } from '../../scripts/kit/link-state-check.mts';
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
