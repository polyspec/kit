#!/usr/bin/env node
// Runs the steps of one job of a GitHub workflow of the checkout, as CI runs them (`make ci-job JOB=<id>`, K1227):
//
//   node scripts/kit/ci-job.mts --workflow <file> --job <id> [--matrix <key>=<value>]...
//
// A check before a push must be the CI job itself, not a list of its commands copied by hand, because a copy drifts from
// the workflow and a missed step makes the local run differ from CI. The run reads the workflow of the checkout and runs
// each `run:` step of the job in order, with the `env:` of the workflow, the job and the step and the `working-directory`
// of the step, in the shell of a GitHub Linux runner (`bash --noprofile --norc -eo pipefail`). A step `uses: ./<path>`
// is a composite action of the checkout, whose steps run in its place. A step of an external action (checkout, the setup
// of a language, an upload) does not run on the machine, and the run prints it with its `with:` inputs, so no step is left
// out without a line that names it. It stops at the first failing step, as CI does, and names the step, its command and its
// exit status.
//
// A job with `strategy.matrix` runs once for each of its combinations, in order, or only for those whose values match every
// `--matrix <key>=<value>`; the combinations are those of `include` alone, or the product of the axes, since a run that
// mixed the two would need the matching rules of GitHub, which the run does not imitate. A combination that no selection
// matches fails the run with the combinations that exist. In `run:`, `env:` and `working-directory`, `${{ matrix.<key> }}`
// is the value of the combination and `${{ runner.temp }}` is `RUNNER_TEMP`. Refused by name, because the run could not
// give them the meaning that CI gives: a job that calls a reusable workflow, any other `${{ }}` expression in those places,
// and an `if:` other than a conjunction (`&&`) of `always()`, `success()`, `!cancelled()`, `matrix.<key>` or `runner.os` `==` or `!=` a
// text or a number, and `contains(fromJSON('<list>'), matrix.<key>)`, which the run decides for the combination; a step whose condition does not
// hold is named and not run. `RUNNER_TEMP` is a directory that the
// run makes under the temporary directory of the system (`TMPDIR`) for each combination and removes at its end, also
// on SIGINT and SIGTERM. The run makes no download; the steps that download are the install targets of the repository.
// Status 0 when every step passed, 1 when a step failed or was refused, 2 for a usage error.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isMain, repositoryRoot } from './paths.mts';

const USAGE = 'usage: node scripts/kit/ci-job.mts --workflow <file> --job <id> [--matrix <key>=<value>]...';
const SHELL_ARGS = ['--noprofile', '--norc', '-eo', 'pipefail', '-c'];
const RUN_CONDITIONS = new Set(['always()', 'success()', '!cancelled()']);
/** `runner.os` of GitHub for the machine of the run. */
const RUNNER_OS = ({ darwin: 'macOS', linux: 'Linux', win32: 'Windows' } as Record<string, string>)[process.platform] ?? process.platform;

type Mapping = Record<string, unknown>;

