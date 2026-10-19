// The requirement trace of the parity check (S6, K273): docs/spec defines each requirement once, as a bullet **<id>** or a
// heading <id>, its id matching requirements.pattern of config/parity.json; every unit cites the requirements it tests, so
// the bindings of every implementation of its profile test each requirement of the spec. The Korean twins (*.ko.md) define
// nothing: they translate the English definitions.
//   R13 untraced-requirement  a requirement of the spec that no unit cites
//   R14 unknown-requirement   a unit cites an id that the spec does not define
//   R15 unnamed-requirement   a suite or feature unit cites an id that the test of a binding (or the vector file of a
//                             suite) does not name: a test names the requirement it tests, so a unit cannot cite them all
// Only a suite or feature unit traces a requirement for R13: an api unit runs no test.
import { finding, type Finding } from './parity-declaration.mts';

const SPEC = /^docs\/spec\/(?:.+\/)?[^/]+(?<!\.ko)\.md$/;

/** The findings of the trace of `config` against the spec among the checked `files`, read with `read`. */
export function requirementFindings(config: { requirements: { pattern: string }; units: { id: string; kind: string; file?: string; requirements: string[]; bindings?: { implementation: string; test: string }[] }[] }, files: Iterable<string>, read: (file: string) => string): Finding[] {
  const { pattern } = config.requirements;
  const definition = new RegExp(`^\\s*(?:[-*]\\s+\\*\\*(${pattern})\\*\\*|#{1,6}\\s+(${pattern})\\b)`);
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
  if (defined.size === 0) return [finding('declaration', `requirements.pattern ${pattern} matches no requirement of docs/spec; the spec defines each requirement as a bullet **<id>** or a heading <id>`)];
  const cited = new Set<string>();
  const texts = new Map<string, string>();
  // A suite file may be a directory of case directories, which names no requirement as a text.
  const text = (file: string) => texts.get(file) ?? (texts.set(file, listed.has(file) ? read(file) : ''), texts.get(file) ?? '');
  const named = (id: string, source: string) => new RegExp(`(?<![A-Za-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`).test(source);
  for (const unit of config.units) {
    const tested = unit.kind !== 'api';
    for (const id of unit.requirements) {
      if (tested) cited.add(id);
      if (tested && defined.has(id)) {
        const vectors = unit.kind === 'suite' && unit.file !== undefined && named(id, text(unit.file));
        for (const binding of unit.bindings ?? []) {
          if (!vectors && !named(id, text(binding.test))) findings.push(finding('R15', `cites ${id}, which its test ${binding.test} does not name; a test names the requirement it tests`, { unit: unit.id, implementation: binding.implementation }));
        }
      }
      if (!defined.has(id)) findings.push(finding('R14', `cites ${id}, which no file of docs/spec defines as a requirement (a bullet **${id}** or a heading ${id})`, { unit: unit.id }));
    }
  }
  for (const [id, file] of defined) if (!cited.has(id)) findings.push(finding('R13', `${file} defines ${id}, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile`));
  return findings;
}
