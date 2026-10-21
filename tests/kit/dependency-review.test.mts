// Tests of the review path of scripts/kit/dependency-review.mts: the fix that a finding names is the fix of the newer release
// that the review found. The checkout is the fixture copy of tests/kit/checkout.mts; the registries are stubs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { composerCommand, composerEnvironment as toolingEnvironment } from '../../scripts/kit/install-composer-project.mts';
import { repositoryRoot } from '../../scripts/kit/paths.mts';
import { composerEntries, composerEnvironment, highestStableRelease, isReleaseConsumerDirectory, providerEntries, runUpdateSteps, updatePlan } from '../../scripts/kit/dependency-review.mts';
import { TOOLCHAIN } from '../../scripts/kit/dependency-state.mts';
import { fixtureCheckout as fixture, gate, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { editFixture } from './json-fixture.mts';

test('a newer ruff release of mise.toml is named in the fix of its finding', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\nruff = "0.16.10"\n');
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
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
  const stub = stubRegistries(t, root);
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

// K340: while a Composer project is linked, the review reads the link lock, so a linked package is not compared with its registry and
// every Composer command runs on composer.link.json, never on the tracked project.
test('while a Composer project is linked the review asks Composer for the link files and does not compare a linked package (K340)', (t) => {
  const root = fixture(t);
  editFixture<{ composerPlatforms: { manifest: string; php: string }[] }>(root, 'config/dependency-policy.json', (policy) => { policy.composerPlatforms = [{ manifest: 'composer.json', php: '8.2.0' }]; });
  writeFileSync(path.join(root, 'composer.json'), JSON.stringify({ name: 'polyspec/kit-fixture-development', type: 'project', license: 'proprietary', repositories: [{ type: 'path', url: 'packages/fixture-php' }], require: { 'polyspec/kit-fixture': '0.0.0', 'psr/log': '^3.0' }, config: { platform: { php: '8.2.0' } } }));
  writeFileSync(path.join(root, 'composer.lock'), JSON.stringify(MONOREPO_LOCK));
  rmSync(path.join(root, 'packages/fixture-php/composer.lock'));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'psr/log': '3.0.3', 'example/framework': '1.0.0', 'example/helper': '1.0.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  assert.match(review(root, [], stub.env).stdout, /psr\/log 3\.0\.2 < 3\.0\.3: a newer stable release exists/, 'without a link the package is compared');
  assert.equal(composerEnvironment(root, '.'), undefined, 'a project that is not linked runs Composer on its own files');
  const linked = { ...MONOREPO_LOCK, packages: MONOREPO_LOCK.packages.map(item => (item.name === 'psr/log' ? { ...item, dist: { type: 'path', url: '../psr-log' } } : item)) };
  writeFileSync(path.join(root, 'composer.link.json'), readFileSync(path.join(root, 'composer.json'), 'utf8'));
  writeFileSync(path.join(root, 'composer.link.lock'), JSON.stringify(linked));
  assert.equal(composerEnvironment(root, '.')?.COMPOSER, 'composer.link.json');
  const result = review(root, [], stub.env);
  assert.doesNotMatch(result.stdout, /psr\/log 3\.0\.2 < 3\.0\.3/, 'a linked package is judged by its link');
  assert.doesNotMatch(result.stderr, /reported no release/);
  assert.equal(readFileSync(path.join(root, 'composer.lock'), 'utf8'), JSON.stringify(MONOREPO_LOCK), 'the tracked lock is untouched');
});

// A requirement that only a dependency group of a pyproject.toml declares, here through the include of another group
// (PEP 735), is reviewed like an extra: a newer release is a finding with the fix that pins it (K177).
test('a newer release of a requirement of a dependency group is a finding (K177)', (t) => {
  const root = fixture(t);
  const manifest = path.join(root, 'packages/fixture-python/pyproject.toml');
  writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}\n[dependency-groups]\ntest = ["pytest==8.0.0"]\ndev = [{ include-group = "test" }]\n`);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
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
  const stub = stubRegistries(t, root);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'psr/log': '[none matched]', 'example/framework': '1.0.0', 'example/helper': '2.0.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /composer outdated in \. reported no release of psr\/log/);
  assert.doesNotMatch(result.stdout + result.stderr, /3\.0\.2 < \[none matched\]/);
});

// K369: a Composer package locked at a version above the latest release of the registry is not outdated, so the review never
// proposes the older release (a downgrade), while a real newer release of another package is still proposed.
test('the review never proposes a release older than the locked version of a Composer package (K369)', (t) => {
  const root = fixture(t);
  editFixture<{ composerPlatforms: { manifest: string; php: string }[] }>(root, 'config/dependency-policy.json', (policy) => { policy.composerPlatforms = [{ manifest: 'composer.json', php: '8.2.0' }]; });
  writeFileSync(path.join(root, 'composer.json'), JSON.stringify({ name: 'polyspec/kit-fixture-development', type: 'project', license: 'proprietary', repositories: [{ type: 'path', url: 'packages/fixture-php' }], require: { 'polyspec/kit-fixture': '0.0.0', 'polyspec/template': '^0.0.11', 'psr/log': '^3.0', 'example/framework': '^1.0' }, config: { platform: { php: '8.2.0' } } }));
  writeFileSync(path.join(root, 'composer.lock'), JSON.stringify({ ...MONOREPO_LOCK, packages: [...MONOREPO_LOCK.packages, { name: 'polyspec/template', version: '0.0.11', dist: { type: 'zip', url: 'https://example.com/template.zip' } }] }));
  rmSync(path.join(root, 'packages/fixture-php/composer.lock'));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'polyspec/template': '0.0.6', 'psr/log': '3.0.2', 'example/framework': '1.1.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  const result = review(root, ['--update'], stub.env);
  const calls = stub.calls();
  assert.doesNotMatch(result.stdout, /polyspec\/template 0\.0\.11 < 0\.0\.6/, result.stdout);
  assert.deepEqual(calls.filter(call => call.includes('polyspec/template:')), [], calls.join('\n'));
  assert.match(result.stdout, /example\/framework 1\.0\.0 < 1\.1\.0: a newer stable release exists/);
  assert.ok(calls.includes('composer require --update-with-dependencies --no-interaction example/framework:^1.1.0'), calls.join('\n'));
});

// K392-1: while a Composer project is linked, UPDATE moves the new range in composer.link.json only; the tracked composer.json declares
// it too, and the tracked composer.lock waits for the release check (K326).
test('while linked UPDATE also declares the new range in the tracked composer.json, and leaves the tracked lock (K392-1)', (t) => {
  const root = fixture(t);
  editFixture<{ composerPlatforms: { manifest: string; php: string }[] }>(root, 'config/dependency-policy.json', (policy) => { policy.composerPlatforms = [{ manifest: 'composer.json', php: '8.2.0' }]; });
  const manifest = JSON.stringify({ name: 'polyspec/kit-fixture-development', type: 'project', license: 'proprietary', repositories: [{ type: 'path', url: 'packages/fixture-php' }], require: { 'polyspec/kit-fixture': '0.0.0', 'example/framework': '^1.0' }, config: { platform: { php: '8.2.0' } } });
  writeFileSync(path.join(root, 'composer.json'), manifest);
  writeFileSync(path.join(root, 'composer.lock'), JSON.stringify(MONOREPO_LOCK));
  rmSync(path.join(root, 'packages/fixture-php/composer.lock'));
  writeFileSync(path.join(root, 'composer.link.json'), manifest);
  writeFileSync(path.join(root, 'composer.link.lock'), JSON.stringify(MONOREPO_LOCK));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'example/framework': '1.1.0', 'psr/log': '3.0.2', 'example/helper': '1.0.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  const lockBefore = readFileSync(path.join(root, 'composer.lock'), 'utf8');
  review(root, ['--update'], stub.env);
  const calls = stub.calls();
  assert.ok(calls.includes('composer require --update-with-dependencies --no-interaction example/framework:^1.1.0 [COMPOSER=composer.link.json]'), calls.join('\n'));
  assert.ok(calls.includes('composer require --no-update --no-interaction example/framework:^1.1.0'), calls.join('\n'));
  assert.equal(readFileSync(path.join(root, 'composer.lock'), 'utf8'), lockBefore, 'the tracked lock is untouched');
});

// K392-2: while linked, UPDATE also updates the tracked composer.lock of a package that is no polyspec package, lock only (no install);
// a polyspec package keeps its tracked lock for the release check (K326).
test('while linked UPDATE also updates the tracked lock of a package that is no polyspec package, lock only (K392-2)', (t) => {
  const root = fixture(t);
  editFixture<{ composerPlatforms: { manifest: string; php: string }[] }>(root, 'config/dependency-policy.json', (policy) => { policy.composerPlatforms = [{ manifest: 'composer.json', php: '8.2.0' }]; });
  const manifest = JSON.stringify({ name: 'polyspec/kit-fixture-development', type: 'project', license: 'proprietary', repositories: [{ type: 'path', url: 'packages/fixture-php' }], require: { 'polyspec/kit-fixture': '0.0.0', 'polyspec/template': '^0.0.11', 'example/framework': '^1.0' }, config: { platform: { php: '8.2.0' } } });
  const lock = JSON.stringify({ ...MONOREPO_LOCK, packages: [...MONOREPO_LOCK.packages, { name: 'polyspec/template', version: '0.0.11', dist: { type: 'zip', url: 'https://example.com/template.zip' } }] });
  writeFileSync(path.join(root, 'composer.json'), manifest);
  writeFileSync(path.join(root, 'composer.lock'), lock);
  rmSync(path.join(root, 'packages/fixture-php/composer.lock'));
  writeFileSync(path.join(root, 'composer.link.json'), manifest);
  writeFileSync(path.join(root, 'composer.link.lock'), lock);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'example/framework': '1.1.0', 'polyspec/template': '0.0.12', 'psr/log': '3.0.2', 'example/helper': '1.0.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  review(root, ['--update'], stub.env);
  const calls = stub.calls();
  const declared = calls.indexOf('composer require --no-update --no-interaction example/framework:^1.1.0');
  assert.ok(declared >= 0, calls.join('\n'));
  assert.ok(calls.indexOf('composer update --with-dependencies --no-install --no-interaction example/framework') > declared, calls.join('\n'));
  assert.ok(calls.includes('composer require --no-update --no-interaction polyspec/template:^0.0.12'), calls.join('\n'));
  assert.deepEqual(calls.filter(call => call.includes('--no-install') && call.includes('polyspec/')), [], calls.join('\n'));
});

test('a Go module under the tracked go.work of the repository is scanned with that workspace (K418)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  // The tracked root go.work uses the fixture module, which has no go.work of its own; the lone module lies outside every use.
  writeFileSync(path.join(root, 'go.work'), 'go 1.21\n\nuse (\n\t./packages/fixture-go\n\t./packages/sibling\n)\n');
  mkdirSync(path.join(root, 'packages/sibling'), { recursive: true });
  writeFileSync(path.join(root, 'packages/sibling/go.mod'), 'module example.com/sibling\n\ngo 1.21\n\nrequire example.com/kit-fixture-go v0.0.0\n');
  writeFileSync(path.join(root, 'packages/fixture-go/main.go'), 'package main\n\nfunc main() {}\n');
  mkdirSync(path.join(root, 'packages/lone'), { recursive: true });
  writeFileSync(path.join(root, 'packages/lone/go.mod'), 'module example.com/other\n\ngo 1.21\n');
  writeFileSync(path.join(root, 'packages/lone/main.go'), 'package main\n\nfunc main() {}\n');
  spawnSync('git', ['add', '-A', '-f', '--', 'go.work', 'packages'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', 'commit', '--quiet', '-m', 'workspace'], { cwd: root });
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  review(root, [], stub.env);
  const calls = readFileSync(path.join(root, 'var/tools/govulncheck-calls.log'), 'utf8').split('\n').filter(Boolean).map(line => {
    const call: unknown = JSON.parse(line);
    if (!isJsonObject(call) || typeof call.cwd !== 'string') throw new Error(`govulncheck-calls.log holds no call with a cwd: ${line}`);
    return { cwd: call.cwd, gowork: typeof call.gowork === 'string' ? call.gowork : undefined };
  });
  assert.equal(calls.find(call => call.cwd === realpathSync(path.join(root, 'packages/fixture-go')))?.gowork, path.join(realpathSync(root), 'go.work'));
  assert.equal(calls.find(call => call.cwd === realpathSync(path.join(root, 'packages/lone')))?.gowork, undefined);
});

// K439: a tracked composer.lock takes the manifest of the provider that a checkout provides: its require (php >=8.4 of every provider)
// and the other fields Composer copies into an entry, while the name, the version, the dist, the source and the content-hash stay.
// A package that no checkout provides is left as it is.
test('a lock entry of a provided polyspec package takes the manifest of the provider and keeps its version and dist (K439)', () => {
  const dist = { type: 'zip', url: '../../var/composer-artifacts/polyspec-orm-php-0.0.18.zip', shasum: '7aff6a97d7ca201839d362c051acdc86779677de' };
  const lock = `${JSON.stringify({ 'content-hash': '931a126f8dbe3bfc612effd5fcda35b2', packages: [{ name: 'polyspec/orm', version: '0.0.18', dist, require: { php: '>=8.5', 'ext-json': '*' } }], 'packages-dev': [] }, null, 4)}\n`;
  const providers = new Map([['polyspec/orm', { name: 'polyspec/orm', type: 'library', require: { php: '>=8.4', 'ext-json': '*' }, autoload: { 'psr-4': { 'Polyspec\\Orm\\': 'src/' } } }]]);
  const result = providerEntries(lock, providers);
  const parsed: unknown = JSON.parse(result.text);
  assert.ok(isJsonObject(parsed) && Array.isArray(parsed.packages), result.text);
  assert.deepEqual(result.rewritten, ['polyspec/orm']);
  assert.equal(parsed['content-hash'], '931a126f8dbe3bfc612effd5fcda35b2');
  assert.deepEqual(parsed.packages[0], { name: 'polyspec/orm', version: '0.0.18', dist, require: { php: '>=8.4', 'ext-json': '*' }, type: 'library', autoload: { 'psr-4': { 'Polyspec\\Orm\\': 'src/' } } });
  assert.equal(result.text, `${JSON.stringify(parsed, null, 4)}\n`, 'kit writes the lock with 4-space indentation and a final newline');
});

test('a package that no checkout provides is unchanged byte for byte (K439)', () => {
  const psr = { name: 'psr/log', version: '3.0.2', dist: { type: 'zip', url: 'https://example.com/psr-log.zip' }, require: { php: '>=8.5' } };
  const orm = { name: 'polyspec/orm', version: '0.0.18', dist: { type: 'zip', url: '../orm.zip' }, require: { php: '>=8.5' } };
  const lock = `${JSON.stringify({ 'content-hash': 'abc', packages: [orm, psr], 'packages-dev': [] }, null, 4)}\n`;
  const result = providerEntries(lock, new Map([['polyspec/orm', { name: 'polyspec/orm', require: { php: '>=8.4' } }]]));
  const expected = JSON.stringify(psr, null, 4).split('\n').map((line, index) => (index === 0 ? line : `        ${line}`)).join('\n');
  assert.ok(result.text.includes(`        ${expected}`), result.text);
  assert.deepEqual(result.rewritten, ['polyspec/orm']);
  assert.equal(providerEntries(lock, new Map()).text, lock, 'without a provider nothing is rewritten');
  assert.deepEqual(providerEntries(lock, new Map()).rewritten, []);
});

// K439-1: the platform sections of the root of a lock are recomputed from the composer.json of its directory (require and config.platform),
// and a release-consumer lock is never rewritten: it is written by make release-consumer-lock only.
test('the platform and platform-overrides of a lock are recomputed from its own composer.json (K439-1)', () => {
  const lock = `${JSON.stringify({ 'content-hash': 'abc', packages: [], 'packages-dev': [], platform: { php: '>=8.5' }, 'platform-overrides': { php: '8.5.0' } }, null, 4)}\n`;
  const manifest = { require: { php: '>=8.4', 'ext-json': '*', 'polyspec/orm': '0.0.18' }, config: { platform: { php: '8.4.1' } } };
  const result = providerEntries(lock, new Map(), manifest);
  const parsed: unknown = JSON.parse(result.text);
  assert.ok(isJsonObject(parsed), result.text);
  assert.deepEqual(parsed.platform, { php: '>=8.4', 'ext-json': '*' });
  assert.deepEqual(parsed['platform-overrides'], { php: '8.4.1' });
  assert.ok(result.rewritten.includes('platform-overrides') && result.rewritten.includes('platform'), JSON.stringify(result.rewritten));
});

test('a release-consumer directory is never a lock that the provider entries rewrite (K439-1)', () => {
  assert.equal(isReleaseConsumerDirectory('tests/fixtures/release-consumer/composer'), true);
  assert.equal(isReleaseConsumerDirectory('tests/release-consumer/npm'), true);
  assert.equal(isReleaseConsumerDirectory('packages/php'), false);
});

// The Composer that the checkout declares in mise.toml (K439-2): make install-tools installs it. A missing or unrunnable one throws and
// names make install-tools, so a test that needs it fails instead of skipping.
function composerOfCheckout(checkout: string, user: string): string {
  let composer: string;
  try {
    composer = composerCommand(checkout, user);
  } catch (error) {
    throw new Error(`${user} needs the Composer of mise.toml, which make install-tools installs: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const version = spawnSync(composer, ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) throw new Error(`${user}: ${composer} --version failed, so run make install-tools: ${version.error?.message ?? version.stderr.trim()}`);
  return composer;
}

// K439-2: an entry that Composer wrote keeps its form: a provider manifest that says the same thing changes nothing on a rerun.
test('a rerun on a lock in Composer form changes nothing (K439-2)', () => {
  const dist = { type: 'zip', url: '../../var/composer-artifacts/polyspec-orm-php-0.0.18.zip', shasum: '7aff6a97d7ca201839d362c051acdc86779677de' };
  const composed = { name: 'polyspec/orm', version: '0.0.18', dist, require: { php: '>=8.4' }, type: 'library', license: ['MIT'] };
  const lock = `${JSON.stringify({ 'content-hash': 'abc', packages: [composed], 'packages-dev': [] }, null, 4)}\n`;
  const providers = new Map([['polyspec/orm', { name: 'polyspec/orm', type: 'library', license: 'MIT', require: { php: '>=8.4' } }]]);
  const first = providerEntries(lock, providers);
  assert.deepEqual(first.rewritten, [], 'the manifest license string is the lock array of Composer, so nothing is rewritten');
  assert.equal(first.text, lock);
});

// K439-2: the entries are the ones Composer writes (its own lock writer, offline, on the consumer's declared platform). The real case: the
// provider's manifest says php >=8.4, and only the tracked lock still holds the stale >=8.5. A rerun changes nothing; a provider that really
// demands a PHP the consumer's platform lacks fails, naming both.
test('the provider entries are Composer\'s own, and a rerun on its lock changes nothing (K439-2)', (t) => {
  // The Composer that the checkout declares in mise.toml, which make install-tools installs (K439-2). A missing one fails the test and
  // names make install-tools; a skip is no verification.
  const checkout = repositoryRoot();
  const composer = composerOfCheckout(checkout, 'the test of K439-2');
  const toolEnv = toolingEnvironment(checkout);
  const platform = { php: '8.4.1' };
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-entries-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'orm');
  mkdirSync(folder);
  const writeManifest = (php: string) => writeFileSync(path.join(folder, 'composer.json'), JSON.stringify({ name: 'polyspec/orm', type: 'library', license: 'MIT', require: { php }, autoload: { 'psr-4': { 'Orm\\': 'src/' } } }));
  writeManifest('>=8.4');
  const dist = { type: 'zip', url: '../../var/composer-artifacts/polyspec-orm-php-0.0.18.zip', shasum: '7aff6a97d7ca201839d362c051acdc86779677de' };
  const tracked = `${JSON.stringify({ 'content-hash': 'abc', packages: [{ name: 'polyspec/orm', version: '0.0.18', dist, require: { php: '>=8.5' } }], 'packages-dev': [] }, null, 4)}\n`;
  const manifests = (): Map<string, Record<string, unknown>> => {
    const manifest: unknown = JSON.parse(readFileSync(path.join(folder, 'composer.json'), 'utf8'));
    return new Map([['polyspec/orm', isJsonObject(manifest) ? manifest : {}]]);
  };
  const packagesOf = (text: string): Record<string, unknown>[] => {
    const parsed: unknown = JSON.parse(text);
    const list: unknown = isJsonObject(parsed) ? parsed.packages : undefined;
    return Array.isArray(list) ? list.filter(isJsonObject) : [];
  };
  const packages = [{ name: 'polyspec/orm', version: '0.0.18', folder }];
  const first = providerEntries(tracked, manifests(), undefined, composerEntries(packages, composer, toolEnv, platform));
  assert.deepEqual(first.rewritten, ['polyspec/orm']);
  const once = { packages: packagesOf(first.text) };
  assert.deepEqual(once.packages[0]?.dist, dist, 'the release dist stays');
  assert.equal(once.packages[0]?.version, '0.0.18', 'the version stays');
  assert.deepEqual(once.packages[0]?.require, { php: '>=8.4' }, 'the requirement is the manifest of the provider');
  const again = providerEntries(first.text, manifests(), undefined, composerEntries(packages, composer, toolEnv, platform));
  assert.deepEqual(again.rewritten, [], 'a rerun on the lock it wrote changes nothing');
  assert.equal(again.text, first.text);
  writeManifest('>=8.3');
  const changed = providerEntries(first.text, manifests(), undefined, composerEntries(packages, composer, toolEnv, platform));
  const twice = { packages: packagesOf(changed.text) };
  assert.deepEqual(Object.keys(twice.packages[0] ?? {}), Object.keys(once.packages[0] ?? {}), 'the manifest change keeps the form of the entry');
  assert.deepEqual(twice.packages[0]?.require, { php: '>=8.3' }, 'a manifest change changes exactly that field');
  writeManifest('>=8.5');
  assert.throws(
    () => composerEntries(packages, composer, toolEnv, platform),
    (error: unknown) => error instanceof Error && error.message.includes('php >=8.5') && error.message.includes('8.4.1'),
    'a provider that demands a PHP the consumer lacks fails, naming both',
  );
});

// K435: UPDATE with --targets moves each dependency that the file names to its target version, in place of the latest stable release
// of the registry; a dependency that the file does not name stays as it is, a target that the registry lacks fails, and RECORD states
// the snapshot moment of the file as the review moment.
const SNAPSHOT = '2026-10-20T12:00:00.000Z';
function writeTargets(root: string, targets: Record<string, Record<string, string>>): string {
  const file = path.join(root, 'targets.json');
  writeFileSync(file, JSON.stringify({ schema: 1, snapshot: SNAPSHOT, targets }));
  return file;
}

test('UPDATE with TARGETS takes each named npm and Composer package to its target and leaves an unnamed outdated package (K435)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const manifest = readFileSync(path.join(root, 'packages/fixture-lib/package.json'), 'utf8');
  stub.registry({ ...FIXTURE_REGISTRY, npm: { 'is-number': ['7.0.0', '7.1.0', '7.2.0'], semver: ['7.6.0', '7.7.0'] }, composer: { 'fixture-php': { 'psr/log': '3.0.4' } }, packagist: { 'psr/log': ['3.0.2', '3.0.3', '3.0.4'] } });
  const file = writeTargets(root, { npm: { 'is-number': '7.1.0' }, composer: { 'psr/log': '3.0.3' } });
  const result = review(root, ['--update', '--targets', file], stub.env);
  const calls = stub.calls();
  assert.ok(calls.includes('npm install --save-dev --save-exact is-number@7.1.0'), calls.join('\n'));
  assert.ok(calls.includes('composer require --update-with-dependencies --no-interaction psr/log:^3.0.3'), calls.join('\n'));
  assert.deepEqual(calls.filter(call => /^(npm install|composer )/.test(call) && /semver|is-number@7\.2|psr\/log:\^3\.0\.4/.test(call)), [], calls.join('\n'));
  assert.equal(readFileSync(path.join(root, 'packages/fixture-lib/package.json'), 'utf8'), manifest, 'the unnamed package is not updated');
  assert.match(result.stdout, /semver 7\.6\.0 < 7\.7\.0: a newer stable release exists/, result.stdout);
});

