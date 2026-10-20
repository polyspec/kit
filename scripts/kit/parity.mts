#!/usr/bin/env node
// The language-parity check (`make parity-check`, `make parity-declarations-check`). config/parity.json declares the
// implementations of the repository, the one source of its language set, and the units that every implementation holds:
// vector suites, features, API symbols and the error-code catalog. The facts come from the tree, never from a flag in the declaration: the checker runs the binding of each suite
// and feature itself and keeps the ledger of the cases and test ids that ran, runs the symbol extractor of each
// implementation (parity-symbols.mts) and reads the error codes from its generated artifact.
//
//   node scripts/kit/parity.mts [--declarations] [--unit <id>]...
//     --declarations  check the declarations only: every rule except R1, R3 and R11; no binding and no extractor runs
//     --unit <id>     run only the bindings (R3) of the named units, through the same runners as a full run; the cross-unit
//                     rules (R1, R2, R4 to R11) need every unit and do not run. An id that no unit holds is an error (K221).
//                     With --declarations, the findings that name the units and those of config/parity.json itself count (K400)
//     --rule <x>      with --declarations, only the findings of the named rules count, by id (R10) or by name (docs-count), and
//                     those of config/parity.json itself (K414); a name that is neither fails the run
//
// The rules, each a finding that fails the check:
//   R1 missing-implementation  an API unit has no public symbol in an implementation, or the extractor of
//                              an implementation gives no symbols
//   R2 missing-binding         a suite or a feature has no binding of an implementation
//   R3 not-executed            a binding exits with an error, the cases that passed are not exactly the cases of the suite,
//                              the id of a feature binding did not pass once in a run of its whole test file, or the
//                              second run gives another status, case or result than the first; a run whose environment
//                              reference is unset or empty, or resolves to a path outside the checkout, cannot start
//   R4 undeclared-suite        a file of the suite globs is the file of no suite unit and lies in no case directory of one
//   R5 undeclared-test         a test file of an implementation (the convention of its runner in its roots, and its tests
//                              globs), other than a support file, is the test of no binding; a file in its roots named like
//                              a test (*_test.*, test_*.*, *Test.*, *.test.*, *.spec.*) that no convention selects is the
//                              test of no binding; or a node, php or python support file reports a case when it runs
//   R6 misplaced-test          the test of a binding lies outside the roots of its implementation, or a file of the
//                              convention or the testPatterns of a runner, other than a support file of that runner, lies
//                              outside its roots, the comparator roots and the tools roots
//   R7 error-catalog           the codes of an implementation differ from the catalog, or it declares none
//   R9 language-set-drift      a declared list of implementation names in another file differs from the implementations
//   R10 docs-count             a document counts a number of implementations that is not the number of the
//                              implementations, or lists implementations in a sentence that names not all of them
//   R11 undeclared-public      a public symbol that no API unit declares
//   R13 untraced-requirement  a requirement that docs/spec defines (a list item **<id>** or a heading <id>) and no unit cites
//   R14 unknown-requirement   a unit cites an id that docs/spec does not define (parity-requirements.mts, K273)
//   R19 spec-without-requirement  a Markdown document of docs/spec defines no requirement id, so no check sees it (K337)
//   R16 internal-contract      an internal test of an implementation (its internal globs) names a requirement of the spec (K313)
//   R17 leaked-internal        a public signature, parent or interface names an internal symbol: @internal (PHP), a _-private name (Python), a type the entry point does not export (TypeScript) (K307-1)
//   R12 duplicate-binding      a unit names one implementation twice, with its test or its symbol (the declaration check)
// A declaration that breaks the schema or names what does not exist is a finding of `declaration`, and no rule runs on it.
// Every unit holds in every implementation: there is no profile, no exclusion and no native-only symbol.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { toolsEnvironment } from './mise-tools.mts';
import { DECLARATION, RULES, finding, findingLine, implementationFolders, readDeclaration } from './parity-declaration.mts';
import type { Finding } from './parity-declaration.mts';
import { errorCatalog, readCodes } from './parity-errors.mts';
import { runBindings } from './parity-ledger.mts';
import type { Ledger } from './parity-ledger.mts';
import { extractSymbols } from './parity-symbols.mts';
import { documentCounts, languageLists } from './parity-text.mts';
import { requirementFindings } from './parity-requirements.mts';
import { misplacedTests, missingBindings, missingImplementations, undeclaredPublic, undeclaredSuites, undeclaredTests } from './parity-units.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { checkedFiles } from './tracked-files.mts';

/** A finding as parity-declaration.mts finding() makes it: the rule, the unit, implementation and place it names, and the message. */
export type ParityFinding = Finding;

/**
 * The check of the checkout at `root`: `{ findings, ledger }`, the findings in the order of the rules. `execute` runs the
 * bindings (R3) with the environment `env`; `say` prints a line for each step.
 */
