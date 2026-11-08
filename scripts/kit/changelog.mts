// Reading a changelog: the sections `## Unreleased` and `## X.Y.Z`. The format rules of a changelog are the repository's own: it
// names the ones it keeps in `changelogRules` of config/documents.json (K1084), and a rule it does not name is not judged. The
// English and the Korean changelog have the same sections. Whether the newest version equals the version of the manifests is
// checked by the release check, which reads the manifests.

import semver from 'semver';
import { finding } from './findings.mts';
import type { Finding } from './findings.mts';
import { headings } from './markdown.mts';
import { present } from './present.mts';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** The level-2 headings of `text` with their lines, as the Markdown tree reads them (markdown.mts). */
export function sections(text: string): { title: string; line: number }[] {
  return headings(text).filter(heading => heading.depth === 2).map(({ title, line }) => ({ title, line }));
}

const changelogFinding = (line: number, message: string): Finding => finding(line, 'changelog', message);

/**
 * The rules of a changelog that a repository can name in `changelogRules` of config/documents.json (K1084): four format rules that
 * check-documents judges, and `unreleased-empty-at-release`, under which release-tag refuses a commit whose ## Unreleased holds an
 * entry (release-run.mts).
 */
export const CHANGELOG_RULES = ['unreleased-first', 'unreleased-once', 'versions-only', 'newest-first', 'unreleased-empty-at-release'] as const;
export type ChangelogRule = (typeof CHANGELOG_RULES)[number];

/** The findings of one changelog `text` under the rules `rules` that the repository names; no rule judges nothing (K1084). */
export function changelogFindings(text: string, rules: readonly string[] = []): Finding[] {
  const found: Finding[] = [];
  const headings = sections(text);
  if (rules.includes('unreleased-first') && headings[0]?.title !== 'Unreleased') {
    found.push(changelogFinding(headings[0]?.line ?? 1, `the first section is ${headings[0] ? `## ${headings[0].title}` : 'missing'}; write the changes that no release contains under ## Unreleased at the top`));
  }
  const unreleased = headings.filter(heading => heading.title === 'Unreleased');
  // The length check makes the second heading exist.
  if (rules.includes('unreleased-once') && unreleased.length > 1) found.push(changelogFinding(present(unreleased[1], 'unreleased[1]').line, `## Unreleased appears ${unreleased.length} times; keep one at the top`));
  const released = headings.filter(heading => heading.title !== 'Unreleased');
  if (rules.includes('versions-only')) {
    for (const heading of released) {
      if (!SEMVER.test(heading.title)) found.push(changelogFinding(heading.line, `the section ## ${heading.title} is neither ## Unreleased nor a released version X.Y.Z`));
    }
  }
  if (!rules.includes('newest-first')) return found;
  const versions = released.filter(heading => SEMVER.test(heading.title));
  versions.slice(1).forEach((heading, index) => {
    // versions[index] precedes heading, so it exists.
    const previous = present(versions[index], 'versions[index]');
    // Every title of versions matches SEMVER, so semver reads it.
    if (semver.compare(previous.title, heading.title) <= 0) found.push(changelogFinding(heading.line, `the section ## ${heading.title} follows ## ${previous.title}; the newer version comes first and each version appears once`));
  });
  return found;
}

/** The findings of the Korean changelog `korean` against the English one `english`: the same sections in the same order. */
export function changelogPairFindings(english: string, korean: string): Finding[] {
  const en = sections(english).map(heading => heading.title);
  const ko = sections(korean).map(heading => heading.title);
  if (en.join('\n') === ko.join('\n')) return [];
  return [changelogFinding(1, `the sections ${ko.map(title => `## ${title}`).join(', ') || 'none'} differ from the sections ${en.map(title => `## ${title}`).join(', ') || 'none'} of the English file`)];
}
