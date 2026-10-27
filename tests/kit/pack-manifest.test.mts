// Tests of scripts/kit/pack-manifest.mts (K613, K641): the prepack step writes the packed form of the files that name the sources of
// kit, so the package that npm packs runs dist, and a file that names no source fails naming it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { packedFiles } from '../../scripts/kit/pack-manifest.mts';
import { tree } from './tree.mts';

const MANIFEST = '{\n  "bin": { "polyspec-kit-hook": "./scripts/kit/claude-hook.mts" },\n  "exports": {\n    "./run-tests": "./scripts/kit/run-tests.mts",\n    "./glob": "./scripts/kit/glob.mts",\n    "./parity-declaration": "./scripts/kit/parity-declaration.mts",\n    "./land": "./scripts/kit/land.mts",\n    "./parity": "./scripts/kit/parity.mts",\n    "./checklist": "./scripts/kit/checklist.mts",\n    "./php-extension": "./scripts/kit/php-extension.mts",\n    "./package.json": "./package.json"\n  }\n}\n';
const BOOTSTRAP = 'KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))\nKIT := $(KIT_BOOTSTRAP)\nKIT_EXT := mts\n';
const SETTINGS = '{ "command": "node node_modules/.bin/polyspec-kit-hook" }\n';

test('the packed exports, bootstrap and native npm hook bin name dist while settings retain identical bytes (K613, K671-1)', (t) => {
  const root = tree(t, { 'package.json': MANIFEST, 'scripts/kit/kit-bootstrap.mk': BOOTSTRAP, 'claude/settings.json': SETTINGS });
  const packed = packedFiles(root);
  assert.equal(packed['package.json'], '{\n  "bin": { "polyspec-kit-hook": "./dist/claude-hook.mjs" },\n  "exports": {\n    "./run-tests": { "types": "./dist/run-tests.d.mts", "default": "./dist/run-tests.mjs" },\n    "./glob": { "types": "./dist/glob.d.mts", "default": "./dist/glob.mjs" },\n    "./parity-declaration": { "types": "./dist/parity-declaration.d.mts", "default": "./dist/parity-declaration.mjs" },\n    "./land": { "types": "./dist/land.d.mts", "default": "./dist/land.mjs" },\n    "./parity": { "types": "./dist/parity.d.mts", "default": "./dist/parity.mjs" },\n    "./checklist": { "types": "./dist/checklist.d.mts", "default": "./dist/checklist.mjs" },\n    "./php-extension": { "types": "./dist/php-extension.d.mts", "default": "./dist/php-extension.mjs" },\n    "./package.json": "./package.json"\n  }\n}\n');
  assert.equal(packed['scripts/kit/kit-bootstrap.mk'], 'KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))\nKIT := $(KIT_BOOTSTRAP:%/scripts/kit=%/dist)\nKIT_EXT := mjs\n');
  assert.equal(packed['claude/settings.json'], SETTINGS);
});

test('a file that names no source of kit fails naming the file, so a pack never ships the sources unchanged (K613)', (t) => {
  const root = tree(t, { 'package.json': '{ "exports": { "./x": "./dist/x.mjs" } }\n', 'scripts/kit/kit-bootstrap.mk': BOOTSTRAP, 'claude/settings.json': SETTINGS });
  assert.throws(() => packedFiles(root), /pack-manifest: package\.json names no source to pack/);
  const noKit = tree(t, { 'package.json': MANIFEST, 'scripts/kit/kit-bootstrap.mk': 'KIT := elsewhere\nKIT_EXT := mts\n', 'claude/settings.json': SETTINGS });
  assert.throws(() => packedFiles(noKit), /pack-manifest: scripts\/kit\/kit-bootstrap\.mk names no source to pack/);
});
