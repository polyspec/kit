#!/usr/bin/env node
// The locked setup of the jobs of the CI pipeline (`make kit-ci-plan`, `make kit-ci-setup`, K731, K910): config/ci.json names
// repository-owned Make targets; where none are declared, Kit uses the repository's deps-<runtime> targets (K859). The plan
// also passes the targets that config/ci.json declares for each job (targets.shared, targets.parity, targets.runtimes). The
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
type CIJob = 'shared' | 'parity' | Runtime;
type SetupGroup = 'shared' | 'parity' | 'runtime' | 'parity-binding';
type BindingSetup = { setup: string[]; tools: string[] };
type ParityMode = 'full' | 'phases' | 'none';
type Runner = 'ubuntu-24.04' | 'ubuntu-26.04-arm';
type CIConfig = {
  runtimes?: Runtime[];
  parityMode?: ParityMode;
  parityBindings?: Record<string, BindingSetup>;
  runner?: Runner;
  setup: { shared: string[]; parity: string[]; runtimes: Partial<Record<Runtime, string[]>> };
  tools?: Partial<Record<CIJob, string[]>>;
  contexts?: Partial<Record<CIJob, { prepare: string; cleanup: string }>>;
  targets?: { shared?: string[]; parity?: string[]; runtimes?: Partial<Record<Runtime, string[]>> };
};
type RuntimeJob = { runtime: Runtime | 'none'; installTools: string[]; targets: string[] };
export type CIPlan = {
  runner: Runner;
  parityMode: ParityMode;
  parityMatrix: { implementation: string; installTools: string[] }[];
  runtimes: RuntimeJob[];
  commonTools: string[];
  parityTools: string[];
  sharedTargets: string[];
  parityTargets: string[];
  extractors: string[];
};


const runtimeTools: Record<Runtime, string[]> = {
  ts: [],
  php: ['php', 'composer', 'phpcs', 'phpstan'],
  'php-ext': ['php', 'composer'],
  python: ['python', 'uv', 'ruff', 'vulture'],
  go: ['go', 'golangciLint', 'deadcode', 'govulncheck'],
  rust: ['rust', 'cargoAudit', 'cargoNextest', 'cargoDeny'],
};
const parityRunnerTools: Record<string, string[]> = {
  go: ['go'], cargo: ['rust'], python: ['python', 'uv'], php: ['php', 'composer', 'phpunit'], node: [], vitest: [],
};

/** The symbol extractors that the toolchain declaration of the repository names. */
function symbolExtractors(declared: Record<string, unknown>): string[] {
  const declaration = declared.symbolExtractors;
  return isJsonObject(declaration) && Array.isArray(declaration.extractors)
    ? declaration.extractors.filter((extractor: unknown): extractor is string => typeof extractor === 'string')
    : [];
}

// K1018: the PHP symbol extractor, which divergence-check of the shared gates and lint-php of the php runtime gates read PHP with
// (K896, K377), is installed by the setup of those two jobs, so the step list of ci-pipeline.yml, which every job shares, names no language.
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
 * config/ci.json of `root` with the plan's runtimes and parity mode. The runtimes are those that config/ci.json declares in
 * `runtimes` and `targets.runtimes` (K1114). The parity declaration is the file at `parity`, which the caller passes with --parity
 * (K1114): ci-setup opens no declaration that it is not given. A declared parityMode is planned as declared (K1068); without one
 * the mode is full with --parity and none without it.
 */
function readAndValidate(root: string, parity?: string): { config: CIConfig; runtimes: Runtime[]; parityMode: ParityMode; parityRunners: string[] } {
  if (!existsSync(path.join(root, CI_CONFIG))) throw new Error(`${CI_CONFIG} is missing. Fix: declare shared, parity and runtime setup targets following docs/operations/tool-inventory.md (schema scripts/kit/schema/ci.schema.json)`);
  const config = readConfig<CIConfig>(root, CI_CONFIG, 'ci.schema.json');
  if (config.runtimes === undefined) throw new Error(`${CI_CONFIG} declares no runtimes. Fix: declare "runtimes" with the runtimes whose CI jobs run (${RUNTIMES.join(', ')}), or [] for none`);
  // One runtime set for the plan, the setup and the contexts: the runtimes that config/ci.json declares and those that
  // targets.runtimes names (K910, K1114).
  const runtimes = [...new Set([...config.runtimes, ...RUNTIMES.filter(runtime => config.targets?.runtimes?.[runtime] !== undefined)])].sort();
  // A declared setup, binding or context target runs as declared (K1068): make reports a target that does not exist when it runs.
  const parityMode: ParityMode = config.parityMode ?? (parity === undefined ? 'none' : 'full');
  // The parity declaration is the caller's (K1114): a parity mode other than none needs it, and only its runners are read.
  let parityRunners: string[] = [];
  if (parity === undefined) {
    if (parityMode !== 'none') throw new Error(`${CI_CONFIG}: parityMode is ${parityMode}, which needs the parity declaration. Fix: pass --parity <path>, or declare "parityMode": "none"`);
  } else {
    if (!existsSync(path.join(root, parity))) throw new Error(`${parity} is missing: the parity declaration that --parity names. Fix: add it, or pass no --parity and declare "parityMode": "none"`);
    parityRunners = readConfig<{ implementations: { name: string; runner: string }[] }>(root, parity, 'parity.schema.json').implementations.map(({ runner }) => runner);
  }
  return { config, runtimes, parityMode, parityRunners };
}

