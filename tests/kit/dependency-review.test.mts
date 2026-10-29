// Tests of the review path of scripts/kit/dependency-review.mts: the fix that a finding names is the fix of the newer release
// that the review found. The checkout is the fixture copy of tests/kit/checkout.mts; the registries are stubs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { composerCommand, composerEnvironment as toolingEnvironment } from '../../scripts/kit/install-composer-project.mts';
import { toolCommand } from '../../scripts/kit/mise-tools.mts';
import { repositoryRoot } from '../../scripts/kit/paths.mts';
import { highestStableRelease, runUpdateSteps, targetRelease, TARGET_RELEASE_ECOSYSTEMS, updatePlan } from '../../scripts/kit/dependency-review.mts';
import { TOOLCHAIN } from '../../scripts/kit/dependency-state.mts';
import type { Dependency } from '../../scripts/kit/dependency-state.mts';
import { fixtureCheckout as fixture, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { editFixture } from './json-fixture.mts';
import { put } from './tree.mts';

test('a newer ruff release of mise.toml is named in the fix of its finding', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, TOOLCHAIN), '[tools]\nruff = "0.16.10"\n');
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, ruff: { '0.16.10': [{}], '0.16.11': [{}] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] mise\.toml ruff 0\.16\.10 < 0\.16\.11: a newer stable release exists\. Fix: set ruff in mise\.toml to 0\.16\.11, then make toolchain-lock and make install-tools\.$/m);
});

test('the latest PyPI release is the highest PEP 440 release with files, a post-release included and a pre-release not (K115)', () => {
  const files = [{}];
  assert.equal(highestStableRelease({ '3.9': files, '3.11': files, '3.12rc1': files, '3.13': [] }), '3.11');
  assert.equal(highestStableRelease({ '1.0': files, '1.0.post1': files, '1.1.dev1': files }), '1.0.post1');
  assert.equal(highestStableRelease({ '2.0b1': files }), null);
});