test('a target version that the registry lacks fails UPDATE before any dependency changes, and names it (K435)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const file = writeTargets(root, { npm: { 'is-number': '9.9.9' } });
  const result = review(root, ['--update', '--targets', file], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /is-number[^\n]*9\.9\.9/, result.stdout);
  assert.deepEqual(stub.calls().filter(call => call.startsWith('npm install')), [], stub.calls().join('\n'));
});

test('a target that breaks the PHP policy fails UPDATE before any dependency changes, and names it (K435)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  // The release 3.0.3 requires php >=8.5, which the platform of the policy (8.2.0 for the fixture lock) does not satisfy.
  stub.registry({ ...FIXTURE_REGISTRY, composer: { 'fixture-php': { 'psr/log': '3.0.4' } }, packagist: { 'psr/log': ['3.0.2', '3.0.3', '3.0.4'] }, packagistPhp: { 'psr/log': '>=8.5.0' } });
  const file = writeTargets(root, { composer: { 'psr/log': '3.0.3' } });
  const result = review(root, ['--update', '--targets', file], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /psr\/log[^\n]*3\.0\.3[^\n]*php >=8\.5/, result.stdout);
  assert.deepEqual(stub.calls().filter(call => /^composer (require|update)/.test(call)), [], stub.calls().join('\n'));
});

