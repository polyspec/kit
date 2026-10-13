// Tests of an accepted advisory: an advisory that no release fixes is accepted by an entry of advisoryExceptions of
// config/dependency-policy.json with its reason and removal condition. The review and the gate then pass it, but print it
// as accepted with its reason; an advisory without an entry still fails both, and an entry that matches no advisory of the
// review is stale and fails both. cargo-audit is a stub that reports one advisory of the Cargo lock of the fixture.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';

const LOCK = 'packages/fixture-rust/Cargo.lock';
const VULNERABLE = {
  vulnerabilities: { found: true, count: 1, list: [{ package: { name: 'itoa', version: '1.0.15' }, advisory: { id: 'RUSTSEC-2099-0001', title: 'itoa overflows', url: 'https://rustsec.org/advisories/RUSTSEC-2099-0001', cvss: null } }] },
  warnings: {},
};
const ACCEPTED = { lock: LOCK, package: 'itoa', advisory: 'RUSTSEC-2099-0001', reason: 'no release of itoa fixes it, and the fixture never parses untrusted numbers', removalCondition: 'a release of itoa fixes RUSTSEC-2099-0001' };

/** The fixture with the advisory exceptions `accepted` in its policy, reviewed with the stub registries and cargo-audit. */
function reviewed(t: TestContext, accepted: object[]) {
  const root = fixture(t);
  const policy = path.join(root, 'config/dependency-policy.json');
  writeFileSync(policy, JSON.stringify({ ...JSON.parse(readFileSync(policy, 'utf8')), advisoryExceptions: accepted }, null, 2));
  installCargoAuditStub(root, VULNERABLE);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
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
  assert.match(gated.stderr, /^\[dependency-policy\] packages\/fixture-rust\/Cargo\.lock itoa 1\.0\.15: the review of .+ found advisory RUSTSEC-2099-0001 /m);
});

test('an advisory with an exception passes the review and the gate, which print it as accepted with its reason', (t) => {
  const { root, result } = reviewed(t, [ACCEPTED]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, ACCEPTED_REVIEW);
  const record = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  assert.deepEqual(record.locks.find((item: { lock: string }) => item.lock === LOCK).advisories.map((item: { id: string }) => item.id), ['RUSTSEC-2099-0001'], 'the record keeps the accepted advisory');
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
  assert.match(gated.stderr, /^\[dependency-policy\] packages\/fixture-rust\/Cargo\.lock itoa: the review of .+ found no advisory RUSTSEC-2099-0009, and config\/dependency-policy\.json holds an exception for it\. Rule: an advisory exception names an advisory that the review of its lock found\. Fix: remove the exception from config\/dependency-policy\.json\.$/m);
});

test('an advisory exception without its reason or removal condition fails the gate', (t) => {
  const { root } = reviewed(t, [{ ...ACCEPTED, reason: ' ' }]);
  const gated = gate(root);
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /^\[dependency-policy\] config\/dependency-policy\.json: the advisory exception RUSTSEC-2099-0001 of packages\/fixture-rust\/Cargo\.lock itoa lacks a lock, package, advisory, reason or removal condition\./m);
});
