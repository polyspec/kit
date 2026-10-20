// Tests of the review path of scripts/kit/dependency-review.mts: the fix that a finding names is the fix of the newer release
// that the review found. The checkout is the fixture copy of tests/kit/checkout.mts; the registries are stubs.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { highestStableRelease, updatePlan } from '../../scripts/kit/dependency-review.mts';
import { TOOLCHAIN } from '../../scripts/kit/dependency-state.mts';
import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { editFixture } from './json-fixture.mts';

test('a newer ruff release of mise.toml is named in the fix of its finding', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\nruff = "0.16.10"\n');
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, ruff: { '0.16.10': [{}], '0.16.11': [{}] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] mise\.toml ruff 0\.16\.10 < 0\.16\.11: a newer stable release exists\. Fix: set ruff in mise\.toml to 0\.16\.11, then make toolchain-lock and make install-tools\.$/m);
});

test('the latest PyPI release is the highest PEP 440 release with files, a post-release included and a pre-release not (K115)', () => {
  const files = [{}];
  assert.equal(highestStableRelease({ '3.9': files, '3.11': files, '3.12rc1': files, '3.13': [] }), '3.11');
  assert.equal(highestStableRelease({ '1.0': files, '1.0.post1': files, '1.1.dev1': files }), '1.0.post1');
  assert.equal(highestStableRelease({ '2.0b1': files }), null);
});

// A checkout without config/dependency-policy.json is told so by name, not by a stack trace of the read (K146).
test('the review and the gate name a missing policy file instead of failing with a stack trace (K146)', (t) => {
  const root = fixture(t);
  rmSync(path.join(root, 'config/dependency-policy.json'));
  for (const result of [review(root, []), gate(root)]) {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /config\/dependency-policy\.json is missing/);
    assert.doesNotMatch(result.stderr, /^\s+at /m);
  }
});

// K168: a Composer monorepo has one development composer.json at the root, which requires its published packages through
// path repositories, and one root lock; a published package commits no lock. Its own requirements reach its consumers, so
// they are first-party requirements of the root: the review reads their versions from the root lock and asks composer
// outdated at the root once. A library that only a third-party package requires is not reviewed.
const MONOREPO_LOCK = {
  packages: [
    { name: 'polyspec/kit-fixture', version: '0.0.0', dist: { type: 'path', url: 'packages/fixture-php' }, require: { php: '>=8.2', 'psr/log': '^3.0' } },
    { name: 'psr/log', version: '3.0.2', dist: { type: 'zip', url: 'https://example.com/psr-log.zip' }, require: { php: '>=8.0.0' } },
    { name: 'example/framework', version: '1.0.0', dist: { type: 'zip', url: 'https://example.com/framework.zip' }, require: { 'example/helper': '^1.0' } },
    { name: 'example/helper', version: '1.0.0', dist: { type: 'zip', url: 'https://example.com/helper.zip' } },
  ],
  'packages-dev': [],
  'platform-overrides': { php: '8.2.0' },
};

test('a requirement of a published package of a Composer monorepo is reviewed from the root lock, and a transitive library is not (K168)', (t) => {
  const root = fixture(t);
  editFixture<{ composerPlatforms: { manifest: string; php: string }[] }>(root, 'config/dependency-policy.json', (policy) => { policy.composerPlatforms = [{ manifest: 'composer.json', php: '8.2.0' }]; });
  writeFileSync(path.join(root, 'composer.json'), JSON.stringify({ name: 'polyspec/kit-fixture-development', type: 'project', license: 'proprietary', repositories: [{ type: 'path', url: 'packages/fixture-php' }], require: { 'polyspec/kit-fixture': '0.0.0', 'example/framework': '^1.0' }, config: { platform: { php: '8.2.0' } } }));
  writeFileSync(path.join(root, 'composer.lock'), JSON.stringify(MONOREPO_LOCK));
  rmSync(path.join(root, 'packages/fixture-php/composer.lock'));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'psr/log': '3.0.3', 'example/framework': '1.0.0', 'example/helper': '2.0.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-php\/composer\.json psr\/log 3\.0\.2 < 3\.0\.3: a newer stable release exists\./m);
  assert.doesNotMatch(result.stdout, /example\/helper/);
  assert.doesNotMatch(result.stderr, /reported no release/);
  assert.deepEqual(stub.calls().filter(call => call.startsWith('composer outdated')), ['composer outdated --locked --all --format=json --no-interaction']);
  // The update raises the requirement in the published manifest alone, and the root updates its lock.
  assert.deepEqual(updatePlan({ newer: [{ ecosystem: 'composer', manifest: 'packages/fixture-php/composer.json', package: 'psr/log', spec: '^3.0', latest: '3.0.3', kind: 'require', lock: 'composer.lock' }], advisories: [] }), [
    { command: 'composer', args: ['require', '--no-update', '--no-interaction', 'psr/log:^3.0.3'], cwd: 'packages/fixture-php' },
    { command: 'composer', args: ['update', '--with-dependencies', '--no-interaction', 'psr/log'], cwd: '.' },
  ]);
});

// A requirement that only a dependency group of a pyproject.toml declares, here through the include of another group
// (PEP 735), is reviewed like an extra: a newer release is a finding with the fix that pins it (K177).
test('a newer release of a requirement of a dependency group is a finding (K177)', (t) => {
  const root = fixture(t);
  const manifest = path.join(root, 'packages/fixture-python/pyproject.toml');
  writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}\n[dependency-groups]\ntest = ["pytest==8.0.0"]\ndev = [{ include-group = "test" }]\n`);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, pytest: { '8.0.0': [{}], '8.1.0': [{}] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-python\/pyproject\.toml pytest 8\.0\.0 < 8\.1\.0: a newer stable release exists\./m);
  assert.equal(result.stdout.match(/pytest 8\.0\.0 < 8\.1\.0/g)?.length, 1, result.stdout);
});

test('the none-matched answer of composer outdated is no release, and is never recorded as a version (K281)', (t) => {
  const root = fixture(t);
  editFixture<{ composerPlatforms: { manifest: string; php: string }[] }>(root, 'config/dependency-policy.json', (policy) => { policy.composerPlatforms = [{ manifest: 'composer.json', php: '8.2.0' }]; });
  writeFileSync(path.join(root, 'composer.json'), JSON.stringify({ name: 'polyspec/kit-fixture-development', type: 'project', license: 'proprietary', repositories: [{ type: 'path', url: 'packages/fixture-php' }], require: { 'polyspec/kit-fixture': '0.0.0', 'example/framework': '^1.0' }, config: { platform: { php: '8.2.0' } } }));
  writeFileSync(path.join(root, 'composer.lock'), JSON.stringify(MONOREPO_LOCK));
  rmSync(path.join(root, 'packages/fixture-php/composer.lock'));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'psr/log': '[none matched]', 'example/framework': '1.0.0', 'example/helper': '2.0.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /composer outdated in \. reported no release of psr\/log/);
  assert.doesNotMatch(result.stdout + result.stderr, /3\.0\.2 < \[none matched\]/);
});
