// Tests of the review path of scripts/kit/dependency-review.mts: the fix that a finding names is the fix of the newer release
// that the review found. The checkout is the fixture copy of tests/kit/checkout.mts; the registries are stubs.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TOOLCHAIN } from '../../scripts/kit/dependency-state.mts';
import { fixtureCheckout as fixture, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';

test('a newer ruff release of config/toolchain.json is named in the fix of its finding', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, TOOLCHAIN), JSON.stringify({ schema: 1, ruff: { version: '0.16.10', sha256: { 'linux-x64': 'f'.repeat(64) } } }));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, ruff: { '0.16.10': [{}], '0.16.11': [{}] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] config\/toolchain\.json ruff 0\.16\.10 < 0\.16\.11: a newer stable release exists\. Fix: set ruff in config\/toolchain\.json to 0\.16\.11 with the sha256 of each wheel, then make install-tools\.$/m);
});
