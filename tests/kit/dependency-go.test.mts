// Tests of the Go review: the direct requirements of every tracked go.mod, the newest stable release of each from the
// module proxy, the vulnerabilities that the code calls from govulncheck, and the install of govulncheck into var/tools.
// go, govulncheck and the proxy are stubs.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { goRequirements } from '../../scripts/kit/dependency-state.mts';
import { goAdvisories, updatePlan } from '../../scripts/kit/dependency-review.mts';
import { fixtureCheckout as fixture, govulncheckCalls, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries, toolStubs } from './registry.mts';
import { readFixture } from './json-fixture.mts';
import type { ReviewRecord } from '../../scripts/kit/dependency-state.mts';

// A SARIF report of govulncheck (-format sarif) of the shape that govulncheck 1.1.4 writes: one rule per vulnerability that
// the scan found, and one result each; a result whose code calls the vulnerable function has a code flow that ends in it.
const flow = (fn: string) => ({ threadFlows: [{ locations: [
  { module: 'example.com/app@', location: { message: { text: 'example.com/app.main' } } },
  { module: 'github.com/google/uuid@v1.6.0', location: { message: { text: `github.com/google/uuid.${fn}` } } },
] }] });
const REPORT = {
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'govulncheck', rules: [
      { id: 'GO-2099-0001', shortDescription: { text: '[GO-2099-0001] uuid generates a predictable identifier' }, fullDescription: { text: 'uuid generates a predictable identifier' } },
      { id: 'GO-2099-0002', shortDescription: { text: '[GO-2099-0002] uuid is unused here' }, fullDescription: { text: 'uuid is unused here' } },
    ] } },
    results: [
      { ruleId: 'GO-2099-0001', level: 'error', message: { text: 'Your code calls vulnerable functions in 1 package (github.com/google/uuid).' }, codeFlows: [flow('New'), flow('NewRandom')] },
      { ruleId: 'GO-2099-0002', level: 'note', message: { text: 'Your code depends on 1 vulnerable module (github.com/google/uuid), but doesn\'t appear to call any of the vulnerable symbols.' } },
    ],
  }],
};

test('go.mod requirements are the direct modules that the checkout does not replace, as go mod edit -json reads them', (t) => {
  // A quoted module path is the path, and a replace block names a directory replacement as a replace line does.
  const text = 'module x\n\ngo 1.21\n\nrequire (\n\t"github.com/a/b" v1.2.3\n\tgithub.com/c/d v0.1.0 // indirect\n\texample.com/local v0.0.0\n)\nrequire github.com/e/f v2.0.0+incompatible\nreplace (\n\texample.com/local => ./local\n)\n';
  const root = mkdtempSync(path.join(tmpdir(), 'kit-go-requirements-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'go.mod'), text);
  // goRequirements runs the go of PATH: the stub, which answers from the record of the real go (registry.mts).
  const saved = { ...process.env };
  Object.assign(process.env, toolStubs(root));
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  assert.deepEqual(goRequirements(root, 'go.mod'), [{ module: 'github.com/a/b', version: 'v1.2.3' }, { module: 'github.com/e/f', version: 'v2.0.0+incompatible' }]);
});

test('the SARIF report of govulncheck gives an advisory for each vulnerability that the code calls, once per module (K124)', () => {
  assert.deepEqual(goAdvisories(REPORT), [{
    package: 'github.com/google/uuid', version: 'v1.6.0', id: 'GO-2099-0001', severity: 'vulnerability',
    title: 'uuid generates a predictable identifier', url: 'https://pkg.go.dev/vuln/GO-2099-0001',
  }]);
  assert.deepEqual(goAdvisories({ version: '2.1.0', runs: [{ tool: { driver: { name: 'govulncheck', rules: [] } }, results: [] }] }), []);
});

test('the review reports a newer stable release of a Go module', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, go: { 'github.com/google/uuid': ['v1.6.0', 'v1.7.0', 'v2.0.0-rc.1'] } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-go\/go\.mod github\.com\/google\/uuid v1\.6\.0 < v1\.7\.0: a newer stable release exists\. Fix: make dependency-review UPDATE=1\.$/m);
});

test('a Go module without a stable release is an error of its query, not a module at its latest release', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, go: { 'github.com/google/uuid': ['v2.0.0-rc.1'] } });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /go list -m -versions reported no stable release of github\.com\/google\/uuid/);
});

