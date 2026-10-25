// Tests of scripts/kit/pack-manifest.mts (K613, K641): the prepack step writes the packed form of the files that name the sources of
// kit, so the package that npm packs runs dist, and a file that names no source fails naming it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { packedFiles } from '../../scripts/kit/pack-manifest.mts';
import { tree } from './tree.mts';

const MANIFEST = '{\n  "exports": {\n    "./run-tests": "./scripts/kit/run-tests.mts",\n    "./package.json": "./package.json"\n  }\n}\n';
const BOOTSTRAP = 'KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))\nKIT := $(KIT_BOOTSTRAP)\nKIT_EXT := mts\n';
const SETTINGS = '{ "command": "node node_modules/@polyspec/kit/scripts/kit/claude-hook.mts" }\n';

test('the packed files name dist: the exports, the KIT of the bootstrap and the Claude hook (K613)', (t) => {
  const root = tree(t, { 'package.json': MANIFEST, 'scripts/kit/kit-bootstrap.mk': BOOTSTRAP, 'claude/settings.json': SETTINGS });
  const packed = packedFiles(root);
  assert.equal(packed['package.json'], '{\n  "exports": {\n    "./run-tests": { "types": "./dist/run-tests.d.mts", "default": "./dist/run-tests.mjs" },\n    "./package.json": "./package.json"\n  }\n}\n');
  assert.equal(packed['scripts/kit/kit-bootstrap.mk'], 'KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))\nKIT := $(KIT_BOOTSTRAP:%/scripts/kit=%/dist)\nKIT_EXT := mjs\n');
  assert.equal(packed['claude/settings.json'], '{ "command": "node node_modules/@polyspec/kit/dist/claude-hook.mjs" }\n');
});

test('a file that names no source of kit fails naming the file, so a pack never ships the sources unchanged (K613)', (t) => {
  const root = tree(t, { 'package.json': '{ "exports": { "./x": "./dist/x.mjs" } }\n', 'scripts/kit/kit-bootstrap.mk': BOOTSTRAP, 'claude/settings.json': SETTINGS });
  assert.throws(() => packedFiles(root), /pack-manifest: package\.json names no source to pack/);
  const noKit = tree(t, { 'package.json': MANIFEST, 'scripts/kit/kit-bootstrap.mk': 'KIT := elsewhere\nKIT_EXT := mts\n', 'claude/settings.json': SETTINGS });
  assert.throws(() => packedFiles(noKit), /pack-manifest: scripts\/kit\/kit-bootstrap\.mk names no source to pack/);
});
