// Tests of the dependency tools on the fixture of tests/kit/fixture (package.json, packages/fixture-php, packages/fixture-python,
// config/): the gate passes on the fixture, fails on a lock changed without a review, and the review records the fixture
// the same way on every run. The registries are stubs (tests/kit/registry.mts), so no test queries the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { FIXTURE_REGISTRY, stubRegistries, toolStubs } from './registry.mts';

import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { tool } from './kit-tools.mts';
import { removeSandbox } from './sandbox-cleanup.mts';
import { initRepository } from './sandbox-repository.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';
import { readNpmLockFile, readNpmManifest } from '../../scripts/kit/manifests.mts';
import type { NpmLockEntry } from '../../scripts/kit/manifests.mts';
import { satisfies } from '../../scripts/kit/composer-constraint.mts';
import { POLICY, RECORD, readPolicy } from '../../scripts/kit/dependency-state.mts';
import { sharedPinFindings } from '../../scripts/kit/check-dependency-policy.mts';
import type { ReviewRecord } from '../../scripts/kit/check-dependency-policy.mts';
import { known } from './known.mts';
import { tree } from './tree.mts';

/** A review record that reviews opis/json-schema of composer.json at `version` (the sibling rule reads the target from it, K464). */
const reviewRecord = (version: string) => `${JSON.stringify({ schema: 1, comment: 'test record', reviewed: '2026-10-19T13:40:32.718Z', locks: [], dependencies: [{ ecosystem: 'composer', manifest: 'composer.json', package: 'opis/json-schema', version, latest: version }], vcs: [] }, null, 4)}\n`;

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
  assert.match(result.stderr, /^\[dependency-policy\] packages\/fixture-php\/composer\.lock: the lock changed after its review: its sha256 is [0-9a-f]{64}, the review recorded [0-9a-f]{64}\./m);
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
  assert.match(gate(root).stderr, new RegExp(`${first.package.replace('/', '\\/')}: the lock holds [^,]+, the review record recorded 9\\.9\\.9`), 'without a link the tracked lock is compared');
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

