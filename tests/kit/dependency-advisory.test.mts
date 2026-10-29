// Tests of an accepted advisory: an advisory that no release fixes is accepted by an entry of advisoryExceptions of
// config/dependency-policy.json with its reason and removal condition. The review then passes it, but prints it
// as accepted with its reason; an advisory without an entry still fails it, and an entry that matches no advisory of the
// review is stale and fails it. cargo-audit is a stub that reports one advisory of the Cargo lock of the fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fixtureCheckout as fixture, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { editFixture, readFixture } from './json-fixture.mts';
import type { ReviewRecord } from '../../scripts/kit/dependency-state.mts';

const LOCK = 'packages/fixture-rust/Cargo.lock';
const VULNERABLE = {
  vulnerabilities: { found: true, count: 1, list: [{ package: { name: 'itoa', version: '1.0.15' }, advisory: { id: 'RUSTSEC-2099-0001', title: 'itoa overflows', url: 'https://rustsec.org/advisories/RUSTSEC-2099-0001', cvss: null } }] },
  warnings: {},
};
const ACCEPTED = { lock: LOCK, package: 'itoa', advisory: 'RUSTSEC-2099-0001', reason: 'no release of itoa fixes it, and the fixture never parses untrusted numbers', removalCondition: 'a release of itoa fixes RUSTSEC-2099-0001' };

/** The fixture with the advisory exceptions `accepted` in its policy, reviewed with the stub registries and cargo-audit. */
function reviewed(t: TestContext, accepted: object[]) {
  const root = fixture(t);
  editFixture(root, 'config/dependency-policy.json', (policy: { advisoryExceptions?: object[] }) => { policy.advisoryExceptions = accepted; });
  installCargoAuditStub(root, VULNERABLE);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  return { root, result: review(root, ['--record'], stub.env) };
}

const ACCEPTED_REVIEW = /^\[dependency-review\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: advisory RUSTSEC-2099-0001 \(vulnerability\) itoa overflows https:\/\/rustsec\.org\/advisories\/RUSTSEC-2099-0001 is accepted by advisoryExceptions of config\/dependency-policy\.json: no release of itoa fixes it, and the fixture never parses untrusted numbers; remove it when a release of itoa fixes RUSTSEC-2099-0001$/m;

test('an advisory without an exception fails the review', (t) => {
  const { result } = reviewed(t, []);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: advisory RUSTSEC-2099-0001 \(vulnerability\) itoa overflows .*\. Fix: make dependency-review UPDATE=1\.$/m);
});

test('an advisory with an exception passes the review, which prints it as accepted with its reason', (t) => {
  const { root, result } = reviewed(t, [ACCEPTED]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, ACCEPTED_REVIEW);
  const record = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  assert.deepEqual(record.locks.find(item => item.lock === LOCK)?.advisories?.map(item => item.id), ['RUSTSEC-2099-0001'], 'the record keeps the accepted advisory');
});

test('an exception that matches no advisory of the review is stale and fails the review', (t) => {
  const stale = { ...ACCEPTED, advisory: 'RUSTSEC-2099-0009' };
  const { result } = reviewed(t, [ACCEPTED, stale]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-rust\/Cargo\.lock itoa: the advisory exception RUSTSEC-2099-0009 of config\/dependency-policy\.json is stale, the review found no such advisory\. Fix: remove the exception from config\/dependency-policy\.json\.$/m);
});

test('a newer release alone does not fail the security review (K660)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, npm: { ...FIXTURE_REGISTRY.npm, 'is-number': ['7.0.0', '7.1.0'] } });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /is-number 7\.0\.0 < 7\.1\.0/);
});

// K470: an accepted advisory remains justified only while the actual lock review still finds it.
test('the repository accepts only reviewed advisories with their reason and removal condition (K470, K660)', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const policy = readFixture<{ advisoryExceptions?: Array<{ lock: string; package: string; advisory: string; reason: string; removalCondition: string }> }>(root, 'config/dependency-policy.json');
  const review = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  for (const exception of policy.advisoryExceptions ?? []) {
    assert.ok(exception.reason.trim(), `${exception.package}: accepted advisory has a reason`);
    assert.ok(exception.removalCondition.trim(), `${exception.package}: accepted advisory has a removal condition`);
    assert.ok(review.locks.some(lock => lock.lock === exception.lock && lock.advisories?.some(advisory => advisory.package === exception.package && advisory.id === exception.advisory)),
      `${exception.package}: accepted advisory ${exception.advisory} is present in the lock review`);
  }
});
