#!/usr/bin/env node
// The language-parity check (`make parity-check`, `make parity-declarations-check`). config/parity.json declares the
// implementations of the repository, the one source of its language set, the shared units that every implementation holds,
// and requirement units owned by tooling outside that set: vector suites, features, API symbols and the error-code catalog.
// The facts come from the tree, never from a flag in the declaration: the checker runs the binding of each suite
// and feature itself and keeps the ledger of the cases and test ids that ran, runs the symbol extractor of each
// implementation (parity-symbols.mts) and reads the error codes from its generated artifact.
//
//   node scripts/kit/parity.mts [--phase all|api|bindings] [--declarations] [--unit <id>]... [--implementation <name>]...
//   node scripts/kit/parity.mts --make-targets
//     --declarations  check the declarations only: every rule except R1, R3 and R11; no binding and no extractor runs
//     --phase all      run every existing phase (the default)
//     --phase api      run public symbol extractors and all static parity rules; no native bindings run
//     --phase bindings run native bindings twice and requirement checks; public symbol extractors do not run. May select runtimes with --implementation.
//     --unit <id>     run only the bindings (R3) of the named units, through the same runners as a full run; the cross-unit
//                     rules (R1, R2, R4 to R11) need every unit and do not run. An id that no unit holds is an error (K221).
//                     With --declarations, the findings that name the units and those of config/parity.json itself count (K400),
//                     and a schema finding of config/parity.json counts only at a named unit's index (K400-1)
//     --implementation <name>  run only runtime bindings of the named implementations; support files run when --unit is absent.
//                     All implementation declarations and static checks remain global. Empty and unknown names fail (K700).
//     --rule <x>      with --declarations, only the findings of the named rules count, by id (R10) or by name (docs-count), and
//                     those of config/parity.json itself (K414); a name that is neither fails the run
//     --id <requirement>  with --declarations, only findings that name one of the requirement ids count, including R2 missing
//                     bindings of units that cite it; also keeps findings of config/parity.json itself. With --unit and --rule,
//                     the scope is their intersection;
//                     an id that no shared or tool unit cites fails the run (K414-1)
//
// The rules, each a finding that fails the check:
//   R1 missing-implementation  an API unit has no public symbol in an implementation, or the extractor of
//                              an implementation gives no symbols
//   R2 missing-binding         a suite or a feature has no binding of an implementation
//   R3 not-executed            a binding exits with an error, the cases that passed are not exactly the cases of the suite,
//                              the id of a feature binding did not pass once (Cargo runs its exact id; other file runners run the file), or the
//                              second run gives another status, case or result than the first; a run whose environment
//                              reference is unset or empty, or resolves to a path outside the checkout and the kit package
//                              in use, cannot start
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
// Unscoped units hold in every implementation. A feature owner can narrow only through a declared repository owner; there is no free-form profile.
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
import { misplacedTests, missingBindings, missingImplementations, pairs, undeclaredPublic, undeclaredSuites, undeclaredTests } from './parity-units.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { checkedFiles } from './tracked-files.mts';
import { loadConfig } from './checklist.mts';
import { isJsonList, isJsonObject, readJsonObject } from './bootstrap/files.mts';

const hasImplementationName = (value: unknown): value is { name: string } => isJsonObject(value) && typeof value.name === 'string';

/** A finding as parity-declaration.mts finding() makes it: the rule, the unit, implementation and place it names, and the message. */
export type ParityFinding = Finding;
export type ParityPhase = 'all' | 'api' | 'bindings';
const isParityPhase = (value: string): value is ParityPhase => value === 'all' || value === 'api' || value === 'bindings';

/**
 * The check of the checkout at `root`: `{ findings, ledger }`, the findings in the order of the rules. `phase: 'all'` preserves
 * the full check; `phase: 'api'` runs R1/R11 without native bindings, and `phase: 'bindings'` runs native bindings and requirement
 * checks without public symbol extraction. Together, `api` and `bindings` cover the full rule set; `execute` runs bindings (R3).
 */
