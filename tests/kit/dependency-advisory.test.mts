// Tests of an accepted advisory: an advisory that no release fixes is accepted by an entry of advisoryExceptions of
// config/dependency-policy.json with its reason and removal condition. The review and the gate then pass it, but print it
// as accepted with its reason; an advisory without an entry still fails both, and an entry that matches no advisory of the
// review is stale and fails both. cargo-audit is a stub that reports one advisory of the Cargo lock of the fixture.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { editFixture, readFixture } from './json-fixture.mts';
import type { ReviewRecord } from '../../scripts/kit/check-dependency-policy.mts';

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
const ACCEPTED_GATE = /^\[dependency-policy\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: advisory RUSTSEC-2099-0001 \(vulnerability\) itoa overflows is accepted by advisoryExceptions of config\/dependency-policy\.json: no release of itoa fixes it, and the fixture never parses untrusted numbers; remove it when a release of itoa fixes RUSTSEC-2099-0001$/m;

test('an advisory without an exception fails the review and the gate', (t) => {
  const { root, result } = reviewed(t, []);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: advisory RUSTSEC-2099-0001 \(vulnerability\) itoa overflows .*\. Fix: make dependency-review UPDATE=1\.$/m);
  const gated = gate(root);
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /^\[dependency-policy\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: the review record found advisory RUSTSEC-2099-0001 /m);
});

test('an advisory with an exception passes the review and the gate, which print it as accepted with its reason', (t) => {
  const { root, result } = reviewed(t, [ACCEPTED]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, ACCEPTED_REVIEW);
  const record = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  assert.deepEqual(record.locks.find(item => item.lock === LOCK)?.advisories?.map(item => item.id), ['RUSTSEC-2099-0001'], 'the record keeps the accepted advisory');
  const gated = gate(root);
  assert.equal(gated.status, 0, gated.stderr);
  assert.match(gated.stdout, ACCEPTED_GATE);
  assert.match(gated.stdout, /1 accepted advisory/);
});

test('an exception that matches no advisory of the review is stale and fails the review and the gate', (t) => {
  const stale = { ...ACCEPTED, advisory: 'RUSTSEC-2099-0009' };
  const { root, result } = reviewed(t, [ACCEPTED, stale]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-rust\/Cargo\.lock itoa: the advisory exception RUSTSEC-2099-0009 of config\/dependency-policy\.json is stale, the review found no such advisory\. Fix: remove the exception from config\/dependency-policy\.json\.$/m);
  const gated = gate(root);
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /^\[dependency-policy\] packages\/fixture-rust\/Cargo\.lock itoa: the review record found no advisory RUSTSEC-2099-0009, and config\/dependency-policy\.json holds an exception for it\. Rule: an advisory exception names an advisory that the review of its lock found\. Fix: remove the exception from config\/dependency-policy\.json\.$/m);
});

test('an advisory exception without its reason or removal condition fails the gate', (t) => {
  const { root } = reviewed(t, [{ ...ACCEPTED, reason: ' ' }]);
  const gated = gate(root);
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /^\[dependency-policy\] config\/dependency-policy\.json: the advisory exception RUSTSEC-2099-0001 of packages\/fixture-rust\/Cargo\.lock itoa lacks a lock, package, advisory, reason or removal condition\./m);
});

test('the security gate rejects changed and unreviewed locks without querying a registry (K660)', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t, root);
  appendFileSync(path.join(root, 'package-lock.json'), '\n');
  const changed = gate(root, stub.env);
  assert.equal(changed.status, 1, changed.stdout + changed.stderr);
  assert.match(changed.stderr, /package-lock\.json: the lock changed after its review/);
  rmSync(path.join(root, 'config/dependency-review.json'));
  const missing = gate(root, stub.env);
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /the review record does not exist/);
  assert.equal(stub.calls().filter(call => !call.startsWith('composer validate ')).length, 0);
});

test('a newer release alone does not fail the security review or gate (K660)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, npm: { ...FIXTURE_REGISTRY.npm, 'is-number': ['7.0.0', '7.1.0'] } });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /is-number 7\.0\.0 < 7\.1\.0/);
  const gated = gate(root, stub.env);
  assert.equal(gated.status, 0, gated.stdout + gated.stderr);
});

test('the security gate rejects duplicate and missing lock reviews (K660)', (t) => {
  const root = fixture(t);
  const record = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  const first = record.locks[0];
  assert.ok(first);
  editFixture<ReviewRecord>(root, 'config/dependency-review.json', value => { value.locks.push({ ...first, advisories: [] }); });
  const duplicate = gate(root);
  assert.equal(duplicate.status, 1, duplicate.stdout + duplicate.stderr);
  assert.match(duplicate.stderr, /the review record names a lock more than once/);
  editFixture<ReviewRecord>(root, 'config/dependency-review.json', value => { value.locks = record.locks.filter(item => item.lock !== first.lock); });
  const missing = gate(root);
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /the lock has no entry in the review record/);
});

// K470: the sprintf-js advisory of the api-extractor chain stays an accepted exception, and its record carries the evidence
// that no release fixes it and the removal condition that the review reads as stale.
test('the sprintf-js advisory stays an accepted exception with its evidence and removal condition (K470)', () => {
  const policy: unknown = JSON.parse(readFileSync(new URL('../../config/dependency-policy.json', import.meta.url), 'utf8'));
  const exceptions: unknown[] = typeof policy === 'object' && policy !== null && 'advisoryExceptions' in policy && Array.isArray(policy.advisoryExceptions) ? policy.advisoryExceptions : [];
  const record: unknown = exceptions.find(item => typeof item === 'object' && item !== null && 'package' in item && item.package === 'sprintf-js' && 'advisory' in item && item.advisory === '1241202');
  assert.ok(typeof record === 'object' && record !== null && 'reason' in record && typeof record.reason === 'string' && 'removalCondition' in record && typeof record.removalCondition === 'string', 'an advisoryExceptions entry names sprintf-js and GHSA-hp3w-g68c-fv3c with its reason and removal condition');
  const reason = record.reason;
  const removalCondition = record.removalCondition;
  assert.match(reason, /first_patched_version none/, 'the reason records that no patched sprintf-js exists');
  assert.match(reason, /sprintf-js is 1\.1\.3/, 'the reason records the latest sprintf-js release');
  assert.match(reason, /argparse 2\.0\.1 override breaks 'api-extractor --help'/, 'the reason records why the argparse override is refused');
  assert.match(reason, /ae-forgotten-export/, 'the reason records why the TypeScript compiler API is refused');
  assert.match(removalCondition, /a patched sprintf-js .*or an api-extractor release without argparse 1\.x/, 'the removal condition names the retry condition');
});
