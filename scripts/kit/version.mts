// The versions of the registry dependencies, compared by the rules of their ecosystem: semver for npm and Go (which reads Go's
// `v` prefix, pseudo-versions and `+incompatible`), PEP 440 by @renovatebot/pep440 for PyPI. kit orders no Composer version:
// `composer outdated` judges a release (dependency-review), and a release is outdated when it is not the latest one, the rule
// of its `latest-status`.
import { explain, lt as pep440Older, valid as pep440Valid } from '@renovatebot/pep440';
import semver from 'semver';
import { present } from './present.mts';

/** An ecosystem of the registry dependencies. */
export type Ecosystem = 'npm' | 'go' | 'pypi' | 'composer';

// The version `version` of a semver ecosystem, checked; throws with the ecosystem and the version.
function semverOf(ecosystem: string, version: string): string {
  if (semver.valid(version) === null) throw new Error(`${ecosystem} version ${JSON.stringify(version)} is not a semver version`);
  return version;
}

// The version `version` of PyPI, checked; throws with the version.
function pep440Of(version: string): string {
  if (pep440Valid(version) === null) throw new Error(`PyPI version ${JSON.stringify(version)} is not a PEP 440 version`);
  return version;
}

/**
 * Whether `text` names a release version: a number, with a leading v of Composer allowed. composer outdated answers a package
 * that no repository releases (a path repository) with the sentinel "[none matched]", which is no version (K281).
 */
export const isVersionText = (text: string): boolean => /^v?\d/.test(text);

/** Whether `version` is a prerelease: a semver prerelease (a Go pseudo-version too), or a PEP 440 pre-release or dev release. */
export function isPrerelease(ecosystem: Exclude<Ecosystem, 'composer'>, version: string): boolean {
  if (ecosystem === 'pypi') return present(explain(pep440Of(version)), 'explain(pep440Of(version))').is_prerelease; // pep440Of checked that the version reads.
  return semver.prerelease(semverOf(ecosystem, version)) !== null;
}

/** Whether `current` is an older release than `latest` by the rules of `ecosystem`. */
export function older(ecosystem: Ecosystem, current: string, latest: string): boolean {
  if (ecosystem === 'composer') return current !== latest;
  if (ecosystem === 'pypi') return pep440Older(pep440Of(current), pep440Of(latest));
  return semver.lt(semverOf(ecosystem, current), semverOf(ecosystem, latest));
}

/** The stable releases of a list of npm or Go versions from a registry, highest first; a text that is no version is no release. */
export function stableDescending(ecosystem: 'npm' | 'go', versions: readonly string[]): string[] {
  return semver.rsort(versions.filter(version => semver.valid(version) !== null && !isPrerelease(ecosystem, version)));
}