function isMapping(value: unknown): value is Mapping {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapping(value: unknown, where: string): Mapping {
  if (value === undefined) return {};
  if (!isMapping(value)) throw new Error(`${where} is not a mapping`);
  return value;
}

function text(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${where} is not a text`);
  return value;
}

function steps(value: unknown, where: string): Mapping[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isMapping)) throw new Error(`${where} is not a list of steps`);
  return value;
}

/** One step that the run executes or names: `run` with its command, or `skip` for an external action. */
export type PlannedStep =
  | { kind: 'run'; label: string; command: string; env: Record<string, string>; root: string; directory: string }
  | { kind: 'skip'; label: string; uses: string; with: Record<string, unknown> };

const EXPRESSION = /\$\{\{\s*([^}]*?)\s*\}\}/g;
const RUNNER_TEMP = '\u0000RUNNER_TEMP\u0000';

/** The values of one combination of a matrix, by key. */
export type Combination = Record<string, string>;

/** `value` with `${{ matrix.<key> }}` and `${{ runner.temp }}` given their values; any other expression throws with `where`. */
function expand(value: string, combination: Combination, where: string): string {
  return value.replace(EXPRESSION, (whole, inner: string) => {
    if (inner === 'runner.temp') return RUNNER_TEMP;
    const key = /^matrix\.([A-Za-z0-9_-]+)$/.exec(inner)?.[1];
    if (key !== undefined && key in combination) return combination[key] ?? '';
    throw new Error(`${where} holds the expression ${whole}, which the local run cannot evaluate as CI does`);
  });
}

function textMap(map: unknown, combination: Combination, where: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping(map, `${where} env`))) result[key] = expand(String(value), combination, `${where}: env ${key}`);
  return result;
}

/**
 * The value of one term of a condition: a status function, which holds while no earlier step failed, since the run stops at
 * the first failing step; `matrix.<key>` or `runner.os` (the system of this machine) `==` or `!=` a quoted text or a number; or `contains(fromJSON('<list>'), matrix.<key>)`, whose list holds
 * texts or numbers. Undefined for any other term.
 */
function term(text: string, combination: Combination): boolean | undefined {
  if (RUN_CONDITIONS.has(text)) return true;
  const compared = /^(matrix\.[A-Za-z0-9_-]+|runner\.os)\s*(==|!=)\s*(?:'([^']*)'|(-?\d+(?:\.\d+)?))$/.exec(text);
  if (compared) {
    const [, name = '', operator, quoted, number] = compared;
    const value = name === 'runner.os' ? RUNNER_OS : combination[name.slice('matrix.'.length)];
    if (value === undefined) return undefined;
    return (value === (quoted ?? number)) === (operator === '==');
  }
  const contained = /^contains\(\s*fromJSON\(\s*'([^']*)'\s*\)\s*,\s*matrix\.([A-Za-z0-9_-]+)\s*\)$/.exec(text);
  if (contained) {
    const [, list = '', key = ''] = contained;
    if (!(key in combination)) return undefined;
    const values: unknown = JSON.parse(list);
    if (!Array.isArray(values)) return undefined;
    return values.some(value => (typeof value === 'string' || typeof value === 'number') && String(value) === combination[key]);
  }
  return undefined;
}

/**
 * Whether the step runs: true without `if:`; otherwise the value of its condition, a conjunction (`&&`) of the terms of
 * `term`. Any other condition throws with `where`, since the run could not decide it as CI does.
 */
function condition(step: Mapping, combination: Combination, where: string): boolean {
  const when = text(step.if, `${where} if`);
  if (when === undefined) return true;
  const bare = when.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  const values = bare.split('&&').map(part => term(part.trim(), combination));
  if (values.some(value => value === undefined)) throw new Error(`${where}: if: ${when} is not a condition that the local run decides as CI does: always(), success(), !cancelled(), matrix.<key> or runner.os == or != a text or a number, contains(fromJSON('<list>'), matrix.<key>), joined by &&`);
  return values.every(Boolean);
}

function readYaml(file: string): Mapping {
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const value: unknown = parseYaml(readFileSync(file, 'utf8'));
  if (!isMapping(value)) throw new Error(`${file} holds no YAML mapping`);
  return value;
}

function planSteps(root: string, list: Mapping[], env: Record<string, string>, combination: Combination, where: string, planned: PlannedStep[]): void {
  list.forEach((step, index) => {
    const name = text(step.name, `${where} step ${index + 1} name`);
    const label = `${where} step ${index + 1}${name ? ` (${name})` : ''}`;
    if (!condition(step, combination, label)) {
      planned.push({ kind: 'skip', label, uses: `if: ${String(step.if)}`, with: {} });
      return;
    }
    const stepEnv = { ...env, ...textMap(step.env, combination, label) };
    const run = text(step.run, `${label} run`);
    const uses = text(step.uses, `${label} uses`);
    const shell = text(step.shell, `${label} shell`);
    if (run !== undefined) {
      if (shell !== undefined && shell !== 'bash') throw new Error(`${label}: shell ${shell} is not bash, the shell that the local run gives`);
      const command = expand(run.trim(), combination, `${label}: run`);
      const directory = expand(text(step['working-directory'], `${label} working-directory`) ?? '.', combination, `${label}: working-directory`);
      planned.push({ kind: 'run', label, command, env: stepEnv, root, directory });
    } else if (uses?.startsWith('./')) {
      const directory = path.join(root, uses);
      const file = ['action.yml', 'action.yaml'].map(name => path.join(directory, name)).find(existsSync);
      if (file === undefined) throw new Error(`${label}: ${uses} has no action.yml`);
      const runs = mapping(readYaml(file).runs, `${uses} runs`);
      if (runs.using !== 'composite') throw new Error(`${label}: ${uses} is not a composite action`);
      planSteps(root, steps(runs.steps, `${uses} steps`), stepEnv, combination, `${label} > ${uses}`, planned);
    } else if (uses !== undefined) {
      planned.push({ kind: 'skip', label, uses, with: mapping(step.with, `${label} with`) });
    } else {
      throw new Error(`${label}: neither run nor uses`);
    }
  });
}

function axisValues(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${where} is not a list of values`);
  return value.map(item => {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') throw new Error(`${where} holds a value that is not a text, a number or a bool`);
    return String(item);
  });
}

function combination(value: unknown, where: string): Combination {
  const result: Combination = {};
  for (const [key, item] of Object.entries(mapping(value, where))) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') throw new Error(`${where} ${key} is not a text, a number or a bool`);
    result[key] = String(item);
  }
  return result;
}

/** The combinations of the matrix of a job, in the order of CI: one empty combination for a job without a matrix. */
function combinations(entry: Mapping, where: string): Combination[] {
  const matrix = mapping(mapping(entry.strategy, `${where} strategy`).matrix, `${where} matrix`);
  const { include, exclude, ...axes } = matrix;
  if (exclude !== undefined) throw new Error(`${where} matrix has exclude, whose matching rules the local run does not imitate`);
  const axisNames = Object.keys(axes);
  if (include !== undefined && axisNames.length > 0) throw new Error(`${where} matrix has both axes and include, whose matching rules the local run does not imitate`);
  if (include !== undefined) {
    if (!Array.isArray(include)) throw new Error(`${where} matrix include is not a list`);
    return include.map((item, index) => combination(item, `${where} matrix include ${index + 1}`));
  }
  let result: Combination[] = [{}];
  for (const name of axisNames) {
    const values = axisValues(axes[name], `${where} matrix ${name}`);
    result = result.flatMap(base => values.map(value => ({ ...base, [name]: value })));
  }
  return result;
}