export function checkParity(root: string, { execute = true, env = process.env, say = () => {}, units, rules }: { execute?: boolean; env?: NodeJS.ProcessEnv; say?: (text: string) => void; units?: string[] | undefined; rules?: string[] | undefined } = {}): { findings: ParityFinding[]; ledger: Ledger } {
  const files = new Set(checkedFiles(root));
  const ledger: Ledger = { runs: [], cases: [] };
  // Parity holds between implementations: a repository with one needs no declaration, and one with two or more fails without it.
  if (!existsSync(path.join(root, DECLARATION))) {
    const implementations = implementationFolders(files);
    if (implementations.length < 2) {
      say(`${DECLARATION} is absent, and packages/ holds ${implementations.length === 1 ? 'one implementation' : 'no implementation'}: no parity to check`);
      return { findings: [], ledger };
    }
    return { findings: [finding('declaration', `${DECLARATION} does not exist, and packages/ holds ${implementations.length} implementations (${implementations.join(', ')}); declare them and their units there (scripts/kit/schema/parity.schema.json)`)], ledger };
  }
  say(`read ${DECLARATION}`);
  const declaration = readDeclaration(root, files);
  const model = declaration.model;
  if (declaration.errors.length) return { findings: declaration.errors, ledger };
  if (model === undefined) throw new Error(`${DECLARATION}: readDeclaration returned neither errors nor a model`);
  // With --unit, only the named units run: an id that no unit holds fails the run before any binding starts (K221).
  const selected = units === undefined ? undefined : new Set(units);
  if (selected !== undefined) {
    const known = new Set(model.config.units.map((unit: { id: string }) => unit.id));
    const unknown = units?.filter(id => !known.has(id)) ?? [];
    if (unknown.length) return { findings: unknown.map(id => finding('declaration', `--unit ${id} names no unit of ${DECLARATION}`, { place: DECLARATION })), ledger };
    if (execute) say(`--unit ${[...selected].join(', ')}: only their bindings (R3) run; the cross-unit rules (R1, R2, R4 to R11) need every unit and do not run`);
    else say(`--unit ${[...selected].join(', ')}: only the findings of these units and of ${DECLARATION} itself count`);
  }
  // With --rule, a rule is named by its id or by its name in RULES; a name that is neither fails the run before any check.
  const ruleNames: Record<string, string> = RULES;
  const ruleIds = rules === undefined ? undefined : new Set(Object.keys(ruleNames).filter(id => rules.includes(id) || rules.some(rule => rule === ruleNames[id])));
  if (rules !== undefined) {
    const unknownRules = rules.filter(rule => !Object.keys(ruleNames).some(id => id === rule || ruleNames[id] === rule));
    if (unknownRules.length) return { findings: unknownRules.map(rule => finding('declaration', `--rule ${rule} names no rule of the parity check`, { place: DECLARATION })), ledger };
    say(`--rule ${rules.join(', ')}: only the findings of these rules and of ${DECLARATION} itself count`);
  }
  const { codes, findings: unreadable } = readCodes(model, root);
  if (unreadable.length) return { findings: unreadable, ledger };
  for (const tool of model.config.tools ?? []) say(`tools root ${tool.root}: ${tool.reason}`);
  const executed = execute ? runBindings(model, root, { env, files, say, units: selected }) : { ledger, findings: [] };
  if (selected !== undefined && execute) return { findings: executed.findings, ledger: executed.ledger };
  const extracted = execute ? extractSymbols(model, root, { env, say }) : { snapshots: new Map(), findings: [] };
  say('check the units against the tree');
  const findings = [
    ...extracted.findings,
    ...missingImplementations(model, extracted.snapshots),
    ...missingBindings(model),
    ...executed.findings,
    ...undeclaredSuites(model, files),
    ...undeclaredTests(model, files),
    ...misplacedTests(model, files),
    ...errorCatalog(model, codes),
    ...languageLists(model, root),
    ...documentCounts(model, root, files),
    ...undeclaredPublic(model, extracted.snapshots),
    ...requirementFindings(model.config, files, file => readFileSync(path.join(root, file), 'utf8'), model.cases),
  ];
  // The declarations of named units hold alone: a row that fixes its units passes while other units still have findings (K400).
  // The same holds for named rules; the findings of config/parity.json itself stay with either filter.
  const isDeclaration = (item: ParityFinding) => item.place?.split(':')[0] === DECLARATION;
  const named = findings.filter(item => (selected === undefined || (item.unit === undefined ? isDeclaration(item) : selected.has(item.unit))) && (ruleIds === undefined || isDeclaration(item) || ruleIds.has(item.rule)));
  return { findings: named, ledger: executed.ledger };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { declarations: { type: 'boolean' }, unit: { type: 'string', multiple: true }, rule: { type: 'string', multiple: true } } });
  const say = (text: string) => console.log(`[parity] ${text}`);
  const { findings, ledger } = checkParity(repositoryRoot(), { execute: !values.declarations, env: toolsEnvironment(repositoryRoot()), say, units: values.unit, rules: values.rule });
  if (!values.declarations) say(`${ledger.runs.length / 2} bindings ran twice, ${ledger.cases.filter(entry => entry.outcome === 'pass').length} cases passed`);
  for (const item of findings) console.error(`[parity] ${findingLine(item)}`);
  if (findings.length) console.error(`[parity] ${findings.length} findings`);
  else say(values.declarations ? 'every declaration holds' : 'every unit holds in every implementation');
  process.exitCode = findings.length ? 1 : 0;
}