test('the review records the Go advisories, and the update plan raises the module and tidies its directory', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root, REPORT);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, go: { 'github.com/google/uuid': ['v1.6.0', 'v1.7.0'] } });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-go\/go\.sum github\.com\/google\/uuid v1\.6\.0: advisory GO-2099-0001 \(vulnerability\) uuid generates a predictable identifier https:\/\/pkg\.go\.dev\/vuln\/GO-2099-0001\. Fix: make dependency-review UPDATE=1\.$/m);
  const record = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  assert.deepEqual(record.locks.find(item => item.lock === 'packages/fixture-go/go.sum')?.advisories?.map(item => item.id), ['GO-2099-0001']);
  const plan = updatePlan({
    newer: [{ ecosystem: 'go', manifest: 'packages/fixture-go/go.mod', package: 'github.com/google/uuid', spec: 'v1.6.0', latest: 'v1.7.0' }],
    advisories: [{ lock: 'packages/fixture-go/go.sum', package: 'github.com/google/uuid' }],
  });
  assert.deepEqual(plan, [
    { command: 'go', args: ['get', 'github.com/google/uuid@v1.7.0'], cwd: 'packages/fixture-go' },
    { command: 'go', args: ['get', 'github.com/google/uuid@latest'], cwd: 'packages/fixture-go' },
    { command: 'go', args: ['mod', 'tidy'], cwd: 'packages/fixture-go' },
  ]);
});

test('the review names the install command when govulncheck is not installed', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /packages\/fixture-go\/go\.sum: the advisory query failed: govulncheck of the checkout is missing \(var\/tools\/bin\/govulncheck, var\/tools\/mise\/shims\/govulncheck\); run make install/);
});

test('govulncheck scans the packages of each tracked Go module and never the tree under var/ (K53)', (t) => {
  const root = fixture(t);
  // The checkout's own module, a second lock beside packages/fixture-go, with a Go tree under var/tools as mise installs it.
  writeFileSync(path.join(root, 'go.mod'), 'module example.com/kit-root\n\ngo 1.21\n\nrequire github.com/google/uuid v1.6.0\n');
  cpSync(path.join(root, 'packages/fixture-go/go.sum'), path.join(root, 'go.sum'));
  writeFileSync(path.join(root, 'main.go'), 'package main\n\nfunc main() {}\n');
  const goroot = path.join(root, 'var/tools/mise/installs/go/1.27.2');
  mkdirSync(path.join(goroot, 'src/x'), { recursive: true });
  writeFileSync(path.join(goroot, 'src/go.mod'), 'module std\n\ngo 1.27\n');
  writeFileSync(path.join(goroot, 'src/x/x.go'), 'package x\n');
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, [], stub.env);
  assert.doesNotMatch(result.stdout, /advisory query failed/);
  const scans = govulncheckCalls(root).map(({ cwd, args }) => ({ cwd: path.relative(realpathSync(root), cwd), args }));
  assert.deepEqual(scans, [
    { cwd: '', args: ['-format', 'sarif', '.'] },
    { cwd: 'packages/fixture-go', args: ['-format', 'sarif', '.'] },
  ]);
});

test('the advisory scan of a linked Go module runs with its go.work and a failed scan names its cause (K365)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  // A linked checkout: its module at the root holds a go.work beside its go.mod, which the go stub answers from its records.
  writeFileSync(path.join(root, 'go.mod'), 'module example.com/kit-root\n\ngo 1.21\n\nrequire github.com/google/uuid v1.6.0\n');
  cpSync(path.join(root, 'packages/fixture-go/go.sum'), path.join(root, 'go.sum'));
  writeFileSync(path.join(root, 'main.go'), 'package main\n\nfunc main() {}\n');
  writeFileSync(path.join(root, 'go.work'), 'go 1.21\n\nuse (\n\t./packages/fixture-go\n\t./packages/sibling\n)\n');
  mkdirSync(path.join(root, 'packages/sibling'), { recursive: true });
  writeFileSync(path.join(root, 'packages/sibling/go.mod'), 'module example.com/sibling\n\ngo 1.21\n\nrequire example.com/kit-fixture-go v0.0.0\n');
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, [], stub.env);
  assert.doesNotMatch(result.stdout, /advisory query failed/);
  const calls = govulncheckCalls(root);
  assert.ok(calls.length > 0, result.stdout + result.stderr);
  const log = readFileSync(path.join(root, 'var/tools/govulncheck-calls.log'), 'utf8').split('\n').filter(Boolean).map(line => {
    const call: unknown = JSON.parse(line);
    if (!isJsonObject(call) || typeof call.cwd !== 'string') throw new Error(`govulncheck-calls.log holds no call with a cwd: ${line}`);
    return { cwd: call.cwd, gowork: typeof call.gowork === 'string' ? call.gowork : undefined };
  });
  assert.equal(log.find(call => call.cwd === realpathSync(root))?.gowork, path.join(realpathSync(root), 'go.work'));
  // govulncheck of a module that does not compile prints the compiler's errors on stderr and exits 1.
  writeFileSync(path.join(root, 'var/tools/mise/shims/govulncheck'), `#!/usr/bin/env node
process.stderr.write('packages/fixture-go/main.go:3:2: undefined: uuid.Foo\\n');
process.exit(1);
`);
  const failed = review(root, [], stub.env);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stdout, /^\[dependency-review\] go\.sum: the advisory query failed: .*undefined: uuid\.Foo.*Fix: correct the cause that the output of the scan names \(a module that does not compile is fixed in its code or its link\), then run make dependency-review again\.$/m);
  assert.doesNotMatch(failed.stdout, /when the advisory database answers/);
});
