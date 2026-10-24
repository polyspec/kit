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
import { readConfig } from '../../scripts/kit/schema-validate.mts';
import { readNpmLockFile, readNpmManifest } from '../../scripts/kit/manifests.mts';
import type { NpmLockEntry } from '../../scripts/kit/manifests.mts';
import { POLICY, RECORD, readPolicy } from '../../scripts/kit/dependency-state.mts';
import type { ReviewRecord } from '../../scripts/kit/check-dependency-policy.mts';
import { known } from './known.mts';


const findings = (result: { stderr: string }) => result.stderr.split('\n').filter(line => line.startsWith('[dependency-policy] ') && !line.includes(' finding'));

test('the gate passes on the fixture and queries no registry', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t, root);
  const result = gate(root, stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-policy\] the manifests and locks of .+ pass$/m);
  assert.equal(stub.calls().filter(call => !call.startsWith('composer validate ')).length, 0, stub.calls().join('\n'));
});

// K330: Composer reads repositories only from the root manifest, so a root that requires a polyspec package must declare the
// repositories that the package declares.
test('a root composer.json that requires a polyspec package lacks a repository that the package declares fails (K330)', (t) => {
  const root = fixture(t);
  const directory = path.join(root, 'packages/fixture-php');
  const fork = { type: 'vcs', url: 'https://github.com/min-0-max/yaml', 'no-api': true };
  const manifest = readConfig<{ require?: Record<string, string>; repositories?: unknown[] }>(root, 'packages/fixture-php/composer.json', 'composer-manifest.schema.json');
  mkdirSync(path.join(directory, 'vendor/polyspec/provider'), { recursive: true });
  writeFileSync(path.join(directory, 'vendor/polyspec/provider/composer.json'), JSON.stringify({ name: 'polyspec/provider', repositories: [fork] }));
  const required = { ...manifest, require: { ...manifest.require, 'polyspec/provider': '0.0.1' } };
  writeFileSync(path.join(directory, 'composer.json'), JSON.stringify(required));
  assert.match(gate(root).stderr, /packages\/fixture-php\/composer\.json: requires polyspec\/provider, whose composer\.json declares the repository vcs https:\/\/github\.com\/min-0-max\/yaml that this root manifest lacks/);
  writeFileSync(path.join(directory, 'composer.json'), JSON.stringify({ ...required, repositories: [...(manifest.repositories ?? []), fork] }));
  assert.doesNotMatch(gate(root).stderr, /that this root manifest lacks/);
});

// K181: a Composer manifest that composerPlatforms does not name escaped composer validate --strict, so its lock went stale
// unnoticed; the fixture holds the Composer consumer project of its release, which is not checked here.
test('the gate fails on a Composer manifest that no Composer platform covers; a manifest that kit writes passes', (t) => {
  const root = fixture(t);
  const write = (file: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), '{ "name": "example/extra" }\n'); };
  write('tools/extra/composer.json');
  write('config/php-lint/composer.json');
  const result = gate(root);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const [line, ...rest] = findings(result);
  assert.deepEqual(rest, [], findings(result).join('\n'));
  assert.match(known(line, 'the finding'), /^\[dependency-policy\] tools\/extra\/composer\.json: no entry of composerPlatforms .* never reads it or its lock\. Rule: each Composer manifest of the checkout is checked.*Fix: add \{ "manifest": "tools\/extra\/composer\.json", "php": "<the minimum PHP>" \} to composerPlatforms/);
});

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

test('the mutation check rejects every mutation of the fixture', (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-dependency-policy-mutation.mts'))], { cwd: root, encoding: 'utf8', env: toolStubs(root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /1 mutations rejected/);
});

test('the mutation check applies to the ecosystems of the repository: no Composer platform, and a record that starts with a Python dependency', (t) => {
  const root = fixture(t);
  const edit = <T,>(file: typeof POLICY | typeof RECORD, change: (data: T) => void) => {
    const data = readConfig<T>(root, file, file === POLICY ? 'dependency-policy.schema.json' : 'dependency-review.schema.json');
    change(data);
    writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
  };
  edit('config/dependency-policy.json', (policy: { composerPlatforms: string[] }) => { policy.composerPlatforms = []; });
  edit('config/dependency-review.json', (record: { dependencies: Array<{ ecosystem: string }> }) => { record.dependencies = record.dependencies.filter(entry => entry.ecosystem === 'pypi'); });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-dependency-policy-mutation.mts'))], { cwd: root, encoding: 'utf8', env: toolStubs(root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /0 mutations rejected/);
});

