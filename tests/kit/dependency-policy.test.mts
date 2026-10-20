// Tests of the dependency tools on the fixture of tests/kit/fixture (package.json, packages/fixture-php, packages/fixture-python,
// config/): the gate passes on the fixture, fails on a lock changed without a review, and the review records the fixture
// the same way on every run. The registries are stubs (tests/kit/registry.mts), so no test queries the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { FIXTURE_REGISTRY, stubRegistries, toolStubs } from './registry.mts';

import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { tool } from './kit-tools.mts';
import { removeSandbox } from './sandbox-cleanup.mts';
import { initRepository } from './sandbox-repository.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';
import { readNpmManifest } from '../../scripts/kit/manifests.mts';
import { satisfies } from '../../scripts/kit/composer-constraint.mts';
import { POLICY, RECORD, readPolicy } from '../../scripts/kit/dependency-state.mts';
import { sharedPinFindings } from '../../scripts/kit/check-dependency-policy.mts';
import type { ReviewRecord } from '../../scripts/kit/check-dependency-policy.mts';
import { known } from './known.mts';
import { tree } from './tree.mts';

const findings = (result: { stderr: string }) => result.stderr.split('\n').filter(line => line.startsWith('[dependency-policy] ') && !line.includes(' finding'));

test('the gate passes on the fixture and queries no registry', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t, root);
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

// K281: the answer "[none matched]" of composer outdated is no version, so a review record that holds it as the latest fails.
test('the gate fails on a review record that holds the none-matched sentinel as a latest version (K281)', (t) => {
  const root = fixture(t);
  const file = path.join(root, RECORD);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  const entry = record.dependencies.find(item => item.ecosystem === 'composer');
  assert.ok(entry, 'the fixture record holds a Composer dependency');
  entry.latest = '[none matched]';
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  const result = gate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the review recorded \[none matched\] as the latest stable release/);
});

// K282: one PHP platform. A manifest that declares another config.platform.php than the others, and a platform that is not the
// minor of .php-version with the patch 1 (PHPUnit 13 needs 8.4.1), fail the gate.
test('the gate fails on a Composer platform that differs from the others or from .php-version (K282)', (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'tools/extra'), { recursive: true });
  writeFileSync(path.join(root, 'tools/extra/composer.json'), '{ "name": "example/extra", "config": { "platform": { "php": "8.1.0" } } }\n');
  const split = gate(root);
  assert.match(split.stderr, /^\[dependency-policy\] tools\/extra\/composer\.json config\.platform\.php: the PHP platform is 8\.1\.0, the one platform of this repository is 8\.2\.0, that of its first manifest/m);
  writeFileSync(path.join(root, '.php-version'), '8.2\n');
  const pinned = gate(root);
  assert.match(pinned.stderr, /^\[dependency-policy\] packages\/fixture-php\/composer\.json: the PHP platform is 8\.2\.0, the one platform of this repository is 8\.2\.1: the minor of \.php-version with the patch 1, which PHPUnit 13 needs/m);
});

// K415: a tracked lock pinned a package whose PHP requirement the declared platform did not meet, so a fresh worktree failed in
// vendor/composer/platform_check.php and no check saw it. Each locked package is checked against config.platform of its manifest.
test('a locked package whose PHP requirement the declared platform does not meet is a finding (K415)', (t) => {
  const root = fixture(t);
  const manifestFile = path.join(root, 'packages/fixture-php/composer.json');
  const lockFile = path.join(root, 'packages/fixture-php/composer.lock');
  const manifest = readConfig<Record<string, unknown> & { config: Record<string, unknown> }>(root, 'packages/fixture-php/composer.json', 'composer-manifest.schema.json');
  const lock = readConfig<{ packages: Record<string, unknown>[] }>(root, 'packages/fixture-php/composer.lock', 'composer-lock.schema.json');
  // The first locked package requires the given packages; the manifest declares the given platform.
  const declare = (platform: Record<string, string>, require: Record<string, string>) => {
    writeFileSync(manifestFile, JSON.stringify({ ...manifest, config: { ...manifest.config, platform } }));
    writeFileSync(lockFile, JSON.stringify({ ...lock, packages: [{ name: 'example/locked', version: '1.0.0', require }, ...lock.packages.slice(1)] }));
    return gate(root);
  };
  const failing = declare({ php: '8.4.1' }, { php: '>=8.5' });
  assert.match(failing.stderr, /^\[dependency-policy\] packages\/fixture-php\/composer\.lock: example\/locked 1\.0\.0 requires php >=8\.5, the platform that packages\/fixture-php\/composer\.json declares is php 8\.4\.1/m);
  assert.doesNotMatch(declare({ php: '8.4.1' }, { php: '^8.2 || ^8.3 || ^8.4' }).stderr, /requires php/, 'a lock that the platform satisfies passes');
  assert.match(declare({ php: '8.4.1', 'ext-intl': '8.3.0' }, { 'ext-intl': '>=8.4' }).stderr, /^\[dependency-policy\] packages\/fixture-php\/composer\.lock: example\/locked 1\.0\.0 requires ext-intl >=8\.4, the platform .* is ext-intl 8\.3\.0/m);
});

