// Tests of the dependencies of a wheel (wheel-dependencies.mjs): a Requires-Dist is a registry pin `name==version` or, for a
// polyspec package declared in consumers.wheel.polyspec, a direct reference to its release asset with a sha256 fragment. The
// lock of the wheel (consumers.wheel.lock, a PEP 751 pylock.toml) holds each of them with the same version, or the same URL and
// sha256. Each refusal names the requirement. The lock text is a fixture; no test reaches a network.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../../scripts/kit/digest.mjs';
import { Stop } from '../../scripts/kit/process.mjs';
import { lockProblems, lockRequirements, wheelDependencyProblems } from '../../scripts/kit/wheel-dependencies.mjs';

const LOCK = 'packages/fixture-python/pylock.wheel.toml';
const RUFF_SHA = '1'.repeat(64);
const REPO = 'https://github.com/polyspec/kit-lib';
const ASSET = 'kit_lib-0.0.1-py3-none-any.whl';
const URL = `${REPO}/releases/download/v0.0.1/${ASSET}`;
const SHA = 'a'.repeat(64);
const POLYSPEC = { 'kit-lib': REPO };
const RUFF_ENTRY = `[[packages]]
name = "ruff"
version = "0.16.10"
wheels = [{ name = "ruff-0.16.10-py3-none-any.whl", url = "https://files.pythonhosted.org/packages/ruff-0.16.10-py3-none-any.whl", hashes = { sha256 = "${RUFF_SHA}" } }]
`;
const KIT_LIB_ENTRY = `[[packages]]
name = "kit-lib"
version = "0.0.1"
archive = { url = "${URL}", hashes = { sha256 = "${SHA}" } }
`;
const HEADER = 'lock-version = "1.0"\ncreated-by = "uv"\n\n';
const LOCK_TEXT = `${HEADER}${RUFF_ENTRY}\n${KIT_LIB_ENTRY}`;
const metadata = (...requires) => ['Metadata-Version: 2.4', 'Name: kit-fixture', 'Version: 0.0.1', ...requires.map(line => `Requires-Dist: ${line}`)].join('\n') + '\n';
const problemsOf = (requires, { polyspec = POLYSPEC, lockText = LOCK_TEXT } = {}) => wheelDependencyProblems({ metadata: metadata(...requires), name: 'kit-fixture', version: '0.0.1', polyspec, lockFile: LOCK, lockText });

test('a registry pin that the lock holds at the same version is accepted', () => {
  assert.deepEqual(problemsOf(['ruff==0.16.10']), []);
});

test('a registry pin that differs from the lock is named with both versions', () => {
  assert.deepEqual(problemsOf(['ruff==0.16.9']), [`Requires-Dist ruff==0.16.9 differs from ${LOCK}: ruff is 0.16.10`]);
});

test('a dependency that the lock lacks is named', () => {
  assert.deepEqual(problemsOf(['six==1.16.0']), [`Requires-Dist six==1.16.0 has no entry in ${LOCK}. Fix: add six 1.16.0 with its files to ${LOCK}`]);
});

test('a polyspec direct reference with its fragment equal to the lock sha256 is accepted', () => {
  assert.deepEqual(problemsOf([`kit-lib @ ${URL}#sha256=${SHA}`]), []);
});

test('a polyspec reference without the sha256 fragment is refused', () => {
  assert.deepEqual(problemsOf([`kit-lib @ ${URL}`]), [`Requires-Dist kit-lib @ ${URL} has no #sha256= fragment; a polyspec package is named by its release asset and the sha256 of that asset`]);
});

test('a polyspec reference on another host or repository than the declared one is refused', () => {
  const other = `https://example.com/polyspec/kit-lib/releases/download/v0.0.1/${ASSET}#sha256=${SHA}`;
  assert.deepEqual(problemsOf([`kit-lib @ ${other}`]), [`Requires-Dist kit-lib @ ${other} is not a release asset of ${REPO}, the repository that consumers.wheel.polyspec declares for kit-lib`]);
});

