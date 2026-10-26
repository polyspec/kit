// Tests of the Cargo review: every tracked Cargo.lock is a lock of the review, its advisories come from cargo-audit and
// are recorded at the review only; cargo-audit is the tool of mise.toml, a stub as its shim.
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { readFixture } from './json-fixture.mts';
import type { ReviewRecord } from '../../scripts/kit/check-dependency-policy.mts';

const VULNERABLE = {
  vulnerabilities: { found: true, count: 1, list: [{ package: { name: 'itoa', version: '1.0.15' }, advisory: { id: 'RUSTSEC-2099-0001', title: 'itoa overflows', url: 'https://rustsec.org/advisories/RUSTSEC-2099-0001', cvss: null } }] },
  warnings: { unmaintained: [{ package: { name: 'itoa', version: '1.0.15' }, advisory: { id: 'RUSTSEC-2099-0002', title: 'itoa is unmaintained', url: 'https://rustsec.org/advisories/RUSTSEC-2099-0002' } }] },
};

test('the review records the Cargo lock with its advisories, and the gate then names each advisory', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root, VULNERABLE);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: advisory RUSTSEC-2099-0001 \(vulnerability\) itoa overflows https:\/\/rustsec\.org\/advisories\/RUSTSEC-2099-0001\. Fix: make dependency-review UPDATE=1\.$/m);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: advisory RUSTSEC-2099-0002 \(unmaintained\) itoa is unmaintained /m);
  const record = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  assert.deepEqual(record.locks.find(item => item.lock === 'packages/fixture-rust/Cargo.lock')?.advisories?.map(item => item.id), ['RUSTSEC-2099-0001', 'RUSTSEC-2099-0002']);
  const gated = gate(root);
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /^\[dependency-policy\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: the review record found advisory RUSTSEC-2099-0001 \(vulnerability\) itoa overflows /m);
});

test('the gate fails when a Cargo lock changed after its review', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'packages/fixture-rust/Cargo.lock'), `${readFileSync(path.join(root, 'packages/fixture-rust/Cargo.lock'), 'utf8')}\n`);
  const result = gate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[dependency-policy\] packages\/fixture-rust\/Cargo\.lock: the lock changed after its review: its sha256 is [0-9a-f]{64}, the review recorded [0-9a-f]{64}\./m);
});

test('the review names the install command when cargo-audit is not installed', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /cargo-audit of the checkout is missing \(var\/tools\/bin\/cargo-audit, var\/tools\/mise\/shims\/cargo-audit\); run make install/);
});

test('the vendored fixture of kit is not a lock of the repository that holds it', (t) => {
  const root = fixture(t);
  // A repository that vendors kit holds the fixture under tests/kit/fixture, with a Cargo.lock of its own.
  cpSync(path.join(root, 'packages/fixture-rust'), path.join(root, 'tests/kit/fixture/packages/fixture-rust'), { recursive: true });
  const result = gate(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
