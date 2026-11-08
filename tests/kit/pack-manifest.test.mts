// Tests of scripts/kit/pack-manifest.mts (K613, K641): the prepack step writes the packed form of the files that name the sources of
// kit, so the package that npm packs runs dist, and a file that names no source fails naming it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { packedFiles } from '../../scripts/kit/pack-manifest.mts';
import { tree } from './tree.mts';

const MANIFEST = '{\n  "exports": {\n    "./run-tests": "./scripts/kit/run-tests.mts",\n    "./glob": "./scripts/kit/glob.mts",\n    "./land": "./scripts/kit/land.mts",\n    "./checklist": "./scripts/kit/checklist.mts",\n    "./php-extension": "./scripts/kit/php-extension.mts",\n    "./package.json": "./package.json"\n  }\n}\n';

test('the packed exports name dist; only package.json is packed (K613, K671-1, K1054, K1053)', (t) => {
  const root = tree(t, { 'package.json': MANIFEST });
  const packed = packedFiles(root);
  assert.equal(packed['package.json'], '{\n  "exports": {\n    "./run-tests": { "types": "./dist/run-tests.d.mts", "default": "./dist/run-tests.mjs" },\n    "./glob": { "types": "./dist/glob.d.mts", "default": "./dist/glob.mjs" },\n    "./land": { "types": "./dist/land.d.mts", "default": "./dist/land.mjs" },\n    "./checklist": { "types": "./dist/checklist.d.mts", "default": "./dist/checklist.mjs" },\n    "./php-extension": { "types": "./dist/php-extension.d.mts", "default": "./dist/php-extension.mjs" },\n    "./package.json": "./package.json"\n  }\n}\n');
  assert.deepEqual(Object.keys(packed), ['package.json']);
});

test('a file that names no source of kit fails naming the file, so a pack never ships the sources unchanged (K613)', (t) => {
  const root = tree(t, { 'package.json': '{ "exports": { "./x": "./dist/x.mjs" } }\n' });
  assert.throws(() => packedFiles(root), /pack-manifest: package\.json names no source to pack/);
});
