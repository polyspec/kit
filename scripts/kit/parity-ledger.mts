// R3 of the language-parity check: the checker runs the binding of every suite and feature unit in each applicable implementation
// and keeps, in memory, the ledger of the runs and of the cases that each run reported. A suite binding holds its unit
// when its command exits with 0 and the cases that passed are exactly the cases of the suite file: a failed, skipped, missing or
// extra case is a finding. A feature binding holds its unit when its native id passes once in one successful run; Cargo
// filters that id exactly, while file-based runners run the test file. Each binding runs once (K959): fixed seeds and isolated
// databases make a run deterministic, and a test that is not is a defect of the test. No saved report is read. The environment references of the runner values resolve here, and a run whose
// reference is unset or empty cannot start. Each support file of a file runner (node, php, python) runs once, and one that
// reports a case is an R5 finding.
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { buildGroups, cargoNativeContexts, runCargoGroup, runGoGroup, type BuildGroup, type BuildRequest } from './parity-build.mts';
import { cargoCommandConfig, cargoConfigFiles, readCargoConfig } from './cargo-config.mts';
import { runCommand, type RunCommandResult } from './run-command.mts';
import { START_UP_MS } from './test-gap.mts';
import { compactSeconds } from './time.mts';
import { finding, resolveCommand, resolveReferences, supportFiles } from './parity-declaration.mts';
import type { Environment, Finding, ParityImplementation, ParityModel, Runner } from './parity-declaration.mts';
import { outcomesOf, runOf } from './parity-runners.mts';
import type { BindingCommand, Outcome, RunError, RunKind, RunTarget } from './parity-runners.mts';
import { pairs } from './parity-units.mts';
import { present } from './present.mts';

/** A run with `shown`, its command line as declared, or a run that cannot start. */
type PreparedRun = { target?: string; buildFailure?: RunCommandResult; result: RunCommandResult; built: boolean; execution?: { command: string; args: string[]; cwd: string } };

type ResolvedRun = (BindingCommand & { shown: string }) | RunError;

/** A run of the ledger. */
export interface LedgerRun {
  target?: string;
  unit: string;
  implementation: string;
  command: string;
  args: string[];
  cwd: string;
  status: number | null;
}

