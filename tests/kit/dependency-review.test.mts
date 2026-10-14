// Tests of the review path of scripts/kit/dependency-review.mts: the fix that a finding names is the fix of the newer release
// that the review found. The checkout is the fixture copy of tests/kit/checkout.mts; the registries are stubs.
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { highestStableRelease } from '../../scripts/kit/dependency-review.mts';
import { TOOLCHAIN } from '../../scripts/kit/dependency-state.mts';
import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';

test('a newer ruff release of mise.toml is named in the fix of its finding', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\nruff = "0.16.10"\n');
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, ruff: { '0.16.10': [{}], '0.16.11': [{}] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] mise\.toml ruff 0\.16\.10 < 0\.16\.11: a newer stable release exists\. Fix: set ruff in mise\.toml to 0\.16\.11, then make toolchain-lock and make install-tools\.$/m);
});

test('the latest PyPI release is the highest PEP 440 release with files, a post-release included and a pre-release not (K115)', () => {
  const files = [{}];
  assert.equal(highestStableRelease({ '3.9': files, '3.11': files, '3.12rc1': files, '3.13': [] }), '3.11');
  assert.equal(highestStableRelease({ '1.0': files, '1.0.post1': files, '1.1.dev1': files }), '1.0.post1');
  assert.equal(highestStableRelease({ '2.0b1': files }), null);
});

// A checkout without config/dependency-policy.json is told so by name, not by a stack trace of the read (K146).
test('the review and the gate name a missing policy file instead of failing with a stack trace (K146)', (t) => {
  const root = fixture(t);
  rmSync(path.join(root, 'config/dependency-policy.json'));
  for (const result of [review(root, []), gate(root)]) {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /config\/dependency-policy\.json is missing/);
    assert.doesNotMatch(result.stderr, /^\s+at /m);
  }
});
