// Tests of scripts/kit/link-metadata-check.mts (K305): while a polyspec package is linked, the installed metadata of it equals its linked
// source, and the finding names the package and the field. Composer runs as a stub that answers `vendor` to `config vendor-dir`.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { linkFindings } from '../../scripts/kit/link-metadata-check.mts';
import { put, tree } from './tree.mts';

/** A consumer whose vendor links polyspec/y to the provider folder `provider`; `installed` is the record of the package. */
function consumer(t: TestContext, installed: Record<string, unknown>, linked = true) {
  const root = tree(t, {
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' } }),
    'vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y', ...installed }] }),
    'provider/composer.json': JSON.stringify({ name: 'polyspec/y', require: { php: '>=8.4' } }),
    'package.json': '{"name": "cons"}',
    'node_modules/@polyspec/.keep': '',
  });
  mkdirSync(path.join(root, 'vendor/polyspec'), { recursive: true });
  if (linked) symlinkSync(path.join(root, 'provider'), path.join(root, 'vendor/polyspec/y'));
  else put(root, { 'vendor/polyspec/y/composer.json': JSON.stringify({ name: 'polyspec/y', require: { php: '>=8.4' } }) });
  const stub = path.join(root, 'composer-stub');
  writeFileSync(stub, '#!/bin/sh\necho vendor\n');
  chmodSync(stub, 0o755);
  return { root, env: { ...process.env, COMPOSER_BIN: stub } };
}

test('a linked Composer package whose record requires another PHP than its source is a finding that names the package and the field (K305)', (t) => {
  const { root, env } = consumer(t, { require: { php: '>=8.5' } });
  assert.deepEqual(linkFindings(root, env), ['composer polyspec/y: require of vendor/composer/installed.json is {"php":">=8.5"}, the linked source says {"php":">=8.4"}']);
});

test('a record equal to its source, and an installed copy that no link replaced, pass (K305)', (t) => {
  const equal = consumer(t, { require: { php: '>=8.4' } });
  assert.deepEqual(linkFindings(equal.root, equal.env), []);
  const copy = consumer(t, { require: { php: '>=8.5' } }, false);
  assert.deepEqual(linkFindings(copy.root, copy.env), [], 'a plain copy is the released package: no link, no finding');
});

test('an npm link that resolves to no package, and a go.work use folder without a go.mod, are findings (K305)', (t) => {
  const root = tree(t, { 'package.json': '{"name": "cons"}', 'go.mod': 'module cons\n', 'go.work': 'go 1.26\n\nuse (\n\t.\n\t../gone\n)\n' });
  mkdirSync(path.join(root, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync(path.join(root, 'missing'), path.join(root, 'node_modules/@polyspec/x'));
  assert.deepEqual(linkFindings(root, process.env), [
    'go ../gone: the use folder of go.work holds no go.mod',
    'npm @polyspec/x: the link node_modules/@polyspec/x resolves to no package folder',
  ]);
});
