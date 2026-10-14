// Tests of the dependency tools on the fixture of tests/kit/fixture (package.json, packages/fixture-php, packages/fixture-python,
// config/): the gate passes on the fixture, fails on a lock changed without a review, and the review records the fixture
// the same way on every run. The registries are stubs (tests/kit/registry.mts), so no test queries the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { FIXTURE_REGISTRY, stubRegistries, toolStubs } from './registry.mts';

import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { tool } from './kit-tools.mts';

const findings = (result: { stderr: string }) => result.stderr.split('\n').filter(line => line.startsWith('[dependency-policy] ') && !line.includes(' finding'));

test('the gate passes on the fixture and queries no registry', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t);
  const result = gate(root, stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-policy\] 6 registry dependencies and 5 locks match the review of /m);
  assert.equal(stub.calls().filter(call => !call.startsWith('composer validate ')).length, 0, stub.calls().join('\n'));
});

test('the gate fails on a lock changed without a review and names the file, the review and the fix', (t) => {
  const root = fixture(t);
  appendFileSync(path.join(root, 'packages/fixture-php/composer.lock'), '\n');
  const result = gate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[dependency-policy\] packages\/fixture-php\/composer\.lock: the lock changed after the review of .+: its sha256 is [0-9a-f]{64}, the review recorded [0-9a-f]{64}\./m);
});

test('the review reports a newer stable release with the fix command and writes no record without RECORD', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  stub.registry({ ...FIXTURE_REGISTRY, npm: { ...FIXTURE_REGISTRY.npm, 'is-number': ['7.0.0', '7.1.0'] } });
  const before = readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8');
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] package\.json is-number 7\.0\.0 < 7\.1\.0: a newer stable release exists\. Fix: make dependency-review UPDATE=1\.$/m);
  assert.equal(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'), before);
});

test('the review records the fixture, and a second run writes the same record', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  stub.registry(FIXTURE_REGISTRY);
  const first = review(root, ['--record'], stub.env);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const once = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  const second = review(root, ['--record'], stub.env);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const twice = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  assert.deepEqual({ ...twice, reviewed: null }, { ...once, reviewed: null });
  assert.deepEqual(twice.dependencies.map((item: { ecosystem: string; package: string; version: string }) => [item.ecosystem, item.package, item.version]), [
    ['npm', 'is-number', '7.0.0'], ['npm', 'semver', '7.6.0'], ['composer', 'psr/log', '3.0.2'], ['pypi', 'click', '8.1.7'], ['pypi', 'setuptools', '84.0.0'], ['go', 'github.com/google/uuid', 'v1.6.0'],
  ]);
});

test('the mutation check rejects every mutation of the fixture', (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, [tool('check-dependency-policy-mutation')], { cwd: root, encoding: 'utf8', env: toolStubs() });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /4 mutations rejected/);
});

test('the mutation check applies to the ecosystems of the repository: no Composer platform, and a record that starts with a Python dependency', (t) => {
  const root = fixture(t);
  const edit = <T,>(file: string, change: (data: T) => void) => {
    const data: T = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    change(data);
    writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
  };
  edit('config/dependency-policy.json', (policy: { composerPlatforms: string[] }) => { policy.composerPlatforms = []; });
  edit('config/dependency-review.json', (record: { dependencies: Array<{ ecosystem: string }> }) => { record.dependencies = record.dependencies.filter(entry => entry.ecosystem === 'pypi'); });
  const result = spawnSync(process.execPath, [tool('check-dependency-policy-mutation')], { cwd: root, encoding: 'utf8', env: toolStubs() });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /3 mutations rejected/);
});

// The copy of the mutation check holds go.work with the dependency files: without it a module that requires only another
// module of the workspace was asked for a go.sum that it cannot have (K153).
test('the mutation check copies go.work, so a module that requires only a workspace member needs no go.sum (K153)', (t) => {
  const root = fixture(t);
  const write = (file: string, text: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  write('go.work', 'go 1.21\n\nuse (\n\t./packages/fixture-go\n\t./packages/sibling\n)\n');
  write('packages/sibling/go.mod', 'module example.com/sibling\n\ngo 1.21\n\nrequire example.com/kit-fixture-go v0.0.0\n');
  write('packages/sibling/sibling.go', 'package sibling\n');
  const result = spawnSync(process.execPath, [tool('check-dependency-policy-mutation')], { cwd: root, encoding: 'utf8', env: toolStubs() });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /4 mutations rejected/);
});

