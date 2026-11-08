#!/usr/bin/env node
// The locked setup of the jobs of the CI pipeline (`make kit-ci-plan`, `make kit-ci-setup`, K731, K910): config/ci.json names
// repository-owned Make targets; where none are declared, Kit uses the repository's deps-<runtime> targets (K859). The plan
// also passes the targets that config/ci.json declares for each job (targets.shared, targets.runtimes). The
// runtimes of the plan are those that config/ci.json declares (K1114): kit reads no runtime from a folder name or a file.
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
  python: ['python', 'uv', 'ruff', 'vulture'],
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
    if (runtime !== undefined) throw new Error('make kit-ci-setup GROUP=shared does not accept a selector; omit RUNTIME');
    return config.setup.shared.map(target => ({ target, args: [] }));
  }
  if (runtime === undefined || !isRuntime(runtime) || !runtimes.includes(runtime)) throw new Error(`make kit-ci-setup GROUP=runtime needs a runtime of the plan (runtimes and targets.runtimes of config/ci.json); choose ${runtimes.join(', ') || '(none)'}`);
  const php = symbolExtractors(toolchainNames(root).declared).includes('php');
  return [...runtimeSetup(runtime, config), ...(php && runtime === 'php' ? [PHP_EXTRACTOR] : [])];
}

export function ciSetupInvocations(root: string, group: SetupGroup, runtime?: string) {
  return invocations(root, group, runtime);
}

function writePlan(root: string): void {
  const result = plan(root);
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined || output === '') {
    console.log(JSON.stringify(result));
    return;
  }
  const outputs: Record<string, unknown> = {
    runtimes: result.runtimes,
    runner: result.runner,
    has_runtimes: result.runtimes.some(({ runtime }) => runtime !== 'none'),
    common_tools: result.commonTools,
    shared_targets: result.sharedTargets,
  };
  for (const [key, value] of Object.entries(outputs)) appendFileSync(output, `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

export function runCISetup(root: string, group: SetupGroup, runtimeName?: string): void {
  if (!['shared', 'runtime'].includes(group)) throw new Error(`unknown CI setup group ${group}; choose shared or runtime`);
  const runtime = runtimeName;
  const commands = invocations(root, group, runtime);
  for (const { target, args } of commands) {
    const result = spawnMake('make', ['--no-print-directory', target, ...args], root);
    if (result !== 0) throw new Error(`make ${target}${args.length ? ` ${args.join(' ')}` : ''} failed in the CI setup ${group}${runtime ? `/${runtime}` : ''}; fix that locked install/build target and rerun this gate`);
  }
}

export function runCIContext(root: string, phase: 'prepare' | 'cleanup', group: string, runtimeName?: Runtime): void {
  if (group !== 'shared' && group !== 'runtime') throw new Error(`unknown CI context group ${group}; choose shared or runtime`);
  const { config, runtimes } = readAndValidate(root);
  let scope: CIJob;
  if (group === 'runtime') {
    if (runtimeName === undefined || !runtimes.includes(runtimeName)) throw new Error(`make kit-ci-context-${phase} GROUP=runtime needs a runtime of the plan (runtimes and targets.runtimes of config/ci.json); choose ${runtimes.join(', ') || '(none)'}`);
    scope = runtimeName;
  } else {
    if (runtimeName !== undefined) throw new Error(`make kit-ci-context-${phase} GROUP=${group} does not accept RUNTIME; omit it`);
    scope = group;
  }
  const target = config.contexts?.[scope]?.[phase];
  if (target === undefined) return;
  const result = spawnMake('make', ['--no-print-directory', target], root);
  if (result !== 0) throw new Error(`make ${target} failed in the CI context ${phase} for ${scope}; fix that target and rerun the gate`);
}

// Kept as one small seam for an execution test; a target name of config/ci.json is one argument of make, never shell input.
function spawnMake(command: string, args: string[], cwd: string): number {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return result.status ?? 1;
}

if (isMain(import.meta.url)) {
  try {
    const root = repositoryRoot();
    const [mode = '', group = '', runtime = ''] = process.argv.slice(2);
    if (mode === '--plan') writePlan(root);
    else if (mode === '--context-prepare' || mode === '--context-cleanup') {
      if (runtime !== '' && !isRuntime(runtime)) throw new Error(`unknown runtime ${runtime}; choose ${RUNTIMES.join(', ')}`);
      runCIContext(root, mode === '--context-prepare' ? 'prepare' : 'cleanup', group, runtime === '' ? undefined : runtime);
    } else if (mode === '--setup') {
      if (group !== 'shared' && group !== 'runtime') throw new Error(`unknown CI setup group ${group}; choose shared or runtime`);
      if (group === 'runtime' && runtime !== '' && !isRuntime(runtime)) throw new Error(`unknown runtime ${runtime}; choose ${RUNTIMES.join(', ')}`);
      runCISetup(root, group, runtime === '' ? undefined : runtime);
    } else throw new Error(`unknown CI setup mode ${mode}; use --plan, --setup GROUP [RUNTIME], --context-prepare GROUP [RUNTIME], or --context-cleanup GROUP [RUNTIME]`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[ci-setup] ${error.message}`);
    process.exitCode = 1;
  }
}