/** The default setup of a runtime is the repository's own deps-<runtime> target, a thin call of its package manager (K859); make reports it when it is missing. */
function defaultSetup(runtime: Runtime): { target: string; args: string[] }[] {
  return [{ target: `deps-${{ ts: 'node', go: 'go', rust: 'rust', php: 'php', 'php-ext': 'php', python: 'python' }[runtime]}`, args: [] }];
}

function plan(root: string, parity?: string): CIPlan {
  const { config, runtimes, parityMode, parityRunners } = readAndValidate(root, parity);
  invocations(root, 'shared', undefined, parity);
  if (parityMode !== 'none') invocations(root, 'parity', undefined, parity);
  for (const runtime of runtimes) invocations(root, 'runtime', runtime, parity);
  const { declared, names } = toolchainNames(root);
  const activeOwners = new Set(runtimes.flatMap(runtime => runtimeTools[runtime]));
  const assignedElsewhere = new Set([
    ...(config.tools?.parity ?? []),
    ...runtimes.flatMap(runtime => config.tools?.[runtime] ?? []),
  ]);
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
  const parityTools = new Set(parityRunners.flatMap(runner => parityRunnerTools[runner] ?? []).filter(name => names.includes(name)));
  for (const runtime of runtimes) for (const tool of config.tools?.[runtime] ?? []) parityTools.add(tool);
  for (const tool of config.tools?.parity ?? []) parityTools.add(tool);
  const extractors = symbolExtractors(declared);
  for (const name of [...(extractors.includes('go') ? ['go'] : []), ...(extractors.includes('php') ? ['php', 'composer'] : [])]) if (names.includes(name)) parityTools.add(name);
  // divergence-check of the shared job reads the polyfill guards with the PHP symbol extractor, which is installed with PHP and Composer (K896).
  const sharedTools = extractors.includes('php') ? [...new Set([...commonTools, ...['composer', 'php'].filter(name => names.includes(name))])].sort() : commonTools;
  return {
    runner: config.runner ?? 'ubuntu-24.04',
    parityMode,
    // One binding job for each declared binding (K1068); an implementation without a binding gets no job.
    parityMatrix: parityMode === 'phases' ? Object.entries(config.parityBindings ?? {}).map(([implementation, binding]) => ({ implementation, installTools: binding.tools })) : [],
    runtimes: runtimeJobs.length ? runtimeJobs : [{ runtime: 'none', installTools: [], targets: [] }],
    commonTools: sharedTools,
    parityTools: [...parityTools].sort(),
    sharedTargets: config.targets?.shared ?? [],
    parityTargets: config.targets?.parity ?? [],
    extractors,
  };
}

export function ciPlan(root: string = repositoryRoot(), parity?: string): CIPlan { return plan(root, parity); }

/** The setup of `runtime`: its declared targets or its deps target. */
function runtimeSetup(runtime: Runtime, config: CIConfig): { target: string; args: string[] }[] {
  const configured = config.setup.runtimes[runtime] ?? [];
  return configured.length ? configured.map(target => ({ target, args: [] })) : defaultSetup(runtime);
}

