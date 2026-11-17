#!/usr/bin/env node
// The jobs of the CI pipeline, each one recipe that CI and a local run call alike (K1250):
//
//   node scripts/kit/ci-setup.mts --plan                      make ci-plan: the fan-out of the pipeline to GITHUB_OUTPUT
//   node scripts/kit/ci-setup.mts --job shared                make ci-shared
//   node scripts/kit/ci-setup.mts --job runtime <runtime>     make ci-runtime RUNTIME=<runtime>
//   node scripts/kit/ci-setup.mts --required                  make ci-required RESULTS=<toJSON(needs)>
//
// A job installs its tools and runs its setup targets first and stops at the first failure; it then prepares its context, runs
// kit's gate of its group and the targets that config/ci.json declares for it through `make -k ci-targets`, every target to its
// end, and cleans up its context after the preparation was entered, also when the checks failed (K731, K910). config/ci.json
// names repository-owned Make targets; where none are declared, Kit uses the repository's deps-<runtime> targets (K859). The
// runtimes of the plan are those that config/ci.json declares (K1114): kit reads no runtime from a folder name or a file.
// Each job reads its tools and targets from config/ci.json itself; the plan publishes only the fan-out of the pipeline.
import { appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { declaredMiseTools, TOOLS as CHECK_TOOLS } from './toolchain-mise.mts';
import { declaredLintTools } from './toolchain-lint.mts';
import { declaredRust } from './toolchain-files.mts';
import { isJsonObject } from './bootstrap/files.mts';
import { passed } from './ci-passed.mts';

export const CI_CONFIG = 'config/ci.json';
export const RUNTIMES = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
type Runtime = (typeof RUNTIMES)[number];
type CIJob = 'shared' | Runtime;
type SetupGroup = 'shared' | 'runtime';
type Runner = 'ubuntu-24.04' | 'ubuntu-26.04-arm';
type CIConfig = {
  runtimes?: Runtime[];
  runner?: Runner;
  setup: { shared: string[]; runtimes: Partial<Record<Runtime, string[]>> };
  tools?: Partial<Record<CIJob, string[]>>;
  contexts?: Partial<Record<CIJob, { prepare: string; cleanup: string }>>;
  targets?: { shared?: string[]; runtimes?: Partial<Record<Runtime, string[]>> };
};
type RuntimeJob = { runtime: Runtime | 'none'; installTools: string[]; targets: string[] };
export type CIPlan = {
  runner: Runner;
  runtimes: RuntimeJob[];
  commonTools: string[];
  sharedTargets: string[];
};


const runtimeTools: Record<Runtime, string[]> = {
  ts: [],
  php: ['php', 'composer', 'phpcs', 'phpstan'],
  'php-ext': ['php', 'composer'],
  python: ['python', 'uv', 'ruff', 'vulture', 'maturin'],
  go: ['go', 'golangciLint', 'deadcode', 'govulncheck'],
  rust: ['rust', 'cargoAudit', 'cargoNextest', 'cargoDeny'],
};

/** The symbol extractors that the toolchain declaration of the repository names. */
function symbolExtractors(declared: Record<string, unknown>): string[] {
  const declaration = declared.symbolExtractors;
  return isJsonObject(declaration) && Array.isArray(declaration.extractors)
    ? declaration.extractors.filter((extractor: unknown): extractor is string => typeof extractor === 'string')
    : [];
}

// K1018: the PHP symbol extractor, which lint-php of the php runtime gates reads PHP with (K377), is installed by the setup of that
// job, so the step list of ci-pipeline.yml, which every job shares, names no language.
const PHP_EXTRACTOR = { target: 'kit-install-symbols', args: ['EXTRACTORS=php'] };

function toolchainNames(root: string): { declared: Record<string, unknown>; names: string[] } {
  const declared: Record<string, unknown> = {
    ...declaredToolchain(root),
    ...declaredLintTools(root),
    ...declaredMiseTools(root),
    rust: declaredRust(root),
  };
  return { declared, names: CHECK_TOOLS.filter(name => ['node', 'npm', 'mise'].includes(name) || declared[name] !== undefined) };
}

const isRuntime = (value: string): value is Runtime => (RUNTIMES as readonly string[]).includes(value);

/**
 * config/ci.json of `root` with the plan's runtimes: those that config/ci.json declares in `runtimes` and `targets.runtimes` (K1114).
 */
function readAndValidate(root: string): { config: CIConfig; runtimes: Runtime[] } {
  if (!existsSync(path.join(root, CI_CONFIG))) throw new Error(`${CI_CONFIG} is missing. Fix: declare shared and runtime setup targets following docs/operations/tool-inventory.md (schema scripts/kit/schema/ci.schema.json)`);
  const config = readConfig<CIConfig>(root, CI_CONFIG, 'ci.schema.json');
  if (config.runtimes === undefined) throw new Error(`${CI_CONFIG} declares no runtimes. Fix: declare "runtimes" with the runtimes whose CI jobs run (${RUNTIMES.join(', ')}), or [] for none`);
  // One runtime set for the plan, the setup and the contexts: the runtimes that config/ci.json declares and those that
  // targets.runtimes names (K910, K1114). A declared setup or context target runs as declared (K1068): make reports a target
  // that does not exist when it runs.
  const runtimes = [...new Set([...config.runtimes, ...RUNTIMES.filter(runtime => config.targets?.runtimes?.[runtime] !== undefined)])].sort();
  return { config, runtimes };
}

/** The default setup of a runtime is the repository's own deps-<runtime> target, a thin call of its package manager (K859); make reports it when it is missing. */
function defaultSetup(runtime: Runtime): { target: string; args: string[] }[] {
  return [{ target: `deps-${{ ts: 'node', go: 'go', rust: 'rust', php: 'php', 'php-ext': 'php', python: 'python' }[runtime]}`, args: [] }];
}

function plan(root: string): CIPlan {
  const { config, runtimes } = readAndValidate(root);
  invocations(root, 'shared');
  for (const runtime of runtimes) invocations(root, 'runtime', runtime);
  const { names } = toolchainNames(root);
  const activeOwners = new Set(runtimes.flatMap(runtime => runtimeTools[runtime]));
  const assignedElsewhere = new Set(runtimes.flatMap(runtime => config.tools?.[runtime] ?? []));
  const sharedNativeTools = ['go', 'python'].filter(name => names.includes(name));
  const commonTools = [...new Set([
    ...sharedNativeTools,
    ...names.filter(name => !['node', 'npm', 'mise'].includes(name) && !activeOwners.has(name) && !assignedElsewhere.has(name)),
    ...(config.tools?.shared ?? []),
  ])].sort();
  const runtimeJobs = runtimes.map(runtime => ({
    runtime,
    // A configured selector passes as written, so install-tools judges it (K860); the runtime's own tools follow the declarations.
    installTools: [...new Set([...runtimeTools[runtime].filter(name => names.includes(name) && !['node', 'npm', 'mise'].includes(name)), ...(config.tools?.[runtime] ?? [])])],
    targets: config.targets?.runtimes?.[runtime] ?? [],
  }));
  return {
    runner: config.runner ?? 'ubuntu-24.04',
    runtimes: runtimeJobs.length ? runtimeJobs : [{ runtime: 'none', installTools: [], targets: [] }],
    commonTools,
    sharedTargets: config.targets?.shared ?? [],
  };
}

export function ciPlan(root: string = repositoryRoot()): CIPlan { return plan(root); }

/** The setup of `runtime`: its declared targets or its deps target. */
function runtimeSetup(runtime: Runtime, config: CIConfig): { target: string; args: string[] }[] {
  const configured = config.setup.runtimes[runtime] ?? [];
  return configured.length ? configured.map(target => ({ target, args: [] })) : defaultSetup(runtime);
}

function invocations(root: string, group: SetupGroup, runtime?: string): { target: string; args: string[] }[] {
  const { config, runtimes } = readAndValidate(root);
  if (group === 'shared') {
    if (runtime !== undefined) throw new Error('make ci-shared takes no RUNTIME; omit it');
    return config.setup.shared.map(target => ({ target, args: [] }));
  }
  if (runtime === undefined || !isRuntime(runtime) || !runtimes.includes(runtime)) throw new Error(`make ci-runtime needs RUNTIME, a runtime of the plan (runtimes and targets.runtimes of config/ci.json); choose ${runtimes.join(', ') || '(none)'}`);
  const php = symbolExtractors(toolchainNames(root).declared).includes('php');
  return [...runtimeSetup(runtime, config), ...(php && runtime === 'php' ? [PHP_EXTRACTOR] : [])];
}

export function ciSetupInvocations(root: string, group: SetupGroup, runtime?: string) {
  return invocations(root, group, runtime);
}

/**
 * The make targets that the CI job of `group` runs in `root`: its setup, the preparation and cleanup of its context, the gate of
 * kit and the targets of config/ci.json, as runCIJob runs them; for the runtime group each runtime of the plan unless `runtime`
 * names one. The rules check reads the reach of a call of ci-setup from it (K1254).
 */
export function ciJobTargets(root: string, group: SetupGroup, runtime?: string): string[] {
  const result = plan(root);
  const { config } = readAndValidate(root);
  const context = (scope: CIJob) => { const found = config.contexts?.[scope]; return found === undefined ? [] : [found.prepare, found.cleanup]; };
  if (group === 'shared') return [...invocations(root, 'shared').map(({ target }) => target), ...context('shared'), 'kit-gates-static', ...result.sharedTargets];
  return result.runtimes.flatMap(({ runtime: name, targets }) => (name === 'none' || (runtime !== undefined && name !== runtime) ? [] : [
    ...invocations(root, 'runtime', name).map(({ target }) => target), ...context(name), `kit-gates-runtime-${name}`, ...targets]));
}

function writePlan(root: string): void {
  const result = plan(root);
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined || output === '') {
    console.log(JSON.stringify(result));
    return;
  }
  // The fan-out of the pipeline and the condition of the PHP setup action of the shared job: each job reads its tools and
  // targets from config/ci.json itself (K1250).
  const outputs: Record<string, unknown> = {
    runtimes: result.runtimes.map(({ runtime }) => ({ runtime })),
    runner: result.runner,
    has_runtimes: result.runtimes.some(({ runtime }) => runtime !== 'none'),
    shared_php: result.commonTools.includes('php'),
  };
  for (const [key, value] of Object.entries(outputs)) appendFileSync(output, `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

export function runCISetup(root: string, group: SetupGroup, runtimeName?: string): void {
  if (!['shared', 'runtime'].includes(group)) throw new Error(`unknown CI setup group ${group}; choose shared or runtime`);
  const runtime = runtimeName;
  const commands = invocations(root, group, runtime);
  for (const { target, args } of commands) {
    const result = spawnMake('make', ['--no-print-directory', target, ...args], root);
    if (result !== 0) throw new Error(`make ${target}${args.length ? ` ${args.join(' ')}` : ''} failed in the CI setup ${group}${runtime ? `/${runtime}` : ''}; fix that locked install/build target and run the job again`);
  }
}

// Kept as one small seam for an execution test; a target name of config/ci.json is one argument of make, never shell input.
function spawnMake(command: string, args: string[], cwd: string): number {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  // A signal is named, since the status that it gives is no exit status of the command (K1165).
  if (result.signal) console.error(`${command} ${args.join(' ')} ended by signal ${result.signal}`);
  return result.status ?? 1;
}

/**
 * Runs the CI job of `group` (`make ci-shared`, `make ci-runtime RUNTIME=<runtime>`) as CI runs it and returns its exit status: the
 * tools of the job and its setup targets first, stopping at the first failure; then its context, the gate of kit and the targets of
 * config/ci.json through `make -k ci-targets`, every target to its end; then the cleanup of the context whenever its preparation
 * ran. The status is 0 only when the checks passed and the context was prepared and cleaned up (K1250).
 */
export function runCIJob(root: string, group: SetupGroup, runtimeName?: string, make: (args: string[]) => number = args => spawnMake('make', args, root)): number {
  const result = plan(root);
  const { config } = readAndValidate(root);
  const job = group === 'runtime' ? result.runtimes.find(({ runtime }) => runtime === runtimeName) : undefined;
  if (group === 'runtime' && (job === undefined || job.runtime === 'none')) throw new Error(`make ci-runtime needs RUNTIME, a runtime of the plan (runtimes and targets.runtimes of config/ci.json); choose ${result.runtimes.filter(({ runtime }) => runtime !== 'none').map(({ runtime }) => runtime).join(', ') || '(none)'}`);
  if (group === 'shared' && runtimeName !== undefined) throw new Error('make ci-shared takes no RUNTIME; omit it');
  const scope: CIJob = job === undefined || job.runtime === 'none' ? 'shared' : job.runtime;
  const tools = job === undefined ? result.commonTools : job.installTools;
  const targets = job === undefined ? ['kit-gates-static', ...result.sharedTargets] : [`kit-gates-runtime-${scope}`, ...job.targets];
  const where = job === undefined ? 'shared' : `runtime/${scope}`;
  // The installs and the setup: a later step needs what an earlier one installed, so the first failure stops the job.
  if (tools.length > 0 && make(['--no-print-directory', 'install-tools', `TOOLS=${tools.join(' ')}`]) !== 0) {
    console.error(`[ci-setup] make install-tools TOOLS="${tools.join(' ')}" failed in the CI job ${where}; fix that install and run the job again`);
    return 1;
  }
  runCISetup(root, group, runtimeName);
  const context = config.contexts?.[scope];
  const failed: string[] = [];
  if (context !== undefined && make(['--no-print-directory', context.prepare]) !== 0) failed.push(`the context preparation make ${context.prepare}`);
  if (failed.length === 0 && make(['--no-print-directory', '-k', 'ci-targets', `TARGETS=${targets.join(' ')}`]) !== 0) failed.push(`the checks make -k ci-targets TARGETS="${targets.join(' ')}"`);
  if (context !== undefined && make(['--no-print-directory', context.cleanup]) !== 0) failed.push(`the context cleanup make ${context.cleanup}`);
  for (const failure of failed) console.error(`[ci-setup] ${failure} failed in the CI job ${where}`);
  return failed.length === 0 ? 0 : 1;
}

/**
 * The judgement of the required job of the pipeline (`make ci-required RESULTS=<toJSON(needs)>`): every needed job must succeed, a
 * skipped one included, except the runtime job when config/ci.json declares no runtime, which the plan does not select (K950).
 */
export function requiredJudgement(root: string, text: string | undefined): ReturnType<typeof passed> {
  let unselected: string[] = [];
  try {
    if (readAndValidate(root).runtimes.length === 0) unselected = ['runtime'];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // A config/ci.json that does not validate failed the plan too; the judgement of the jobs is still printed.
    const judged = passed(text, { failSkipped: true });
    return { status: Math.max(1, judged.status), lines: [...judged.lines, `[ci-passed] failed: ${error.message}`], errors: [...judged.errors, error.message] };
  }
  return passed(text, { failSkipped: true, unselected });
}

if (isMain(import.meta.url)) {
  try {
    const root = repositoryRoot();
    const [mode = '', group = '', runtime = ''] = process.argv.slice(2);
    if (mode === '--plan') writePlan(root);
    else if (mode === '--job') {
      if (group !== 'shared' && group !== 'runtime') throw new Error(`unknown CI job ${group}; choose shared or runtime`);
      process.exitCode = runCIJob(root, group, runtime === '' ? undefined : runtime);
    } else if (mode === '--required') {
      const result = requiredJudgement(root, process.env.RESULTS);
      for (const line of result.lines) console.log(line);
      if (process.env.GITHUB_ACTIONS === 'true') for (const error of result.errors) console.log(`::error title=ci-required::${error}`);
      process.exitCode = result.status;
    } else throw new Error(`unknown CI setup mode ${mode}; use --plan, --job shared, --job runtime RUNTIME, or --required`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[ci-setup] ${error.message}`);
    process.exitCode = 1;
  }
}
