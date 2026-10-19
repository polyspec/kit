// The requirement trace of the parity check (S6, K273): docs/spec defines each requirement once, as a bullet **<id>** or a
// heading <id>, its id matching requirements.pattern of config/parity.json; every unit cites the requirements it tests, so
// the bindings of every implementation of its profile test each requirement of the spec. The Korean twins (*.ko.md) define
// nothing: they translate the English definitions.
//   R13 untraced-requirement  a requirement of the spec that no unit cites
//   R14 unknown-requirement   a unit cites an id that the spec does not define
import { finding, type Finding } from './parity-declaration.mts';

const SPEC = /^docs\/spec\/(?:.+\/)?[^/]+(?<!\.ko)\.md$/;

/** The findings of the trace of `config` against the spec among the checked `files`, read with `read`. */
export function requirementFindings(config: { requirements: { pattern: string }; units: { id: string; requirements: string[] }[] }, files: Iterable<string>, read: (file: string) => string): Finding[] {
  const { pattern } = config.requirements;
  const definition = new RegExp(`^\\s*(?:[-*]\\s+\\*\\*(${pattern})\\*\\*|#{1,6}\\s+(${pattern})\\b)`);
  const defined = new Map<string, string>();
  const findings: Finding[] = [];
  for (const file of [...files].filter(name => SPEC.test(name)).sort()) {
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
  for (const unit of config.units) {
    for (const id of unit.requirements) {
      cited.add(id);
      if (!defined.has(id)) findings.push(finding('R14', `cites ${id}, which no file of docs/spec defines as a requirement (a bullet **${id}** or a heading ${id})`, { unit: unit.id }));
    }
  }
  for (const [id, file] of defined) if (!cited.has(id)) findings.push(finding('R13', `${file} defines ${id}, which no unit of config/parity.json cites; add the unit that tests it in every implementation of its profile`));
  return findings;
}