test('a polyspec reference whose file name differs from its name and version is refused', () => {
  const wrong = `${REPO}/releases/download/v0.0.1/kit_other-0.0.1-py3-none-any.whl#sha256=${SHA}`;
  assert.deepEqual(problemsOf([`kit-lib @ ${wrong}`]), [`Requires-Dist kit-lib @ ${wrong}: the file kit_other-0.0.1-py3-none-any.whl of v0.0.1 is not kit_lib-0.0.1-py3-none-any.whl`]);
});

test('a polyspec reference whose version differs from the lock is named', () => {
  const next = `${REPO}/releases/download/v0.0.2/kit_lib-0.0.2-py3-none-any.whl#sha256=${SHA}`;
  assert.deepEqual(problemsOf([`kit-lib @ ${next}`]), [`${LOCK}: kit-lib is 0.0.1, the Requires-Dist kit-lib @ ${next} names 0.0.2`]);
});

test('a polyspec reference whose fragment differs from the lock sha256 is named with both digests', () => {
  const other = 'b'.repeat(64);
  assert.deepEqual(problemsOf([`kit-lib @ ${URL}#sha256=${other}`]), [`Requires-Dist kit-lib @ ${URL}#sha256=${other}: the fragment has the sha256 ${other}, ${LOCK} holds ${SHA} for kit-lib`]);
});

test('a direct reference to a name that consumers.wheel.polyspec does not declare is refused', () => {
  const undeclared = 'https://github.com/polyspec/kit-other/releases/download/v0.0.1/kit_other-0.0.1-py3-none-any.whl#sha256=' + SHA;
  assert.deepEqual(problemsOf([`kit-other @ ${undeclared}`]), [`Requires-Dist kit-other @ ${undeclared} names kit-other, which consumers.wheel.polyspec does not declare; a direct reference is accepted only for a declared polyspec package`]);
});

test('a plain pin of a declared polyspec package is refused, since its release asset is named by URL', () => {
  assert.deepEqual(problemsOf(['kit-lib==0.0.1']), ['Requires-Dist kit-lib==0.0.1 names the polyspec package kit-lib; it must be a direct reference to its release asset with a sha256 fragment']);
});

test('the forms other than name==version and a polyspec reference are refused and named', () => {
  const refused = [
    ['kit-git @ git+https://example.com/kit-git.git', 'a git source'],
    ['kit-range>=1.0', 'a range'],
    ['kit-marker==1.0.0; python_version < "3.10"', 'a marker'],
    [`kit-lib @ ${URL}#sha256=${SHA}; python_version >= "3.10"`, 'a marker'],
  ];
  for (const [line, form] of refused) {
    const [problem] = problemsOf([line]);
    assert.equal(problem, `Requires-Dist ${line} is ${form}, not name==version or a polyspec release asset with a sha256 fragment`);
  }
});

test('the lock is read as PEP 751 and refused when a package has no hash or another source', () => {
  assert.deepEqual(lockProblems(`${HEADER}${RUFF_ENTRY}`, LOCK), []);
  assert.deepEqual(lockProblems(LOCK_TEXT.replace('lock-version = "1.0"', 'lock-version = "2.0"'), LOCK), [`${LOCK}: lock-version is "2.0", PEP 751 requires "1.0"`]);
  assert.deepEqual(lockProblems(`${HEADER}${RUFF_ENTRY.replace(`, hashes = { sha256 = "${RUFF_SHA}" }`, ', hashes = {}')}`, LOCK), [`${LOCK}: ruff 0.16.10 has a file with no sha256; a consumer installs with --require-hashes`]);
  assert.deepEqual(lockProblems(`${HEADER}[[packages]]\nname = "tool"\nversion = "1.0.0"\ndirectory = { path = "." }\n`, LOCK), [`${LOCK}: tool 1.0.0 is a directory source; a consumer installs only registry files and archives`]);
});