test('RECORD with TARGETS records the snapshot moment of the file as the review moment (K435)', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const file = writeTargets(root, { npm: { 'is-number': '7.0.0' } });
  review(root, ['--record', '--targets', file], stub.env);
  const record: unknown = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  assert.ok(isJsonObject(record), 'the record is a JSON object');
  assert.equal(record.reviewed, SNAPSHOT);
});

// K439-3: the scratch project takes the consumer's manifest and tracked lock as its base, so a provider's transitive requirement (nikic/php-parser,
// locked in the tracked lock) resolves offline; without the base the scratch cannot find it and fails.
test('the provider entries resolve the transitive requirements from the tracked lock, offline (K439-3)', (t) => {
  const checkout = repositoryRoot();
  let composer: string | undefined = process.env.COMPOSER_BIN;
  try {
    composer ??= composerCommand(checkout, 'the test of K439-3');
  } catch {
    composer = undefined;
  }
  if (composer === undefined || spawnSync(composer, ['--version']).status !== 0) {
    t.skip('no Composer on this machine');
    return;
  }
  const toolEnv = toolingEnvironment(checkout);
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-transitive-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'orm');
  mkdirSync(folder);
  writeFileSync(path.join(folder, 'composer.json'), JSON.stringify({ name: 'polyspec/orm', type: 'library', require: { php: '>=8.4', 'nikic/php-parser': '^5.9.0' }, autoload: { 'psr-4': { 'Orm\\': 'src/' } } }));
  const parser = { name: 'nikic/php-parser', version: '5.9.0', dist: { type: 'zip', url: 'https://example.invalid/php-parser.zip' }, require: { php: '>=8.1' } };
  const lock = JSON.stringify({ packages: [parser], 'packages-dev': [] });
  const consumer = { require: { 'polyspec/orm': '0.0.18', 'nikic/php-parser': '^5.9.0' }, config: { platform: { php: '8.4.1' } } };
  const packages = [{ name: 'polyspec/orm', version: '0.0.18', folder }];
  assert.throws(() => composerEntries(packages, composer, toolEnv, { php: '8.4.1' }), /nikic\/php-parser/, 'without the base the transitive requirement is not found');
  const written = composerEntries(packages, composer, toolEnv, { php: '8.4.1' }, { manifest: consumer, lock, folder: root });
  assert.ok(written.has('polyspec/orm'), 'the provider is written');
  assert.equal(written.get('polyspec/orm')?.version, '0.0.18');
});

