#!/usr/bin/env node
// Runs the steps of one job of a GitHub workflow of the checkout, as CI runs them (`make ci-job JOB=<id>`, K1227):
//
//   node scripts/kit/ci-job.mts --workflow <file> --job <id>
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
// Refused by name, because the run could not give them the meaning that CI gives: a job that calls a reusable workflow,
// a step whose `run:`, `env:` or `working-directory` holds a `${{ }}` expression, and a step whose `if:` is not one of
// `always()`, `success()` and `!cancelled()`. `RUNNER_TEMP` is a directory that the run makes and removes at its end, also
// on SIGINT and SIGTERM. The run makes no download; the steps that download are the install targets of the repository.
// Status 0 when every step passed, 1 when a step failed or was refused, 2 for a usage error.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isMain, repositoryRoot } from './paths.mts';

const USAGE = 'usage: node scripts/kit/ci-job.mts --workflow <file> --job <id>';
const SHELL_ARGS = ['--noprofile', '--norc', '-eo', 'pipefail', '-c'];
const RUN_CONDITIONS = new Set(['always()', 'success()', '!cancelled()']);

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
  | { kind: 'run'; label: string; command: string; env: Record<string, string>; directory: string }
  | { kind: 'skip'; label: string; uses: string; with: Record<string, unknown> };

const EXPRESSION = /\$\{\{/;

function textMap(map: unknown, where: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping(map, `${where} env`))) {
    const text = String(value);
    if (EXPRESSION.test(text)) throw new Error(`${where}: env ${key} holds the expression ${text}, which the local run cannot evaluate as CI does`);
    result[key] = text;
  }
  return result;
}

function condition(step: Mapping, where: string): void {
  const when = text(step.if, `${where} if`);
  if (when === undefined) return;
  const bare = when.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  if (!RUN_CONDITIONS.has(bare)) throw new Error(`${where}: if: ${when} is not always(), success() or !cancelled(), so the local run cannot decide it as CI does`);
}

function readYaml(file: string): Mapping {
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const value: unknown = parseYaml(readFileSync(file, 'utf8'));
  if (!isMapping(value)) throw new Error(`${file} holds no YAML mapping`);
  return value;
}

function planSteps(root: string, list: Mapping[], env: Record<string, string>, where: string, planned: PlannedStep[]): void {
  list.forEach((step, index) => {
    const name = text(step.name, `${where} step ${index + 1} name`);
    const label = `${where} step ${index + 1}${name ? ` (${name})` : ''}`;
    condition(step, label);
    const stepEnv = { ...env, ...textMap(step.env, label) };
    const run = text(step.run, `${label} run`);
    const uses = text(step.uses, `${label} uses`);
    const shell = text(step.shell, `${label} shell`);
    if (run !== undefined) {
      if (EXPRESSION.test(run)) throw new Error(`${label}: run holds a \${{ }} expression, which the local run cannot evaluate as CI does`);
      if (shell !== undefined && shell !== 'bash') throw new Error(`${label}: shell ${shell} is not bash, the shell that the local run gives`);
      const directory = text(step['working-directory'], `${label} working-directory`) ?? '.';
      if (EXPRESSION.test(directory)) throw new Error(`${label}: working-directory holds a \${{ }} expression`);
      planned.push({ kind: 'run', label, command: run.trim(), env: stepEnv, directory: path.resolve(root, directory) });
    } else if (uses?.startsWith('./')) {
      const directory = path.join(root, uses);
      const file = ['action.yml', 'action.yaml'].map(name => path.join(directory, name)).find(existsSync);
      if (file === undefined) throw new Error(`${label}: ${uses} has no action.yml`);
      const runs = mapping(readYaml(file).runs, `${uses} runs`);
      if (runs.using !== 'composite') throw new Error(`${label}: ${uses} is not a composite action`);
      planSteps(root, steps(runs.steps, `${uses} steps`), stepEnv, `${label} > ${uses}`, planned);
    } else if (uses !== undefined) {
      planned.push({ kind: 'skip', label, uses, with: mapping(step.with, `${label} with`) });
    } else {
      throw new Error(`${label}: neither run nor uses`);
    }
  });
}

/** The steps of job `job` of `workflow` (a path relative to `root`), in the order that CI runs them. Throws with the cause. */
export function planJob(root: string, workflow: string, job: string): PlannedStep[] {
  const document = readYaml(path.resolve(root, workflow));
  const jobs = mapping(document.jobs, `${workflow} jobs`);
  if (!(job in jobs)) throw new Error(`${workflow} has no job ${job}; its jobs are ${Object.keys(jobs).join(', ') || 'none'}`);
  const entry = mapping(jobs[job], `${workflow} job ${job}`);
  if (entry.uses !== undefined) throw new Error(`${workflow}: job ${job} calls the reusable workflow ${JSON.stringify(entry.uses)}; run its job by its own workflow`);
  const env = { ...textMap(document.env, workflow), ...textMap(entry.env, `${workflow} job ${job}`) };
  const planned: PlannedStep[] = [];
  planSteps(root, steps(entry.steps, `${workflow} job ${job} steps`), env, `${workflow} job ${job}`, planned);
  return planned;
}

function runStep(step: Extract<PlannedStep, { kind: 'run' }>, runnerTemp: string): Promise<number> {
  return new Promise(resolve => {
    const child = spawn('bash', [...SHELL_ARGS, step.command], {
      cwd: step.directory,
      env: { ...process.env, ...step.env, RUNNER_TEMP: runnerTemp, CI_JOB_LOCAL: '1' },
      stdio: 'inherit',
    });
    child.on('error', error => { console.error(`[ci-job] ${step.label}: ${error.message}`); resolve(127); });
    child.on('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

/** Runs the job and returns the exit status. */
export async function ciJob({ root, workflow, job, print = (line: string) => console.log(line) }: { root: string; workflow: string; job: string; print?: (line: string) => void }): Promise<number> {
  let planned: PlannedStep[];
  try {
    planned = planJob(root, workflow, job);
  } catch (error) {
    print(`[ci-job] refused: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-job-'));
  const remove = () => rmSync(runnerTemp, { recursive: true, force: true });
  const onSignal = (signal: NodeJS.Signals) => { remove(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    for (const step of planned) {
      if (step.kind === 'skip') {
        print(`[ci-job] not run on this machine: ${step.label}: ${step.uses} ${JSON.stringify(step.with)}`);
        continue;
      }
      print(`[ci-job] ${step.label}: ${step.command}`);
      const status = await runStep(step, runnerTemp);
      if (status !== 0) {
        print(`[ci-job] failed: ${step.label} exited with status ${status}: ${step.command}`);
        return 1;
      }
    }
    print(`[ci-job] ${workflow} job ${job}: ${planned.filter(step => step.kind === 'run').length} steps passed`);
    return 0;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    remove();
  }
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
  const workflow = value('--workflow');
  const job = value('--job');
  if (!workflow || !job || args.length !== 4) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exitCode = await ciJob({ root: repositoryRoot(), workflow, job });
}