export function checkParity(root: string, { execute = true, env = process.env, say = () => {}, units, rules, ids, implementations, phase = 'all' }: { execute?: boolean; env?: NodeJS.ProcessEnv; say?: (text: string) => void; units?: string[] | undefined; rules?: string[] | undefined; ids?: string[] | undefined; implementations?: string[] | undefined; phase?: ParityPhase } = {}): { findings: ParityFinding[]; ledger: Ledger } {
  const files = new Set(checkedFiles(root));
  const ledger: Ledger = { runs: [], cases: [] };
  if (!execute && phase !== 'all') return { findings: [finding('declaration', `--declarations cannot be combined with --phase ${phase}`, { place: DECLARATION })], ledger };
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
  // With --unit, the units that break the schema other than the named ones are left out, and the rules run on the rest (K517).
  const declaration = readDeclaration(root, files, units);
  const model = declaration.model;
  if (declaration.errors.length) return { findings: declaration.errors, ledger };
  const leftOut = declaration.leftOut ?? [];
  if (leftOut.length) say(`${leftOut.join(', ')} ${leftOut.length === 1 ? 'breaks' : 'break'} the schema of ${DECLARATION} and ${leftOut.length === 1 ? 'is' : 'are'} left out; the rules run on the other units`);
  if (model === undefined) throw new Error(`${DECLARATION}: readDeclaration returned neither errors nor a model`);
  const implementationSelection = implementations === undefined ? undefined : new Set(implementations);
  if (implementations !== undefined) {
    if (implementations.length === 0 || implementations.some(name => name.trim() === ''))
      return { findings: [finding('declaration', '--implementation needs one or more nonempty implementation names', { place: DECLARATION })], ledger };
    const duplicates = [...new Set(implementations.filter((name, index) => implementations.indexOf(name) !== index))];
    if (duplicates.length) return { findings: [finding('declaration', `--implementation repeats ${duplicates.join(', ')}`, { place: DECLARATION })], ledger };
    const known = new Set(model.config.implementations.map(implementation => implementation.name));
    const unknown = implementations.filter(name => !known.has(name));
    if (unknown.length) return { findings: unknown.map(name => finding('declaration', `--implementation ${name} names no implementation of ${DECLARATION}`, { place: DECLARATION })), ledger };
    say(execute
      ? phase === 'bindings'
        ? `--implementation ${implementations.join(', ')}: only their runtime bindings and missing-binding checks run; requirement checks stay global`
        : `--implementation ${implementations.join(', ')}: only their runtime bindings run, and their support files run when --unit is absent; implementation declarations and static checks stay global`
      : `--implementation ${implementations.join(', ')}: declarations and static checks still cover every implementation; no runtime bindings run`);
  }
  if (phase === 'api' && implementations !== undefined) return { findings: [finding('declaration', '--phase api extracts every implementation; --implementation is only valid with --phase bindings', { place: DECLARATION })], ledger };
  // With --unit, only the named units run: an id that no unit holds fails the run before any binding starts (K221).
  const selected = units === undefined ? undefined : new Set(units);
  if (selected !== undefined) {
    const known = new Set(model.config.units.map((unit: { id: string }) => unit.id));
    const unknown = units?.filter(id => !known.has(id)) ?? [];
    if (unknown.length) return { findings: unknown.map(id => finding('declaration', `--unit ${id} names no unit of ${DECLARATION}`, { place: DECLARATION })), ledger };
    if (execute) say(`--unit ${[...selected].join(', ')}: only their bindings (R3) run; the cross-unit rules (R1, R2, R4 to R11) need every unit and do not run`);
    else say(`--unit ${[...selected].join(', ')}: only the findings of these units and of ${DECLARATION} itself count`);
  }
  if (execute && implementationSelection !== undefined) {
    const applicable = [...pairs(model, 'suite'), ...pairs(model, 'feature')]
      .some(({ unit, implementation }) => implementationSelection.has(implementation.name) && (selected === undefined || selected.has(unit.id))
        && unit.bindings?.some(binding => binding.implementation === implementation.name));
    if (!applicable) return { findings: [finding('declaration', `--implementation ${implementations?.join(', ')} selects no runtime bindings${units === undefined ? '' : ` in --unit ${units.join(', ')}`}`, { place: DECLARATION })], ledger };
  }
  // With --rule, a rule is named by its id or by its name in RULES; a name that is neither fails the run before any check.
  const ruleNames: Record<string, string> = RULES;
  const ruleIds = rules === undefined ? undefined : new Set(Object.keys(ruleNames).filter(id => rules.includes(id) || rules.some(rule => rule === ruleNames[id])));
  if (rules !== undefined) {
    const unknownRules = rules.filter(rule => !Object.keys(ruleNames).some(id => id === rule || ruleNames[id] === rule));
    if (unknownRules.length) return { findings: unknownRules.map(rule => finding('declaration', `--rule ${rule} names no rule of the parity check`, { place: DECLARATION })), ledger };
    say(`--rule ${rules.join(', ')}: only the findings of these rules and of ${DECLARATION} itself count`);
  }
  const idSet = ids === undefined ? undefined : new Set(ids);
  const traceRequirements = () => {
    const heldUnits = new Set<string>();
    const findings = requirementFindings(
      model.config,
      files,
      file => readFileSync(path.join(root, file), 'utf8'),
      model.cases,
      model.config.deferredRequirements?.length ? loadConfig(root).idPattern : undefined,
      entry => {
        if (ids === undefined || ids.includes(entry.id)) say(`DEFERRED ${entry.id}: held by ${entry.item} in ${entry.checklist}`);
      },
      unit => heldUnits.add(unit),
    );
    return { findings, heldUnits };
  };
  const reportHeldUnits = (heldUnits: Set<string>) => {
    for (const unit of heldUnits) if (selected === undefined || selected.has(unit)) say(`HELD ${unit}: its requirements are deferred; no runtime bindings execute`);
  };
  const sharedFindings = (codes: ReturnType<typeof readCodes>['codes'], snapshots: ReturnType<typeof extractSymbols>['snapshots'], beforeUndeclared: ParityFinding[] = []) => [
    ...missingBindings(model),
    ...beforeUndeclared,
    ...undeclaredSuites(model, files),
    ...undeclaredTests(model, files),
    ...misplacedTests(model, files),
    ...errorCatalog(model, codes),
    ...languageLists(model, root),
    ...documentCounts(model, root, files),
    ...undeclaredPublic(model, snapshots),
  ];
  const matchesSelection = (item: ParityFinding) => {
    const isDeclaration = item.place?.split(':')[0] === DECLARATION;
    return (selected === undefined || (item.unit === undefined ? isDeclaration : selected.has(item.unit)))
      && (ruleIds === undefined || isDeclaration || ruleIds.has(item.rule))
      && (idSet === undefined || isDeclaration || (item.requirements ?? []).some(id => idSet.has(id)));
  };
  // With --id, a requirement is named by its id; an id that no shared or tool unit of the declaration cites fails the run before any check (K414-1).
  if (ids !== undefined) {
    const cited = new Set([
      ...model.config.units.flatMap(unit => unit.requirements),
      ...(model.config.tools ?? []).flatMap(tool => (tool.units ?? []).flatMap(unit => unit.requirements)),
      ...(model.config.deferredRequirements ?? []).map(item => item.id),
    ]);
    const unknownIds = ids.filter(id => !cited.has(id));
    if (unknownIds.length) return { findings: unknownIds.map(id => finding('declaration', `--id ${id} names no requirement that a unit of ${DECLARATION} cites`, { place: DECLARATION })), ledger };
    say(`--id ${ids.join(', ')}: only the findings that name these requirements, and of ${DECLARATION} itself, count`);
  }
  if (phase === 'api') {
    say('API phase: validate public symbols and all static parity rules; native bindings do not run');
    const extracted = extractSymbols(model, root, { env, say });
    const { codes, findings: unreadable } = readCodes(model, root);
    if (unreadable.length) return { findings: unreadable, ledger };
    const { findings: requirementTraceFindings } = traceRequirements();
    const findings = [
      ...extracted.findings,
      ...missingImplementations(model, extracted.snapshots, extracted.entrySnapshots),
      ...sharedFindings(codes, extracted.snapshots),
      ...requirementTraceFindings,
    ].filter(matchesSelection);
    return { findings, ledger };
  }
  if (phase === 'bindings') {
    if (!execute) return { findings: [finding('declaration', '--phase bindings requires native binding execution; do not use --declarations', { place: DECLARATION })], ledger };
    say(`bindings phase${implementations === undefined ? '' : ` for ${implementations.join(', ')}`}: native bindings run twice; public symbol extraction is skipped`);
    const { findings: requirementTraceFindings, heldUnits } = traceRequirements();
    reportHeldUnits(heldUnits);
    const executed = runBindings(model, root, { env, files, say, units: selected, implementations: implementationSelection, heldUnits });
    const missing = missingBindings(model).filter(item => implementationSelection === undefined || implementationSelection.has(item.implementation ?? ''));
    const findings = [...missing, ...executed.findings, ...requirementTraceFindings]
      .filter(matchesSelection);
    return { findings, ledger: executed.ledger };
  }
  const { codes, findings: unreadable } = readCodes(model, root);
  if (unreadable.length) return { findings: unreadable, ledger };
  const { findings: requirementTraceFindings, heldUnits } = traceRequirements();
  reportHeldUnits(heldUnits);
  for (const tool of model.config.tools ?? []) say(tool.root === undefined
    ? `tools exact files ${(tool.files ?? []).join(', ')}: ${tool.reason}`
    : `tools root ${tool.root}: ${tool.reason}`);
  const executed = execute ? runBindings(model, root, { env, files, say, units: selected, implementations: implementationSelection, heldUnits }) : { ledger, findings: [] };
  if (selected !== undefined && execute) return { findings: [...executed.findings, ...requirementTraceFindings.filter(item => item.unit !== undefined && selected.has(item.unit))], ledger: executed.ledger };
  const extracted = execute ? extractSymbols(model, root, { env, say }) : { snapshots: new Map(), entrySnapshots: new Map(), findings: [] };
  say('check the units against the tree');
  const findings = [
    ...extracted.findings,
    ...missingImplementations(model, extracted.snapshots, extracted.entrySnapshots),
    ...sharedFindings(codes, extracted.snapshots, executed.findings),
    ...requirementTraceFindings,
  ];
  // The declarations of named units hold alone: a row that fixes its units passes while other units still have findings (K400).
  // The same holds for named rules and requirement ids (K414-1); the findings of config/parity.json itself stay with any filter.
  const named = findings.filter(matchesSelection);
  return { findings: named, ledger: executed.ledger };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { declarations: { type: 'boolean' }, phase: { type: 'string' }, unit: { type: 'string', multiple: true }, implementation: { type: 'string', multiple: true }, rule: { type: 'string', multiple: true }, id: { type: 'string', multiple: true }, 'make-targets': { type: 'boolean' } } });
  const say = (text: string) => console.log(`[parity] ${text}`);
  if (values['make-targets']) {
    try {
      // Make target generation needs only safe implementation names. Full declaration validation belongs to
      // parity-declarations-check, where scoped unit checks may intentionally tolerate other schema findings.
      const declaration = readJsonObject(repositoryRoot(), DECLARATION);
      const entries = declaration.implementations;
      if (!isJsonList(entries)) {
        throw new Error(`${DECLARATION} has no usable implementation names`);
      }
      const names: string[] = [];
      for (const entry of entries) {
        if (!hasImplementationName(entry)) throw new Error(`${DECLARATION} has no usable implementation names`);
        names.push(entry.name);
      }
      if (new Set(names).size !== names.length || names.some(name => !/^[a-z][a-z0-9-]*$/.test(name))) throw new Error(`${DECLARATION} has no usable unique implementation names`);
      console.log(names.join(' '));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error(`[parity] ${error.message}`);
      process.exitCode = 1;
    }
  } else {
    const phase = values.phase ?? 'all';
    if (!isParityPhase(phase)) {
      console.error(`[parity] --phase ${phase} is unknown; choose all, api, or bindings`);
      process.exitCode = 1;
    } else {
      const selectedPhase = phase;
      const { findings, ledger } = checkParity(repositoryRoot(), { execute: !values.declarations, env: toolsEnvironment(repositoryRoot()), say, units: values.unit, rules: values.rule, ids: values.id, implementations: values.implementation, phase: selectedPhase });
      if (selectedPhase === 'api' && !values.declarations) say('API phase ran no native bindings');
      else if (!values.declarations) say(`${ledger.runs.length / 2} bindings ran twice, ${ledger.cases.filter(entry => entry.outcome === 'pass').length} cases passed`);
      for (const item of findings) console.error(`[parity] ${findingLine(item)}`);
      if (findings.length) console.error(`[parity] ${findings.length} findings`);
      else if (selectedPhase === 'api') say('API phase passed; native bindings were not run, so this is not a full parity pass');
      else if (selectedPhase === 'bindings') say('bindings phase passed; public API extraction was not run, so this is not a full parity pass');
      else say(values.declarations ? 'every declaration holds' : values.implementation === undefined ? 'every applicable unit holds' : 'selected runtime bindings and applicable declarations hold');
      process.exitCode = findings.length ? 1 : 0;
    }
  }
}
