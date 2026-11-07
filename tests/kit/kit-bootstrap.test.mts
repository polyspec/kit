// K1054: kit includes no recipe into a repository. The package ships no make file: kit.mk is the recipe set of kit's own Makefile,
// and the bootstrap that repositories included is the example docs/examples/bootstrap.mk, which a repository may copy.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { shippedAssets } from '../../scripts/kit/kit-assets.mts';
import { packedFiles } from '../../scripts/kit/pack-manifest.mts';
import { readFixture } from './json-fixture.mts';
import { assertWorkflowPackageBootstrap } from './workflow-package-bootstrap.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

test('the package ships no make file and includes no recipe into a repository (K1054)', () => {
  const manifest = readFixture<{ exports: Record<string, string>; files: string[]; scripts: Record<string, string> }>(ROOT, 'package.json');
  const makeFile = /\.mk\b/;
  assert.deepEqual(Object.entries(manifest.exports).filter(([key, value]) => makeFile.test(key) || makeFile.test(value)), [], 'package.json exports no make file');
  assert.deepEqual(manifest.files.filter(file => makeFile.test(file)), [], 'package.json files name no make file');
  assert.doesNotMatch(manifest.scripts.postpack ?? '', makeFile, 'postpack restores no make file');
  assert.equal(shippedAssets(read('Makefile')).has('kit.mk'), false, 'kit-build copies no kit.mk into dist');
  assert.deepEqual(Object.keys(packedFiles(ROOT)).filter(file => makeFile.test(file)), [], 'prepack rewrites no make file');
  assert.equal(existsSync(path.join(ROOT, 'scripts/kit/kit-bootstrap.mk')), false, 'kit holds no bootstrap for repositories to include');
  assert.ok(existsSync(path.join(ROOT, 'docs/examples/bootstrap.mk')), 'the bootstrap is an example');
});

test('the CI pipeline bootstraps the installed kit with pinned npm before Make and builds no sibling checkout (K686-2, K910)', (t) => {
  const workflow = read('workflows/ci-pipeline.yml');
  assertWorkflowPackageBootstrap(workflow, t);
  assert.doesNotMatch(workflow, /make -C \.\.\/kit|kit-build/, 'package bootstrap never builds a sibling kit');
});
