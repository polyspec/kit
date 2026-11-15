#!/usr/bin/env node
// Runs the steps of one job of a GitHub workflow of the checkout, as CI runs them (K1227, K1228):
//
//   node scripts/kit/ci-job.mts --workflow <file> --job <id> [--matrix <key>=<value>]... [--input <name>=<value>]... [--input-event <workflow_call|workflow_dispatch>] [--plan]
//
// A check before a push must be the CI job itself, not a list of its commands copied by hand, because a copy drifts from
// the workflow and a missed step makes the local run differ from CI. The run reads the workflow of the checkout and runs
// each `run:` step of the job in order, with the `env:` of the workflow, the job and the step, the `working-directory` and
// the shell of the step or of `defaults.run`, as a GitHub runner runs it: the script is a file of `RUNNER_TEMP`, run by
// `bash -e` without a shell, by `bash --noprofile --norc -eo pipefail` for `shell: bash` and by `sh -e` for `shell: sh`.
// A step `uses: ./<path>` is a composite action of the checkout, whose steps run in its place with its `inputs` (the `with:`
// of the step over the defaults) and give its `outputs`. A step of an external action (checkout, the setup of a language,
// an upload) does not run on the machine, and the run prints it with its `with:` inputs, so no step is left out without a
// line that names it. `--plan` prints the steps and the combinations and runs nothing.
//
// `${{ }}` and `if:` are expressions of GitHub Actions, which `@actions/expressions` of GitHub parses and evaluates
// (actions-expression.mts), with the status functions and the contexts that the run has: `matrix`, `runner` (`os` and
// `arch` of this machine, `temp`), `env`, `steps.<id>` (`outputs`, `outcome`, `conclusion`), `inputs` of a workflow or composite action, `github.workspace` (the checkout; `github.action_path` in a
// composite action) and `needs.<job>.outputs`. A step writes its outputs, its environment for the later steps, its
// folders of PATH and its summary to the files `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH` and `GITHUB_STEP_SUMMARY`, in
// the form `name=value` or `name<<DELIMITER`; the run prints a summary that a step writes. A condition without a status
// function holds only while no step failed (`success() && ...`), so a failing step skips the later steps except those of
// `always()`, `failure()` and `!cancelled()`, which run as in CI, and the run then ends with status 1; a step with a true
// `continue-on-error` fails without failing the job. In a composite action the status functions read the status of its
// own steps, as the runner gives them. `cancelled()` is false: an interrupted run stops at once.
//
// A job that reads `needs.<job>.outputs` runs after that job, as CI runs it: the run runs the needed job first, which must
// succeed, and gives its outputs; a job of a matrix gives no outputs that a run can reproduce, since CI takes those of the
// combination that ends last, so it is refused. A job that reads anything else of `needs`, such as the results of the jobs
// that it judges, is refused by name: its value is the outcome of the whole CI run, not of the jobs that a local run of one
// job runs. A job does not wait for a needed job whose outputs it does not read. `runs-on` is not read: the machine of the
// run is the runner.
//
// A job with `strategy.matrix` runs once for each of its combinations, in order, or only for those whose values match every
// `--matrix <key>=<value>`. The combinations follow GitHub: the product of the axes without the entries of `exclude`, then
// each entry of `include` extends every combination whose values of the axes it matches, or adds a combination when it
// matches none; a part of the matrix may be an expression over `github` and `needs`. With `fail-fast` (the default) the
// combinations after a failed one are named and not run. A combination that no selection matches fails the run with the
// combinations that exist.
//
// Refused by name, because the run could not give them the meaning that CI gives: a job that calls a reusable workflow, a
// job with `container`, `services` or `continue-on-error`, an expression that reads a context or a property that the run
// does not have (`secrets`, `vars`, `github.<name>` other than those above, `job`, `strategy`, `runner.<name>` other than
// those above), the outputs of a step of an external action, which does not run, a function that `@actions/expressions`
// does not define, such as hashFiles, and a shell other than bash, sh and, on Windows, pwsh.
// `RUNNER_TEMP` is a directory that the run makes under the temporary directory of the system (`TMPDIR`) for each
// combination and removes at its end, also on SIGINT and SIGTERM. The steps see `CI=true` and `CI_JOB_LOCAL=1`, not
// `GITHUB_ACTIONS`, since no service of GitHub serves the run. The run makes no download; the steps that download are the
// install targets of the repository. `timeout-minutes` is not applied, since kit sets no time limit on a check. The `env:`
// and `with:` of an external action are printed and not evaluated, since the action does not run. Status 0 when every step passed, 1 when a step failed or the job was refused, 2 for a usage error.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { callsStatus, evaluateTemplate, parseExpression, parseTemplate, references, toText, truthy, type Reference, type Status, type Template, type Value } from './actions-expression.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { failureOf, runCommand } from './run-command.mts';
import { checkEnvironmentName, EnvironmentRefusal, environmentRefusal, environmentValue, mergeEnvironment } from './environment.mts';

const USAGE = 'usage: node scripts/kit/ci-job.mts --workflow <file> --job <id> [--matrix <key>=<value>]... [--input <name>=<value>]... [--input-event <workflow_call|workflow_dispatch>] [--plan]';
const WINDOWS = process.platform === 'win32';
/** `runner.os` and `runner.arch` of GitHub for the machine of the run. */
const RUNNER_OS = ({ darwin: 'macOS', linux: 'Linux', win32: 'Windows' } as Record<string, string>)[process.platform] ?? process.platform;
const RUNNER_ARCH = ({ x64: 'X64', arm64: 'ARM64', ia32: 'X86', arm: 'ARM' } as Record<string, string>)[process.arch] ?? process.arch;

type Mapping = Record<string, unknown>;