// A checkout without config/dependency-policy.json is told so by name, not by a stack trace of the read (K146).
test('the review names a missing policy file instead of failing with a stack trace (K146)', (t) => {
  const root = fixture(t);
  rmSync(path.join(root, 'config/dependency-policy.json'));
  const result = review(root, []);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /config\/dependency-policy\.json is missing/);
  assert.doesNotMatch(result.stderr, /^\s+at /m);
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
  assert.equal(result.status, 0, result.stdout + result.stderr);
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

// K340: a linked package is judged by its link, so the review does not compare it with its registry; since K591 a Composer package is
// linked when its folder of the vendor is a symbolic link.
test('the review does not compare a Composer package whose vendor folder is a symbolic link (K340, K591)', (t) => {
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
  // The installed folder of psr/log becomes a link to a checkout of it, as link makes it (K591).
  const checkout = path.join(root, 'var/psr-log');
  mkdirSync(checkout, { recursive: true });
  mkdirSync(path.join(root, 'vendor/psr'), { recursive: true });
  symlinkSync(checkout, path.join(root, 'vendor/psr/log'));
  const result = review(root, [], stub.env);
  assert.doesNotMatch(result.stdout, /psr\/log 3\.0\.2 < 3\.0\.3/, 'a linked package is judged by its link');
  assert.doesNotMatch(result.stderr, /reported no release/);
  assert.equal(readFileSync(path.join(root, 'composer.lock'), 'utf8'), JSON.stringify(MONOREPO_LOCK), 'the tracked lock is untouched');
});

// A requirement that only a dependency group of a pyproject.toml declares, here through the include of another group
// (PEP 735), is reviewed like an extra: a newer release is a finding with the fix that pins it (K177).
test('a newer release of a dependency group requirement is informational (K177, K661-5)', (t) => {
  const root = fixture(t);
  const manifest = path.join(root, 'packages/fixture-python/pyproject.toml');
  writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}\n[dependency-groups]\ntest = ["pytest==8.0.0"]\ndev = [{ include-group = "test" }]\n`);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, pytest: { '8.0.0': [{}], '8.1.0': [{}] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
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
  writeFileSync(path.join(root, 'composer.json'), JSON.stringify({ name: 'polyspec/kit-fixture-development', type: 'project', license: 'proprietary', repositories: [{ type: 'path', url: 'packages/fixture-php' }], require: { 'polyspec/kit-fixture': '0.0.0', 'polyspec/fixture-package': '^0.0.11', 'psr/log': '^3.0', 'example/framework': '^1.0' }, config: { platform: { php: '8.2.0' } } }));
  writeFileSync(path.join(root, 'composer.lock'), JSON.stringify({ ...MONOREPO_LOCK, packages: [...MONOREPO_LOCK.packages, { name: 'polyspec/fixture-package', version: '0.0.11', dist: { type: 'zip', url: 'https://example.com/fixture-package.zip' } }] }));
  rmSync(path.join(root, 'packages/fixture-php/composer.lock'));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  const at = path.basename(root);
  stub.registry({ ...FIXTURE_REGISTRY, composer: { [at]: { 'polyspec/fixture-package': '0.0.6', 'psr/log': '3.0.2', 'example/framework': '1.1.0' } }, composerAudit: { [at]: { advisories: [], abandoned: [] } } });
  const result = review(root, ['--update'], stub.env);
  const calls = stub.calls();
  assert.doesNotMatch(result.stdout, /polyspec\/fixture-package 0\.0\.11 < 0\.0\.6/, result.stdout);
  assert.deepEqual(calls.filter(call => call.includes('polyspec/fixture-package:')), [], calls.join('\n'));
  assert.match(result.stdout, /example\/framework 1\.0\.0 < 1\.1\.0: a newer stable release exists/);
  assert.ok(calls.includes('composer require --update-with-dependencies --no-interaction example/framework:^1.1.0'), calls.join('\n'));
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
// The Composer that the checkout declares in mise.toml (K439-2): make install-tools installs it. A missing or unrunnable one throws and
// names make install-tools, so a test that needs it fails instead of skipping.
function composerOfCheckout(checkout: string, user: string): string {
  let composer: string;
  try {
    composer = composerCommand(checkout, user);
  } catch (error) {
    throw new Error(`${user} needs the Composer of mise.toml, which make install-tools installs: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  // K508: the shim of mine runs with the toolchain environment of kit, which gives it the trust and the directories of the checkout.
  // K508: the shim of mine runs with the toolchain environment of kit, which gives it the trust and the directories of the checkout.
  const version = spawnSync(composer, ['--version'], { encoding: 'utf8', env: toolingEnvironment(checkout) });
  if (version.error || version.status !== 0) throw new Error(`${user}: ${composer} --version failed, so run make install-tools: ${version.error?.message ?? version.stderr.trim()}`);
  return composer;
}

test('K435-1: targeted Go and PyPI releases validate and produce exact update steps', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, click: { '8.1.7': [{}], '8.1.8': [{}] } } });
  const pypi: Dependency = { ecosystem: 'pypi', manifest: 'packages/fixture-python/pyproject.toml', package: 'click', kind: 'dependencies', spec: '==8.1.7', version: '8.1.7', lock: 'packages/fixture-python/pylock.toml' };
  const go: Dependency = { ecosystem: 'go', manifest: 'packages/fixture-go/go.mod', package: 'github.com/google/uuid', kind: 'require', spec: 'v1.6.0', version: 'v1.6.0', lock: 'packages/fixture-go/go.sum' };

  assert.deepEqual(targetRelease(root, pypi, '8.1.8', new Map(), stub.env), { latest: '8.1.8' });
  const pypiPlan = updatePlan({ newer: [{ ...pypi, latest: '8.1.8' }], advisories: [], targeted: true });
  assert.equal(pypiPlan.length, 1);
  assert.equal(pypiPlan[0]?.command, 'node');
  assert.ok(pypiPlan[0]?.args.some(argument => argument.endsWith('/pin-python-dependency.mjs') || argument.endsWith('/pin-python-dependency.mts')));
  assert.deepEqual(pypiPlan[0]?.args.slice(-3), [pypi.manifest, pypi.package, '8.1.8']);

  assert.deepEqual(targetRelease(root, go, 'v1.5.0', new Map(), stub.env), { latest: 'v1.5.0' });
  assert.deepEqual(updatePlan({ newer: [{ ...go, latest: 'v1.5.0' }], advisories: [], targeted: true }), [
    { command: 'go', args: ['get', 'github.com/google/uuid@v1.5.0'], cwd: 'packages/fixture-go' },
    { command: 'go', args: ['mod', 'tidy'], cwd: 'packages/fixture-go' },
  ]);
});