// K326-2: while a project is linked, the K415 rule judges the link lock too. The tracked lock requires php >=8.5.0 from psr/log, which the
// declared platform 8.2.0 does not meet; the link lock, which Composer resolved for the declared platform, does not, so no finding names it.
test('while a project is linked the K415 locked-requirement rule judges the link lock, not the tracked lock (K326-2)', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t, root);
  const directory = path.join(root, 'packages/fixture-php');
  const lock = readConfig<{ packages: { name: string; require?: Record<string, string> }[] }>(root, 'packages/fixture-php/composer.lock', 'composer-lock.schema.json');
  const tracked = { ...lock, packages: lock.packages.map(item => (item.name === 'psr/log' ? { ...item, require: { php: '>=8.5.0' } } : item)) };
  writeFileSync(path.join(directory, 'composer.lock'), JSON.stringify(tracked));
  assert.match(gate(root, stub.env).stderr, /packages\/fixture-php\/composer\.lock: psr\/log \S+ requires php >=8\.5\.0, the platform that packages\/fixture-php\/composer\.json declares is php 8\.2\.0/, 'without a link the tracked lock is judged');
  writeFileSync(path.join(directory, 'composer.link.json'), readFileSync(path.join(directory, 'composer.json'), 'utf8'));
  writeFileSync(path.join(directory, 'composer.link.lock'), JSON.stringify(lock));
  const linked = gate(root, stub.env);
  assert.doesNotMatch(linked.stderr, /requires php/, 'with a link the link lock is judged, not the tracked lock');
  // composer validate of the linked project runs on the link files: the stub logs the COMPOSER it was given.
  assert.ok(stub.calls().some(call => call.startsWith('composer validate ') && call.includes('[COMPOSER=composer.link.json]')), stub.calls().join('\n'));
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
  // A repository of a temporary directory with the files of `files`, committed on main, as the sibling rule reads a sibling.
  const checkout = (name: string, files: Record<string, string>) => {
    const directory = mkdtempSync(path.join(tmpdir(), `${name}-`));
    t.after(() => removeSandbox(directory));
    initRepository(directory, '--initial-branch=main');
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      writeFileSync(path.join(directory, file), text);
    }
    const added = spawnSync('git', ['-C', directory, 'add', '.'], { encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    const committed = spawnSync('git', ['-C', directory, 'commit', '--quiet', '-m', 'base'], { encoding: 'utf8' });
    assert.equal(committed.status, 0, committed.stderr);
    return directory;
  };
  const reference = 'a'.repeat(40);
  const pinned = (name: string, version: string, url: string) => ({ name, version, source: { type: 'git', url, reference }, dist: { type: 'zip', url: `${url}/zipball/${reference}`, reference } });
  const lock = (...packages: object[]) => `${JSON.stringify({ packages, 'packages-dev': [] }, null, 4)}\n`;
  const requiring = JSON.stringify({ name: 'example/orm', require: { 'opis/json-schema': '^2.6' } });
  const fork = 'https://github.com/example-orm/json-schema.git';
  const upstream = 'https://github.com/opis/json-schema.git';
  const record = reviewRecord('2.6.0');

  // Both checkouts lock opis/json-schema at 2.6.0, the fork from one source and the upstream from another: a source mismatch at one
  // version is a finding that names both locks, whatever the reviewed targets are (K464).
  const orm = checkout('kit-sibling-orm', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', '2.6.0', fork)), 'config/dependency-review.json': record });
  const template = checkout('kit-sibling-template', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', '2.6.0', upstream)), 'config/dependency-review.json': record });
  const red = sharedPinFindings(orm, [template]).findings;
  assert.equal(red.length, 1, JSON.stringify(red));
  assert.match(red[0]?.problem ?? '', new RegExp(`${path.basename(orm)}/composer\\.lock:\\d+ locks 2\\.6\\.0 from ${fork}@`));
  assert.match(red[0]?.problem ?? '', new RegExp(`${path.basename(template)}/composer\\.lock:\\d+ locks 2\\.6\\.0 from ${upstream}@`));

  // The same version from the same source is no finding.
  const same = checkout('kit-sibling-same', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', '2.6.0', fork)), 'config/dependency-review.json': record });
  assert.deepEqual(sharedPinFindings(orm, [same]).findings, []);

  // A package that neither checkout requires directly is transitive, so its difference is no finding; and a lock under tests/
  // or fixtures/ is no lock of the checkout, so a fixture that pins another version is no finding either.
  const transitiveOrm = checkout('kit-transitive-orm', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', '2.6.0', fork), pinned('acme/transitive', '1.0.0', fork)), 'config/dependency-review.json': record });
  const transitiveTemplate = checkout('kit-transitive-template', { 'composer.json': requiring, 'composer.lock': lock(pinned('opis/json-schema', '2.6.0', fork), pinned('acme/transitive', '2.0.0', upstream)), 'config/dependency-review.json': record, 'tests/fixtures/release/composer.lock': lock(pinned('opis/json-schema', '2.6.0', upstream)) });
  assert.deepEqual(sharedPinFindings(transitiveOrm, [transitiveTemplate]).findings, []);
});

// K458: a finding of a worktree names the checkout by its repository, not by its folder, so the text of a worktree <repo>-<name>-<id>
// equals the text of main <repo> and land does not count the finding as new.
test('a finding names the repository of a worktree, not its folder (K458)', (t) => {
  const main = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-finding-key-')));
  t.after(() => removeSandbox(main));
  const repo = path.join(main, 'repo');
  mkdirSync(repo);
  initRepository(repo, '--initial-branch=main');
  const reference = 'a'.repeat(40);
  const pinned = (name: string, version: string, url: string) => ({ name, version, source: { type: 'git', url, reference }, dist: { type: 'zip', url: `${url}/zipball/${reference}`, reference } });
  const lock = (...packages: object[]) => `${JSON.stringify({ packages, 'packages-dev': [] }, null, 4)}\n`;
  const requiring = JSON.stringify({ name: 'example/orm', require: { 'opis/json-schema': '^2.6' } });
  const fork = 'https://github.com/example-orm/json-schema.git';
  const upstream = 'https://github.com/opis/json-schema.git';
  writeFileSync(path.join(repo, 'composer.json'), requiring);
  writeFileSync(path.join(repo, 'composer.lock'), lock(pinned('opis/json-schema', '2.6.0', fork)));
  mkdirSync(path.join(repo, 'config'));
  writeFileSync(path.join(repo, 'config/dependency-review.json'), reviewRecord('2.6.0'));
  const added = spawnSync('git', ['-C', repo, 'add', '.'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const committed = spawnSync('git', ['-C', repo, 'commit', '--quiet', '-m', 'base'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  // The worktree of the branch, in a folder named <repo>-x-K1 beside main, as worktree-setup names it.
  const worktree = `${repo}-x-K1`;
  const created = spawnSync('git', ['-C', repo, 'worktree', 'add', '--quiet', '-b', 'fix/x-K1', worktree], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  t.after(() => spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree]));
  const template = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-finding-key-template-')));
  t.after(() => removeSandbox(template));
  initRepository(template, '--initial-branch=main');
  writeFileSync(path.join(template, 'composer.json'), requiring);
  writeFileSync(path.join(template, 'composer.lock'), lock(pinned('opis/json-schema', '2.6.0', upstream)));
  mkdirSync(path.join(template, 'config'));
  writeFileSync(path.join(template, 'config/dependency-review.json'), reviewRecord('2.6.0'));
  assert.equal(spawnSync('git', ['-C', template, 'add', '.'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-C', template, 'commit', '--quiet', '-m', 'base'], { encoding: 'utf8' }).status, 0);

  const onMain = sharedPinFindings(repo, [template]).findings.map(finding => finding.problem);
  const inWorktree = sharedPinFindings(worktree, [template]).findings.map(finding => finding.problem);
  assert.equal(onMain.length, 1, JSON.stringify(onMain));
  assert.deepEqual(inWorktree, onMain, 'the finding of the worktree reads as the finding of main');
  assert.doesNotMatch(inWorktree[0] ?? '', /-x-K1/, 'the folder of the worktree is not named in the finding');
});

// K464: a version mismatch between sibling checkouts is reported only by the checkout that lags its reviewed target, and the sibling
// side is the committed main of the sibling. A repository of a temporary directory whose main holds `files`, committed.
const K464_REFERENCE = 'a'.repeat(40);
const K464_UPSTREAM = 'https://github.com/opis/json-schema.git';
const k464Lock = (version: string, url = K464_UPSTREAM) => `${JSON.stringify({ packages: [{ name: 'opis/json-schema', version, source: { type: 'git', url, reference: K464_REFERENCE }, dist: { type: 'zip', url: `${url}/zipball/${K464_REFERENCE}`, reference: K464_REFERENCE } }], 'packages-dev': [] }, null, 4)}\n`;
const k464Requiring = JSON.stringify({ name: 'example/orm', require: { 'opis/json-schema': '^2.6' } });
const committedMain = (t: TestContext, name: string, files: Record<string, string>, branch = 'main'): string => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), `${name}-`)));
  t.after(() => removeSandbox(directory));
  initRepository(directory, `--initial-branch=${branch}`);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), text);
  }
  const added = spawnSync('git', ['-C', directory, 'add', '.'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const committed = spawnSync('git', ['-C', directory, 'commit', '--quiet', '-m', 'base'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  return directory;
};
// The rule of a version mismatch (K464): a checkout reports it when its locked version is not its reviewed target, or when both are at
// their targets and the targets differ, since the two reviews then disagree. Versions that agree are no version mismatch.
const reportsVersion = (version: string, target: string, siblingVersion: string, siblingTarget: string) =>
  version !== siblingVersion && (version !== target || (siblingVersion === siblingTarget && target !== siblingTarget));
const DATE = /\d{4}-\d{2}-\d{2}/;

for (const ownAtTarget of [true, false]) {
  for (const siblingAtTarget of [true, false]) {
    for (const targetsEqual of [true, false]) {
      test(`a version mismatch is reported by the checkout off its target, not by one at it (K464): own at target ${ownAtTarget}, sibling at target ${siblingAtTarget}, targets equal ${targetsEqual}`, (t) => {
        const ownTarget = '2.6.0';
        const siblingTarget = targetsEqual ? '2.6.0' : '2.7.0';
        const ownVersion = ownAtTarget ? ownTarget : '2.5.0';
        const siblingVersion = siblingAtTarget ? siblingTarget : '2.4.0';
        const own = committedMain(t, 'kit-k464-own', { 'composer.json': k464Requiring, 'composer.lock': k464Lock(ownVersion), 'config/dependency-review.json': reviewRecord(ownTarget) });
        const sibling = committedMain(t, 'kit-k464-sibling', { 'composer.json': k464Requiring, 'composer.lock': k464Lock(siblingVersion), 'config/dependency-review.json': reviewRecord(siblingTarget) });
        const ownFindings = sharedPinFindings(own, [sibling]).findings;
        const siblingFindings = sharedPinFindings(sibling, [own]).findings;
        assert.equal(ownFindings.length, reportsVersion(ownVersion, ownTarget, siblingVersion, siblingTarget) ? 1 : 0, JSON.stringify(ownFindings));
        assert.equal(siblingFindings.length, reportsVersion(siblingVersion, siblingTarget, ownVersion, ownTarget) ? 1 : 0, JSON.stringify(siblingFindings));
        for (const finding of [...ownFindings, ...siblingFindings]) {
          // A finding names the sibling and both reviewed targets, and no review date, which would make a finding new on every review.
          assert.ok(finding.problem.includes(path.basename(own)) || finding.problem.includes(path.basename(sibling)), finding.problem);
          assert.ok(finding.problem.includes(ownTarget) && finding.problem.includes(siblingTarget), finding.problem);
          assert.doesNotMatch(finding.problem, DATE, finding.problem);
        }
      });
    }
  }
}

test('shared pins compare tracked Composer locks, not generated link locks or manifests (K464-1)', (t) => {
  const own = committedMain(t, 'kit-k464-own', {
    '.gitignore': 'composer.link.json\ncomposer.link.lock\n',
    'composer.json': k464Requiring,
    'composer.lock': k464Lock('2.6.0'),
    'composer.link.json': JSON.stringify({ name: 'example/orm-linked', require: { 'opis/json-schema': '^2.6' } }),
    'composer.link.lock': k464Lock('2.5.0'),
    'config/dependency-review.json': reviewRecord('2.6.0'),
  });
  const sibling = committedMain(t, 'kit-k464-sibling', { 'composer.json': k464Requiring, 'composer.lock': k464Lock('2.6.0'), 'config/dependency-review.json': reviewRecord('2.6.0') });
  assert.deepEqual(sharedPinFindings(own, [sibling]).findings, []);

  writeFileSync(path.join(own, 'composer.lock'), k464Lock('2.5.0'));
  assert.deepEqual(sharedPinFindings(own, [sibling]).findings, [], 'an uncommitted tracked-lock edit is not part of the committed comparison');

  const trackedLag = committedMain(t, 'kit-k464-tracked-lag', {
    '.gitignore': 'composer.link.json\ncomposer.link.lock\n',
    'composer.json': k464Requiring,
    'composer.lock': k464Lock('2.5.0'),
    'composer.link.json': JSON.stringify({ name: 'example/orm-linked', require: { 'opis/json-schema': '^2.6' } }),
    'composer.link.lock': k464Lock('2.6.0'),
    'config/dependency-review.json': reviewRecord('2.6.0'),
  });
  const findings = sharedPinFindings(trackedLag, [sibling]).findings;
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0]?.problem ?? '', /locked at 2\.5\.0/);

  writeFileSync(path.join(trackedLag, 'composer.json'), JSON.stringify({ name: 'example/orm', require: {} }));
  assert.equal(sharedPinFindings(trackedLag, [sibling]).findings.length, 1, 'an uncommitted manifest edit does not erase a committed direct pin');
});

test('the sibling side is the committed main of the sibling, not its working tree (K464)', (t) => {
  const own = committedMain(t, 'kit-k464-own', { 'composer.json': k464Requiring, 'composer.lock': k464Lock('2.6.0'), 'config/dependency-review.json': reviewRecord('2.6.0') });
  const sibling = committedMain(t, 'kit-k464-sibling', { 'composer.json': k464Requiring, 'composer.lock': k464Lock('2.6.0'), 'config/dependency-review.json': reviewRecord('2.6.0') });
  // The working tree of the sibling holds an uncommitted lag; the committed main is at its target, so no finding.
  writeFileSync(path.join(sibling, 'composer.lock'), k464Lock('2.5.0'));
  assert.deepEqual(sharedPinFindings(own, [sibling]).findings, []);
});

test('a sibling whose committed main cannot be read prints not evaluated and no finding (K464)', (t) => {
  const own = committedMain(t, 'kit-k464-own', { 'composer.json': k464Requiring, 'composer.lock': k464Lock('2.5.0'), 'config/dependency-review.json': reviewRecord('2.6.0') });
  const noMain = committedMain(t, 'kit-k464-trunk', { 'composer.json': k464Requiring, 'composer.lock': k464Lock('2.7.0'), 'config/dependency-review.json': reviewRecord('2.7.0') }, 'trunk');
  const result = sharedPinFindings(own, [noMain]);
  assert.deepEqual(result.findings, []);
  assert.ok(result.progress.some(line => line.includes(path.basename(noMain)) && line.includes('not evaluated')), JSON.stringify(result.progress));
});

test('a source mismatch at one version is reported by both checkouts whatever their targets (K464)', (t) => {
  const own = committedMain(t, 'kit-k464-own', { 'composer.json': k464Requiring, 'composer.lock': k464Lock('2.6.0', 'https://github.com/example-orm/json-schema.git'), 'config/dependency-review.json': reviewRecord('2.6.0') });
  const sibling = committedMain(t, 'kit-k464-sibling', { 'composer.json': k464Requiring, 'composer.lock': k464Lock('2.6.0'), 'config/dependency-review.json': reviewRecord('2.7.0') });
  assert.equal(sharedPinFindings(own, [sibling]).findings.length, 1);
  assert.equal(sharedPinFindings(sibling, [own]).findings.length, 1);
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
  assert.match(remote(reached)[0] ?? '', new RegExp(`^\\[dependency-policy\\] package-lock\\.json @polyspec/ordered-json: package-lock\\.json:\\d+ resolves @polyspec/ordered-json from ${url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}, which no package\\.json of the lock names\\. Rule: each remote tarball that an npm lock resolves is named .+ Fix: declare @polyspec/ordered-json with this URL in the root package\\.json`));
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