test('lockRequirements renders each registry file and each archive as a hashed requirement for pip', () => {
  assert.equal(lockRequirements(LOCK_TEXT, LOCK), `ruff==0.16.10 --hash=sha256:${RUFF_SHA}\nkit-lib @ ${URL} --hash=sha256:${SHA}\n`);
  assert.throws(() => lockRequirements(`${HEADER}[[packages]]\nname = "tool"\nversion = "1.0.0"\ndirectory = { path = "." }\n`, LOCK), error => error instanceof Stop && error.message === `${LOCK}: tool 1.0.0 is a directory source; a consumer installs only registry files and archives`);
});

// K57: a map from the archive URL of a lock entry to a local file renders each polyspec archive as a file:// requirement with the
// hash of the lock; the file must exist and carry that sha256. The archive files are written in a temporary directory.
const localArchive = (t, bytes = 'kit-lib wheel bytes') => {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-local-archive-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, ASSET);
  writeFileSync(file, bytes);
  return { folder, file, sha: sha256(Buffer.from(bytes)) };
};
const lockOf = sha => `${HEADER}${RUFF_ENTRY}\n${KIT_LIB_ENTRY.replace(SHA, sha)}`;
const stopWith = message => error => error instanceof Stop && error.message === message;

test('lockRequirements with a map of local files renders each archive as its file:// URL with the hash of the lock', (t) => {
  const { file, sha } = localArchive(t);
  assert.equal(lockRequirements(lockOf(sha), LOCK, { [URL]: file }), `ruff==0.16.10 --hash=sha256:${RUFF_SHA}\nkit-lib @ ${pathToFileURL(file).href} --hash=sha256:${sha}\n`);
  assert.ok(pathToFileURL(file).href.startsWith('file:///'), 'an absolute path gives file:///');
});

test('without a map the archive keeps the URL of the lock', (t) => {
  const { sha } = localArchive(t);
  assert.equal(lockRequirements(lockOf(sha), LOCK), `ruff==0.16.10 --hash=sha256:${RUFF_SHA}\nkit-lib @ ${URL} --hash=sha256:${sha}\n`);
});

test('a local file whose sha256 differs from the lock fails and names the entry and both digests', (t) => {
  const { file, sha } = localArchive(t);
  const other = 'c'.repeat(64);
  assert.throws(() => lockRequirements(lockOf(other), LOCK, { [URL]: file }), stopWith(`${LOCK}: kit-lib 0.0.1: the local file ${file} of ${URL} has the sha256 ${sha}, the lock holds ${other}`));
});

test('a missing local file, a relative path and an archive without a map entry fail and name the entry', (t) => {
  const { folder, sha } = localArchive(t);
  const missing = path.join(folder, 'gone.whl');
  assert.throws(() => lockRequirements(lockOf(sha), LOCK, { [URL]: missing }), stopWith(`${LOCK}: kit-lib 0.0.1: the local file ${missing} of ${URL} is missing`));
  assert.throws(() => lockRequirements(lockOf(sha), LOCK, { [URL]: ASSET }), stopWith(`${LOCK}: kit-lib 0.0.1: the local file ${ASSET} of ${URL} is not an absolute path`));
  assert.throws(() => lockRequirements(lockOf(sha), LOCK, {}), stopWith(`${LOCK}: kit-lib 0.0.1: the archive ${URL} has no local file in the map`));
});

test('a map entry that names no archive of the lock fails and names the URL', (t) => {
  const { file, sha } = localArchive(t);
  const stray = `${REPO}/releases/download/v0.0.2/kit_lib-0.0.2-py3-none-any.whl`;
  assert.throws(() => lockRequirements(lockOf(sha), LOCK, { [URL]: file, [stray]: file }), stopWith(`${LOCK}: the map of local files names ${stray}, which is no archive of the lock`));
});

test('a sibling is never in the lock, so a map entry for the asset URL of a sibling names no archive and fails', (t) => {
  const { file, sha } = localArchive(t);
  const sibling = 'https://github.com/polyspec/kit-fixture/releases/download/v0.0.1/kit_sibling-0.0.1-py3-none-any.whl';
  assert.throws(() => lockRequirements(lockOf(sha), LOCK, { [URL]: file, [sibling]: file }), stopWith(`${LOCK}: the map of local files names ${sibling}, which is no archive of the lock`));
});