function isMapping(value: unknown): value is Mapping {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapping(value: unknown, where: string): Mapping {
  if (value === undefined || value === null) return {};
  if (!isMapping(value)) throw new Error(`${where} is not a mapping`);
  return value;
}

function text(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${where} is not a text`);
  return value;
}

function stepList(value: unknown, where: string): Mapping[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isMapping)) throw new Error(`${where} is not a list of steps`);
  return value;
}

function readYaml(file: string): Mapping {
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const value: unknown = parseYaml(readFileSync(file, 'utf8'));
  if (!isMapping(value)) throw new Error(`${file} holds no YAML mapping`);
  return value;
}

/**
 * An expression of the workflow: a text with its `${{ }}` expressions, and for a condition without a status function the
 * `success() &&` that GitHub puts before it.
 */
export type Expression = Template & { needsSuccess: boolean };

/** The value of an expression with the contexts and the status of the run. */
function valueOf(expression: Expression, contexts: Record<string, Value>, status: Status = { success: true, failure: false, cancelled: false }): Value {
  if (expression.needsSuccess && !(status.success && !status.cancelled)) return false;
  return evaluateTemplate(expression, contexts, status);
}

function textOf(expression: Expression, contexts: Record<string, Value>, status?: Status): string {
  return toText(valueOf(expression, contexts, status));
}

function referencesOf(expression: Expression, contexts?: Record<string, Value>, status?: Status): Reference[] {
  return expression.parts.flatMap(part => (typeof part === 'string' ? [] : references(part, contexts, status)));
}

function parsed(make: () => Template, where: string, needsSuccess = false): Expression {
  try {
    return { ...make(), needsSuccess };
  } catch (error) {
    throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** A value of the workflow as an expression: a number or a bool keeps its kind, and null is the empty text. */
function template(value: unknown, where: string): Expression {
  if (value === null) return { text: '', parts: [], needsSuccess: false };
  if (typeof value === 'number' || typeof value === 'boolean') return parsed(() => ({ text: String(value), parts: [parseExpression(String(value))] }), where);
  if (typeof value !== 'string') throw new Error(`${where} is not a text, a number or a bool`);
  return parsed(() => parseTemplate(value), where);
}

/** A condition (`if:`): an expression with or without `${{ }}`, under `success() &&` when it calls no status function. */
function condition(value: unknown, where: string): Expression {
  if (value === undefined) return parsed(() => ({ text: 'success()', parts: [parseExpression('success()')] }), where);
  if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') throw new Error(`${where}: if is not a text, a number or a bool`);
  const text = String(value);
  const expression = parsed(() => (text.includes('${{') ? parseTemplate(text) : { text, parts: [parseExpression(text)] }), `${where}: if`);
  return { ...expression, needsSuccess: !expression.parts.some(part => typeof part !== 'string' && callsStatus(part)) };
}

/** Where an expression is evaluated: the contexts that GitHub gives there, the needs of the job and the steps of its scope. */
type Place = {
  roots: readonly string[];
  needs: readonly string[];
  /** The ids of the steps of the scope: the external action that a step runs, or undefined for a step that the run runs. */
  steps: Map<string, string | undefined>;
  composite: boolean;
  inputsCause?: string | undefined;
  /** The needed jobs whose outputs the job reads, which the check fills. */
  read: Set<string>;
};

const ROOT_CAUSES: Record<string, string> = {
  secrets: 'a secret of the repository, which lives on GitHub',
  vars: 'a variable of the repository, which lives on GitHub',
  job: 'the job context of a GitHub runner, which the local run does not give',
  strategy: 'the strategy context of a GitHub runner, which the local run does not give',
  inputs: 'the inputs of a workflow call or a dispatch, which a local run of one job is not given',
};

const INPUT_EVENTS = ['workflow_call', 'workflow_dispatch'] as const;
type InputEvent = typeof INPUT_EVENTS[number];
export type WorkflowInputSelection = { inputs?: readonly string[] | undefined; inputEvent?: InputEvent | undefined };
type BoundInputs = { values: Record<string, Value> | undefined; event: InputEvent | undefined; cause: string | undefined };
type InputDeclaration = { name: string; type: string; required: boolean; fallback: Value | undefined; options: readonly string[] | undefined };

/** Validate the declaration independently of the values supplied to this local run. */
function inputDeclaration(name: string, value: unknown, event: InputEvent, where: string): InputDeclaration {
  const at = `${where} input ${name}`;
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error(`${at}: invalid input name`);
  if (Object.hasOwn(Object.prototype, name.toLowerCase())) throw new Error(`${at}: unsupported native Dictionary key; its case-folded name collides with an inherited property`);
  const entry = mapping(value, at);
  const allowed = ['description', 'type', 'required', 'default', ...(event === 'workflow_dispatch' ? ['options'] : [])];
  for (const key of Object.keys(entry)) if (!allowed.includes(key)) throw new Error(`${at}: unsupported declaration ${key}`);
  const types = event === 'workflow_call' ? ['boolean', 'number', 'string'] : ['boolean', 'number', 'string', 'choice', 'environment'];
  if (typeof entry.type !== 'string' || !types.includes(entry.type)) throw new Error(`${at}: type must be ${types.join(', ')}`);
  if (entry.required !== undefined && typeof entry.required !== 'boolean') throw new Error(`${at}: required must be boolean`);
  if (entry.description !== undefined && typeof entry.description !== 'string') throw new Error(`${at}: description must be string`);
  let options: readonly string[] | undefined;
  if (entry.type === 'choice') {
    if (!Array.isArray(entry.options) || entry.options.length === 0 || !entry.options.every(item => typeof item === 'string')) throw new Error(`${at}: choice options must be a nonempty list of strings`);
    options = entry.options;
    if (new Set(options).size !== options.length) throw new Error(`${at}: choice options must be distinct`);
  } else if (entry.options !== undefined) throw new Error(`${at}: options require choice type`);
  const declaration: InputDeclaration = { name, type: entry.type, required: entry.required === true, fallback: undefined, options };
  if (Object.hasOwn(entry, 'default')) {
    if (typeof entry.default === 'string' && entry.default.includes('${{')) throw new Error(`${at}: expression default is not supported; supply a literal default`);
    declaration.fallback = inputValue(entry.default, declaration, `${at} default`);
  }
  return declaration;
}

function inputValue(value: unknown, declaration: InputDeclaration, where: string): Value {
  const type = declaration.type === 'choice' || declaration.type === 'environment' ? 'string' : declaration.type;
  if (typeof value !== type) throw new Error(`${where} must be ${type}`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${where} must be a finite number`);
  if (declaration.options !== undefined && !declaration.options.includes(String(value))) throw new Error(`${where} must belong to options ${JSON.stringify(declaration.options)}`);
  return plainValue(value);
}

/** CLI values are text; decode only the declared scalar type, without coercing empty text to zero or false. */
function inputArgument(value: string, declaration: InputDeclaration, where: string): Value {
  if (declaration.type === 'boolean') {
    if (value !== 'true' && value !== 'false') throw new Error(`${where} must be exactly true or false`);
    return value === 'true';
  }
  if (declaration.type === 'number') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`${where} must be a finite JSON number without whitespace`);
    return Number(value);
  }
  return inputValue(value, declaration, where);
}

