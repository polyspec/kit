// Tests of the dependency review on the fixture of tests/kit/fixture (package.json, packages/fixture-php, packages/fixture-python,
// config/): the review records the fixture the same way on every run. The registries are stubs (tests/kit/registry.mts), so no test queries the network.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';

import { fixtureCheckout as fixture, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';
import { readNpmManifest } from '../../scripts/kit/manifests.mts';
import { POLICY, RECORD, readPolicy } from '../../scripts/kit/dependency-state.mts';
import type { ReviewRecord } from '../../scripts/kit/dependency-state.mts';
import { known } from './known.mts';
import { editFixture } from './json-fixture.mts';


test('the review reports a newer stable release with the fix command, exits 0 and writes no record without RECORD', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, npm: { ...FIXTURE_REGISTRY.npm, 'is-number': ['7.0.0', '7.1.0'] } });
  const before = readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8');
  const result = review(root, [], stub.env);
  // K448: the review reports a newer release for the developer and never fails over it (S4).
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] package\.json is-number 7\.0\.0 < 7\.1\.0: a newer stable release exists\. Fix: make dependency-review UPDATE=1\.$/m);
  assert.equal(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'), before);
});

test('the review records the fixture, and a second run writes the same record', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const first = review(root, ['--record'], stub.env);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const once = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  const second = review(root, ['--record'], stub.env);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const twice = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  assert.deepEqual({ ...twice, reviewed: null }, { ...once, reviewed: null });
  assert.deepEqual(twice.dependencies.map(item => [item.ecosystem, item.package, item.version]), [
    ['npm', 'is-number', '7.0.0'], ['npm', 'semver', '7.6.0'], ['composer', 'psr/log', '3.0.2'], ['pypi', 'click', '8.1.7'], ['pypi', 'setuptools', '84.0.0'], ['go', 'github.com/google/uuid', 'v1.6.0'],
  ]);
});

test('a package that the root overrides install from a URL is not reviewed against the registry', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const manifest = readNpmManifest(root, 'package.json');
  manifest.overrides = { 'is-number': 'https://example.org/releases/is-number-7.0.0.tgz' };
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, npm: Object.fromEntries(Object.entries(FIXTURE_REGISTRY.npm).filter(([name]) => name !== 'is-number')) });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  assert.equal(record.dependencies.some(entry => entry.package === 'is-number'), false);
});

// A package beside the fixture, at tools/sub, with its own lock: it links fixture-lib as a local package, and the lock records
// the version `lockVersion` of it (fixture-lib has version 0.0.0).
const SUB_LOCK = 'tools/sub/package-lock.json';
const addSubPackage = (root: string, lockVersion: string) => {
  mkdirSync(path.join(root, 'tools/sub'), { recursive: true });
  const dependencies = { 'fixture-lib': 'file:../../packages/fixture-lib' };
  writeFileSync(path.join(root, 'tools/sub/package.json'), `${JSON.stringify({ name: 'fixture-sub', version: '0.0.0', private: true, dependencies }, null, 2)}\n`);
  writeFileSync(path.join(root, SUB_LOCK), `${JSON.stringify({ name: 'fixture-sub', version: '0.0.0', lockfileVersion: 3, requires: true, packages: {
    '': { name: 'fixture-sub', version: '0.0.0', dependencies },
    'node_modules/fixture-lib': { resolved: '../../packages/fixture-lib', link: true },
    '../../packages/fixture-lib': { version: lockVersion },
  } }, null, 2)}\n`);
};
const addPolicyLock = (root: string) => {
  const policy = readPolicy(root);
  policy.npmLocks.push(SUB_LOCK);
  writeFileSync(path.join(root, 'config/dependency-policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
};

test('the review records and audits every npm lock that the policy names', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  addSubPackage(root, '0.0.0');
  addPolicyLock(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  assert.deepEqual(record.locks.map(entry => entry.lock).filter(lock => lock.endsWith('package-lock.json')), ['package-lock.json', SUB_LOCK]);
  assert.equal(stub.calls().filter(call => call.startsWith('npm audit ')).length, 2, stub.calls().join('\n'));
});

test('an npm audit that prints nothing is an error of its lock, not a lock without advisories', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, npmAuditText: '' });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /npm audit --json --package-lock-only --offline=false printed no JSON: the output is empty/);
});

test('the review refuses a policy that breaks its schema instead of reviewing nothing for a missing key', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'config/dependency-policy.json');
  const policy = readConfig<{ pythonLocks?: unknown }>(root, POLICY, 'dependency-policy.schema.json');
  delete policy.pythonLocks;
  writeFileSync(file, JSON.stringify(policy));
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /config\/dependency-policy\.json: .*pythonLocks/);
  assert.equal(stub.calls().length, 0, 'the review queried a registry');
});