/** One combination of a job with its steps, in the order that CI runs them. */
export type PlannedRun = { combination: Combination; steps: PlannedStep[] };

/**
 * The runs of job `job` of `workflow` (a path relative to `root`): one for each combination of its matrix that matches every
 * key and value of `select`. Throws with the cause, also when `select` matches no combination.
 */
export function planJob(root: string, workflow: string, job: string, select: Combination = {}): PlannedRun[] {
  const document = readYaml(path.resolve(root, workflow));
  const jobs = mapping(document.jobs, `${workflow} jobs`);
  if (!(job in jobs)) throw new Error(`${workflow} has no job ${job}; its jobs are ${Object.keys(jobs).join(', ') || 'none'}`);
  const entry = mapping(jobs[job], `${workflow} job ${job}`);
  if (entry.uses !== undefined) throw new Error(`${workflow}: job ${job} calls the reusable workflow ${JSON.stringify(entry.uses)}; run its job by its own workflow`);
  const where = `${workflow} job ${job}`;
  const all = combinations(entry, where);
  const chosen = all.filter(item => Object.entries(select).every(([key, value]) => item[key] === value));
  if (chosen.length === 0) throw new Error(`${where}: no combination of its matrix has ${JSON.stringify(select)}; its combinations are ${all.map(item => JSON.stringify(item)).join(', ')}`);
  return chosen.map(item => {
    const env = { ...textMap(document.env, item, workflow), ...textMap(entry.env, item, where) };
    const planned: PlannedStep[] = [];
    planSteps(root, steps(entry.steps, `${where} steps`), env, item, Object.keys(item).length > 0 ? `${where} ${JSON.stringify(item)}` : where, planned);
    return { combination: item, steps: planned };
  });
}

function withTemp(value: string, runnerTemp: string): string {
  return value.split(RUNNER_TEMP).join(runnerTemp);
}

function runStep(step: Extract<PlannedStep, { kind: 'run' }>, runnerTemp: string): Promise<number> {
  return new Promise(resolve => {
    const env = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, withTemp(value, runnerTemp)]));
    const child = spawn('bash', [...SHELL_ARGS, withTemp(step.command, runnerTemp)], {
      cwd: path.resolve(step.root, withTemp(step.directory, runnerTemp)),
      env: { ...process.env, ...env, RUNNER_TEMP: runnerTemp, CI_JOB_LOCAL: '1' },
      stdio: 'inherit',
    });
    child.on('error', error => { console.error(`[ci-job] ${step.label}: ${error.message}`); resolve(127); });
    child.on('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

/** Runs the job, each chosen combination in turn, and returns the exit status. */
export async function ciJob({ root, workflow, job, select = {}, print = (line: string) => console.log(line) }: { root: string; workflow: string; job: string; select?: Combination; print?: (line: string) => void }): Promise<number> {
  let runs: PlannedRun[];
  try {
    runs = planJob(root, workflow, job, select);
  } catch (error) {
    print(`[ci-job] refused: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  let runnerTemp = '';
  const remove = () => { if (runnerTemp) rmSync(runnerTemp, { recursive: true, force: true }); };
  const onSignal = (signal: NodeJS.Signals) => { remove(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    let passed = 0;
    for (const run of runs) {
      runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-job-'));
      for (const step of run.steps) {
        if (step.kind === 'skip') {
          print(`[ci-job] not run on this machine: ${step.label}: ${step.uses} ${JSON.stringify(step.with)}`);
          continue;
        }
        print(`[ci-job] ${step.label}: ${withTemp(step.command, runnerTemp)}`);
        const status = await runStep(step, runnerTemp);
        if (status !== 0) {
          print(`[ci-job] failed: ${step.label} exited with status ${status}: ${withTemp(step.command, runnerTemp)}`);
          return 1;
        }
        passed += 1;
      }
      remove();
      runnerTemp = '';
    }
    print(`[ci-job] ${workflow} job ${job}: ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}, ${passed} steps passed`);
    return 0;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    remove();
  }
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  let workflow: string | undefined;
  let job: string | undefined;
  const select: Combination = {};
  let usage = false;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) usage = true;
    else if (flag === '--workflow') workflow = value;
    else if (flag === '--job') job = value;
    else if (flag === '--matrix' && /^[^=]+=/.test(value)) select[value.slice(0, value.indexOf('='))] = value.slice(value.indexOf('=') + 1);
    else usage = true;
  }
  if (usage || !workflow || !job) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exitCode = await ciJob({ root: repositoryRoot(), workflow, job, select });
}
