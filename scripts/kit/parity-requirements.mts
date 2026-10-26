// The requirement trace of the parity check (S6, K273): docs/spec defines each requirement once, as a list item (bulleted or numbered) **<id>** or a
// heading <id>, its id matching requirements.pattern of config/parity.json; each shared unit cites the requirements it tests, so
// every applicable implementation tests each one, and each tool unit cites requirements tested by its native tool cases. The Korean twins (*.ko.md) define
// nothing: they translate the English definitions.
//   R13 untraced-requirement  a requirement of the spec that no unit cites
//   R14 unknown-requirement   a unit cites an id that the spec does not define
//   R15 unnamed-requirement   a suite or feature unit cites an id that the test of a binding (or the vector file of a
//                             suite) does not name: a test names the requirement it tests, so a unit cannot cite them all
//   R18 duplicate-suite       two directory suites cite a shared requirement from different case sets: one feature, one unit (K350)
// A directory suite names its requirements in data (K277): each case directory of the unit holds case.json, read as JSON,
// whose `requirements` array of strings lists the ids the case tests, and other keys are ignored. A missing or malformed
// case.json is a declaration finding; an id of it that the spec does not define is R14 naming the file, reported once
// although units share the directory; a unit's cited id is named for R15 when a case.json of the unit's case set lists it.
// Only a suite or feature unit traces a requirement for R13: an api unit runs no test.
// Each finding that names one requirement carries its id in `requirements`, and R18 carries the shared ids, so IDS selects them (K414-1).
import { matchesAny } from './glob.mts';
import { DECLARATION, finding, type Finding } from './parity-declaration.mts';

const SPEC = /^docs\/spec\/(?:.+\/)?[^/]+(?<!\.ko)\.md$/;

/** The findings of the trace of `config` against the spec among the checked `files`, read with `read`. */
export function requirementFindings(config: { requirements: { pattern: string }; implementations?: { name: string; internal?: { glob: string }[] }[]; units: { id: string; kind: string; file?: string; requirements: string[]; bindings?: { implementation: string; test: string }[] }[]; tools?: { root?: string; files?: string[]; reason: string; units?: { id: string; requirements: string[]; bindings: { test: string; id: string }[] }[] }[] }, files: Iterable<string>, read: (file: string) => string, cases: ReadonlyMap<string, string[]>): Finding[] {
  const { pattern } = config.requirements;
  const definition = new RegExp(`^\\s*(?:(?:[-*+]|\\d+[.)])\\s+\\*\\*(${pattern})\\*\\*|#{1,6}\\s+(${pattern})\\b)`);
  const listed = new Set(files);
  const defined = new Map<string, { file: string; line: number }>();
  const definers = new Set<string>();
  const findings: Finding[] = [];
  for (const file of [...listed].filter(name => SPEC.test(name)).sort()) {
    for (const [index, line] of read(file).split('\n').entries()) {
      const match = definition.exec(line);
      const id = match?.[1] ?? match?.[2];
      if (id === undefined) continue;
      definers.add(file);
      const first = defined.get(id);
      // K520: the duplicate names both places and lies on the declaration, so every filter of a scoped run keeps it.
      if (first !== undefined) findings.push(finding('declaration', `${id} is defined at ${first.file}:${first.line} and ${file}:${index + 1}; a requirement has one definition`, { place: DECLARATION }));
      else defined.set(id, { file, line: index + 1 });
    }
  }
  if (defined.size === 0) return [finding('declaration', `requirements.pattern ${pattern} matches no requirement of docs/spec; the spec defines each requirement as a list item **<id>** or a heading <id>`)];
  // R19: a document of docs/spec that defines no requirement is a finding that names it, so a tooling document cannot sit in the spec unchecked (K337).
  for (const file of [...listed].filter(name => SPEC.test(name)).sort()) if (!definers.has(file)) findings.push(finding('R19', `${file} defines no requirement; a document of docs/spec defines at least one requirement, as a list item **<id>** or a heading <id>`, { place: file }));
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
          for (const id of ids) if (!defined.has(id)) findings.push(finding('R14', `${file} lists ${id}, which no file of docs/spec defines as a requirement (a list item **${id}** or a heading ${id})`, { requirements: [id] }));
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
  const requirementUnits = [
    ...config.units,
    ...(config.tools ?? []).flatMap(tool => tool.units ?? []),
  ];
  for (const unit of requirementUnits) {
    const kind = 'kind' in unit ? unit.kind : 'tool';
    const tested = kind !== 'api';
    const directory = listedBy({ id: unit.id, kind, ...('file' in unit && unit.file !== undefined ? { file: unit.file } : {}) });
    for (const id of unit.requirements) {
      if (tested) cited.add(id);
      if (tested && defined.has(id)) {
        const vectors = directory?.has(id) ?? (kind === 'suite' && 'file' in unit && unit.file !== undefined && named(id, text(unit.file)));
        for (const binding of unit.bindings ?? []) {
          if (!vectors && !named(id, text(binding.test))) findings.push(finding('R15', `cites ${id}, which its test ${binding.test} does not name; a test names the requirement it tests`, { unit: unit.id, ...('implementation' in binding ? { implementation: binding.implementation } : {}), requirements: [id] }));
        }
      }
      if (!defined.has(id)) findings.push(finding('R14', `cites ${id}, which no file of docs/spec defines as a requirement (a list item **${id}** or a heading ${id})`, { unit: unit.id, requirements: [id] }));
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
      if (named !== undefined) findings.push(finding('R16', `the internal test of ${implementation.name} names ${named}, a requirement of the spec; a test of a requirement belongs to a feature unit`, { implementation: implementation.name, place: file, requirements: [named] }));
    }
  }
  // R18: two directory suites that cite a requirement from different case sets are one feature written twice (K350).
  const directories = config.units.flatMap(unit => {
    const names = cases.get(unit.id);
    if (unit.kind !== 'suite' || unit.file === undefined || listed.has(unit.file) || names === undefined) return [];
    return [{ unit, files: names.map(name => `${unit.file}/${name}/case.json`).sort().join('\n') }];
  });
  for (const [index, first] of directories.entries()) for (const second of directories.slice(index + 1)) {
    const shared = [...new Set(first.unit.requirements)].filter(id => second.unit.requirements.includes(id));
    if (shared.length > 0 && first.files !== second.files) findings.push(finding('R18', `${first.unit.id} and ${second.unit.id} both cite ${shared.join(', ')} from different case sets; a shared suite is one unit, so merge the two suites into one unit`, { requirements: shared }));
  }
  for (const [id, { file }] of defined) if (!cited.has(id)) findings.push(finding('R13', `${file} defines ${id}, which no unit of config/parity.json cites; add a unit that tests it`, { requirements: [id] }));
  return findings;
}
