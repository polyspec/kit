// Tests of the assets of kit (K421): every file or folder that a module of kit reads beside itself is shipped into dist by kit-build,
// since a consumer holds no scripts/kit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assetsOf, kitModules, shippedAssets, unshippedAssets } from '../../scripts/kit/kit-assets.mts';
import { trackedFiles } from '../../scripts/kit/tracked-files.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = 'kit-build: ## Build\n\trm -rf dist.next\n\tcp scripts/kit/kit.mk dist.next/kit.mk\n\tcp -R scripts/kit/schema dist.next/schema\n\ttar -C scripts/kit --exclude=vendor -cf - symbols | tar -C dist.next -xf -\n\nother:\n\tcp -R scripts/kit/runners x\n';

test('a file that a module reads beside itself and kit-build does not ship is a finding (K421)', () => {
  const runner = "const RUNNER = fileURLToPath(new URL('./runners/python.py', import.meta.url));\n";
  const schema = "export const SCHEMAS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema');\n";
  assert.deepEqual(assetsOf(runner + schema + "const tool = new URL('./reporter.mts', import.meta.url);\n"), ['runners', 'schema'], 'a compiled module is no asset');
  assert.deepEqual([...shippedAssets(BUILD)].sort(), ['kit.mk', 'schema', 'symbols'], 'only the recipe of kit-build counts');
  assert.deepEqual(unshippedAssets(new Map([['scripts/kit/run-tests.mts', runner], ['scripts/kit/schema-validate.mts', schema]]), BUILD), ['scripts/kit/run-tests.mts: runners']);
});

test('kit-build ships every file that a module of kit reads beside itself (K421)', () => {
  assert.deepEqual(unshippedAssets(kitModules(ROOT, trackedFiles(ROOT)), readFileSync(path.join(ROOT, 'Makefile'), 'utf8')), []);
});
