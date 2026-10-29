// Tests of the PEP 751 lock of a Python project (pylock.toml) in the dependency tools: the parser reads the tables that uv and pip
// write and names the line of a construct it does not read; the review records the git pins, queries PyPI for the latest release and the advisories of each registry package, and names the tool of created-by in
// the fix. The fixture is tests/kit/fixture/packages/fixture-python/pylock.toml, written by uv; no test uses the network.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readPylock } from '../../scripts/kit/pylock.mts';
import { schemaFile, validate } from '../../scripts/kit/schema-validate.mts';
import { fixtureCheckout as fixture, installCargoAuditStub, installGovulncheckStub, review } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { editFixture, readFixture } from './json-fixture.mts';
import type { ReviewRecord } from '../../scripts/kit/dependency-state.mts';
import type { LockEntry } from '../../scripts/kit/python-lock.mts';
import { known } from './known.mts';
import { fileDigest } from '../../scripts/kit/bootstrap/digest.mts';

const LOCK = 'packages/fixture-python/pylock.toml';
// A lock with a git pin. python-lock-check refuses a git package (the writer resolves registry files and archives only), so the
// fixture lock holds none; the tests that need a git pin add this lock to the policy of their own temporary checkout.
const GIT_LOCK = 'packages/fixture-python/pylock.git.toml';
const GIT_TEXT = 'lock-version = "1.0"\ncreated-by = "uv"\nrequires-python = ">=3.11"\n\n[[packages]]\nname = "pip-tools"\nversion = "7.4.1"\nvcs = { type = "git", url = "https://github.com/jazzband/pip-tools", requested-revision = "7.4.1", commit-id = "COMMIT" }\n';
// Adds the git lock to the policy and to the review record of the checkout, with the commit of the lock.
function withGitLock(root: string, commit = PIP_TOOLS_COMMIT) {
  writeFileSync(path.join(root, GIT_LOCK), GIT_TEXT.replace('COMMIT', commit));
  editFixture(root, 'config/dependency-policy.json', (policy: { pythonLocks: LockEntry[] }) => {
    policy.pythonLocks.push({ lock: GIT_LOCK, source: { requirements: 'packages/fixture-python/requirements.txt', constraints: 'packages/fixture-python/constraints.txt' } });
  });
  editFixture(root, 'config/dependency-review.json', (record: ReviewRecord) => {
    record.vcs = [{ lock: GIT_LOCK, package: 'pip-tools', url: 'https://github.com/jazzband/pip-tools', requestedRevision: '7.4.1', commitId: commit }];
  });
  return root;
}
const lockText = (root: string) => readFileSync(path.join(root, LOCK), 'utf8');
const writeLock = (root: string, text: string) => writeFileSync(path.join(root, LOCK), text);
const PIP_TOOLS_COMMIT = '60ebdf5d1625cb63d0b94326035e0aa209659f4d';

test('the parser reads the tables of a uv export: registry files with their hashes and a git pin with its commit', (t) => {
  const root = fixture(t);
  const lock = readPylock(lockText(root), LOCK);
  assert.equal(lock.lockVersion, '1.0');
  assert.equal(lock.createdBy, 'uv');
  // The fixture lock holds click first; without it, reading its fields fails the case as before.
  const click = known(lock.packages[0], 'lock.packages[0]');
  // GIT_TEXT holds the package pip-tools.
  const pipTools = known(readPylock(GIT_TEXT.replace('COMMIT', PIP_TOOLS_COMMIT), GIT_LOCK).packages[0], 'readPylock(GIT_TEXT.replace(…, PIP_TOOLS_COMMIT), GIT_LOCK).packages[0]');
  assert.equal(click.kind, 'registry');
  assert.equal(click.name, 'click');
  assert.equal(click.version, '8.1.7');
  assert.deepEqual(click.files.map(file => file.sha256), [
    'ca9853ad459e787e2192211578cc907e7594e294c7ccc834310722b41b9ca6de',
    'ae74fb96c20a0277a1d615f1e4d73c8414f5a98db8b799a7931d1582f3390c28',
  ]);
  assert.equal(pipTools.kind, 'vcs');
  assert.deepEqual(pipTools.vcs, {
    type: 'git', url: 'https://github.com/jazzband/pip-tools', requestedRevision: '7.4.1', commitId: PIP_TOOLS_COMMIT, subdirectory: null,
  });
});

const LOCK_HEAD = 'lock-version = "1.0"\n';