function invocations(root: string, group: SetupGroup, selector?: string, parity?: string): { target: string; args: string[] }[] {
  const { config, runtimes } = readAndValidate(root, parity);
  if (group === 'parity-binding') {
    const bindings = config.parityBindings ?? {};
    if (selector === undefined) throw new Error('make kit-ci-setup GROUP=parity-binding needs IMPLEMENTATION; choose a binding of config/ci.json parityBindings');
    const binding = bindings[selector];
    if (binding === undefined) throw new Error(`unknown binding implementation ${selector}; ${CI_CONFIG} parityBindings declares ${Object.keys(bindings).join(', ') || '(none)'}`);
    return binding.setup.map(target => ({ target, args: [] }));
  }
  const runtime = selector;
  if (group !== 'runtime' && runtime !== undefined) throw new Error(`make kit-ci-setup GROUP=${group} does not accept a selector; omit RUNTIME and IMPLEMENTATION`);
  const php = symbolExtractors(toolchainNames(root).declared).includes('php');
  if (group === 'shared') return [...(php ? [PHP_EXTRACTOR] : []), ...config.setup.shared.map(target => ({ target, args: [] }))];
  if (group === 'runtime') {
    if (runtime === undefined || !isRuntime(runtime) || !runtimes.includes(runtime)) throw new Error(`make kit-ci-setup GROUP=runtime needs a runtime of the plan (runtimes and targets.runtimes of config/ci.json); choose ${runtimes.join(', ') || '(none)'}`);
    return [...runtimeSetup(runtime, config), ...(php && runtime === 'php' ? [PHP_EXTRACTOR] : [])];
  }
  // The parity job builds every implementation, so it runs the setup of every runtime, each target once.
  const targets = [...runtimes.flatMap(selected => runtimeSetup(selected, config)), ...config.setup.parity.map(target => ({ target, args: [] }))];
  return [...new Map(targets.map(invocation => [invocation.target, invocation])).values()];
}

export function ciSetupInvocations(root: string, group: SetupGroup, runtime?: string, parity?: string) {
  return invocations(root, group, runtime, parity);
}

function writePlan(root: string, parity?: string): void {
  const result = plan(root, parity);
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined || output === '') {
    console.log(JSON.stringify(result));
    return;
  }
  const outputs: Record<string, unknown> = {
    runtimes: result.runtimes,
    runner: result.runner,
    parity_mode: result.parityMode,
    parity_matrix: result.parityMatrix,
    has_runtimes: result.runtimes.some(({ runtime }) => runtime !== 'none'),
    common_tools: result.commonTools,
    parity_tools: result.parityTools,
    shared_targets: result.sharedTargets,
    parity_targets: result.parityTargets,
    extractors: result.extractors,
  };
  for (const [key, value] of Object.entries(outputs)) appendFileSync(output, `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

export function runCISetup(root: string, group: SetupGroup, runtimeName?: string, parity?: string): void {
  if (!['shared', 'parity', 'runtime', 'parity-binding'].includes(group)) throw new Error(`unknown CI setup group ${group}; choose shared, parity, parity-binding or runtime`);
  const runtime = runtimeName;
  const commands = invocations(root, group, runtime, parity);
  for (const { target, args } of commands) {
    const result = spawnMake('make', ['--no-print-directory', target, ...args], root);
    if (result !== 0) throw new Error(`make ${target}${args.length ? ` ${args.join(' ')}` : ''} failed in the CI setup ${group}${runtime ? `/${runtime}` : ''}; fix that locked install/build target and rerun this gate`);
  }
}

export function runCIContext(root: string, phase: 'prepare' | 'cleanup', group: string, runtimeName?: Runtime, parity?: string): void {
  if (group !== 'shared' && group !== 'parity' && group !== 'runtime') throw new Error(`unknown CI context group ${group}; choose shared, parity or runtime`);
  const { config, runtimes } = readAndValidate(root, parity);
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
    // --parity <path> names the parity declaration (K1114); the other arguments are the mode and its group and selector.
    const argv = process.argv.slice(2);
    const at = argv.indexOf('--parity');
    const parity = at === -1 ? undefined : argv[at + 1];
    if (at !== -1 && (parity === undefined || parity.startsWith('--'))) throw new Error('--parity needs the path of the parity declaration');
    const [mode = '', group = '', runtime = ''] = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
    if (mode === '--plan') writePlan(root, parity);
    else if (mode === '--context-prepare' || mode === '--context-cleanup') {
      if (runtime !== '' && !isRuntime(runtime)) throw new Error(`unknown runtime ${runtime}; choose ${RUNTIMES.join(', ')}`);
      runCIContext(root, mode === '--context-prepare' ? 'prepare' : 'cleanup', group, runtime === '' ? undefined : runtime, parity);
    } else if (mode === '--setup') {
      if (group !== 'shared' && group !== 'parity' && group !== 'runtime' && group !== 'parity-binding') throw new Error(`unknown CI setup group ${group}; choose shared, parity, parity-binding or runtime`);
      if (group === 'runtime' && runtime !== '' && !isRuntime(runtime)) throw new Error(`unknown runtime ${runtime}; choose ${RUNTIMES.join(', ')}`);
      runCISetup(root, group, runtime === '' ? undefined : runtime, parity);
    } else throw new Error(`unknown CI setup mode ${mode}; use [--parity <path>] --plan, --setup GROUP [RUNTIME|IMPLEMENTATION], --context-prepare GROUP [RUNTIME], or --context-cleanup GROUP [RUNTIME]`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[ci-setup] ${error.message}`);
    process.exitCode = 1;
  }
}