// K415: the Composer constraints of php and ext-* requirements, in the forms that they use, judge a platform version as Composer does.
test('the Composer constraints of PHP and extension requirements are evaluated in the forms they use (K415)', () => {
  const cases: [string, string, boolean][] = [
    ['>=8.5', '8.4.1', false], ['>=8.5', '8.5.0', true], ['>=8.4', '8.4.1', true], ['>8.4', '8.4.0', false], ['<=8.4.1', '8.4.1', true],
    ['^8.2 || ^8.3 || ^8.4', '8.4.1', true], ['^8.2 || ^8.3', '8.4.1', true], ['^8.2 || ^8.3', '8.1.2', false], ['^8.2', '9.0.0', false], ['^0.3', '0.3.9', true], ['^0.3', '0.4.0', false],
    ['^0.0.3', '0.0.4', false], ['~8.4.0', '8.4.9', true], ['~8.4.0', '8.5.0', false], ['~8.4', '8.9.0', true], ['~8.4', '9.0.0', false], ['~8', '8.9', true],
    ['8.4.*', '8.4.1', true], ['8.4.*', '8.5.0', false], ['8.*', '8.0.0', true], ['*', '1.0.0', true], ['8.4.1', '8.4.1', true], ['8.4.1', '8.4.2', false],
    ['>=8.1 <8.5', '8.4.1', true], ['>=8.1, <8.4', '8.4.1', false], ['>= 8.1', '8.4.1', true], ['!=8.4.1', '8.4.1', false], ['=8.4.1', '8.4.1', true],
    ['>=8.4', '8.4', true], ['>=8.4', 'v8.4.1', true], ['^8.2 || ^8.3 || ^8.4', '8.1.2', false],
  ];
  for (const [constraint, version, expected] of cases) assert.equal(satisfies(constraint, version), expected, `${constraint} against ${version}`);
  assert.throws(() => satisfies('1.0 - 2.0', '1.5.0'), /kit reads/, 'a hyphen range is a form kit does not read');
  assert.throws(() => satisfies('dev-main', '8.4.1'), /kit reads/, 'a dev branch is a form kit does not read');
  assert.throws(() => satisfies('>=8.4', '8.*'), /wildcard/, 'a platform version is concrete');
});

// K326: while a project is linked the local checkouts are canonical, so the platform and the dist of the Composer packages are judged on
// the link lock that Composer resolved from the path packages, and the tracked lock waits for the batch release.
test('while a project is linked the gate judges the link lock, not the tracked lock (K326)', (t) => {
  const root = fixture(t);
  const directory = path.join(root, 'packages/fixture-php');
  const lock = readConfig<{ 'platform-overrides': { php: string }; packages: { name: string; dist?: { type: string } }[] }>(root, 'packages/fixture-php/composer.lock', 'composer-lock.schema.json');
  const manifest = readFileSync(path.join(directory, 'composer.json'), 'utf8');
  // The tracked lock was resolved for another PHP than the policy declares; the link lock, resolved from the path packages, for the declared one.
  writeFileSync(path.join(directory, 'composer.lock'), JSON.stringify({ ...lock, 'platform-overrides': { php: '8.5.0' } }));
  const plain = gate(root);
  assert.match(plain.stderr, /composer\.lock: the lock was resolved for PHP 8\.5\.0/, 'without a link the tracked lock is judged');
  writeFileSync(path.join(directory, 'composer.link.json'), manifest);
  writeFileSync(path.join(directory, 'composer.link.lock'), JSON.stringify(lock));
  const linked = gate(root);
  assert.doesNotMatch(linked.stderr, /the lock was resolved for PHP/, linked.stderr);
  assert.doesNotMatch(linked.stderr, /composer\.lock: the lock changed after the review/, 'the review hash of the tracked lock waits for the batch release');
  writeFileSync(path.join(directory, 'composer.link.lock'), JSON.stringify({ ...lock, 'platform-overrides': { php: '8.5.0' } }));
  assert.match(gate(root).stderr, /composer\.link\.lock: the lock was resolved for PHP 8\.5\.0, the policy declares/, 'a link lock of another platform fails');
});