test('a package that the root overrides install from a URL is not reviewed against the registry', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  manifest.overrides = { 'is-number': 'https://example.org/releases/is-number-7.0.0.tgz' };
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const stub = stubRegistries(t);
  stub.registry({ ...FIXTURE_REGISTRY, npm: Object.fromEntries(Object.entries(FIXTURE_REGISTRY.npm).filter(([name]) => name !== 'is-number')) });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const record = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  assert.equal(record.dependencies.some((entry: { package: string }) => entry.package === 'is-number'), false);
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
  const policy = JSON.parse(readFileSync(path.join(root, 'config/dependency-policy.json'), 'utf8'));
  policy.npmLocks.push(SUB_LOCK);
  writeFileSync(path.join(root, 'config/dependency-policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
};

test('the gate reads every npm lock that the policy names: a stale lock of a second npm manifest fails, a current one passes', (t) => {
  const root = fixture(t);
  addSubPackage(root, '0.0.1');
  addPolicyLock(root);
  const local = (line: string) => line.startsWith('[dependency-policy] tools/sub/package.json fixture-lib:');
  const stale = findings(gate(root)).filter(local);
  assert.equal(stale.length, 1, `the gate read no stale lock of tools/sub: ${stale.join('\n')}`);
  const first = stale[0];
  assert.ok(first !== undefined, 'the gate printed no finding of tools/sub');
  assert.match(first, /^\[dependency-policy\] tools\/sub\/package\.json fixture-lib: tools\/sub\/package-lock\.json records version 0\.0\.1, packages\/fixture-lib has version 0\.0\.0\./);
  addSubPackage(root, '0.0.0');
  assert.deepEqual(findings(gate(root)).filter(local), []);
});

test('the review records and audits every npm lock that the policy names', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  addSubPackage(root, '0.0.0');
  addPolicyLock(root);
  const stub = stubRegistries(t);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const record = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  assert.deepEqual(record.locks.map((entry: { lock: string }) => entry.lock).filter((lock: string) => lock.endsWith('package-lock.json')), ['package-lock.json', SUB_LOCK]);
  assert.equal(stub.calls().filter(call => call.startsWith('npm audit ')).length, 2, stub.calls().join('\n'));
});

test('an npm audit that prints nothing is an error of its lock, not a lock without advisories', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  stub.registry({ ...FIXTURE_REGISTRY, npmAuditText: '' });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /npm audit --json --package-lock-only printed no JSON: the output is empty/);
});

test('the review refuses a policy that breaks its schema instead of reviewing nothing for a missing key', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'config/dependency-policy.json');
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  delete policy.pythonLocks;
  writeFileSync(file, JSON.stringify(policy));
  const stub = stubRegistries(t);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /config\/dependency-policy\.json: .*pythonLocks/);
  assert.equal(stub.calls().length, 0, 'the review queried a registry');
});

test('the gate reads the review record by its schema and names each error', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'config/dependency-review.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  delete record.comment;
  writeFileSync(file, JSON.stringify(record));
  const result = gate(root, stubRegistries(t).env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /\[dependency-policy\] config\/dependency-review\.json: the record breaks dependency-review\.schema\.json: .*comment/);
});

test('an npm advisory of a package that the lock does not hold at node_modules/<name> records its range, not a version', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  const via = [{ source: 1099, url: 'https://github.com/advisories/GHSA-0000-0000-0001', severity: 'high', title: 'nested overflows' }];
  stub.registry({ ...FIXTURE_REGISTRY, npmAudit: { vulnerabilities: { nested: { range: '<1.2.0', via } } } });
  review(root, ['--record'], stub.env);
  const record = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  const npm = record.locks.find((entry: { lock: string }) => entry.lock === 'package-lock.json');
  assert.deepEqual(npm.advisories, [{ package: 'nested', range: '<1.2.0', id: '1099', severity: 'high', title: 'nested overflows', url: via[0]!.url }]);
});

// K58: a command module does not act when it is imported; the mutation check runs only as the command.
test('importing the mutation check runs nothing and prints nothing', (t) => {
  const root = fixture(t);
  const url = pathToFileURL(tool('check-dependency-policy-mutation')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log('imported');`], { cwd: root, encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'imported\n', 'the import ran the mutation check');
  assert.equal(result.stderr, '');
});