/** Select local declarations, not a GitHub event: no event identity or event payload is fabricated. */
function bindWorkflowInputs(document: Mapping, workflow: string, selection: WorkflowInputSelection): BoundInputs {
  const on = document.on;
  const events: Mapping = typeof on === 'string' ? { [on]: null }
    : Array.isArray(on) && on.every(item => typeof item === 'string') ? Object.fromEntries(on.map(item => [item, null]))
      : mapping(on, `${workflow} on`);
  const available = INPUT_EVENTS.filter(event => Object.hasOwn(events, event));
  if (selection.inputEvent !== undefined && !available.includes(selection.inputEvent)) throw new Error(`${workflow}: input event ${selection.inputEvent} is not declared`);
  const event = selection.inputEvent ?? (available.length === 1 ? available[0] : undefined);
  const arguments_ = selection.inputs ?? [];
  if (event === undefined) {
    const cause = available.length > 1 ? 'select --input-event workflow_call or --input-event workflow_dispatch before binding workflow inputs'
      : ROOT_CAUSES.inputs;
    if (arguments_.length > 0) throw new Error(`${workflow}: ${cause}`);
    return { values: undefined, event: undefined, cause };
  }
  const where = `${workflow} on.${event}`;
  const configuration = mapping(events[event], where);
  const declarations = Object.entries(mapping(configuration.inputs, `${where} inputs`)).map(([name, value]) => inputDeclaration(name, value, event, where));
  const names = new Map<string, InputDeclaration>();
  for (const declaration of declarations) {
    const key = declaration.name.toLowerCase();
    const previous = names.get(key);
    if (previous !== undefined) throw new Error(`${where}: ambiguous input names ${previous.name} and ${declaration.name}`);
    names.set(key, declaration);
  }
  const given = new Map<string, Value>();
  for (const argument of arguments_) {
    const equals = argument.indexOf('=');
    if (equals < 1) throw new Error(`${workflow}: --input must be name=value: ${JSON.stringify(argument)}`);
    const name = argument.slice(0, equals);
    const declaration = names.get(name.toLowerCase());
    if (declaration === undefined) throw new Error(`${where}: input ${name} is not declared`);
    if (given.has(declaration.name)) throw new Error(`${where}: duplicate input ${name}`);
    given.set(declaration.name, inputArgument(argument.slice(equals + 1), declaration, `${where} input ${name}`));
  }
  const values = Object.fromEntries(declarations.map(declaration => {
    if (given.has(declaration.name)) return [declaration.name, given.get(declaration.name) ?? null];
    if (declaration.fallback !== undefined) return [declaration.name, declaration.fallback];
    if (declaration.required) throw new Error(`${where} input ${declaration.name} is required; supply --input ${declaration.name}=value`);
    if (event === 'workflow_dispatch') throw new Error(`${where} input ${declaration.name}: supply --input ${declaration.name}=value; the native omitted value is not established by this local runner`);
    return [declaration.name, declaration.type === 'boolean' ? false : declaration.type === 'number' ? 0 : ''];
  }));
  return { values, event, cause: undefined };
}

/** Throws with `where` when `expression` reads a context or a property that the run does not give at `place`. */
function check(expression: Expression, place: Place, where: string): void {
  for (const { path: chain, dynamic } of referencesOf(expression)) {
    const [root = '', first, second] = chain;
    const name = chain.join('.') + (dynamic ? '[...]' : '');
    const refuse: (cause: string) => never = cause => {
      throw new Error(`${where}: ${expression.text} reads ${name}, ${cause}`);
    };
    if (!place.roots.includes(root)) {
      if (root === 'needs' && place.composite) refuse('which a composite action does not have');
      refuse((root === 'inputs' ? place.inputsCause : undefined) ?? ROOT_CAUSES[root] ?? `which is not a context of GitHub Actions that the local run gives here (${place.roots.join(', ')})`);
    }
    if (root === 'github') {
      const allowed = place.composite ? ['workspace', 'action_path'] : ['workspace'];
      if (first === undefined || !allowed.includes(first.toLowerCase())) refuse(`a value of a run of GitHub; the local run gives only github.${allowed.join(' and github.')}`);
    } else if (root === 'runner') {
      if (first === undefined || !['os', 'arch', 'temp'].includes(first.toLowerCase())) refuse('a value of a GitHub runner; the local run gives only runner.os, runner.arch and runner.temp');
    } else if (root === 'needs') {
      if (first === undefined || second?.toLowerCase() !== 'outputs') refuse('the outcome of other jobs of the CI run, which a local run of one job does not have: only needs.<job>.outputs, which the run gets by running that job first');
      const needed = place.needs.find(each => each.toLowerCase() === first.toLowerCase());
      if (needed === undefined) refuse(`but the job needs no job ${first}`);
      place.read.add(needed);
    } else if (root === 'steps' && first !== undefined) {
      const uses = place.steps.get(first.toLowerCase());
      if (uses !== undefined) refuse(`the step ${first} of the external action ${uses}, which the local run does not run`);
    }
  }
}

/** One step that the run executes or names, with its expressions. */
export type PlannedStep =
  | { kind: 'run'; label: string; id: string | undefined; condition: Expression; run: Expression; shell: Expression | undefined; env: Record<string, Expression>; directory: Expression | undefined; continueOnError: Expression | undefined }
  | { kind: 'action'; label: string; id: string | undefined; condition: Expression; uses: string; with: Mapping }
  | {
    kind: 'composite'; label: string; id: string | undefined; condition: Expression; uses: string; with: Record<string, Expression>; env: Record<string, Expression>;
    continueOnError: Expression | undefined; path: string; inputs: Record<string, Expression>; outputs: Record<string, Expression>; steps: PlannedStep[];
  };

/** The expressions evaluated in a step's caller scope; composite outputs belong to its inner scope. */
function stepExpressions(step: PlannedStep): Expression[] {
  if (step.kind === 'action') return [step.condition];
  const common = [step.condition, ...Object.values(step.env), step.continueOnError];
  const own = step.kind === 'run' ? [step.run, step.shell, step.directory] : [...Object.values(step.with), ...Object.values(step.inputs)];
  return [...common, ...own].filter((item): item is Expression => item !== undefined);
}

/** Resolve computed producer names when their contexts are known, before an external output can become a silent null. */
function checkExternalProducers(expressions: Expression[], steps: PlannedStep[], values: Record<string, Value>, where: string, status?: Status): void {
  const external = steps.filter(step => step.kind === 'action' && step.id !== undefined);
  if (external.length === 0) return;
  for (const expression of expressions) {
    for (const reference of referencesOf(expression, values, status)) {
      const [root, producer] = reference.path;
      if (root !== 'steps') continue;
      const candidates = producer === undefined
        ? reference.dynamic && status !== undefined ? external : []
        : external.filter(step => step.id?.toLowerCase() === producer.toLowerCase());
      if (candidates.length > 0) throw new Error(`${where}: ${expression.text} reads the step outputs of the external action ${candidates.map(step => step.kind === 'action' ? step.uses : '').join(', ')}, which the local run does not run`);
    }
  }
}

function expressions(value: unknown, place: Place, where: string): Record<string, Expression> {
  const result: Record<string, Expression> = {};
  for (const [key, item] of Object.entries(mapping(value, where))) {
    result[key] = template(item, `${where} ${key}`);
    check(result[key], place, `${where} ${key}`);
  }
  return result;
}