test('K435-1: targeted-update coverage names every target-release handler', () => {
  const covered = ['npm', 'go', 'pypi', 'composer'].sort();
  assert.deepEqual([...TARGET_RELEASE_ECOSYSTEMS].sort(), covered);
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

test('the Composer shim of a checkout runs with the toolchain environment of kit (K508)', () => {
  const checkout = repositoryRoot();
  // The shim is run from a bare environment: no MISE variable of the runner, so the test does not depend on how it was started.
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('MISE_')));
  for (const name of Object.keys(saved)) delete process.env[name];
  try {
    // The helper that every test of Composer uses must run the shim with that environment: it is the path under test.
    const composer = composerOfCheckout(checkout, 'the test of K508');
    const version = spawnSync(composer, ['--version'], { encoding: 'utf8', env: toolingEnvironment(checkout) });
    assert.equal(version.status, 0, version.stderr || version.stdout);
    assert.equal(toolCommand(checkout, 'composer'), composer, 'the helper runs the Composer shim of the checkout');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('K681: a failing native Composer command leaves the application lock metadata untouched', (t) => {
  const checkout = repositoryRoot();
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-native-review-boundary-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'composer.json'), JSON.stringify({ name: 'example/app', require: { php: '>=99.0' } }));
  const before = JSON.stringify({ 'content-hash': 'original', packages: [], 'packages-dev': [], platform: { php: '>=8.4' }, 'platform-overrides': { php: '8.4.1' } });
  writeFileSync(path.join(root, 'composer.lock'), before);
  composerOfCheckout(checkout, 'K681 native metadata boundary');
  assert.equal(runUpdateSteps(checkout, [{ command: 'composer', args: ['validate', '--strict', '--no-check-publish', '--no-interaction'], cwd: path.relative(checkout, root) }]), 1);
  assert.equal(readFileSync(path.join(root, 'composer.lock'), 'utf8'), before, 'no preflight or postflight metadata reconciliation');
});

// K681 replaces the K439/K468/K475 synthesis assertions with package-manager ownership regressions.
function nativeComposerProject(t: TestContext) {
  const checkout = repositoryRoot();
  composerOfCheckout(checkout, 'K681 native Composer ownership');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-native-composer-review-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = { ...toolingEnvironment(checkout), COMPOSER: 'composer.local.json', COMPOSER_HOME: path.join(root, 'home'), COMPOSER_CACHE_DIR: path.join(root, 'cache'), COMPOSER_DISABLE_NETWORK: '1' };
  const run = (args: string[]) => runUpdateSteps(checkout, [{ command: 'composer', args, cwd: path.relative(checkout, root) }], env);
  return { checkout, root, env, run };
}

test('K681: native Composer resolves the selected application path graph and writes only its lock', (t) => {
  const { root, run } = nativeComposerProject(t);
  const selected = { name: 'example/app', license: 'MIT', require: { 'example/local': '2.0.0' }, repositories: [
    { type: 'path', url: 'source', options: { symlink: true } }, { type: 'path', url: 'dependency', options: { symlink: true } }, { 'packagist.org': false },
  ], config: { platform: { php: '8.4.1' } } };
  put(root, {
    'composer.json': JSON.stringify({ name: 'example/released', require: { 'example/local': '1.0.0' } }),
    'composer.lock': 'released lock must remain byte identical',
    'composer.local.json': JSON.stringify(selected),
    'source/composer.json': JSON.stringify({ name: 'example/local', version: '2.0.0', license: 'MIT', require: { php: '>=8.4', 'example/dependency': '^1.0' } }),
    'dependency/composer.json': JSON.stringify({ name: 'example/dependency', version: '1.0.0', license: 'MIT' }),
    'tests/release-consumer/composer/composer.lock': 'release consumer lock',
  });
  const manifests = ['composer.json', 'composer.local.json', 'source/composer.json', 'dependency/composer.json'];
  const before = manifests.map(file => readFileSync(path.join(root, file), 'utf8'));
  const flags = ['--no-install', '--no-scripts', '--no-plugins', '--no-audit', '--no-interaction'];
  assert.equal(run(['update', ...flags]), 0);
  const first = readFileSync(path.join(root, 'composer.local.lock'), 'utf8');
  const lock: unknown = JSON.parse(first);
  assert.ok(isJsonObject(lock) && Array.isArray(lock.packages));
  const local: unknown = lock.packages.find((entry: unknown) => isJsonObject(entry) && entry.name === 'example/local');
  assert.ok(isJsonObject(local) && isJsonObject(local.dist) && isJsonObject(local.require));
  assert.equal(local.version, '2.0.0');
  assert.equal(local.dist.type, 'path');
  assert.equal(local.require.php, '>=8.4');
  assert.deepEqual(local.license, ['MIT'], 'native Composer writes metadata in its own format');
  assert.equal(run(['update', 'example/local', '--with-dependencies', ...flags]), 0);
  assert.equal(readFileSync(path.join(root, 'composer.local.lock'), 'utf8'), first, 'native repeated update is unchanged');
  assert.deepEqual(manifests.map(file => readFileSync(path.join(root, file), 'utf8')), before);
  assert.equal(readFileSync(path.join(root, 'composer.lock'), 'utf8'), 'released lock must remain byte identical');
  assert.equal(readFileSync(path.join(root, 'tests/release-consumer/composer/composer.lock'), 'utf8'), 'release consumer lock');
  assert.equal(existsSync(path.join(root, 'vendor')), false, '--no-install remains a native lock-only update');
});

test('K681: incompatible source versions and unreadable declared paths fail natively without metadata repair', (t) => {
  const project = nativeComposerProject(t);
  // These expected Composer failures must retain their native diagnostics without workflow annotations.
  delete project.env.GITHUB_ACTIONS;
  const { root, run } = project;
  const manifest = { name: 'example/app', require: { 'example/local': '1.0.0' }, repositories: [{ type: 'path', url: 'source' }, { 'packagist.org': false }] };
  put(root, { 'composer.local.json': JSON.stringify(manifest), 'source/composer.json': JSON.stringify({ name: 'example/local', version: '2.0.0' }) });
  const before = readFileSync(path.join(root, 'composer.local.json'), 'utf8');
  const args = ['update', '--no-install', '--no-scripts', '--no-plugins', '--no-audit', '--no-interaction'];
  assert.equal(run(args), 1, 'the real source version is not aliased to the application requirement');
  assert.equal(existsSync(path.join(root, 'composer.local.lock')), false);
  assert.equal(readFileSync(path.join(root, 'composer.local.json'), 'utf8'), before);
  put(root, { 'source/composer.json': JSON.stringify({ name: 'example/local', version: '1.0.0', require: { php: '>=99.0' } }) });
  assert.equal(run(args), 1, 'native platform requirements are not rewritten to match the runtime');
  assert.equal(existsSync(path.join(root, 'composer.local.lock')), false);
  rmSync(path.join(root, 'source'), { recursive: true });
  assert.equal(run(args), 1, 'an absent path is not replaced by a guessed sibling');
  assert.equal(readFileSync(path.join(root, 'composer.local.json'), 'utf8'), before);
});

test('K681: a declared VCS repository stays an application declaration without sibling conversion', (t) => {
  const { root, run } = nativeComposerProject(t);
  const manifest = JSON.stringify({ name: 'example/app', description: 'Native repository declaration', license: 'MIT', repositories: [{ type: 'vcs', url: 'https://example.invalid/source.git', 'no-api': true }] });
  writeFileSync(path.join(root, 'composer.local.json'), manifest);
  assert.equal(run(['validate', '--strict', '--no-check-lock', '--no-check-publish', '--no-interaction']), 0);
  assert.equal(readFileSync(path.join(root, 'composer.local.json'), 'utf8'), manifest);
  assert.equal(existsSync(path.join(root, 'composer.local.lock')), false);
});

test('K681: retired provider-entry commands refuse before review or mutation and explain native migration', (t) => {
  const root = fixture(t);
  put(root, { 'composer.json': '{"name":"example/app"}', 'composer.lock': 'application lock bytes' });
  const lock = readFileSync(path.join(root, 'composer.lock'), 'utf8');
  const manifest = readFileSync(path.join(root, 'composer.json'), 'utf8');
  const result = review(root, ['--provider-entries']);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /--provider-entries was removed/);
  assert.match(result.stderr, /COMPOSER/);
  assert.match(result.stderr, /make composer-install DIR=<project>/);
  assert.equal(readFileSync(path.join(root, 'composer.lock'), 'utf8'), lock);
  assert.equal(readFileSync(path.join(root, 'composer.json'), 'utf8'), manifest);
  assert.equal(result.stdout, '');
  const make = spawnSync('make', ['-n', 'composer-provider-entries'], { cwd: repositoryRoot(), encoding: 'utf8' });
  assert.equal(make.status, 0, make.stderr);
  assert.match(make.stdout, /dependency-review\.(mts|mjs) --provider-entries/);
});