// K439-4: the scratch resolves the root as the consumer does: a path repository of the consumer, relative to the consumer folder, is one of its
// repositories, so a root requirement that only that repository provides resolves; packagist stays disabled.
test('a root requirement that only the consumer own path repository provides resolves in the scratch (K439-4)', (t) => {
  const checkout = repositoryRoot();
  const composer = composerOfCheckout(checkout, 'the test of K439-4');
  const toolEnv = toolingEnvironment(checkout);
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-own-repository-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const orm = path.join(root, 'orm');
  mkdirSync(orm);
  writeFileSync(path.join(orm, 'composer.json'), JSON.stringify({ name: 'polyspec/orm', type: 'library', require: { php: '>=8.4' }, autoload: { 'psr-4': { 'Orm\\': 'src/' } } }));
  const consumer = path.join(root, 'consumer');
  const own = path.join(consumer, 'own');
  mkdirSync(own, { recursive: true });
  writeFileSync(path.join(own, 'composer.json'), JSON.stringify({ name: 'polyspec/own', type: 'library', version: '1.0.0', require: { php: '>=8.4' }, autoload: { 'psr-4': { 'Own\\': 'src/' } } }));
  const manifest = { require: { php: '>=8.4', 'polyspec/orm': '0.0.18', 'polyspec/own': '1.0.0' }, repositories: [{ type: 'path', url: './own' }], config: { platform: { php: '8.4.1' } } };
  const lock = JSON.stringify({ packages: [], 'packages-dev': [] });
  const packages = [{ name: 'polyspec/orm', version: '0.0.18', folder: orm }];
  const written = composerEntries(packages, composer, toolEnv, { php: '8.4.1' }, { manifest, lock, folder: consumer });
  assert.equal(written.get('polyspec/orm')?.version, '0.0.18');
});