function checkEnvironmentKeys(value: unknown, where: string): void {
  for (const key of Object.keys(mapping(value, where))) {
    try { checkEnvironmentName(key); }
    catch (error) {
      const refusal = environmentRefusal(error);
      if (refusal !== undefined) throw new EnvironmentRefusal(`${where}: ${refusal.message}`, { cause: error });
      throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
}

function environmentExpressions(value: unknown, place: Place, where: string): Record<string, Expression> {
  checkEnvironmentKeys(value, where);
  return expressions(value, place, where);
}

function optional(value: unknown, place: Place, where: string): Expression | undefined {
  if (value === undefined) return undefined;
  const expression = template(value, where);
  check(expression, place, where);
  return expression;
}

const STEP_ROOTS = ['github', 'needs', 'matrix', 'runner', 'env', 'steps'];
const COMPOSITE_ROOTS = ['github', 'matrix', 'runner', 'env', 'steps', 'inputs'];

function planSteps(root: string, list: Mapping[], place: Place, where: string, ancestors: readonly string[] = []): PlannedStep[] {
  for (const step of list) {
    const id = text(step.id, `${where} id`);
    const uses = text(step.uses, `${where} uses`);
    if (id !== undefined) place.steps.set(id.toLowerCase(), uses !== undefined && !uses.startsWith('./') ? uses : undefined);
  }
  return list.map((step, index) => {
    const name = text(step.name, `${where} step ${index + 1} name`);
    const label = `${where} step ${index + 1}${name ? ` (${name})` : ''}`;
    const id = text(step.id, `${label} id`);
    const when = condition(step.if, label);
    check(when, place, `${label}: if`);
    // A plain scalar of YAML, such as `run: true`, is the text that it reads as, as GitHub reads a scalar of a text field.
    const run = typeof step.run === 'boolean' || typeof step.run === 'number' ? String(step.run) : text(step.run, `${label} run`);
    const uses = text(step.uses, `${label} uses`);
    if (uses !== undefined && run === undefined && !uses.startsWith('./')) {
      checkEnvironmentKeys(step.env, `${label}: env`);
      return { kind: 'action', label, id, condition: when, uses, with: mapping(step.with, `${label} with`) };
    }
    const env = environmentExpressions(step.env, place, `${label}: env`);
    const continueOnError = optional(step['continue-on-error'], place, `${label}: continue-on-error`);
    if (run !== undefined) {
      if (place.composite && step.shell === undefined) throw new Error(`${label}: a run step of a composite action needs shell, as GitHub requires`);
      const expression = template(run.trim(), `${label}: run`);
      check(expression, place, `${label}: run`);
      return { kind: 'run', label, id, condition: when, run: expression, shell: optional(step.shell, place, `${label}: shell`), env, directory: optional(step['working-directory'], place, `${label}: working-directory`), continueOnError };
    }
    if (uses?.startsWith('./')) {
      const directory = path.join(root, uses);
      const relative = path.relative(root, directory).split(path.sep).join('/');
      if (ancestors.includes(relative)) throw new Error(`${label}: composite action cycle: ${[...ancestors, relative].join(' -> ')}`);
      const file = ['action.yml', 'action.yaml'].map(each => path.join(directory, each)).find(existsSync);
      if (file === undefined) throw new Error(`${label}: ${uses} has no action.yml`);
      const action = readYaml(file);
      const runs = mapping(action.runs, `${uses} runs`);
      if (runs.using !== 'composite') throw new Error(`${label}: ${uses} is not a composite action`);
      const inner: Place = { roots: COMPOSITE_ROOTS, needs: [], steps: new Map(), composite: true, read: new Set() };
      const inputs: Record<string, Expression> = {};
      for (const [key, input] of Object.entries(mapping(action.inputs, `${uses} inputs`))) {
        const fallback = mapping(input, `${uses} inputs ${key}`).default;
        inputs[key] = template(fallback ?? null, `${uses} inputs ${key} default`);
        check(inputs[key], { ...inner, roots: ['github', 'matrix', 'runner', 'env'] }, `${uses} inputs ${key} default`);
      }
      const steps = planSteps(root, stepList(runs.steps, `${uses} steps`), inner, `${label} > ${uses}`, [...ancestors, relative]);
      const outputs: Record<string, Expression> = {};
      for (const [key, output] of Object.entries(mapping(action.outputs, `${uses} outputs`))) {
        outputs[key] = template(mapping(output, `${uses} outputs ${key}`).value ?? '', `${uses} outputs ${key}`);
        check(outputs[key], inner, `${uses} outputs ${key}`);
      }
      return { kind: 'composite', label, id, condition: when, uses, with: expressions(step.with, place, `${label}: with`), env, continueOnError, path: directory, inputs, outputs, steps };
    }
    throw new Error(`${label}: neither run nor uses`);
  });
}

/** The values of one combination of a matrix, by key. */
export type Combination = Record<string, Value>;

/** The plan of one job: the jobs that run first, its condition, its matrix and its steps. */
export type JobPlan = {
  workflow: string;
  job: string;
  where: string;
  root: string;
  inputs: Record<string, Value> | undefined;
  inputEvent: InputEvent | undefined;
  /** The needed jobs whose outputs the job reads, which run first. */
  needs: JobPlan[];
  condition: Expression | undefined;
  /** The matrix as the workflow writes it. */
  matrix: unknown;
  /** The combinations, or undefined while they depend on the outputs of a needed job. */
  combinations: Combination[] | undefined;
  failFast: Expression | undefined;
  env: { workflow: Record<string, Expression>; job: Record<string, Expression> };
  defaults: { shell: Expression | undefined; directory: Expression | undefined };
  outputs: Record<string, Expression>;
  steps: PlannedStep[];
};

function plainValue(value: unknown): Value {
  if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value ?? null;
  if (Array.isArray(value)) return value.map(plainValue);
  if (isMapping(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValue(item)]));
  throw new Error(`the workflow holds a value that is not a text, a number, a bool, a list or a mapping: ${typeof value}`);
}

/** The matrix with each text that holds `${{ }}` replaced by its value, deeply. */
function resolve(value: unknown, contexts: Record<string, Value>, where: string): Value {
  if (typeof value === 'string' && value.includes('${{')) return valueOf(template(value, where), contexts);
  if (Array.isArray(value)) return value.map(item => resolve(item, contexts, where));
  if (isMapping(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, contexts, `${where} ${key}`)]));
  return plainValue(value);
}

function sameValue(left: Value, right: Value): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function entries(value: Value, where: string): Combination[] {
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) throw new Error(`${where} is not a list of mappings`);
  return value.filter((item): item is Combination => item !== null && typeof item === 'object' && !Array.isArray(item));
}

/**
 * The combinations of a matrix, by the rules of GitHub: the product of the axes in the order of their keys, without each
 * combination that every key of an entry of `exclude` matches; then each entry of `include` extends each combination of that
 * product whose axes it matches (a key of the entry that is no axis matches) and may overwrite a value that an earlier entry
 * added, or is a combination of its own when it matches none.
 */
export function matrixCombinations(matrix: Value, where: string): Combination[] {
  if (matrix === null) return [{}];
  if (typeof matrix !== 'object' || Array.isArray(matrix)) throw new Error(`${where} matrix is not a mapping`);
  const { include = null, exclude = null, ...axes } = matrix;
  const names = Object.keys(axes);
  let product: Combination[] = names.length > 0 ? [{}] : [];
  for (const name of names) {
    const values = axes[name];
    if (!Array.isArray(values) || values.length === 0) throw new Error(`${where} matrix ${name} is not a list of values`);
    product = product.flatMap(base => values.map(value => ({ ...base, [name]: value })));
  }
  const excluded = entries(exclude, `${where} matrix exclude`);
  for (const entry of excluded) {
    const unknown = Object.keys(entry).find(key => !names.includes(key));
    if (unknown !== undefined) throw new Error(`${where} matrix exclude names ${unknown}, which is no axis of the matrix`);
  }
  product = product.filter(item => !excluded.some(entry => Object.entries(entry).every(([key, value]) => sameValue(item[key] ?? null, value))));
  const added: Combination[] = [];
  for (const entry of entries(include, `${where} matrix include`)) {
    const matches = product.filter(item => Object.entries(entry).every(([key, value]) => !names.includes(key) || sameValue(item[key] ?? null, value)));
    for (const item of matches) Object.assign(item, entry);
    if (matches.length === 0) added.push({ ...entry });
  }
  return [...product, ...added];
}

