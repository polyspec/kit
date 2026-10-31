// R3 of the language-parity check: the checker runs the binding of every suite and feature unit in each applicable implementation
// and keeps, in memory, the ledger of the runs and of the cases that each run reported. A suite binding holds its unit
// when its command exits with 0 and the cases that passed are exactly the cases of the suite file: a failed, skipped, missing or
// extra case is a finding. A feature binding holds its unit when its native id passes once in one successful run; Cargo
// filters that id exactly, while file-based runners run the test file. Each binding runs once (K959): fixed seeds and isolated
// databases make a run deterministic, and a test that is not is a defect of the test. No saved report is read. The environment references of the runner values resolve here, and a run whose
// reference is unset or empty cannot start. Each support file of a file runner (node, php, python) runs once, and one that
// reports a case is an R5 finding.
import type { SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import { execute } from './process.mts';
import { finding, resolveCommand, resolveReferences, supportFiles } from './parity-declaration.mts';
import type { Environment, Finding, ParityImplementation, ParityModel, Runner } from './parity-declaration.mts';
import { outcomesOf, runOf } from './parity-runners.mts';
import type { BindingCommand, Outcome, RunError, RunKind, RunTarget } from './parity-runners.mts';
import { pairs } from './parity-units.mts';
import { present } from './present.mts';

/** A run with `shown`, its command line as declared, or a run that cannot start. */
type ResolvedRun = (BindingCommand & { shown: string }) | RunError;

/** A run of the ledger. */
export interface LedgerRun {
  unit: string;
  implementation: string;
  command: string;
  args: string[];
  cwd: string;
  status: number | null;
}

/** A case of the ledger, with its outcome. */
export interface LedgerCase {
  unit: string;
  implementation: string;
  case: string;
  outcome: string;
}

/** The ledger of the runs and the cases of the bindings. */
export interface Ledger {
  runs: LedgerRun[];
  cases: LedgerCase[];
}

/** The run of a binding. */
interface Attempt {
  result: SpawnSyncReturns<string>;
  status: number | null;
  cases: Map<string, Outcome>;
  repeated: string[];
  reportError?: string;
}

/** The names of `cases` (a map from case to outcome) whose outcome is `outcome`. */
const named = (cases: Map<string, Outcome>, outcome: Outcome) => [...cases].filter(([, value]) => value === outcome).map(([name]) => name);

/** The names that `reported` (the `[name, outcome]` pairs of the run, in order) report more than once. */
const repeated = (reported: [string, Outcome][]) => [...new Set(reported.map(([name]) => name).filter((name, index, names) => names.indexOf(name) !== index))];

/**
 * The run of `binding` in the implementation `declared` with its environment references resolved from `env`: the run of
 * runOf, with `shown`, the command line as declared (a reference is printed, never its value), or `{ error }`.
 */
function resolvedRun(declared: ParityImplementation, root: string, binding: RunTarget, kind: RunKind, env: Environment): ResolvedRun {
  const { implementation, errors } = resolveReferences(declared, env, root);
  const command = binding.command === undefined ? undefined : resolveCommand(binding.command, env, root);
  const args = binding.args === undefined ? undefined : resolveCommand(binding.args, env, root, 'binding args');
  const failures = [...errors, ...command?.errors ?? [], ...args?.errors ?? []];
  if (failures.length) return { error: `cannot start: ${failures.join('; ')}` };
  const run = runOf(implementation, root, { ...binding, command: command?.command, args: args?.command }, kind, env);
  if (run.error) return run;
  const shown = runOf(declared, root, binding, kind, env);
  // The runner of a binding does not read the references, so the declared run starts where the resolved run does.
  if (shown.error) {
    throw new Error(`${declared.name}: the run as declared cannot start while the resolved run starts: ${shown.error}`);
  }
  // The program of a binding with its own runner is that runner's, as runOf gives it.
  return { ...run, shown: [binding.command?.[0] ?? (binding.runner === undefined ? declared.command : undefined) ?? shown.command, ...shown.args].join(' ') };
}

// The runners whose support files the check runs: a file runner reports its cases by printing them, so a support file of one
// could hold a test that no declaration shows.
const FILE_RUNNERS = new Set(['node', 'php', 'python']);

/** R5 of the support files: each support file of a node, php or python implementation runs once and reports no case. */
function runSupport(model: ParityModel, root: string, files: Set<string>, { env, say, implementations }: { env: Environment; say: (line: string) => void; implementations?: ReadonlySet<string> | undefined }): Finding[] {
  return model.config.implementations.filter(implementation => (implementations === undefined || implementations.has(implementation.name)) && FILE_RUNNERS.has(implementation.runner)).flatMap(implementation => supportFiles(implementation, files).flatMap((file) => {
    const where = { implementation: implementation.name, place: file };
    const run = resolvedRun(implementation, root, { test: file }, 'suite', env);
    if (run.error) return [finding('R3', run.error, where)];
    say(`run the support file ${file} of ${implementation.name}: ${run.shown} (in ${run.cwd})`);
    const result = execute(run.command, run.args, { cwd: path.join(root, run.cwd), env: run.env });
    if (result.error) return [finding('R5', `the support file could not run: ${run.shown}: ${result.error.message}`, where)];
    const reported = outcomesOf(run, result).map(([name]) => name);
    return reported.length ? [finding('R5', `the support file reports cases (${reported.join(', ')}); declare it as the test of a binding`, where)] : [];
  }));
}

/**
 * The run of `run`, recorded in `ledger.runs` under `unit` and `implementation`, with `say` printing the step; a reported name
 * that `group` holds is a group of cases, not a case.
 */
function once(run: BindingCommand & { shown: string }, root: string, where: { unit: string; implementation: string }, ledger: { runs: LedgerRun[] }, say: (line: string) => void, group: (name: string) => boolean = () => false): Attempt {
  say(`run ${where.unit} ${where.implementation}: ${run.shown} (in ${run.cwd})`);
  const result = execute(run.command, run.args, { cwd: path.join(root, run.cwd), env: run.env });
  const status = result.error ? null : result.status;
  let reported: [string, Outcome][] = [];
  let reportError: string | undefined;
  if (!result.error) {
    try { reported = outcomesOf(run, result).filter(([name]) => !group(name)); }
    // catch-any -- Malformed child output is a binding finding, not a reason to abort the remaining bindings.
    catch (error) {
      reportError = error instanceof Error ? error.message : String(error);
    }
  }
  ledger.runs.push({ ...where, command: run.command, args: run.args, cwd: run.cwd, status });
  return { result, status, cases: new Map(reported), repeated: repeated(reported), ...(reportError === undefined ? {} : { reportError }) };
}

/** The last 20 non-blank lines of a run's standard output and then its standard error, joined by ' | ' (K215). */
const lastLines = ({ stdout, stderr }: { stdout: string; stderr: string }): string => [stdout ?? '', stderr ?? ''].join('\n').split('\n').filter(line => line.trim()).slice(-20).join(' | ');

/**
 * R3 of the feature units: each test file runs once for the native ids that bind it in its implementation, and each id passes
 * once, with the run exiting 0.
 */
function runFeatures(model: ParityModel, root: string, ledger: Ledger, { env, say, units, implementations, heldUnits }: { env: Environment; say: (line: string) => void; units?: ReadonlySet<string> | undefined; implementations?: ReadonlySet<string> | undefined; heldUnits: ReadonlySet<string> }): Finding[] {
  // The bindings of each test file of an implementation, in declaration order.
  const files = new Map<string, { implementation: ParityImplementation; test: string; command: string[] | undefined; args: string[] | undefined; runner: Runner | undefined; bound: { unit: string; id: string }[] }>();
  for (const { unit, implementation } of pairs(model, 'feature')) {
    if (heldUnits.has(unit.id)) continue;
    if (units !== undefined && !units.has(unit.id)) continue;
    if (implementations !== undefined && !implementations.has(implementation.name)) continue;
    // readDeclaration requires bindings and the id of each feature binding.
    for (const binding of present(unit.bindings, 'unit.bindings').filter(entry => entry.implementation === implementation.name)) {
      // Bindings of one test file share a run only when they name the same command, args and runner (K422).
      const runner = binding.runner ?? implementation.runner;
      // A Cargo feature id is an exact libtest filter, so its file cannot combine different native ids in one run.
      const key = `${implementation.name}\0${binding.test}\0${JSON.stringify(binding.command ?? null)}\0${JSON.stringify(binding.args ?? null)}\0${binding.runner ?? ''}${runner === 'cargo' ? `\0${binding.id}` : ''}`;
      const entry = files.get(key) ?? { implementation, test: binding.test, command: binding.command, args: binding.args, runner: binding.runner, bound: [] };
      entry.bound.push({ unit: unit.id, id: present(binding.id, 'binding.id') });
      files.set(key, entry);
    }
  }
  return [...files.values()].flatMap(({ implementation, test, command, args, runner, bound }) => {
    const where = (unit: string) => ({ unit, implementation: implementation.name, place: test });
    const run = resolvedRun(implementation, root, { test, command, args, runner, ids: bound.map(entry => entry.id) }, 'feature', env);
    if (run.error) return bound.map(entry => finding('R3', run.error, where(entry.unit)));
    const units = [...new Set(bound.map(entry => entry.unit))].join(', ');
    const first = once(run, root, { unit: units, implementation: implementation.name }, ledger, say);
    // A failed run names the failing tests that no binding declares, read from its output; none readable is said, never silent.
    const outside = named(first.cases, 'fail').filter(name => !bound.some(entry => entry.id === name));
    const failedOutside = first.status === 0 ? '' : `; failed outside the ids: ${outside.length ? outside.join(', ') : `no test name readable from the output; last 20 lines: ${lastLines(first.result)}`}`;
    say(`${units} ${implementation.name}: exit ${first.status ?? 'none'}, ${bound.filter(entry => first.cases.get(entry.id) === 'pass').length} of ${bound.length} ids passed${failedOutside}`);
    const failedRun = [
      first.result.error && `${run.shown} could not start: ${first.result.error.message}`,
      !first.result.error && first.status !== 0 && `exited with ${first.status ?? first.result.signal}${run.detail(first.result).length ? `: ${run.detail(first.result).join(' | ')}` : ''}`,
      first.reportError !== undefined && `invalid reporter output: ${first.reportError}`,
      ...((runner ?? implementation.runner) === 'cargo' ? (unexpected => unexpected.length ? [`reported outside the exact feature ids: ${unexpected.join(', ')}`] : [])(
        [...first.cases.keys()].filter(name => !bound.some(entry => entry.id === name))) : []),
    ];
    return bound.flatMap(({ unit, id }) => {
      const outcome = first.cases.get(id);
      if (outcome !== undefined) ledger.cases.push({ unit, implementation: implementation.name, case: id, outcome });
      const problems = [
        ...failedRun,
        outcome === undefined && `not executed: ${id}`,
        outcome === 'fail' && `failed: ${id}`,
        outcome === 'skip' && `skipped: ${id}`,
        first.repeated.includes(id) && `reported twice: ${id}`,
      ].filter(Boolean);
      return problems.length ? [finding('R3', problems.join('; '), where(unit))] : [];
    });
  });
}

/**
 * The ledger `{ runs, cases }` of every bound suite pair, the R3 findings, and the R5 findings of the support files that
 * report cases; `say` prints a line for each step.
 */
export function runBindings(model: ParityModel, root: string, { env, files, say, units, implementations, heldUnits = new Set<string>() }: { env: Environment; files: Set<string>; say: (line: string) => void; units?: ReadonlySet<string> | undefined; implementations?: ReadonlySet<string> | undefined; heldUnits?: ReadonlySet<string> }): { ledger: Ledger; findings: Finding[] } {
  const ledger: Ledger = { runs: [], cases: [] };
  const findings: Finding[] = [];
  for (const { unit, implementation } of pairs(model, 'suite')) {
    if (heldUnits.has(unit.id)) continue;
    if (units !== undefined && !units.has(unit.id)) continue;
    if (implementations !== undefined && !implementations.has(implementation.name)) continue;
    if (unit.bindings === undefined) throw new Error(`config/parity.json: the suite unit ${unit.id} has no bindings; readDeclaration reports it before the bindings run`);
    const binding = unit.bindings.find(entry => entry.implementation === implementation.name);
    if (!binding) continue;
    const where = { unit: unit.id, implementation: implementation.name, place: binding.test };
    const run = resolvedRun(implementation, root, binding, 'suite', env);
    if (run.error) {
      findings.push(finding('R3', run.error, where));
      continue;
    }
    const expected = model.cases.get(unit.id) ?? [];
    // Go nests a subtest at each /, so it reports each directory above a case of a case directory as a subtest of its own.
    const declared = model.cases.get(unit.id) ?? [];
    const group = (name: string) => (binding.runner ?? implementation.runner) === 'go' && declared.some(entry => entry.startsWith(`${name}/`));
    const { result, status, cases, reportError, repeated: twice } = once(run, root, { unit: unit.id, implementation: implementation.name }, ledger, say, group);
    say(`${unit.id} ${implementation.name}: ${status === 0 ? 'exit 0' : `exit ${status ?? 'none'}`}, ${expected.filter(name => cases.get(name) === 'pass').length} of ${expected.length} cases passed`);
    for (const [name, outcome] of cases) ledger.cases.push({ unit: unit.id, implementation: implementation.name, case: name, outcome });
    const problems = [
      result.error && `${run.shown} could not start: ${result.error.message}`,
      !result.error && status !== 0 && `exited with ${status ?? result.signal}${run.detail(result).length ? `: ${run.detail(result).join(' | ')}` : ''}`,
      reportError !== undefined && `invalid reporter output: ${reportError}`,
      named(cases, 'fail').length && `failed: ${named(cases, 'fail').join(', ')}`,
      named(cases, 'skip').length && `skipped: ${named(cases, 'skip').join(', ')}`,
      `not executed: ${expected.filter(name => !cases.has(name)).join(', ')}`,
      `not in the suite: ${[...cases.keys()].filter(name => !expected.includes(name)).join(', ')}`,
      `reported twice: ${twice.join(', ')}`,
    ].filter(part => part && !part.endsWith(': '));
    if (problems.length) findings.push(finding('R3', problems.join('; '), where));
  }
  // The support files belong to no unit, so a run of named units leaves them to the whole-set check.
  const support = units === undefined ? runSupport(model, root, files, { env, say, implementations }) : [];
  return { ledger, findings: [...findings, ...runFeatures(model, root, ledger, { env, say, units, implementations, heldUnits }), ...support] };
}