// K439-4: a repository of the consumer that is not a readable folder fails naming it; no other repository stands in for it.
test('an unreadable path repository of the consumer fails naming it (K439-4)', (t) => {
  const checkout = repositoryRoot();
  const composer = composerOfCheckout(checkout, 'the test of K439-4');
  const toolEnv = toolingEnvironment(checkout);
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-missing-repository-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const orm = path.join(root, 'orm');
  mkdirSync(orm);
  writeFileSync(path.join(orm, 'composer.json'), JSON.stringify({ name: 'polyspec/orm', type: 'library', require: { php: '>=8.4' } }));
  const consumer = path.join(root, 'consumer');
  mkdirSync(consumer);
  const manifest = { require: { php: '>=8.4', 'polyspec/orm': '0.0.18' }, repositories: [{ type: 'path', url: './missing' }], config: { platform: { php: '8.4.1' } } };
  const lock = JSON.stringify({ packages: [], 'packages-dev': [] });
  const packages = [{ name: 'polyspec/orm', version: '0.0.18', folder: orm }];
  assert.throws(() => composerEntries(packages, composer, toolEnv, { php: '8.4.1' }, { manifest, lock, folder: consumer }), /\.\/missing/);
});

// K439-4-1: the provider entries of a tracked lock are written before the commands of an update run on it. The tracked lock holds an old
// polyspec/orm 0.0.18 entry that requires php >=8.5; Composer's platform check of a tracked update of example/lib fails on it, unless the
// entry takes the provider manifest first.
test('a tracked update passes a stale polyspec entry, whose provider entry is written before it (K439-4-1)', (t) => {
  const checkout = repositoryRoot();
  composerOfCheckout(checkout, 'the test of K439-4-1');
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-update-steps-')));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const orm = path.join(scratch, 'orm');
  const consumer = path.join(scratch, 'consumer');
  const lib = path.join(consumer, 'lib');
  mkdirSync(orm);
  mkdirSync(lib, { recursive: true });
  const ormManifest = { name: 'polyspec/orm', type: 'library', require: { php: '>=8.4' }, autoload: { 'psr-4': { 'Orm\\': 'src/' } } };
  writeFileSync(path.join(orm, 'composer.json'), JSON.stringify(ormManifest));
  writeFileSync(path.join(lib, 'composer.json'), JSON.stringify({ name: 'example/lib', version: '1.0.0', type: 'library', require: { php: '>=8.4' }, autoload: { 'psr-4': { 'Lib\\': 'src/' } } }));
  // The consumer has no repository of polyspec/orm: its locked entry is the only metadata that Composer reads for it (as crudui's tracked lock).
  const repositories = [{ packagist: false }, { type: 'path', url: './lib', options: { symlink: false } }];
  writeFileSync(path.join(consumer, 'composer.json'), JSON.stringify({ name: 'kit/consumer', type: 'project', license: 'proprietary', repositories, require: { php: '>=8.4', 'polyspec/orm': '0.0.18' }, config: { platform: { php: '8.4.1' } } }));
  writeFileSync(path.join(consumer, 'composer.lock'), JSON.stringify({ packages: [{ name: 'polyspec/orm', version: '0.0.18', dist: { type: 'zip', url: 'https://example.invalid/polyspec-orm-0.0.18.zip' }, type: 'library', require: { php: '>=8.5' } }], 'packages-dev': [], platform: { php: '>=8.4' }, 'platform-overrides': { php: '8.4.1' } }));
  const found = new Map([['polyspec/orm', { manifest: ormManifest, folder: orm }]]);
  const plan = [{ command: 'composer', args: ['update', '--with-dependencies', '--no-install', '--no-audit', '--no-interaction', 'example/lib'], cwd: path.relative(checkout, consumer), tracked: true }];
  assert.equal(runUpdateSteps(checkout, plan, found), 0, 'the tracked update passes');
  const lock: unknown = JSON.parse(readFileSync(path.join(consumer, 'composer.lock'), 'utf8'));
  const entries: unknown[] = isJsonObject(lock) && Array.isArray(lock.packages) ? lock.packages : [];
  const ormEntry = entries.find((entry: unknown) => isJsonObject(entry) && entry.name === 'polyspec/orm');
  assert.equal(isJsonObject(ormEntry) && isJsonObject(ormEntry.require) ? ormEntry.require.php : undefined, '>=8.4', 'the entry takes the provider manifest');
});
