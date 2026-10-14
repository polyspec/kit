// Tests of the ruff of mise.toml in the dependency review: its release is a PyPI dependency of the state, its newer release
// is set by hand and locked with make toolchain-lock, and updatePlan never edits mise.toml. The checkout is the
// fixture copy of tests/kit/checkout.mts; nothing reaches a network.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TOOLCHAIN, UPDATE, readPolicy, readState } from '../../scripts/kit/dependency-state.mts';
import type { Dependency } from '../../scripts/kit/dependency-state.mts';
import { fixOf, updatePlan } from '../../scripts/kit/dependency-review.mts';
import { fixtureCheckout as fixture } from './checkout.mts';

const toolchainRuff: Dependency = { ecosystem: 'pypi', manifest: TOOLCHAIN, package: 'ruff', kind: 'toolchain', spec: '==0.16.10', version: '0.16.10', lock: null };
const policyOf = (root: string) => readPolicy(root);

test('the ruff of mise.toml is a PyPI dependency of the review state', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\nruff = "0.16.10"\n');
  const state = readState(root, policyOf(root));
  assert.deepEqual(state.dependencies.filter(dependency => dependency.manifest === TOOLCHAIN), [toolchainRuff]);
});

test('a mise.toml without ruff has no toolchain dependency', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\npython = "3.14.8"\n');
  const state = readState(root, policyOf(root));
  assert.equal(state.dependencies.some(dependency => dependency.manifest === TOOLCHAIN), false);
});

test('a newer ruff is set by hand and locked, and updatePlan never edits mise.toml', () => {
  assert.equal(fixOf({ ...toolchainRuff, latest: '0.16.11' }), `set ruff in ${TOOLCHAIN} to 0.16.11, then make toolchain-lock and make install-tools`);
  assert.equal(fixOf({ ...toolchainRuff, manifest: 'pyproject.toml', latest: '0.16.11' }), UPDATE);
  assert.deepEqual(updatePlan({ newer: [{ ...toolchainRuff, latest: '0.16.11' }], advisories: [] }), []);
});