function selected(item: Combination, select: Record<string, string>): boolean {
  return Object.entries(select).every(([key, value]) => {
    const own = item[key];
    return own !== undefined && (typeof own === 'object' && own !== null ? JSON.stringify(own) : toText(own)) === value;
  });
}

function needsOf(entry: Mapping, where: string): string[] {
  const needs = entry.needs;
  if (needs === undefined) return [];
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs) && needs.every(item => typeof item === 'string')) return needs;
  throw new Error(`${where} needs is not a job or a list of jobs`);
}

/** Whether every reference of `expression` is to a context of `roots`. */
function decidable(expression: Expression, roots: string[]): boolean {
  return referencesOf(expression).every(({ path: chain }) => roots.includes(chain[0] ?? ''));
}

/** The contexts of an expression of the job before its steps: github and the outputs of the needed jobs. */
function jobContexts(root: string, needs: Record<string, Value>, inputs?: Record<string, Value>): Record<string, Value> {
  return { github: { workspace: root }, needs, ...(inputs === undefined ? {} : { inputs }) };
}

/**
 * The plan of job `job` of `workflow` (a path relative to `root`), with the combinations of its matrix that match every key
 * and value of `select`, decided when its matrix reads no needed job. Throws with the cause, also when `select` matches no
 * combination.
 */
export function planJob(root: string, workflow: string, job: string, select: Record<string, string> = {}, inputSelection: WorkflowInputSelection = {}): JobPlan {
  return planJobGraph(root, workflow, job, select, [], inputSelection);
}

function planJobGraph(root: string, workflow: string, job: string, select: Record<string, string>, ancestors: readonly string[], inputSelection: WorkflowInputSelection): JobPlan {
  const document = readYaml(path.resolve(root, workflow));
  const bound = bindWorkflowInputs(document, workflow, inputSelection);
  const jobs = mapping(document.jobs, `${workflow} jobs`);
  const canonical = Object.keys(jobs).find(each => each.toLowerCase() === job.toLowerCase());
  if (canonical === undefined) throw new Error(`${workflow} has no job ${job}; its jobs are ${Object.keys(jobs).join(', ') || 'none'}`);
  job = canonical;
  if (ancestors.includes(job)) throw new Error(`${workflow}: job dependency cycle: ${[...ancestors, job].join(' -> ')}`);
  const entry = mapping(jobs[job], `${workflow} job ${job}`);
  const where = `${workflow} job ${job}`;
  if (entry.uses !== undefined) throw new Error(`${workflow}: job ${job} calls the reusable workflow ${JSON.stringify(entry.uses)}; run its job by its own workflow`);
  for (const key of ['container', 'services', 'continue-on-error']) {
    if (entry[key] !== undefined) throw new Error(`${where} has ${key}, which the local run does not give as CI does`);
  }
  const needs = needsOf(entry, where);
  const read = new Set<string>();
  const at = (roots: string[]): Place => ({ roots: bound.values === undefined ? roots : [...roots, 'inputs'], inputsCause: bound.cause, needs, steps: new Map(), composite: false, read });
  const workflowEnv = environmentExpressions(document.env, at(['github']), `${workflow}: env`);
  const jobEnv = environmentExpressions(entry.env, at(['github', 'needs', 'matrix']), `${where}: env`);
  const jobCondition = entry.if === undefined ? undefined : condition(entry.if, where);
  if (jobCondition) check(jobCondition, at(['github', 'needs']), `${where}: if`);
  const strategy = mapping(entry.strategy, `${where} strategy`);
  const matrix = strategy.matrix;
  const matrixPlace = at(['github', 'needs']);
  const matrixReads = new Set<string>();
  const checkMatrix = (value: unknown, label: string): void => {
    if (typeof value === 'string' && value.includes('${{')) {
      const expression = template(value, label);
      check(expression, matrixPlace, label);
      for (const reference of referencesOf(expression)) if (reference.path[0] === 'needs') matrixReads.add(reference.path[1] ?? '');
    } else if (Array.isArray(value)) {
      value.forEach(item => { checkMatrix(item, label); });
    } else if (isMapping(value)) {
      for (const [key, item] of Object.entries(value)) checkMatrix(item, `${label} ${key}`);
    }
  };
  checkMatrix(matrix, `${where}: matrix`);
  const failFast = optional(strategy['fail-fast'], at(['github', 'needs']), `${where}: fail-fast`);
  const defaultsOf = (value: unknown, label: string) => mapping(mapping(value, `${label} defaults`).run, `${label} defaults run`);
  const defaults = { ...defaultsOf(document.defaults, workflow), ...defaultsOf(entry.defaults, where) };
  const defaultsPlace = at(['github', 'needs', 'matrix', 'env']);
  const stepPlace = at(STEP_ROOTS);
  const steps = planSteps(root, stepList(entry.steps, `${where} steps`), stepPlace, where);
  const outputs = expressions(entry.outputs, stepPlace, `${where}: outputs`);
  const plan: JobPlan = {
    workflow, job, where, root, inputs: bound.values, inputEvent: bound.event, needs: [], condition: jobCondition, matrix, combinations: undefined, failFast,
    env: { workflow: workflowEnv, job: jobEnv },
    defaults: { shell: optional(defaults.shell, defaultsPlace, `${where}: defaults shell`), directory: optional(defaults['working-directory'], defaultsPlace, `${where}: defaults working-directory`) },
    outputs, steps,
  };
  for (const name of needs.filter(each => read.has(each))) {
    const needed = planJobGraph(root, workflow, name, {}, [...ancestors, job], inputSelection);
    if (needed.matrix !== undefined) throw new Error(`${where} reads the outputs of job ${name}, which has a matrix: CI gives the outputs of the combination that ends last, which a local run cannot reproduce`);
    plan.needs.push(needed);
  }
  if (matrixReads.size === 0) {
    const all = matrixCombinations(resolve(matrix, jobContexts(root, {}, bound.values), `${where}: matrix`), where);
    const chosen = all.filter(item => selected(item, select));
    if (chosen.length === 0) throw new Error(`${where}: no combination of its matrix has ${JSON.stringify(select)}; its combinations are ${all.map(item => JSON.stringify(item)).join(', ') || 'none'}`);
    plan.combinations = chosen;
    for (const item of chosen) checkPlannedProducers(plan.steps, { matrix: item, ...jobContexts(root, {}, bound.values) }, where);
    if (!WINDOWS) for (const item of chosen) refuseShells(plan.steps, item, root);
  }
  return plan;
}

