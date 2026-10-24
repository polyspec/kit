// R3 of the language-parity check: the checker runs the binding of every suite and feature unit in each applicable implementation
// and keeps, in memory, the ledger of the runs and of the cases that each run reported. A suite binding holds its unit
// when its command exits with 0 and the cases that passed are exactly the cases of the suite file: a failed, skipped, missing or
// extra case is a finding. A feature binding holds its unit when its native id passes once in two equal successful runs;
// Cargo filters that id exactly, while file-based runners run the test file. Each run happens twice, and a second run with another exit status,
// another case or another result is a finding that names the case. No saved report is read. The environment references of the runner values resolve here, and a run whose
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
  attempt: number;
  command: string;
  args: string[];
  cwd: string;
  status: number | null;
}

/** A case of the ledger, with the outcome of the first run. */
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

/** One of the two runs of a binding. */
interface Attempt {
  result: SpawnSyncReturns<string>;
  status: number | null;
  cases: Map<string, Outcome>;
  repeated: string[];
}

/** The names of `cases` (a map from case to outcome) whose outcome is `outcome`. */
const named = (cases: Map<string, Outcome>, outcome: Outcome) => [...cases].filter(([, value]) => value === outcome).map(([name]) => name);

/** The names that `reported` (the `[name, outcome]` pairs of one run, in order) report more than once. */
const repeated = (reported: [string, Outcome][]) => [...new Set(reported.map(([name]) => name).filter((name, index, names) => names.indexOf(name) !== index))];

/** How the second run differs from the first: its exit status, and each case with another result or in one run only. */
function differences(first: Attempt, second: Attempt): string[] {
  const found = first.status === second.status ? [] : [`exit ${first.status ?? 'none'} then ${second.status ?? 'none'}`];
  for (const [name, outcome] of first.cases) {
    if (!second.cases.has(name)) found.push(`${name} only in the first run`);
    else if (second.cases.get(name) !== outcome) found.push(`${name} ${outcome} then ${second.cases.get(name)}`);
  }
  for (const name of second.cases.keys()) if (!first.cases.has(name)) found.push(`${name} only in the second run`);
  return found;
}

/**
 * The run of `binding` in the implementation `declared` with its environment references resolved from `env`: the run of
 * runOf, with `shown`, the command line as declared (a reference is printed, never its value), or `{ error }`.
 */
function resolvedRun(declared: ParityImplementation, root: string, binding: RunTarget, kind: RunKind, env: Environment): ResolvedRun {
  const { implementation, errors } = resolveReferences(declared, env, root);
  const command = binding.command === undefined ? undefined : resolveCommand(binding.command, env, root);
  const failures = [...errors, ...command?.errors ?? []];
  if (failures.length) return { error: `cannot start: ${failures.join('; ')}` };
  const run = runOf(implementation, root, { ...binding, command: command?.command }, kind, env);
  if (run.error) return run;
  const shown = runOf(declared, root, binding, kind, env);
  // The runner of a binding does not read the references, so the declared run starts where the resolved run does.
  if (shown.error) throw new Error(`${declared.name}: the run as declared cannot start while the resolved run starts: ${shown.error}`);
  // The program of a binding with its own runner is that runner's, as runOf gives it.
  return { ...run, shown: [binding.command?.[0] ?? (binding.runner === undefined ? declared.command : undefined) ?? shown.command, ...shown.args].join(' ') };
}

// The runners whose support files the check runs: a file runner reports its cases by printing them, so a support file of one
// could hold a test that no declaration shows.
const FILE_RUNNERS = new Set(['node', 'php', 'python']);