test('the lock reader reads every valid TOML construct and refuses invalid TOML with the file, the line and the column', () => {
  assert.deepEqual(readPylock(`${LOCK_HEAD}note = """multi\nline"""\nsize = 1e3\n`, 'pylock.toml').packages, [], 'a multi-line string and a float with an exponent are valid TOML');
  assert.throws(() => readPylock(`${LOCK_HEAD}a = 1\na = 2\n`, 'pylock.toml'), /^Error: pylock\.toml line 3 column 1: Invalid TOML document: trying to redefine an already defined table or value$/);
});

test('a table under an array of the lock is refused, as TOML requires (K100)', () => {
  assert.throws(() => readPylock(`${LOCK_HEAD}a = [[1]]\n[a.x]\n`, 'pylock.toml'), /^Error: pylock\.toml line 3 column \d+: Invalid TOML document/);
});

test('an inline table of the lock that a dotted key extends is refused, as TOML requires (K113)', () => {
  assert.throws(() => readPylock(`${LOCK_HEAD}a = { b = 1 }\na.c = 2\n`, 'pylock.toml'), /^Error: pylock\.toml line 3 column \d+: Invalid TOML document/);
});

test('the review records a git pin and the lock fingerprint (K661-7)', (t) => {
  const root = withGitLock(fixture(t));
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry(FIXTURE_REGISTRY);
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const record = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  assert.deepEqual(record.vcs, [{ lock: GIT_LOCK, package: 'pip-tools', url: 'https://github.com/jazzband/pip-tools', requestedRevision: '7.4.1', commitId: PIP_TOOLS_COMMIT }]);
  assert.equal(record.locks.find(item => item.lock === GIT_LOCK)?.sha256, fileDigest(path.join(root, GIT_LOCK)));
});

test('the review names a newer PyPI release of a registry package with the uv regeneration', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, click: { '8.1.7': [{}], '8.1.8': [{}] } } });
  const result = review(root, [], stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-python\/pylock\.toml click 8\.1\.7 < 8\.1\.8: a newer stable release exists\. Fix: regenerate packages\/fixture-python\/pylock\.toml with uv: uv lock --upgrade-package click, then uv export --format pylock\.toml --frozen --no-emit-project -o packages\/fixture-python\/pylock\.toml, then make dependency-review RECORD=1\.$/m);
});

test('the review names pip lock as the regeneration of a lock that pip wrote', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  writeLock(root, lockText(root).replace('created-by = "uv"', 'created-by = "pip"'));
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, pypi: { ...FIXTURE_REGISTRY.pypi, click: { '8.1.7': [{}], '8.1.8': [{}] } } });
  const result = review(root, [], stub.env);
  assert.match(result.stdout, /click 8\.1\.7 < 8\.1\.8: a newer stable release exists\. Fix: regenerate packages\/fixture-python\/pylock\.toml with pip: pip lock, then make dependency-review RECORD=1\./);
});

test('the review reports the PyPI advisories of a registry package at its locked version', (t) => {
  const root = fixture(t);
  installCargoAuditStub(root);
  installGovulncheckStub(root);
  const stub = stubRegistries(t, root);
  stub.registry({ ...FIXTURE_REGISTRY, pypiVulnerabilities: { click: { '8.1.7': [{ id: 'GHSA-test-0001', summary: 'test advisory', link: 'https://example.org/advisory', aliases: [], fixed_in: ['8.1.8'], withdrawn: null }] } } });
  const result = review(root, ['--record'], stub.env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] packages\/fixture-python\/pylock\.toml click 8\.1\.7: advisory GHSA-test-0001 \(vulnerability\) test advisory https:\/\/example\.org\/advisory\. Fix: regenerate packages\/fixture-python\/pylock\.toml with uv:/m);
  const record = readFixture<ReviewRecord>(root, 'config/dependency-review.json');
  const locked = record.locks.find(entry => entry.lock === LOCK);
  assert.deepEqual(locked?.advisories?.map(item => [item.package, item.version, item.id]), [['click', '8.1.7', 'GHSA-test-0001']]);
});

test('the policy names a PEP 751 lock only by pylock.toml or pylock.<name>.toml, at the root or below it', () => {
  const schema = schemaFile('dependency-policy.schema.json');
  const policy = (lock: string) => ({ schema: 1, composerPlatforms: [], pythonManifests: [], pythonLocks: [{ lock, source: { requirements: "requirements.txt", constraints: "constraints.txt" } }], npmLocks: [], exceptions: [] });
  for (const lock of ['pylock.toml', 'packages/x-python/pylock.toml', 'pylock.dev.toml']) assert.deepEqual(validate(policy(lock), schema), [], lock);
  for (const lock of ['uv.lock', 'requirements.txt', 'packages/x/pylock.lock', '/pylock.toml']) assert.notDeepEqual(validate(policy(lock), schema), [], lock);
});
