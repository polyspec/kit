// Tests of the ruff of mise.toml in the dependency review: its release is a PyPI dependency of the state, its newer release
// is set by hand and locked with make toolchain-lock, and updatePlan never edits mise.toml. The checkout is the
// fixture copy of tests/kit/checkout.mts; nothing reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TOOLCHAIN, UPDATE, readPolicy, readState } from '../../scripts/kit/dependency-state.mts';
import type { Dependency } from '../../scripts/kit/dependency-state.mts';
import { fixOf, updatePlan } from '../../scripts/kit/dependency-review.mts';
import { fixtureCheckout as fixture } from './checkout.mts';
import { checkoutTools } from './checkout-stubs.mts';

const toolchainRuff: Dependency = { ecosystem: 'pypi', manifest: TOOLCHAIN, package: 'ruff', kind: 'toolchain', spec: '==0.16.10', version: '0.16.10', lock: null };
const policyOf = (root: string) => readPolicy(root);

test('the ruff of mise.toml is a PyPI dependency of the review state', (t) => {
  const root = fixture(t);
  checkoutTools(root, ['go']);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\nruff = "0.16.10"\n');
  const state = readState(root, policyOf(root));
  assert.deepEqual(state.dependencies.filter(dependency => dependency.manifest === TOOLCHAIN), [toolchainRuff]);
});

test('a mise.toml without ruff has no toolchain dependency', (t) => {
  const root = fixture(t);
  checkoutTools(root, ['go']);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\npython = "3.14.8"\n');
  const state = readState(root, policyOf(root));
  assert.equal(state.dependencies.some(dependency => dependency.manifest === TOOLCHAIN), false);
});

test('a newer ruff is set by hand and locked, and updatePlan never edits mise.toml', () => {
  assert.equal(fixOf({ ...toolchainRuff, latest: '0.16.11' }), `set ruff in ${TOOLCHAIN} to 0.16.11, then make toolchain-lock and make install-tools`);
  assert.equal(fixOf({ ...toolchainRuff, manifest: 'pyproject.toml', latest: '0.16.11' }), UPDATE);
  assert.deepEqual(updatePlan({ newer: [{ ...toolchainRuff, latest: '0.16.11' }], advisories: [] }), []);
});

// K490: the review record names the dependencies that the tracked manifest declares. While a project is linked, composer.link.json holds the
// local install state (the linked providers), which is no declaration: it must not add a dependency to the record.
test('a linked project records only the requirements of its tracked composer.json (K490)', (t) => {
  const root = fixture(t);
  checkoutTools(root, ['go']);
  const project = path.join(root, 'packages/fixture-php');
  writeFileSync(path.join(project, 'composer.json'), JSON.stringify({ name: 'app/app', require: { 'vendor/declared': '1.0.0' } }));
  writeFileSync(path.join(project, 'composer.link.json'), JSON.stringify({ name: 'app/app', require: { 'vendor/declared': '1.0.0', 'vendor/linked': '2.0.0' } }));
  writeFileSync(path.join(project, 'composer.link.lock'), JSON.stringify({ packages: [{ name: 'vendor/declared', version: '1.0.0' }, { name: 'vendor/linked', version: '2.0.0' }] }));
  writeFileSync(path.join(project, 'composer.lock'), JSON.stringify({ packages: [{ name: 'vendor/declared', version: '1.0.0' }] }));
  // The tools list the tracked files through Git: the index holds the files of this project.
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const state = readState(root, policyOf(root));
  const packages = state.dependencies.filter(dependency => dependency.ecosystem === 'composer').map(dependency => dependency.package);
  assert.ok(packages.includes('vendor/declared'), packages.join(', '));
  assert.equal(packages.includes('vendor/linked'), false, 'the link manifest is local install state, not a declaration');
});