function checkPlannedProducers(steps: PlannedStep[], values: Record<string, Value>, where: string): void {
  for (const step of steps) {
    checkExternalProducers(stepExpressions(step), steps, values, where);
    if (step.kind === 'composite') {
      // Composite inputs are strings bound in their own scope at runtime; caller inputs cannot decide their producers.
      const innerValues = { ...values };
      delete innerValues.inputs;
      checkPlannedProducers(step.steps, innerValues, step.label);
    }
  }
}

/** The shells of the runner of this machine, as GitHub starts them: the command line of the script file `{0}`. */
const BASH = ['bash', '--noprofile', '--norc', '-eo', 'pipefail', '{0}'];
const SHELLS: Record<string, string[]> = WINDOWS
  ? { '': ['pwsh', '-command', ". '{0}'"], pwsh: ['pwsh', '-command', ". '{0}'"], bash: BASH, sh: ['sh', '-e', '{0}'] }
  : { '': ['bash', '-e', '{0}'], bash: BASH, sh: ['sh', '-e', '{0}'] };

/** Throws for a step whose shell the machine does not give when its condition, decided with the matrix alone, holds. */
function refuseShells(list: PlannedStep[], combination: Combination, root: string): void {
  for (const step of list) {
    if (step.kind !== 'run' || step.shell === undefined || !decidable(step.shell, ['matrix', 'github']) || !decidable(step.condition, ['matrix', 'runner', 'github'])) continue;
    const contexts = { matrix: combination, runner: { os: RUNNER_OS, arch: RUNNER_ARCH }, github: { workspace: root } };
    const shell = textOf(step.shell, contexts);
    if (!(shell in SHELLS) && truthy(valueOf(step.condition, contexts))) throw new Error(`${step.label}: shell ${shell} is not a shell that the local run gives on ${RUNNER_OS} (${Object.keys(SHELLS).filter(Boolean).join(', ')})`);
  }
}

/** The state of one run of a job: its environment from `GITHUB_ENV`, its folders from `GITHUB_PATH` and its counts. */
type JobState = {
  plan: JobPlan;
  runnerTemp: string;
  matrix: Combination;
  needs: Record<string, Value>;
  env: Record<string, string>;
  path: string[];
  defaults: { shell: string | undefined; directory: string | undefined };
  scripts: number;
  passed: number;
  failed: number;
  interrupted: () => number | undefined;
  print: (line: string) => void;
};

type StepResult = { outputs: Record<string, string>; outcome: string; conclusion: string };

/** The steps of a scope: the job, or a composite action with its inputs and its folder. */
type Frame = { steps: Record<string, StepResult>; failed: boolean; inputs: Record<string, Value> | undefined; actionPath: string | undefined };

function contexts(state: JobState, frame: Frame, env: Record<string, string>): Record<string, Value> {
  const github: Record<string, Value> = { workspace: state.plan.root };
  if (frame.actionPath !== undefined) github.action_path = frame.actionPath;
  const result: Record<string, Value> = {
    github, needs: state.needs, matrix: state.matrix, runner: { os: RUNNER_OS, arch: RUNNER_ARCH, temp: state.runnerTemp },
    env: mergeEnvironment([state.env, env]), steps: frame.steps,
  };
  if (frame.inputs !== undefined) result.inputs = frame.inputs;
  return result;
}

function texts(map: Record<string, Expression>, values: Record<string, Value>, status = { success: true, failure: false, cancelled: false }): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([key, expression]) => [key, textOf(expression, values, status)]));
}

/** The pairs of a file command of GitHub: `name=value` lines and `name<<DELIMITER` blocks. */
export function fileCommand(content: string, where: string): [string, string][] {
  const lines = content.split(/\r?\n/);
  const result: [string, string][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line === '') continue;
    const equals = line.indexOf('=');
    const heredoc = line.indexOf('<<');
    if (equals > 0 && (heredoc < 0 || equals < heredoc)) {
      result.push([line.slice(0, equals), line.slice(equals + 1)]);
    } else if (heredoc > 0 && (equals < 0 || heredoc < equals)) {
      const delimiter = line.slice(heredoc + 2);
      const end = lines.indexOf(delimiter, index + 1);
      if (delimiter === '' || end < 0) throw new Error(`${where}: ${line} opens a block whose delimiter ${JSON.stringify(delimiter)} no later line closes`);
      result.push([line.slice(0, heredoc), lines.slice(index + 1, end).join('\n')]);
      index = end;
    } else {
      throw new Error(`${where}: ${JSON.stringify(line)} is neither name=value nor name<<DELIMITER`);
    }
  }
  return result;
}

const temps = new Set<string>();

function removeTemps(): void {
  for (const directory of temps) rmSync(directory, { recursive: true, force: true });
  temps.clear();
}

async function spawnScript(argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv }, label: string, print: (line: string) => void): Promise<number> {
  const [command = '', ...args] = argv;
  const result = await runCommand({ command, args, ...options });
  const failure = failureOf(result);
  if (failure !== undefined) print(`[ci-job] ${label}: ${failure}`);
  return failure === undefined ? 0 : result.status || (result.signal ? 128 : 1);
}