/** A case of the ledger, with its outcome. */
export interface LedgerCase {
  target?: string;
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

/** The most output of a run that the ledger keeps, the same limit as the buffer of execute (process.mts). */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

/**
 * The longest silence of a binding run (K936): the start-up bound of run-tests (test-gap.mts). A binding that hangs prints nothing, so
 * its run stops there; a test of the ledger passes a shorter one.
 */
export const SILENCE_MS = START_UP_MS;

/** The run of a binding. */
interface Attempt {
  buildFailure?: string;
  result: RunCommandResult;
  status: number | null;
  cases: Map<string, Outcome>;
  repeated: string[];
  reportError?: string;
  /** The sentence of a run that the silence limit stopped (K936). */
  stop?: string;
  /** The build of the tests failed, which is the run (K936). */
  built?: boolean;
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
async function runSupport(model: ParityModel, root: string, files: Set<string>, { env, say, implementations, silenceMs }: { env: Environment; say: (line: string) => void; implementations?: ReadonlySet<string> | undefined; silenceMs: number }): Promise<Finding[]> {
  const found: Finding[] = [];
  for (const implementation of model.config.implementations.filter(entry => (implementations === undefined || implementations.has(entry.name)) && FILE_RUNNERS.has(entry.runner))) {
    for (const file of supportFiles(implementation, files)) {
      const where = { implementation: implementation.name, place: file };
      const run = resolvedRun(implementation, root, { test: file }, 'suite', env);
      if (run.error) {
        found.push(finding('R3', run.error, where));
        continue;
      }
      say(`run the support file ${file} of ${implementation.name}: ${run.shown} (in ${run.cwd})`);
      const { result } = await runGuarded(run, root, silenceMs, say);
      if (result.stopped === 'silence') {
        found.push(finding('R5', `the support file ${stopSentence(file, silenceMs, result).slice('binding '.length)}`, where));
        continue;
      }
      if (result.error || result.stopped === 'output') {
        found.push(finding('R5', `the support file could not run: ${run.shown}: ${result.error?.message ?? 'its output passed the limit of the ledger, and its process group was stopped'}`, where));
        continue;
      }
      const reported = outcomesOf(run, result).map(([name]) => name);
      if (reported.length) found.push(finding('R5', `the support file reports cases (${reported.join(', ')}); declare it as the test of a binding`, where));
    }
  }
  return found;
}

/** The sentence of a run that the silence limit stopped (K936): the binding, the limit, and the stop of its group. */
const stopSentence = (place: string, silenceMs: number, result: RunCommandResult): string => `binding ${place} printed nothing for ${silenceMs / 1000} s: it stopped its process group after ${compactSeconds(result.elapsedMs)}`;

/** The finding of a build that failed (K936): the build of the tests exited with its status, and the compiler lines that explain it. */
const buildSentence = (run: BindingCommand, result: RunCommandResult): string => {
  const detail = run.detail(result);
  return `the build of the tests exited with ${result.status ?? result.signal}${detail.length ? `: ${detail.join(' | ')}` : ''}`;
};

/**
 * Runs a binding command to its end in its own group (K936). A built-in go or cargo binding builds first, with no bound, as run-tests
 * builds them (K549-1), and its build output goes to `say`: a build that fails is the run, with `built` set. The test run stops when it
 * prints nothing for `silenceMs`.
 */
async function runGuarded(run: BindingCommand, root: string, silenceMs: number, say: (line: string) => void): Promise<{ result: RunCommandResult; built: boolean }> {
  const plain = { command: run.command, cwd: path.join(root, run.cwd), env: run.env, stdout: 'pipe' as const, stderr: 'pipe' as const, maxOutputBytes: MAX_OUTPUT_BYTES };
  if (run.build !== undefined) {
    const built = await runCommand({ ...plain, args: run.build });
    for (const text of `${built.stdout}\n${built.stderr}`.split('\n')) if (text.trim() !== '') say(text);
    // A program that cannot start is the error of the run, as for a binding without a build (K393-2).
    if (built.error) return { result: built, built: false };
    if (built.stopped !== undefined || built.status !== 0) return { result: built, built: true };
  }
  return { result: await runCommand({ ...plain, args: run.args, silenceMs }), built: false };
}

/**
 * The run of `run`, recorded in `ledger.runs` under `unit` and `implementation`, with `say` printing the step; a reported name
 * that `group` holds is a group of cases, not a case. A run that the silence limit stopped, or whose build failed, reports no case:
 * the stop or the build is the finding (K936).
 */
async function once(run: BindingCommand & { shown: string }, root: string, where: { unit: string; implementation: string; place: string }, ledger: { runs: LedgerRun[] }, say: (line: string) => void, group: (name: string) => boolean = () => false, silenceMs: number = SILENCE_MS, prepared?: PreparedRun): Promise<Attempt> {
  say(`run ${where.unit} ${where.implementation}${prepared?.target ? ` target ${prepared.target}` : ''}: ${run.shown} (in ${run.cwd})`);
  const { result, built } = prepared ?? await runGuarded(run, root, silenceMs, say);
  const status = result.error ? null : result.status;
  let reported: [string, Outcome][] = [];
  let reportError: string | undefined;
  // A failed build is the run's result: no case is read from its output (K936).
  if (result.stopped === 'output' && !built) reportError = 'its output passed the limit of the ledger, and its process group was stopped';
  else if (!built && !result.error && result.stopped === undefined) {
    try { reported = outcomesOf(run, result).filter(([name]) => !group(name)); }
    // catch-any -- Malformed child output is a binding finding, not a reason to abort the remaining bindings.
    catch (error) {
      reportError = error instanceof Error ? error.message : String(error);
    }
  }
  ledger.runs.push({ ...(prepared?.target ? { target: prepared.target } : {}), unit: where.unit, implementation: where.implementation, command: prepared?.execution?.command ?? run.command, args: prepared?.execution?.args ?? run.args, cwd: prepared?.execution?.cwd ?? run.cwd, status });
  return {
    ...(prepared?.buildFailure ? { buildFailure: buildSentence(run, prepared.buildFailure) } : {}),
    result,
    status,
    cases: new Map(reported),
    repeated: repeated(reported),
    ...(built ? { built: true } : {}),
    ...(reportError === undefined ? {} : { reportError }),
    ...(result.stopped === 'silence' ? { stop: stopSentence(where.place, silenceMs, result) } : {}),
  };
}

/** The last 20 non-blank lines of a run's standard output and then its standard error, joined by ' | ' (K215). */
const lastLines = ({ stdout, stderr }: { stdout: string; stderr: string }): string => [stdout ?? '', stderr ?? ''].join('\n').split('\n').filter(line => line.trim()).slice(-20).join(' | ');

/** Retain each Cargo target and runner before installing its capture adapter. */
async function prepareCargoGroups(group: BuildGroup, selections: ReadonlyMap<string, readonly string[]>, parent: string, silenceMs: number, say: (line: string) => void) {
  const config = readCargoConfig(cargoConfigFiles(group.cwd, group.env));
  const command = cargoCommandConfig(group.options, group.cwd);
  const contexts = await cargoNativeContexts(group, config, command);
  const completed = [];
  for (const native of contexts) {
    // Each target has a different compiler output and native runner. An explicit CLI target overrides build.target.
    const options: string[] = [];
    for (let index = 0; index < group.options.length; index++) {
      const word = group.options[index];
      if (word === '--target') { index++; continue; }
      if (word?.startsWith('--target=')) continue;
      if (word !== undefined) options.push(word);
    }
    const selected = contexts.length > 1 ? { ...group, options: [...options, '--target', native.triple] } : group;
    completed.push({ ...(contexts.length > 1 ? { target: native.triple } : {}),
      completed: await runCargoGroup(selected, selections, parent, native, silenceMs, say) });
  }
  return completed;
}

/** Prepare compatible native bindings before their ledger results are compared. */
async function prepareNativeRuns(runs: readonly ResolvedRun[], root: string, silenceMs: number, say: (line: string) => void) {
  const prepared = new Map<BindingCommand, PreparedRun[]>();
  const requests: BuildRequest[] = [];
  const native = new Map<string, BindingCommand>();
  const selections = new Map<string, readonly string[]>();
  for (const [index, run] of runs.entries()) {
    if (run.error || !run.compiled) continue;
    const id = String(index);
    requests.push({ id, runner: run.compiled.runner, command: run.command, cwd: path.join(root, run.cwd), env: run.env,
      options: run.compiled.options, target: run.compiled.target });
    native.set(id, run);
    selections.set(id, run.compiled.selection);
  }
  if (requests.length) {
    const parent = path.join(root, 'var');
    mkdirSync(parent, { recursive: true });
    for (const group of buildGroups(requests)) {
      try {
        const groups = group.runner === 'go'
          ? [{ completed: await runGoGroup(group, selections, parent, silenceMs, say) }]
          : await prepareCargoGroups(group, selections, parent, silenceMs, say);
        for (const entry of groups) {
          const { completed } = entry;
          const target = 'target' in entry && typeof entry.target === 'string' ? { target: entry.target } : {};
          for (const request of group.requests) {
            const run = native.get(request.id);
            if (!run) throw new Error(`compiled binding ${request.id} lost its planned run`);
            const result = completed.runs.get(request.id);
            const problem = completed.errors.get(request.id);
            if (!result && completed.build.error) {
              prepared.set(run, [...prepared.get(run) ?? [], { ...target, result: completed.build, built: false }]);
              continue;
            }
            prepared.set(run, [...prepared.get(run) ?? [], result ? { ...target, ...(completed.build.status !== 0 ? { buildFailure: completed.build } : {}), result, built: false, execution: result.execution } : { ...target, result: { ...completed.build,
              status: completed.build.status || 1, stderr: `${completed.build.stderr}\n${problem ?? 'no executable was reported'}` }, built: true }]);
          }
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        for (const request of group.requests) {
          const run = native.get(request.id);
          if (run) prepared.set(run, [...prepared.get(run) ?? [], { result: { status: 1, signal: null, stdout: '', stderr: error.message, elapsedMs: 0 }, built: true }]);
        }
      }
    }
  }
  return prepared;
}

/**
 * R3 of the feature units: each test file runs once for the native ids that bind it in its implementation, and each id passes
 * once, with the run exiting 0.
 */
function planFeatures(model: ParityModel, root: string, { env, units, implementations, heldUnits }: { env: Environment; units?: ReadonlySet<string> | undefined; implementations?: ReadonlySet<string> | undefined; heldUnits: ReadonlySet<string> }) {
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
  const planned = [...files.values()].map(entry => ({ ...entry, run: resolvedRun(entry.implementation, root, { test: entry.test, command: entry.command, args: entry.args, runner: entry.runner, ids: entry.bound.map(bound => bound.id) }, 'feature', env) }));
  return planned;
}

async function runFeatures(root: string, ledger: Ledger, planned: ReturnType<typeof planFeatures>, prepared: Awaited<ReturnType<typeof prepareNativeRuns>>, say: (line: string) => void, silenceMs: number): Promise<Finding[]> {
  const found: Finding[] = [];
  for (const { implementation, test, bound, runner, run } of planned) {
    const where = (unit: string) => ({ unit, implementation: implementation.name, place: test });
    if (run.error) {
      found.push(...bound.map(entry => finding('R3', run.error, where(entry.unit))));
      continue;
    }
    const units = [...new Set(bound.map(entry => entry.unit))].join(', ');
    for (const attempt of prepared.get(run) ?? [undefined]) {
      const target = attempt?.target ? { target: attempt.target } : {};
      const first = await once(run, root, { unit: units, implementation: implementation.name, place: test }, ledger, say, () => false, silenceMs, attempt);
      // A failed run names the failing tests that no binding declares, read from its output; none readable is said, never silent.
      const outside = named(first.cases, 'fail').filter(name => !bound.some(entry => entry.id === name));
      const failedOutside = first.status === 0 ? '' : `; failed outside the ids: ${outside.length ? outside.join(', ') : `no test name readable from the output; last 20 lines: ${lastLines(first.result)}`}`;
      say(`${units} ${implementation.name}: exit ${first.status ?? 'none'}, ${bound.filter(entry => first.cases.get(entry.id) === 'pass').length} of ${bound.length} ids passed${failedOutside}`);
      // One finding for a run that the silence limit stopped, however many ids it binds (K936).
      if (first.stop !== undefined) {
        found.push(finding('R3', first.stop, { implementation: implementation.name, place: test }));
        continue;
      }
      const failedRun = first.built
        ? [buildSentence(run, first.result)]
        : [
            first.result.error && `${run.shown} could not start: ${first.result.error.message}`,
            !first.result.error && first.status !== 0 && `exited with ${first.status ?? first.result.signal}${run.detail(first.result).length ? `: ${run.detail(first.result).join(' | ')}` : ''}`,
            first.reportError !== undefined && `invalid reporter output: ${first.reportError}`,
            ...((runner ?? implementation.runner) === 'cargo' ? (unexpected => unexpected.length ? [`reported outside the exact feature ids: ${unexpected.join(', ')}`] : [])(
              [...first.cases.keys()].filter(name => !bound.some(entry => entry.id === name))) : []),
          ];
      for (const { unit, id } of bound) {
        const outcome = first.cases.get(id);
        if (outcome !== undefined) ledger.cases.push({ ...target, unit, implementation: implementation.name, case: id, outcome });
        const problems = [
          ...failedRun,
        first.buildFailure,
          outcome === undefined && `not executed: ${id}`,
          outcome === 'fail' && `failed: ${id}`,
          outcome === 'skip' && `skipped: ${id}`,
          first.repeated.includes(id) && `reported twice: ${id}`,
        ].filter(Boolean);
        if (problems.length) found.push(finding('R3', `${attempt?.target ? `target ${attempt.target}: ` : ''}${problems.join('; ')}`, where(unit)));
      }
    }
  }
  return found;
}

/**
 * The ledger `{ runs, cases }` of every bound suite pair, the R3 findings, and the R5 findings of the support files that
 * report cases; `say` prints a line for each step.
 */
export async function runBindings(model: ParityModel, root: string, { env, files, say, units, implementations, heldUnits = new Set<string>(), silenceMs = SILENCE_MS }: { env: Environment; files: Set<string>; say: (line: string) => void; units?: ReadonlySet<string> | undefined; implementations?: ReadonlySet<string> | undefined; heldUnits?: ReadonlySet<string> | undefined; silenceMs?: number | undefined }): Promise<{ ledger: Ledger; findings: Finding[] }> {
  const ledger: Ledger = { runs: [], cases: [] };
  const findings: Finding[] = [];
  const planned = [];
  for (const { unit, implementation } of pairs(model, 'suite')) {
    if (heldUnits.has(unit.id)) continue;
    if (units !== undefined && !units.has(unit.id)) continue;
    if (implementations !== undefined && !implementations.has(implementation.name)) continue;
    if (unit.bindings === undefined) throw new Error(`config/parity.json: the suite unit ${unit.id} has no bindings; readDeclaration reports it before the bindings run`);
    const binding = unit.bindings.find(entry => entry.implementation === implementation.name);
    if (!binding) continue;
    const run = resolvedRun(implementation, root, binding, 'suite', env);
    planned.push({ unit, implementation, binding, run });
  }
  const features = planFeatures(model, root, { env, units, implementations, heldUnits });
  const prepared = await prepareNativeRuns([...planned.map(entry => entry.run), ...features.map(entry => entry.run)], root, silenceMs, say);
  // Resolve every selected binding before execution so compatible native targets can share their build.
  for (const { unit, implementation, binding, run } of planned) {
    const where = { unit: unit.id, implementation: implementation.name, place: binding.test };
    if (run.error) {
      findings.push(finding('R3', run.error, where));
      continue;
    }
    const expected = model.cases.get(unit.id) ?? [];
    // Go nests a subtest at each /, so it reports each directory above a case of a case directory as a subtest of its own.
    const declared = model.cases.get(unit.id) ?? [];
    const group = (name: string) => (binding.runner ?? implementation.runner) === 'go' && declared.some(entry => entry.startsWith(`${name}/`));
    for (const attempt of prepared.get(run) ?? [undefined]) {
      const target = attempt?.target ? { target: attempt.target } : {};
      const { result, status, cases, reportError, repeated: twice, stop, built, buildFailure } = await once(run, root, { unit: unit.id, implementation: implementation.name, place: binding.test }, ledger, say, group, silenceMs, attempt);
      say(`${unit.id} ${implementation.name}: ${status === 0 ? 'exit 0' : `exit ${status ?? 'none'}`}, ${expected.filter(name => cases.get(name) === 'pass').length} of ${expected.length} cases passed`);
      for (const [name, outcome] of cases) ledger.cases.push({ ...target, unit: unit.id, implementation: implementation.name, case: name, outcome });
      const problems = stop !== undefined ? [stop] : built ? [buildSentence(run, result)] : [
        buildFailure,
      result.error && `${run.shown} could not start: ${result.error.message}`,
        !result.error && status !== 0 && `exited with ${status ?? result.signal}${run.detail(result).length ? `: ${run.detail(result).join(' | ')}` : ''}`,
        reportError !== undefined && `invalid reporter output: ${reportError}`,
        named(cases, 'fail').length && `failed: ${named(cases, 'fail').join(', ')}`,
        named(cases, 'skip').length && `skipped: ${named(cases, 'skip').join(', ')}`,
        `not executed: ${expected.filter(name => !cases.has(name)).join(', ')}`,
        `not in the suite: ${[...cases.keys()].filter(name => !expected.includes(name)).join(', ')}`,
        `reported twice: ${twice.join(', ')}`,
      ].filter(part => part && !part.endsWith(': '));
      if (problems.length) findings.push(finding('R3', `${attempt?.target ? `target ${attempt.target}: ` : ''}${problems.join('; ')}`, where));
    }
  }
  // The support files belong to no unit, so a run of named units leaves them to the whole-set check.
  const support = units === undefined ? await runSupport(model, root, files, { env, say, implementations, silenceMs }) : [];
  return { ledger, findings: [...findings, ...await runFeatures(root, ledger, features, prepared, say, silenceMs), ...support] };
}
