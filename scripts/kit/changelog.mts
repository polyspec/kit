// Reading a changelog: the sections `## Unreleased` and `## X.Y.Z`. `## Unreleased` is the first section and appears once;
// the released versions follow, the newest first, each once. The English and the Korean changelog have the same sections.
// Whether the newest version equals the version of the manifests is checked by the release check, which reads the manifests.

import semver from 'semver';
import { finding } from './findings.mts';
import type { Finding } from './findings.mts';
import { scanFences } from './markdown.mts';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** The `## ` headings of `text` with their lines, outside fenced blocks. */
export function sections(text: string): { title: string; line: number }[] {
  const { fenced } = scanFences(text);
  return text.split('\n').flatMap((line, index) => {
    const heading = fenced[index] ? null : /^## (.*)$/.exec(line);
    return heading ? [{ title: heading[1]!.trim(), line: index + 1 }] : []; // The group always takes part in a match.
  });
}

const changelogFinding = (line: number, message: string): Finding => finding(line, 'changelog', message);

/** The findings of one changelog `text`. */
export function changelogFindings(text: string): Finding[] {
  const found: Finding[] = [];
  const headings = sections(text);
  if (headings[0]?.title !== 'Unreleased') {
    found.push(changelogFinding(headings[0]?.line ?? 1, `the first section is ${headings[0] ? `## ${headings[0].title}` : 'missing'}; write the changes that no release contains under ## Unreleased at the top`));
  }
  const unreleased = headings.filter(heading => heading.title === 'Unreleased');
  // The length check makes the second heading exist.
  if (unreleased.length > 1) found.push(changelogFinding(unreleased[1]!.line, `## Unreleased appears ${unreleased.length} times; keep one at the top`));
  const released = headings.filter(heading => heading.title !== 'Unreleased');
  for (const heading of released) {
    if (!SEMVER.test(heading.title)) found.push(changelogFinding(heading.line, `the section ## ${heading.title} is neither ## Unreleased nor a released version X.Y.Z`));
  }
  const versions = released.filter(heading => SEMVER.test(heading.title));
  versions.slice(1).forEach((heading, index) => {
    // versions[index] precedes heading, so it exists.
    const previous = versions[index]!;
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