/** Runs one run step and gives its outputs; its environment and folders go to the state. */
async function runScript(step: Extract<PlannedStep, { kind: 'run' }>, state: JobState, values: Record<string, Value>, env: Record<string, string>, inComposite: boolean, expressionStatus: Status): Promise<{ status: number; outputs: Record<string, string> }> {
  const shell = step.shell ? textOf(step.shell, values, expressionStatus) : inComposite ? undefined : state.defaults.shell;
  const argv = SHELLS[shell ?? ''];
  if (argv === undefined) {
    state.print(`[ci-job] refused: ${step.label}: shell ${shell ?? '(default)'} is not a shell that the local run gives on ${RUNNER_OS}`);
    return { status: 1, outputs: {} };
  }
  const command = textOf(step.run, values, expressionStatus);
  const directory = step.directory ? textOf(step.directory, values, expressionStatus) : inComposite ? undefined : state.defaults.directory;
  state.scripts += 1;
  const commands = path.join(state.runnerTemp, '_runner_file_commands');
  mkdirSync(commands, { recursive: true });
  const files = Object.fromEntries(['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY'].map(name => [name, path.join(commands, `${name.toLowerCase()}_${state.scripts}`)]));
  for (const file of Object.values(files)) writeFileSync(file, '');
  const script = path.join(state.runnerTemp, `${state.scripts}.${argv[0] === 'pwsh' ? 'ps1' : 'sh'}`);
  writeFileSync(script, `${command}\n`);
  state.print(`[ci-job] ${step.label}: ${command}`);
  const own = mergeEnvironment<string | undefined>([
    process.env, state.env, env, files,
    { CI: 'true', CI_JOB_LOCAL: '1', GITHUB_WORKSPACE: state.plan.root, RUNNER_TEMP: state.runnerTemp, RUNNER_OS, RUNNER_ARCH },
  ]);
  const status = await spawnScript(argv.map(arg => arg.replace('{0}', script)), {
    cwd: path.resolve(state.plan.root, directory ?? '.'),
    env: mergeEnvironment([own, { PATH: [...state.path, environmentValue(own, 'PATH') ?? ''].join(path.delimiter) }]),
  }, step.label, state.print);
  const read = (name: string) => readFileSync(files[name] ?? '', 'utf8');
  let outputs: Record<string, string> = {};
  let failedCommand = false;
  const environmentRefusals: EnvironmentRefusal[] = [];
  const commandsOf = (name: string): [string, string][] => {
    try { return fileCommand(read(name), `${step.label}: ${name}`); } catch (error) {
      state.print(`[ci-job] ${error instanceof Error ? error.message : String(error)}`);
      failedCommand = true;
      return [];
    }
  };
  outputs = Object.fromEntries(commandsOf('GITHUB_OUTPUT'));
  for (const [key, value] of commandsOf('GITHUB_ENV')) {
    if (key.toUpperCase() === 'NODE_OPTIONS') {
      state.print(`[ci-job] ${step.label}: GITHUB_ENV cannot set ${key}, which the GitHub runner blocks`);
      failedCommand = true;
    } else {
      try { state.env = mergeEnvironment([state.env, Object.fromEntries([[key, value]])]); }
      catch (error) {
        const refusal = environmentRefusal(error);
        if (refusal !== undefined) environmentRefusals.push(new EnvironmentRefusal(`${step.label}: ${refusal.message}`, { cause: error }));
        else {
          state.print(`[ci-job] ${step.label}: ${error instanceof Error ? error.message : String(error)}`);
          failedCommand = true;
        }
      }
    }
  }
  const followingErrors: unknown[] = [];
  try {
    for (const folder of read('GITHUB_PATH').split(/\r?\n/).filter(line => line !== '')) {
      state.path = [folder, ...state.path.filter(each => each !== folder)];
    }
    const summary = read('GITHUB_STEP_SUMMARY');
    if (summary.trim() !== '') state.print(`[ci-job] summary of ${step.label}:\n${summary.trimEnd()}`);
  } catch (error) { followingErrors.push(error); }
  if (environmentRefusals.length > 0) {
    const errors = [...environmentRefusals, ...followingErrors];
    throw new EnvironmentRefusal(errors.map(error => error instanceof Error ? error.message : String(error)).join('; '), { cause: new AggregateError(errors, 'environment file capability refusal') });
  }
  if (followingErrors.length > 0) throw followingErrors[0];
  return { status: failedCommand && status === 0 ? 1 : status, outputs };
}

/** Runs the steps of a scope in order, as the runner does, and marks the frame failed when a step fails. */
async function runSteps(list: PlannedStep[], frame: Frame, state: JobState, inherited: Record<string, string>): Promise<void> {
  for (const step of list) {
    if (state.interrupted() !== undefined) return;
    const status = { success: !frame.failed, failure: frame.failed, cancelled: false };
    let result: StepResult;
    try {
      const before = contexts(state, frame, inherited);
      checkExternalProducers(step.kind === 'action' ? [] : Object.values(step.env), list, before, step.label, status);
      const env = step.kind === 'action' ? inherited : mergeEnvironment([inherited, texts(step.env, before, status)]);
      const values = contexts(state, frame, env);
      checkExternalProducers(stepExpressions(step), list, values, step.label, status);
      if (!truthy(valueOf(step.condition, values, status))) {
        state.print(`[ci-job] skipped: ${step.label}: if: ${step.condition.text}`);
        if (step.id !== undefined) frame.steps[step.id] = { outputs: {}, outcome: 'skipped', conclusion: 'skipped' };
        continue;
      }
      if (step.kind === 'action') {
        state.print(`[ci-job] not run on this machine: ${step.label}: ${step.uses} ${JSON.stringify(step.with)}`);
        continue;
      }
      let failed: boolean;
      let outputs: Record<string, string>;
      if (step.kind === 'run') {
        const ran = await runScript(step, state, values, env, frame.actionPath !== undefined, status);
        failed = ran.status !== 0;
        outputs = ran.outputs;
        if (failed) state.print(`[ci-job] failed: ${step.label} exited with status ${ran.status}: ${textOf(step.run, values, status)}`);
        else state.passed += 1;
      } else {
        const given = texts(step.with, values, status);
        const inputs = { ...given };
        for (const [key, fallback] of Object.entries(step.inputs)) if (!(key in given)) inputs[key] = textOf(fallback, values, status);
        const inner: Frame = { steps: {}, failed: false, inputs, actionPath: step.path };
        await runSteps(step.steps, inner, state, env);
        failed = inner.failed;
        checkExternalProducers(Object.values(step.outputs), step.steps, contexts(state, inner, env), step.label, { success: !inner.failed, failure: inner.failed, cancelled: false });
        outputs = texts(step.outputs, contexts(state, inner, env), { success: !inner.failed, failure: inner.failed, cancelled: false });
      }
      const tolerated = failed && step.continueOnError !== undefined && truthy(valueOf(step.continueOnError, values, status));
      if (tolerated) state.print(`[ci-job] continued: ${step.label} failed, and its continue-on-error holds`);
      result = { outputs, outcome: failed ? 'failure' : 'success', conclusion: failed && !tolerated ? 'failure' : 'success' };
    } catch (error) {
      const refusal = environmentRefusal(error);
      if (refusal !== undefined) throw refusal;
      state.print(`[ci-job] failed: ${step.label}: ${error instanceof Error ? error.message : String(error)}`);
      result = { outputs: {}, outcome: 'failure', conclusion: 'failure' };
    }
    if (step.id !== undefined) frame.steps[step.id] = result;
    if (result.conclusion === 'failure') {
      frame.failed = true;
      state.failed += 1;
    }
  }
}

type JobResult = { status: number; result: 'success' | 'failure' | 'skipped'; outputs: Record<string, string>; runs: number; passed: number };