test('a package of a path repository of the link manifest that the link lock holds from another dist fails (K326)', (t) => {
  const root = fixture(t);
  const directory = path.join(root, 'packages/fixture-php');
  const lock = readConfig<{ packages: { name: string; dist?: { type: string } }[] }>(root, 'packages/fixture-php/composer.lock', 'composer-lock.schema.json');
  const manifest = readConfig<Record<string, unknown>>(root, 'packages/fixture-php/composer.json', 'composer-manifest.schema.json');
  mkdirSync(path.join(root, 'provider'), { recursive: true });
  writeFileSync(path.join(root, 'provider/composer.json'), '{ "name": "psr/log" }\n');
  writeFileSync(path.join(directory, 'composer.link.json'), JSON.stringify({ ...manifest, repositories: [{ type: 'path', url: '../../provider', options: { symlink: true } }] }));
  writeFileSync(path.join(directory, 'composer.link.lock'), JSON.stringify(lock));
  assert.match(gate(root).stderr, /composer\.link\.lock: psr\/log is linked but locked from a zip dist, not from its path/);
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

// K326-1: while linked, the locked versions are those of the link lock, which Composer resolved; the tracked lock cannot relock.
test('while a project is linked the review record is compared with the versions of the link lock (K326-1)', (t) => {
  const root = fixture(t);
  const directory = path.join(root, 'packages/fixture-php');
  const lock = readConfig<{ packages: { name: string; version: string; dist?: { type: string } }[] }>(root, 'packages/fixture-php/composer.lock', 'composer-lock.schema.json');
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  const first = record.dependencies.find(item => item.ecosystem === 'composer');
  assert.ok(first);
  // The link lock holds a newer version than the tracked lock, as after the update of the link, and the record was made on it.
  first.version = '9.9.9';
  first.latest = '9.9.9';
  writeFileSync(path.join(root, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  assert.match(gate(root).stderr, new RegExp(`${first.package.replace('/', '\\/')}: the lock holds [^,]+, the review of .+ recorded 9\\.9\\.9`), 'without a link the tracked lock is compared');
  writeFileSync(path.join(directory, 'composer.link.json'), readFileSync(path.join(directory, 'composer.json'), 'utf8'));
  writeFileSync(path.join(directory, 'composer.link.lock'), JSON.stringify({ ...lock, packages: lock.packages.map(item => (item.name === first.package ? { ...item, version: '9.9.9' } : item)) }));
  assert.doesNotMatch(gate(root).stderr, /the lock holds/, 'with a link the link lock is compared');
});

// K358: the link lock records a provider that the link installs as a path dist with the absolute folder of its checkout: a linked
// dependency, judged by its link and the record, never a path package of this repository.
test('while a project is linked a provider path dist of the link lock is a linked dependency, not a package of this repository (K358)', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t, root);
  const directory = path.join(root, 'packages/fixture-php');
  const lock = readConfig<{ packages: { name: string; version: string; dist?: unknown }[] }>(root, 'packages/fixture-php/composer.lock', 'composer-lock.schema.json');
  const provider = tree(t, { 'packages/php/composer.json': JSON.stringify({ name: 'psr/log' }) });
  writeFileSync(path.join(directory, 'composer.link.json'), readFileSync(path.join(directory, 'composer.json'), 'utf8'));
  const linked = lock.packages.map(item => (item.name === 'psr/log' ? { ...item, dist: { type: 'path', url: path.join(provider, 'packages/php'), reference: 'abc' } } : item));
  writeFileSync(path.join(directory, 'composer.link.lock'), JSON.stringify({ ...lock, packages: linked }));
  const result = gate(root, stub.env);
  assert.doesNotMatch(result.stderr, /composer\.json is missing|packages\/fixture-php psr\/log/, 'the provider is no path package of the repository');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// K328: while a project is linked, a linked package is judged by its link; the registry comparison belongs to the batch release.
test('a linked package is not compared with the latest release of the registry, and a third-party package still is (K328)', (t) => {
  const root = fixture(t);
  const directory = path.join(root, 'packages/fixture-php');
  const lock = readConfig<{ packages: { name: string; version: string; dist?: { type: string } }[] }>(root, 'packages/fixture-php/composer.lock', 'composer-lock.schema.json');
  const recordFile = path.join(root, RECORD);
  const record = readConfig<ReviewRecord>(root, RECORD, 'dependency-review.schema.json');
  const composer = record.dependencies.filter(item => item.ecosystem === 'composer');
  assert.ok(composer.length >= 1, 'the fixture record holds a Composer dependency');
  const [first] = composer;
  assert.ok(first);
  first.latest = '99.0.0';
  writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  assert.match(gate(root).stderr, new RegExp(`${first.package.replace('/', '\\/')}: ${first.version} is older than 99\\.0\\.0`), 'without a link the registry comparison fails');
  writeFileSync(path.join(directory, 'composer.link.json'), readFileSync(path.join(directory, 'composer.json'), 'utf8'));
  writeFileSync(path.join(directory, 'composer.link.lock'), JSON.stringify({ ...lock, packages: lock.packages.map(item => (item.name === first.package ? { ...item, dist: { type: 'path', url: '../provider' } } : item)) }));
  const linked = gate(root).stderr;
  assert.doesNotMatch(linked, /must have required property/, 'the link lock is a valid lock');
  assert.doesNotMatch(linked, new RegExp(`${first.package.replace('/', '\\/')}: ${first.version} is older than`), 'the linked package is judged by its link');
  const other = composer.find(item => item.package !== first.package);
  if (other) {
    other.latest = '99.0.0';
    writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    assert.match(gate(root).stderr, new RegExp(`${other.package.replace('/', '\\/')}: ${other.version} is older than 99\\.0\\.0`), 'a third-party package is still compared');
  }
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

test('the review reports a newer stable release with the fix command and writes no record without RECORD', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
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
  assert.match(result.stdout + result.stderr, /5 mutations rejected/);
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
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-dependency-policy-mutation.mts'))], { cwd: root, encoding: 'utf8', env: toolStubs(root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /5 mutations rejected/);
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

test('the gate reads the review record by its schema and names each error', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'config/dependency-review.json');
  const record = readConfig<{ comment?: string }>(root, RECORD, 'dependency-review.schema.json');
  delete record.comment;
  writeFileSync(file, JSON.stringify(record));
  const result = gate(root, stubRegistries(t, root).env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /\[dependency-policy\] config\/dependency-review\.json: the record breaks dependency-review\.schema\.json: .*comment/);
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

test('a package that two sibling checkouts lock from different sources or versions is a finding (K378)', (t) => {
  // A repository of a temporary directory with the files of `files`, all tracked.
  const checkout = (name: string, files: Record<string, string>) => {
    const directory = mkdtempSync(path.join(tmpdir(), `${name}-`));
    t.after(() => removeSandbox(directory));
    initRepository(directory);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      writeFileSync(path.join(directory, file), text);
    }
    const added = spawnSync('git', ['-C', directory, 'add', '.'], { encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    return directory;
  };
  const reference = 'a'.repeat(40);
  const pinned = (name: string, version: string, url: string) => ({ name, version, source: { type: 'git', url, reference }, dist: { type: 'zip', url: `${url}/zipball/${reference}`, reference } });
  const lock = (...packages: object[]) => `${JSON.stringify({ packages, 'packages-dev': [] }, null, 4)}\n`;
  const requiring = JSON.stringify({ name: 'example/orm', require: { 'opis/json-schema': '^2.6' } });
  const fork = 'https://github.com/example-orm/json-schema.git';
  const upstream = 'https://github.com/opis/json-schema.git';
  const base = (directory: string) => path.basename(directory);

  // Both checkouts require opis/json-schema directly: the fork at v2.6.0-p1 and the upstream at 2.6.0 are a finding that names both locks.
  const orm = checkout('kit-sibling-orm', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', 'v2.6.0-p1', fork)) });
  const template = checkout('kit-sibling-template', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', '2.6.0', upstream)) });
  const red = sharedPinFindings(orm, [template]);
  assert.equal(red.length, 1, JSON.stringify(red));
  assert.match(red[0]?.problem ?? '', new RegExp(`${base(orm)}/composer\\.lock:\\d+ locks v2\\.6\\.0-p1 from ${fork}@`));
  assert.match(red[0]?.problem ?? '', new RegExp(`${base(template)}/composer\\.lock:\\d+ locks 2\\.6\\.0 from ${upstream}@`));

  // The same version from the same source is no finding.
  const same = checkout('kit-sibling-same', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', 'v2.6.0-p1', fork)) });
  assert.deepEqual(sharedPinFindings(orm, [same]), []);

  // A package that neither checkout requires directly is transitive, so its difference is no finding; and a lock under tests/
  // or fixtures/ is no lock of the checkout, so a fixture that pins another version is no finding either.
  const transitiveOrm = checkout('kit-transitive-orm', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', 'v2.6.0-p1', fork), pinned('acme/transitive', '1.0.0', fork)) });
  const transitiveTemplate = checkout('kit-transitive-template', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', 'v2.6.0-p1', fork), pinned('acme/transitive', '2.0.0', upstream)), 'tests/fixtures/release/composer.lock': lock(pinned('opis/json-schema', '2.6.0', upstream)) });
  assert.deepEqual(sharedPinFindings(transitiveOrm, [transitiveTemplate]), []);
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
