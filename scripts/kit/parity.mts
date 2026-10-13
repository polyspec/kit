#!/usr/bin/env node
// The language-parity check (`make parity-check`, `make parity-declarations-check`). config/parity.json declares the
// implementations of the repository, the one source of its language set, the profiles that group them and the units that
// every implementation of a profile holds: vector suites, features, API symbols, the error-code catalog, native-only symbols and
// exclusions. The facts come from the tree, never from a flag in the declaration: the checker runs the binding of each suite
// and feature itself and keeps the ledger of the cases and test ids that ran, runs the symbol extractor of each
// implementation (parity-symbols.mts) and reads the error codes from its generated artifact.
//
//   node scripts/kit/parity.mts [--declarations]
//     --declarations  check the declarations only: every rule except R1, R3 and R11; no binding and no extractor runs
//
// The rules, each a finding that fails the check:
//   R1 missing-implementation  an API unit has no public symbol in an implementation of its profile, or the extractor of
//                              an implementation gives no symbols
//   R2 missing-binding         a suite or a feature has no binding of an implementation of its profile
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
//   R8 exclusion               an exclusion: it never counts as holding the unit
//   R9 language-set-drift      a declared list of implementation names in another file differs from its profile
//   R10 docs-count             a document counts implementations that no profile of that count holds, or lists
//                              implementations in a sentence whose names are no profile
//   R11 undeclared-public      a public symbol that no API unit and no native-only entry declares, or a native-only entry
//                              that names no public symbol
// A declaration that breaks the schema or names what does not exist is a finding of `declaration`, and no rule runs on it.
// A permanent difference, a profile narrower than every implementation or a native-only entry, cites in spec the anchors of
// the spec that make it one (contracts/…#id or docs/spec/…#id); an anchor that does not resolve is a `declaration` finding.
import { parseArgs } from 'node:util';
import { DECLARATION, findingLine, readDeclaration } from './parity-declaration.mts';
import type { Finding } from './parity-declaration.mts';
import { errorCatalog, readCodes } from './parity-errors.mts';
import { runBindings } from './parity-ledger.mts';
import type { Ledger } from './parity-ledger.mts';
import { extractSymbols } from './parity-symbols.mts';
import { documentCounts, languageLists } from './parity-text.mts';
import { exclusions, misplacedTests, missingBindings, missingImplementations, undeclaredPublic, undeclaredSuites, undeclaredTests } from './parity-units.mts';
import { isMain, ROOT } from './paths.mts';
import { checkedFiles } from './tracked-files.mts';

/** A finding as parity-declaration.mts finding() makes it: the rule, the unit, implementation and place it names, and the message. */
export type ParityFinding = Finding;

/**
 * The check of the checkout at `root`: `{ findings, ledger }`, the findings in the order of the rules. `execute` runs the
 * bindings (R3) with the environment `env`; `say` prints a line for each step.
 */
export function checkParity(root: string, { execute = true, env = process.env, say = () => {} }: { execute?: boolean; env?: NodeJS.ProcessEnv; say?: (text: string) => void } = {}): { findings: ParityFinding[]; ledger: Ledger } {
  const files = new Set(checkedFiles(root));
  say(`read ${DECLARATION}`);
  const declaration = readDeclaration(root, files);
  const model = declaration.model;
  const ledger: Ledger = { runs: [], cases: [] };
  if (declaration.errors.length) return { findings: declaration.errors, ledger };
  if (model === undefined) throw new Error(`${DECLARATION}: readDeclaration returned neither errors nor a model`);
  const { codes, findings: unreadable } = readCodes(model, root);
  if (unreadable.length) return { findings: unreadable, ledger };
  for (const profile of model.narrow) say(`profile ${profile.name} omits ${profile.omitted.join(', ')}: ${profile.reason}`);
  for (const tool of model.config.tools ?? []) say(`tools root ${tool.root}: ${tool.reason}`);
  for (const unit of model.config.units.filter((entry: { kind: string; admit?: string }) => entry.kind === 'suite' && entry.admit !== undefined)) {
    for (const entry of model.notAdmitted(unit)) say(`unit ${unit.id} does not run ${entry.name} for ${entry.omitted.join(', ')}: ${unit.admit} lists ${entry.list.join(', ')}`);
  }
  const executed = execute ? runBindings(model, root, { env, files, say }) : { ledger, findings: [] };
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
    ...exclusions(model),
    ...languageLists(model, root),
    ...documentCounts(model, root, files),
    ...undeclaredPublic(model, extracted.snapshots),
  ];
  return { findings, ledger: executed.ledger };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { declarations: { type: 'boolean' } } });
  const say = (text: string) => console.log(`[parity] ${text}`);
  const { findings, ledger } = checkParity(ROOT, { execute: !values.declarations, say });
  if (!values.declarations) say(`${ledger.runs.length / 2} bindings ran twice, ${ledger.cases.filter(entry => entry.outcome === 'pass').length} cases passed`);
  for (const item of findings) console.error(`[parity] ${findingLine(item)}`);
  if (findings.length) console.error(`[parity] ${findings.length} findings`);
  else say(values.declarations ? 'every declaration holds' : 'every unit holds in every implementation');
  process.exitCode = findings.length ? 1 : 0;
}