async function runJob(plan: JobPlan, select: Record<string, string>, print: (line: string) => void, interrupted: () => number | undefined): Promise<JobResult> {
  const needs: Record<string, Value> = {};
  for (const needed of plan.needs) {
    print(`[ci-job] ${plan.where} reads the outputs of job ${needed.job}, which runs first, as in CI`);
    const done = await runJob(needed, {}, print, interrupted);
    if (done.result !== 'success') {
      print(`[ci-job] skipped: ${plan.where}, since the job ${needed.job} that it needs ended with ${done.result}`);
      return { status: done.status, result: 'skipped', outputs: {}, runs: 0, passed: 0 };
    }
    needs[needed.job] = { result: 'success', outputs: done.outputs };
  }
  const values = jobContexts(plan.root, needs, plan.inputs);
  if (plan.condition && !truthy(valueOf(plan.condition, values))) {
    print(`[ci-job] skipped: ${plan.where}: if: ${plan.condition.text}`);
    return { status: 0, result: 'skipped', outputs: {}, runs: 0, passed: 0 };
  }
  let chosen = plan.combinations;
  if (chosen === undefined) {
    const all = matrixCombinations(resolve(plan.matrix, values, `${plan.where}: matrix`), plan.where);
    chosen = all.filter(item => selected(item, select));
    if (chosen.length === 0) {
      print(`[ci-job] refused: ${plan.where}: no combination of its matrix has ${JSON.stringify(select)}; its combinations are ${all.map(item => JSON.stringify(item)).join(', ') || 'none'}`);
      return { status: 1, result: 'failure', outputs: {}, runs: 0, passed: 0 };
    }
    if (!WINDOWS) for (const item of chosen) refuseShells(plan.steps, item, plan.root);
  }
  const failFast = plan.failFast === undefined || truthy(valueOf(plan.failFast, values));
  let failed = false;
  let outputs: Record<string, string> = {};
  let passed = 0;
  let runs = 0;
  for (const item of chosen) {
    if (interrupted() !== undefined) break;
    const label = Object.keys(item).length > 0 ? `${plan.where} ${JSON.stringify(item)}` : plan.where;
    if (failed && failFast) {
      print(`[ci-job] cancelled by fail-fast: ${label}`);
      continue;
    }
    if (Object.keys(item).length > 0) print(`[ci-job] ${label}`);
    const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-job-'));
    temps.add(runnerTemp);
    try {
      const github = { workspace: plan.root };
      const workflowEnv = texts(plan.env.workflow, { github, ...(plan.inputs === undefined ? {} : { inputs: plan.inputs }) });
      const state: JobState = {
        plan, runnerTemp, matrix: item, needs, env: {}, path: [], defaults: { shell: undefined, directory: undefined }, scripts: 0, passed: 0, failed: 0, print, interrupted,
      };
      state.env = mergeEnvironment([workflowEnv, texts(plan.env.job, { github, needs, matrix: item, ...(plan.inputs === undefined ? {} : { inputs: plan.inputs }) })]);
      const frame: Frame = { steps: {}, failed: false, inputs: plan.inputs, actionPath: undefined };
      const before = contexts(state, frame, {});
      state.defaults = {
        shell: plan.defaults.shell && textOf(plan.defaults.shell, before),
        directory: plan.defaults.directory && textOf(plan.defaults.directory, before),
      };
      await runSteps(plan.steps, frame, state, {});
      checkExternalProducers(Object.values(plan.outputs), plan.steps, contexts(state, frame, {}), plan.where, { success: !frame.failed, failure: frame.failed, cancelled: false });
      outputs = texts(plan.outputs, contexts(state, frame, {}), { success: !frame.failed, failure: frame.failed, cancelled: false });
      passed += state.passed;
      runs += 1;
      if (frame.failed) {
        failed = true;
        print(`[ci-job] failed: ${label}: ${state.failed} ${state.failed === 1 ? 'step' : 'steps'} failed`);
      }
    } finally {
      rmSync(runnerTemp, { recursive: true, force: true });
      temps.delete(runnerTemp);
    }
  }
  return { status: failed ? 1 : 0, result: failed ? 'failure' : 'success', outputs, runs, passed };
}

/** Runs the job, the needed jobs whose outputs it reads first and each chosen combination in turn; gives the exit status. */
export async function ciJob({ root, workflow, job, select = {}, inputs, inputEvent, print = (line: string) => console.log(line) }: { root: string; workflow: string; job: string; select?: Record<string, string>; print?: (line: string) => void } & WorkflowInputSelection): Promise<number> {
  let plan: JobPlan;
  try {
    plan = planJob(root, workflow, job, select, { inputs, inputEvent });
  } catch (error) {
    print(`[ci-job] refused: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  let interruption: number | undefined;
  // runCommand owns termination and awaits command close. Its interrupted exit reaches this hook only after cleanup;
  // removing files in the signal handler would remove RUNNER_TEMP while the command is still using it.
  const onSignal = (signal: NodeJS.Signals) => { interruption ??= signal === 'SIGINT' ? 130 : 143; };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', removeTemps);
  try {
    const done = await runJob(plan, select, print, () => interruption);
    print(`[ci-job] ${workflow} job ${job}: ${done.result}, ${done.runs} ${done.runs === 1 ? 'run' : 'runs'}, ${done.passed} steps passed`);
    return interruption ?? done.status;
  } catch (error) {
    print(`[ci-job] refused: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('exit', removeTemps);
    removeTemps();
  }
}

function describeSteps(list: PlannedStep[], indent: string): string[] {
  return list.flatMap(step => {
    const when = step.condition.text === 'success()' ? '' : ` [if: ${step.condition.text}]`;
    if (step.kind === 'run') return [`${indent}${step.label}${when}: ${step.shell ? `shell ${step.shell.text}: ` : ''}${step.run.text.split('\n')[0] ?? ''}${step.run.text.includes('\n') ? ' ...' : ''}`];
    if (step.kind === 'action') return [`${indent}${step.label}${when}: not run on this machine: ${step.uses}`];
    return [`${indent}${step.label}${when}: composite ${step.uses}`, ...describeSteps(step.steps, `${indent}  `)];
  });
}

/** The lines of `--plan`: the jobs that run first, the condition, the combinations and the steps, without running them. */
export function describePlan(plan: JobPlan, indent = ''): string[] {
  const lines = [`${indent}job ${plan.job} of ${plan.workflow}`];
  if (plan.inputEvent !== undefined) lines.push(`${indent}  inputs from ${plan.inputEvent}: ${JSON.stringify(plan.inputs)}`);
  for (const needed of plan.needs) lines.push(`${indent}  runs first, for its outputs:`, ...describePlan(needed, `${indent}    `));
  if (plan.condition) lines.push(`${indent}  if: ${plan.condition.text}`);
  if (plan.combinations) lines.push(...plan.combinations.filter(item => Object.keys(item).length > 0).map(item => `${indent}  combination ${JSON.stringify(item)}`));
  else lines.push(`${indent}  combinations after the jobs that run first: ${JSON.stringify(plan.matrix)}`);
  lines.push(...describeSteps(plan.steps, `${indent}  `));
  return lines;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  let workflow: string | undefined;
  let job: string | undefined;
  let planOnly = false;
  const inputs: string[] = [];
  let inputEvent: InputEvent | undefined;
  const select: Record<string, string> = {};
  let usage = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--plan') { planOnly = true; continue; }
    const value = args[index + 1];
    index += 1;
    if (value === undefined) usage = true;
    else if (flag === '--workflow') workflow = value;
    else if (flag === '--job') job = value;
    else if (flag === '--input') inputs.push(value);
    else if (flag === '--input-event' && (value === 'workflow_call' || value === 'workflow_dispatch')) {
      if (inputEvent !== undefined) usage = true;
      else inputEvent = value;
    }
    else if (flag === '--matrix' && /^[^=]+=/.test(value)) select[value.slice(0, value.indexOf('='))] = value.slice(value.indexOf('=') + 1);
    else usage = true;
  }
  if (usage || !workflow || !job) {
    console.error(USAGE);
    process.exit(2);
  }
  if (planOnly) {
    try {
      for (const line of describePlan(planJob(repositoryRoot(), workflow, job, select, { inputs, inputEvent }))) console.log(line);
    } catch (error) {
      console.log(`[ci-job] refused: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  } else {
    process.exitCode = await ciJob({ root: repositoryRoot(), workflow, job, select, inputs, inputEvent });
  }
}
