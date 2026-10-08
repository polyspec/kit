// Reading a changelog: the sections `## Unreleased` and `## X.Y.Z`. `## Unreleased` is the first section and appears once;
// the released versions follow, the newest first, each once. The English and the Korean changelog have the same sections.
// Whether the newest version equals the version of the manifests is checked by the release check, which reads the manifests.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const compare = (a, b) => {
  const [x, y] = [SEMVER.exec(a).slice(1).map(Number), SEMVER.exec(b).slice(1).map(Number)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** The `## ` headings of `text` with their lines, outside fenced blocks. */
export function sections(text) {
  const result = [];
  let fence = null;
  text.split('\n').forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker && (!fence || marker[1][0] === fence)) fence = fence ? null : marker[1][0];
    else if (!fence) {
      const heading = /^## (.*)$/.exec(line);
      if (heading) result.push({ title: heading[1].trim(), line: index + 1 });
    }
  });
  return result;
}

const finding = (line, message) => ({ line, column: 1, rule: 'changelog', message });

/** The findings of one changelog `text`. */
export function changelogFindings(text) {
  const found = [];
  const headings = sections(text);
  if (headings[0]?.title !== 'Unreleased') {
    found.push(finding(headings[0]?.line ?? 1, `the first section is ${headings[0] ? `## ${headings[0].title}` : 'missing'}; write the changes that no release contains under ## Unreleased at the top`));
  }
  const unreleased = headings.filter(heading => heading.title === 'Unreleased');
  if (unreleased.length > 1) found.push(finding(unreleased[1].line, `## Unreleased appears ${unreleased.length} times; keep one at the top`));
  const released = headings.filter(heading => heading.title !== 'Unreleased');
  for (const heading of released) {
    if (!SEMVER.test(heading.title)) found.push(finding(heading.line, `the section ## ${heading.title} is neither ## Unreleased nor a released version X.Y.Z`));
  }
  const versions = released.filter(heading => SEMVER.test(heading.title));
  versions.slice(1).forEach((heading, index) => {
    if (compare(versions[index].title, heading.title) <= 0) found.push(finding(heading.line, `the section ## ${heading.title} follows ## ${versions[index].title}; the newer version comes first and each version appears once`));
  });
  return found;
}

/** The findings of the Korean changelog `korean` against the English one `english`: the same sections in the same order. */
export function changelogPairFindings(english, korean) {
  const en = sections(english).map(heading => heading.title);
  const ko = sections(korean).map(heading => heading.title);
  if (en.join('\n') === ko.join('\n')) return [];
  return [finding(1, `the sections ${ko.map(title => `## ${title}`).join(', ') || 'none'} differ from the sections ${en.map(title => `## ${title}`).join(', ') || 'none'} of the English file`)];
}
