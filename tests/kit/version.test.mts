// Tests of the version comparison of the dependency review and gate: each ecosystem compares by its own rules, semver for
// npm and Go and PEP 440 for PyPI; a Composer release is outdated when it is not the latest, as composer outdated judges.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrerelease, older, stableDescending } from '../../scripts/kit/version.mts';

test('npm and Go versions compare by semver, a prerelease before its release (K115)', () => {
  assert.equal(older('npm', '9.0.0-beta.1', '9.0.0'), true, 'a prerelease is older than its release');
  assert.equal(older('npm', '9.0.0', '9.0.0'), false);
  assert.equal(older('npm', '10.0.0', '9.9.9'), false);
  assert.equal(isPrerelease('npm', '10.0.0-rc.2'), true);
  assert.equal(isPrerelease('npm', '10.0.0'), false);
  assert.equal(older('go', 'v1.2.3', 'v1.10.0'), true);
  assert.equal(older('go', 'v0.0.0-20210101000000-abcdefabcdef', 'v0.1.0'), true);
  assert.equal(isPrerelease('go', 'v0.0.0-20210101000000-abcdefabcdef'), true, 'a pseudo-version is a prerelease');
  assert.equal(isPrerelease('go', 'v2.0.0+incompatible'), false);
  assert.deepEqual(stableDescending('npm', ['1.2.0', '1.10.0', '2.0.0-rc.1', '1.9.0']), ['1.10.0', '1.9.0', '1.2.0']);
  assert.deepEqual(stableDescending('go', ['v1.2.0', 'v1.10.0', 'v2.0.0-rc.1']), ['v1.10.0', 'v1.2.0']);
});

test('PyPI versions compare by PEP 440 (K115)', () => {
  assert.equal(older('pypi', '3.9', '3.11'), true, '3.11 is newer than 3.9');
  assert.equal(older('pypi', '3.11', '3.9'), false);
  assert.equal(older('pypi', '2.1', '2.1.0'), false, 'a missing segment is zero');
  assert.equal(older('pypi', '1.0', '1.0.post1'), true, 'a post-release is newer');
  assert.equal(older('pypi', '1.0.post1', '1.0'), false);
  assert.equal(older('pypi', '3.7.4', '3.7.4.1'), true, 'a fourth segment counts');
  for (const version of ['1.1.0rc1', '3.0b1', '0.6.4.dev1']) assert.equal(isPrerelease('pypi', version), true, version);
  assert.equal(isPrerelease('pypi', '1.0.post1'), false);
});

test('a Composer release is outdated when it is not the latest release, as composer outdated judges', () => {
  assert.equal(older('composer', 'v1.2.3', 'v1.2.3'), false);
  assert.equal(older('composer', 'v1.2.3', 'v1.3.0'), true);
});

test('a version that the ecosystem does not read fails with the ecosystem and the version', () => {
  assert.throws(() => older('npm', 'not a version', '1.0.0'), /npm version "not a version" is not a semver version/);
  assert.throws(() => older('pypi', '1.0', 'x.y'), /PyPI version "x\.y" is not a PEP 440 version/);
});
