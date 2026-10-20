// The requirement trace of the parity check (S6, K273): docs/spec defines each requirement once, as a list item (bulleted or numbered) **<id>** or a
// heading <id>, its id matching requirements.pattern of config/parity.json; every unit cites the requirements it tests, so
// the bindings of every implementation of its profile test each requirement of the spec. The Korean twins (*.ko.md) define
// nothing: they translate the English definitions.
//   R13 untraced-requirement  a requirement of the spec that no unit cites
//   R14 unknown-requirement   a unit cites an id that the spec does not define
//   R15 unnamed-requirement   a suite or feature unit cites an id that the test of a binding (or the vector file of a
//                             suite) does not name: a test names the requirement it tests, so a unit cannot cite them all
// A directory suite names its requirements in data (K277): each case directory of the unit holds case.json, read as JSON,
// whose `requirements` array of strings lists the ids the case tests, and other keys are ignored. A missing or malformed
// case.json is a declaration finding; an id of it that the spec does not define is R14 naming the file, reported once
// although units share the directory; a unit's cited id is named for R15 when a case.json of the unit's case set lists it.
// Only a suite or feature unit traces a requirement for R13: an api unit runs no test.
import { matchesAny } from './glob.mts';
import { finding, type Finding } from './parity-declaration.mts';

const SPEC = /^docs\/spec\/(?:.+\/)?[^/]+(?<!\.ko)\.md$/;

/** The findings of the trace of `config` against the spec among the checked `files`, read with `read`. */
export function requirementFindings(config: { requirements: { pattern: string }; implementations?: { name: string; internal?: { glob: string }[] }[]; units: { id: string; kind: string; file?: string; requirements: string[]; bindings?: { implementation: string; test: string }[] }[] }, files: Iterable<string>, read: (file: string) => string, cases: ReadonlyMap<string, string[]>): Finding[] {
  const { pattern } = config.requirements;
  const definition = new RegExp(`^\\s*(?:(?:[-*+]|\\d+[.)])\\s+\\*\\*(${pattern})\\*\\*|#{1,6}\\s+(${pattern})\\b)`);
  const listed = new Set(files);
  const defined = new Map<string, string>();
  const findings: Finding[] = [];
  for (const file of [...listed].filter(name => SPEC.test(name)).sort()) {
    for (const line of read(file).split('\n')) {
      const match = definition.exec(line);
      const id = match?.[1] ?? match?.[2];
      if (id === undefined) continue;
      const first = defined.get(id);
      if (first !== undefined) findings.push(finding('declaration', `${id} is defined in ${first} and ${file}; a requirement has one definition`));
      else defined.set(id, file);
    }
  }
  if (defined.size === 0) return [finding('declaration', `requirements.pattern ${pattern} matches no requirement of docs/spec; the spec defines each requirement as a list item **<id>** or a heading <id>`)];
  const cited = new Set<string>();
  const texts = new Map<string, string>();
  // A suite file may be a directory of case directories, which holds no text: it is read through the case.json of its cases.
  const text = (file: string) => texts.get(file) ?? (texts.set(file, listed.has(file) ? read(file) : ''), texts.get(file) ?? '');
  const caseIds = new Map<string, string[] | undefined>();
  const caseJson = (file: string) => {
    if (caseIds.has(file)) return caseIds.get(file);
    let ids: string[] | undefined;
    if (!listed.has(file)) findings.push(finding('declaration', `${file} is missing; a case of a directory suite lists the requirements it tests in its case.json`));
    else {
      let parsed: unknown;
      let valid = true;
      try { parsed = JSON.parse(read(file)); } catch (error) {
        valid = false;
        findings.push(finding('declaration', `${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
      if (valid) {
        const listing = typeof parsed === 'object' && parsed !== null && 'requirements' in parsed ? parsed.requirements : undefined;
        if (Array.isArray(listing) && listing.every((entry): entry is string => typeof entry === 'string')) {
          ids = listing;
          for (const id of ids) if (!defined.has(id)) findings.push(finding('R14', `${file} lists ${id}, which no file of docs/spec defines as a requirement (a list item **${id}** or a heading ${id})`));
        } else findings.push(finding('declaration', `${file}: requirements is no array of strings`));
      }
    }
    caseIds.set(file, ids);
    return ids;
  };
  const listedBy = (unit: { id: string; kind: string; file?: string }) => {
    const names = cases.get(unit.id);
    if (unit.kind !== 'suite' || unit.file === undefined || listed.has(unit.file) || names === undefined) return undefined;
    return new Set(names.flatMap(name => caseJson(`${unit.file}/${name}/case.json`) ?? []));
  };
  const named = (id: string, source: string) => new RegExp(`(?<![A-Za-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`).test(source);
  for (const unit of config.units) {
    const tested = unit.kind !== 'api';
    const directory = listedBy(unit);
    for (const id of unit.requirements) {
      if (tested) cited.add(id);
      if (tested && defined.has(id)) {
        const vectors = directory?.has(id) ?? (unit.kind === 'suite' && unit.file !== undefined && named(id, text(unit.file)));
        for (const binding of unit.bindings ?? []) {
          if (!vectors && !named(id, text(binding.test))) findings.push(finding('R15', `cites ${id}, which its test ${binding.test} does not name; a test names the requirement it tests`, { unit: unit.id, implementation: binding.implementation }));
        }
      }
      if (!defined.has(id)) findings.push(finding('R14', `cites ${id}, which no file of docs/spec defines as a requirement (a list item **${id}** or a heading ${id})`, { unit: unit.id }));
    }
  }
  // R16: an internal test names no requirement of the spec (K313): the tests of a requirement are the units that cite it, so a contract
  // test cannot hide among the internal tests of an implementation.
  const identifier = new RegExp(`\\b(?:${pattern})\\b`, 'g');
  for (const implementation of config.implementations ?? []) {
    const globs = (implementation.internal ?? []).map(item => item.glob);
    for (const file of [...listed].filter(name => matchesAny(globs, name)).sort()) {
      // Only a match that the spec defines is a requirement named (K342): UTF-8 and SHA-256 match a pattern such as [A-Z]+-[0-9]+ and are none.
      const named = [...read(file).matchAll(identifier)].map(match => match[0]).find(id => defined.has(id));
      if (named !== undefined) findings.push(finding('R16', `the internal test of ${implementation.name} names ${named}, a requirement of the spec; a test of a requirement is a unit that cites it, in every implementation`, { implementation: implementation.name, place: file }));
    }
  }
  for (const [id, file] of defined) if (!cited.has(id)) findings.push(finding('R13', `${file} defines ${id}, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile`));
  return findings;
}