test('an npm advisory of a package that the lock does not hold at node_modules/<name> records its range, not a version', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const via = [{ source: 1099, url: 'https://github.com/advisories/GHSA-0000-0000-0001', severity: 'high', title: 'nested overflows' }];
  stub.registry({ ...FIXTURE_REGISTRY, npmAudit: { vulnerabilities: { nested: { range: '<1.2.0', via } } } });
  review(root, ['--record'], stub.env);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  const npm = record.locks.find(entry => entry.lock === 'package-lock.json');
  assert.deepEqual(npm?.advisories, [{ package: 'nested', range: '<1.2.0', id: '1099', severity: 'high', title: 'nested overflows', url: known(via[0], 'via[0]').url }]);
});

test('K680 npm advisories preserve native vulnerable node paths and their locked copy versions', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const nested = 'node_modules/docs/node_modules/vite';
  const another = 'node_modules/other/node_modules/vite';
  editFixture(root, 'package-lock.json', (lock: { packages: Record<string, { version: string }> }) => {
    lock.packages['node_modules/vite'] = { version: '8.3.4' };
    lock.packages[nested] = { version: '6.4.3' };
    lock.packages[another] = { version: '6.4.2' };
  });
  const via = [{ source: 680, url: 'https://example.invalid/advisory', severity: 'high', title: 'nested vulnerability' }];
  stub.registry({ ...FIXTURE_REGISTRY, npmAudit: { vulnerabilities: { vite: { range: '<=6.4.3', nodes: [nested, another], via } } } });
  const reviewed = review(root, ['--record'], stub.env);
  assert.equal(reviewed.status, 1, reviewed.stdout + reviewed.stderr);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  const audit = record.locks.find(lock => lock.lock === 'package-lock.json');
  assert.deepEqual(audit?.advisories, [
    { package: 'vite', nodePath: nested, version: '6.4.3', id: '680', severity: 'high', title: 'nested vulnerability', url: via[0]?.url },
    { package: 'vite', nodePath: another, version: '6.4.2', id: '680', severity: 'high', title: 'nested vulnerability', url: via[0]?.url },
  ]);
  for (const node of [nested, another]) assert.ok(reviewed.stdout.includes(node), reviewed.stdout);
  assert.doesNotMatch(reviewed.stdout, /vite 8\.3\.4/);
});


test('K680 an unknown native node keeps its path and range without borrowing a safe top-level version', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  editFixture(root, 'package-lock.json', (lock: { packages: Record<string, { version: string }> }) => { lock.packages['node_modules/nested'] = { version: '9.0.0' }; });
  const nodePath = 'node_modules/parent/node_modules/nested';
  const via = [{ source: 681, url: 'https://example.invalid/advisory', severity: 'high', title: 'unknown copy' }];
  stub.registry({ ...FIXTURE_REGISTRY, npmAudit: { vulnerabilities: { nested: { range: '<1.2.0', nodes: [nodePath], via } } } });
  const reviewed = review(root, ['--record'], stub.env);
  assert.equal(reviewed.status, 1, reviewed.stdout + reviewed.stderr);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  assert.deepEqual(record.locks.find(lock => lock.lock === 'package-lock.json')?.advisories, [{ package: 'nested', nodePath, range: '<1.2.0', id: '681', severity: 'high', title: 'unknown copy', url: via[0]?.url }]);
});


test('K684 the online npm review explicitly overrides inherited offline mode', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, [], { ...stub.env, npm_config_offline: 'true' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(stub.calls().some(call => call === 'npm audit --json --package-lock-only --offline=false'), stub.calls().join('\n'));
});

test('K684 a native audit transport error cannot replace the successful review record', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const before = readFileSync(path.join(root, RECORD), 'utf8');
  const stub = stubRegistries(t, root);
  for (const fields of [{}, { vulnerabilities: {} }]) {
    stub.registry({ ...FIXTURE_REGISTRY, npmAuditText: JSON.stringify({ ...fields, message: 'request to audit endpoint failed: ECONNREFUSED', error: { summary: '', detail: '' } }) });
    const result = review(root, ['--record'], stub.env);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /advisory query failed/);
    assert.equal(readFileSync(path.join(root, RECORD), 'utf8'), before);
  }
});


test('K684 a native vulnerability exit remains a complete review', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, npmAudit: { vulnerabilities: { semver: { range: '<8', nodes: ['node_modules/semver'], via: [{ source: 684, url: 'https://example.invalid/advisory', severity: 'high', title: 'native finding' }] } } } });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /advisory query failed/);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  assert.ok(record.locks.find(lock => lock.lock === 'package-lock.json')?.advisories?.some(advisory => advisory.id === '684'));
});