// The copy of the mutation check holds go.work with the dependency files: without it a module that requires only another
// module of the workspace was asked for a go.sum that it cannot have (K153).
test('the mutation check copies go.work, so a module that requires only a workspace member needs no go.sum (K153)', (t) => {
  const root = fixture(t);
  const write = (file: string, text: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  write('go.work', 'go 1.21\n\nuse (\n\t./packages/fixture-go\n\t./packages/sibling\n)\n');
  write('packages/sibling/go.mod', 'module example.com/sibling\n\ngo 1.21\n\nrequire example.com/kit-fixture-go v0.0.0\n');
  write('packages/sibling/sibling.go', 'package sibling\n');
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-dependency-policy-mutation.mts'))], { cwd: root, encoding: 'utf8', env: toolStubs(root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /1 mutations rejected/);
});

// A committed go.work that uses an ignored clone, such as a sibling repository checked out for local work, names a module
// that no checkout of the repository holds: the mutation check names go.work and the use, without a stack (K160).
test('the mutation check fails with one finding when go.work uses a module that Git does not track (K160)', (t) => {
  const root = fixture(t);
  const write = (file: string, text: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  write('go.work', 'go 1.21\n\nuse (\n\t./packages/fixture-go\n\t./packages/sibling\n)\n');
  write('packages/sibling/go.mod', 'module example.com/sibling\n\ngo 1.21\n\nrequire example.com/kit-fixture-go v0.0.0\n');
  appendFileSync(path.join(root, '.gitignore'), 'packages/sibling/\n');
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-dependency-policy-mutation.mts'))], { cwd: root, encoding: 'utf8', env: toolStubs(root) });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '[dependency-policy] go.work: uses ./packages/sibling, whose go.mod Git does not track; a committed go.work may only use tracked modules. Fix: commit packages/sibling/go.mod or remove the use from go.work\n');
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
  assert.match(result.stdout + result.stderr, /npm audit --json --package-lock-only printed no JSON: the output is empty/);
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

// K58: a command module does not act when it is imported; the mutation check runs only as the command.
test('importing the mutation check runs nothing and prints nothing', (t) => {
  const root = fixture(t);
  const url = pathToFileURL(tool(import.meta.resolve('../../scripts/kit/check-dependency-policy-mutation.mts'))).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log('imported');`], { cwd: root, encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'imported\n', 'the import ran the mutation check');
  assert.equal(result.stderr, '');
});

// K425: a PHP library of S10 is library code only, so a framework of an application in its require fails, and the application is a package beside it.
test('a PHP library of S10 that requires an application framework in require fails, and an application package beside it passes (K425)', (t) => {
  const root = fixture(t);
  const rule = /Rule: a PHP library of S10 requires no application framework/;
  const manifest = (name: string, require: Record<string, string>, requireDev: Record<string, string> = {}) => JSON.stringify({ name, type: 'library', license: 'proprietary', require: { php: '>=8.2', ...require }, 'require-dev': requireDev });
  mkdirSync(path.join(root, 'packages/php'), { recursive: true });
  const library = path.join(root, 'packages/php/composer.json');
  writeFileSync(library, manifest('polyspec/kit-fixture', { 'symfony/console': '^7.0' }));
  assert.match(gate(root).stderr, /^\[dependency-policy\] packages\/php\/composer\.json: requires symfony\/console in require\. Rule: a PHP library of S10 requires no application framework/m);
  writeFileSync(library, manifest('polyspec/kit-fixture', {}, { 'symfony/console': '^7.0' }));
  assert.doesNotMatch(gate(root).stderr, rule, 'the framework in require-dev is no finding');
  mkdirSync(path.join(root, 'packages/cli'), { recursive: true });
  writeFileSync(path.join(root, 'packages/cli/composer.json'), manifest('polyspec/kit-cli', { 'polyspec/kit-fixture': '*', 'symfony/console': '^7.0' }));
  assert.doesNotMatch(gate(root).stderr, rule, 'an application package beside the library is no finding');
});

// K427: allow-remote=root takes only the URLs that a package.json of the lock root names, so a remote tarball that the lock resolves
// for a package reached only through another package fails the gate, and the root that names its URL passes.
test('a remote tarball that a lock resolves for a package the root does not name fails, and a root that names its URL passes (K427)', (t) => {
  const root = fixture(t);
  const url = 'https://github.com/polyspec/ordered-json/releases/download/v0.0.9/polyspec-ordered-json-0.0.9.tgz';
  const lockFile = path.join(root, 'package-lock.json');
  // Changes the packages of the lock of the fixture, which keeps the other fields of the lock.
  const editLock = (change: (packages: Record<string, NpmLockEntry>) => void) => {
    const lock = readNpmLockFile(lockFile);
    const packages = lock.packages ?? {};
    change(packages);
    writeFileSync(lockFile, `${JSON.stringify({ ...lock, packages }, null, 2)}\n`);
  };
  // @polyspec/consumer is a registry package that requires @polyspec/ordered-json by its URL; the root package.json names neither.
  editLock((packages) => {
    packages['node_modules/@polyspec/ordered-json'] = { version: '0.0.9', resolved: url };
    packages['node_modules/@polyspec/consumer'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/@polyspec/consumer/-/consumer-1.0.0.tgz', dependencies: { '@polyspec/ordered-json': url } };
  });
  const remote = (result: { stderr: string }) => findings(result).filter(line => line.includes('resolves @polyspec/ordered-json from'));
  const reached = gate(root);
  assert.equal(remote(reached).length, 1, reached.stderr);
  assert.match(remote(reached)[0] ?? '', /which no direct dependency of this name declares and no matching root override authorizes\. Rule: each remote tarball that an npm lock resolves has a matching dependency name and URL/);
  assert.equal(findings(reached).some(line => line.includes('@polyspec/consumer')), false, 'a registry entry is no finding');

  // The root names the package by its URL, in dependencies of its package.json and of the lock root.
  const manifest = readNpmManifest(root, 'package.json');
  manifest.dependencies = { '@polyspec/ordered-json': url };
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  editLock((packages) => {
    packages[''] = { ...packages[''], dependencies: { '@polyspec/ordered-json': url } };
  });
  assert.deepEqual(remote(gate(root)), [], 'a remote tarball that the root names by its URL is no finding');
});

// K564: npm 12.2.0 applies a root override to a direct workspace edge; allow-remote=root accepts that edge because its source is a workspace.
test('a root URL override is allowed only for the matching package with a direct workspace dependency (K564)', (t) => {
  const root = fixture(t);
  const url = 'https://github.com/polyspec/ordered-json/releases/download/v0.0.9/polyspec-ordered-json-npm-0.0.9.tgz';
  const otherUrl = 'https://example.invalid/other-ordered-json.tgz';
  const manifestFile = path.join(root, 'package.json');
  const rootManifest = readNpmManifest(root, 'package.json');
  rootManifest.overrides = { '@polyspec/ordered-json': url };
  writeFileSync(manifestFile, `${JSON.stringify(rootManifest, null, 2)}\n`);

  const workspaceFile = path.join(root, 'packages/fixture-lib/package.json');
  const workspace = readNpmManifest(root, 'packages/fixture-lib/package.json');
  workspace.dependencies = { ...workspace.dependencies, '@polyspec/ordered-json': '0.0.9' };
  writeFileSync(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`);

  const lockFile = path.join(root, 'package-lock.json');
  const editLock = (change: (packages: Record<string, NpmLockEntry>) => void) => {
    const lock = readNpmLockFile(lockFile);
    const packages = lock.packages ?? {};
    change(packages);
    writeFileSync(lockFile, `${JSON.stringify({ ...lock, packages }, null, 2)}\n`);
  };
  editLock((packages) => {
    packages['node_modules/@polyspec/ordered-json'] = { version: '0.0.9', resolved: url };
    packages['packages/fixture-lib'] = { ...packages['packages/fixture-lib'], dependencies: { ...packages['packages/fixture-lib']?.dependencies, '@polyspec/ordered-json': '0.0.9' } };
  });

  const remote = (result: { stderr: string }) => findings(result).filter(line => line.includes('resolves @polyspec/ordered-json from'));
  assert.deepEqual(remote(gate(root)), [], 'the exact root override matches a direct workspace dependency');

  workspace.dependencies = { semver: workspace.dependencies?.semver ?? '7.6.0' };
  writeFileSync(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`);
  assert.equal(remote(gate(root)).length, 1, 'a root override without a direct workspace dependency does not authorize the URL');
  workspace.dependencies = { ...workspace.dependencies, '@polyspec/ordered-json': '0.0.9' };
  writeFileSync(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`);

  rootManifest.overrides = { '@polyspec/other-package': url };
  writeFileSync(manifestFile, `${JSON.stringify(rootManifest, null, 2)}\n`);
  assert.equal(remote(gate(root)).length, 1, 'the same URL under a different override name does not authorize this package');

  rootManifest.overrides = { '@polyspec/ordered-json': otherUrl };
  writeFileSync(manifestFile, `${JSON.stringify(rootManifest, null, 2)}\n`);
  assert.equal(remote(gate(root)).length, 1, 'an override for this package with another URL does not authorize this tarball');
});

// K493: `--packages <name>[,<name>...]` reports and fails only on the findings that name one of the packages, so a row that fixes
// one finding can close while the other findings stay for their own rows; the unscoped gate stays the same for land, CI and the batch.
test('the gate scoped to one package fails on that package only and drops the findings of the others (K493)', (t) => {
  const root = fixture(t);
  // Two Composer manifests that no entry of composerPlatforms covers: one in the folder of fixture-php, one elsewhere.
  for (const folder of ['packages/fixture-php/extra', 'tools/other']) {
    mkdirSync(path.join(root, folder), { recursive: true });
    writeFileSync(path.join(root, folder, 'composer.json'), JSON.stringify({ name: `example/${path.basename(folder)}` }));
  }
  spawnSync('git', ['add', '-A'], { cwd: root });
  const unscoped = gate(root);
  assert.equal(unscoped.status, 1, unscoped.stdout + unscoped.stderr);
  assert.match(unscoped.stderr, /packages\/fixture-php\/extra\/composer\.json/);
  assert.match(unscoped.stderr, /tools\/other\/composer\.json/);
  const scoped = gate(root, toolStubs(root), ['--packages', 'fixture-php']);
  assert.equal(scoped.status, 1, scoped.stdout + scoped.stderr);
  assert.match(scoped.stderr, /packages\/fixture-php\/extra\/composer\.json/);
  assert.doesNotMatch(scoped.stderr, /tools\/other\/composer\.json/);
});