/** R5 of the support files: each support file of a node, php or python implementation runs once and reports no case. */
function runSupport(model: ParityModel, root: string, files: Set<string>, { env, say }: { env: Environment; say: (line: string) => void }): Finding[] {
  return model.config.implementations.filter(implementation => FILE_RUNNERS.has(implementation.runner)).flatMap(implementation => supportFiles(implementation, files).flatMap((file) => {
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
 * The two runs of `run`, each recorded in `ledger.runs` under `unit` and `implementation`, with `say` printing each step; a
 * reported name that `group` holds is a group of cases, not a case.
 */
function twice(run: BindingCommand & { shown: string }, root: string, where: { unit: string; implementation: string }, ledger: { runs: LedgerRun[] }, say: (line: string) => void, group: (name: string) => boolean = () => false): [Attempt, Attempt] {
  const runOnce = (attempt: number): Attempt => {
    say(`run ${where.unit} ${where.implementation} (${attempt} of 2): ${run.shown} (in ${run.cwd})`);
    const result = execute(run.command, run.args, { cwd: path.join(root, run.cwd), env: run.env });
    const status = result.error ? null : result.status;
    const reported = result.error ? [] : outcomesOf(run, result).filter(([name]) => !group(name));
    ledger.runs.push({ ...where, attempt, command: run.command, args: run.args, cwd: run.cwd, status });
    return { result, status, cases: new Map(reported), repeated: repeated(reported) };
  };
  return [runOnce(1), runOnce(2)];
}

/** The last 20 non-blank lines of a run's standard output and then its standard error, joined by ' | ' (K215). */
const lastLines = ({ stdout, stderr }: { stdout: string; stderr: string }): string => [stdout ?? '', stderr ?? ''].join('\n').split('\n').filter(line => line.trim()).slice(-20).join(' | ');

/**
 * R3 of the feature units: each test file runs twice for the native ids that bind it in its implementation, and each id passes
 * in both runs, once in each, with both runs exiting 0.
 */
function runFeatures(model: ParityModel, root: string, ledger: Ledger, { env, say, units }: { env: Environment; say: (line: string) => void; units?: ReadonlySet<string> | undefined }): Finding[] {
  // The bindings of each test file of an implementation, in declaration order.
  const files = new Map<string, { implementation: ParityImplementation; test: string; command: string[] | undefined; runner: Runner | undefined; bound: { unit: string; id: string }[] }>();
  for (const { unit, implementation } of pairs(model, 'feature')) {
    if (units !== undefined && !units.has(unit.id)) continue;
    // readDeclaration requires bindings and the id of each feature binding.
    for (const binding of present(unit.bindings, 'unit.bindings').filter(entry => entry.implementation === implementation.name)) {
      // Bindings of one test file share a run only when they name the same command and the same runner (K422).
      const runner = binding.runner ?? implementation.runner;
      // A Cargo feature id is an exact libtest filter, so its file cannot combine different native ids in one run.
      const key = `${implementation.name}\0${binding.test}\0${JSON.stringify(binding.command ?? null)}\0${binding.runner ?? ''}${runner === 'cargo' ? `\0${binding.id}` : ''}`;
      const entry = files.get(key) ?? { implementation, test: binding.test, command: binding.command, runner: binding.runner, bound: [] };
      entry.bound.push({ unit: unit.id, id: present(binding.id, 'binding.id') });
      files.set(key, entry);
    }
  }
  return [...files.values()].flatMap(({ implementation, test, command, runner, bound }) => {
    const where = (unit: string) => ({ unit, implementation: implementation.name, place: test });
    const run = resolvedRun(implementation, root, { test, command, runner, ids: bound.map(entry => entry.id) }, 'feature', env);
    if (run.error) return bound.map(entry => finding('R3', run.error, where(entry.unit)));
    const units = [...new Set(bound.map(entry => entry.unit))].join(', ');
    const [first, second] = twice(run, root, { unit: units, implementation: implementation.name }, ledger, say);
    // A failed run names the failing tests that no binding declares, read from its output; none readable is said, never silent.
    const outside = named(first.cases, 'fail').filter(name => !bound.some(entry => entry.id === name));
    const failedOutside = first.status === 0 ? '' : `; failed outside the ids: ${outside.length ? outside.join(', ') : `no test name readable from the output; last 20 lines: ${lastLines(first.result)}`}`;
    say(`${units} ${implementation.name}: exit ${first.status ?? 'none'}, ${bound.filter(entry => first.cases.get(entry.id) === 'pass').length} of ${bound.length} ids passed${failedOutside}`);
    const failedRun = [
      first.result.error && `${run.shown} could not start: ${first.result.error.message}`,
      !first.result.error && first.status !== 0 && `exited with ${first.status ?? first.result.signal}${run.detail(first.result).length ? `: ${run.detail(first.result).join(' | ')}` : ''}`,
      first.status !== second.status && `exit ${first.status ?? 'none'} then ${second.status ?? 'none'}`,
      ...((runner ?? implementation.runner) === 'cargo' ? [first, second].flatMap((attempt, index) => {
        const unexpected = [...attempt.cases.keys()].filter(name => !bound.some(entry => entry.id === name));
        return unexpected.length ? [`reported outside the exact feature ids in run ${index + 1}: ${unexpected.join(', ')}`] : [];
      }) : []),
    ];
    return bound.flatMap(({ unit, id }) => {
      const outcome = first.cases.get(id);
      if (outcome !== undefined) ledger.cases.push({ unit, implementation: implementation.name, case: id, outcome });
      const problems = [
        ...failedRun,
        outcome === undefined && `not executed: ${id}`,
        outcome === 'fail' && `failed: ${id}`,
        outcome === 'skip' && `skipped: ${id}`,
        ...[first, second].map((attempt, index) => attempt.repeated.includes(id) && `reported twice in run ${index + 1}: ${id}`),
        outcome !== second.cases.get(id) && `the second run differs from the first: ${id} ${outcome ?? 'absent'} then ${second.cases.get(id) ?? 'absent'}`,
      ].filter(Boolean);
      return problems.length ? [finding('R3', problems.join('; '), where(unit))] : [];
    });
  });
}

/**
 * The ledger `{ runs, cases }` of every bound suite pair, the R3 findings, and the R5 findings of the support files that
 * report cases; `say` prints a line for each step.
 */
export function runBindings(model: ParityModel, root: string, { env, files, say, units }: { env: Environment; files: Set<string>; say: (line: string) => void; units?: ReadonlySet<string> | undefined }): { ledger: Ledger; findings: Finding[] } {
  const ledger: Ledger = { runs: [], cases: [] };
  const findings: Finding[] = [];
  for (const { unit, implementation } of pairs(model, 'suite')) {
    if (units !== undefined && !units.has(unit.id)) continue;
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
    // The binding runs twice; the same tree gives the same cases with the same results, or the binding does not hold.
    // map gives one attempt for each of the two runs.
    // Go nests a subtest at each /, so it reports each directory above a case of a case directory as a subtest of its own.
    const declared = model.cases.get(unit.id) ?? [];
    const group = (name: string) => (binding.runner ?? implementation.runner) === 'go' && declared.some(entry => entry.startsWith(`${name}/`));
    const [first, second] = twice(run, root, { unit: unit.id, implementation: implementation.name }, ledger, say, group);
    for (const [attempt, { status, cases }] of [first, second].entries()) say(`${unit.id} ${implementation.name} (${attempt + 1} of 2): ${status === 0 ? 'exit 0' : `exit ${status ?? 'none'}`}, ${expected.filter(name => cases.get(name) === 'pass').length} of ${expected.length} cases passed`);
    const { result, status, cases } = first;
    for (const [name, outcome] of cases) ledger.cases.push({ unit: unit.id, implementation: implementation.name, case: name, outcome });
    const problems = [
      result.error && `${run.shown} could not start: ${result.error.message}`,
      !result.error && status !== 0 && `exited with ${status ?? result.signal}${run.detail(result).length ? `: ${run.detail(result).join(' | ')}` : ''}`,
      named(cases, 'fail').length && `failed: ${named(cases, 'fail').join(', ')}`,
      named(cases, 'skip').length && `skipped: ${named(cases, 'skip').join(', ')}`,
      `not executed: ${expected.filter(name => !cases.has(name)).join(', ')}`,
      `not in the suite: ${[...cases.keys()].filter(name => !expected.includes(name)).join(', ')}`,
      ...[first, second].flatMap((attempt, index) => (attempt.repeated.length ? [`reported twice in run ${index + 1}: ${attempt.repeated.join(', ')}`] : [])),
      `the second run differs from the first: ${differences(first, second).join('; ')}`,
    ].filter(part => part && !part.endsWith(': '));
    if (problems.length) findings.push(finding('R3', problems.join('; '), where));
  }
  // The support files belong to no unit, so a run of named units leaves them to the whole-set check.
  const support = units === undefined ? runSupport(model, root, files, { env, say }) : [];
  return { ledger, findings: [...findings, ...runFeatures(model, root, ledger, { env, say, units }), ...support] };
}
