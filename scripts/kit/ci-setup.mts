#!/usr/bin/env node
// The locked setup of the jobs of the CI pipeline (`make kit-ci-plan`, `make kit-ci-setup`, K731, K910): config/ci.json names
// repository-owned Make targets; where none are declared, Kit uses the repository's deps-<runtime> targets (K859). The plan
// also passes the targets that config/ci.json declares for each job (targets.shared, targets.parity, targets.runtimes).
import { appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';
import { makeDatabase } from './owner-check.mts';
import { trackedFiles } from './tracked-files.mts';
import { implementationFolders } from './parity-declaration.mts';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { declaredMiseTools, TOOLS as CHECK_TOOLS } from './toolchain-mise.mts';
import { declaredLintTools } from './toolchain-lint.mts';
import { declaredRust } from './toolchain-files.mts';
import { isJsonObject } from './bootstrap/files.mts';

export const CI_CONFIG = 'config/ci.json';
export const RUNTIMES = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
type Runtime = (typeof RUNTIMES)[number];
type CIJob = 'shared' | 'parity' | Runtime;
type ConfigParityMode = 'full' | 'phases';
type ParityMode = ConfigParityMode | 'none';
type Runner = 'ubuntu-24.04' | 'ubuntu-26.04-arm';
type CIConfig = {
  parityMode?: ConfigParityMode;
  runner?: Runner;
  setup: { shared: string[]; parity: string[]; runtimes: Record<Runtime, string[]> };
  tools?: Partial<Record<CIJob, string[]>>;
  contexts?: Partial<Record<CIJob, { prepare: string; cleanup: string }>>;
  targets?: { shared?: string[]; parity?: string[]; runtimes?: Partial<Record<Runtime, string[]>> };
};
type RuntimeJob = { runtime: Runtime | 'none'; installTools: string[]; targets: string[] };
export type CIPlan = {
  runner: Runner;
  parityMode: ParityMode;
  parityImplementations: string[];
  parityMatrix: { implementation: string }[];
  runtimes: RuntimeJob[];
  commonTools: string[];
  parityTools: string[];
  sharedTargets: string[];
  parityTargets: string[];
  extractors: string[];
};

/** The exact binding matrix from config/parity.json, with duplicate and empty selections rejected before Actions schedules jobs. */
export function parityBindingMatrix(implementations: readonly string[]): { implementation: string }[] {
  if (implementations.length === 0) throw new Error('config/parity.json declares no implementations. Fix: declare every required implementation before selecting parityMode phases');
  if (implementations.some(name => name === '')) throw new Error('config/parity.json declares an empty implementation name. Fix: use each implementation name as the provider target selector');
  if (new Set(implementations).size !== implementations.length) throw new Error('config/parity.json declares duplicate implementation names. Fix: give every implementation a unique name');
  return implementations.map(implementation => ({ implementation }));
}

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

function runtimeSet(files: readonly string[], folders: readonly string[]): Set<Runtime> {
  const packageNames = new Set(folders.map(folder => path.posix.basename(folder)));
  const found = new Set<Runtime>();
  if (packageNames.has('ts') || files.some(file => /\.[cm]?[jt]sx?$/.test(file))) found.add('ts');
  if (packageNames.has('go') || files.some(file => file.endsWith('.go'))) found.add('go');
  if (packageNames.has('rust') || files.some(file => file.endsWith('.rs'))) found.add('rust');
  if (packageNames.has('python') || files.some(file => file.endsWith('.py'))) found.add('python');
  if (packageNames.has('php') || files.some(file => file.endsWith('.php') && !file.endsWith('.stub.php'))) found.add('php');
  if (packageNames.has('php-ext')) found.add('php-ext');
  return found;
}

function readAndValidate(root: string): { config: CIConfig; runtimes: Runtime[]; files: string[]; folders: string[]; db: ReturnType<typeof makeDatabase>; parityMode: ParityMode; parityImplementations: string[] } {
  if (!existsSync(path.join(root, CI_CONFIG))) throw new Error(`${CI_CONFIG} is missing. Fix: declare shared, parity and runtime setup targets following docs/operations/tool-inventory.md (schema scripts/kit/schema/ci.schema.json)`);
  const config = readConfig<CIConfig>(root, CI_CONFIG, 'ci.schema.json');
  const db = makeDatabase(root);
  let parityMode: ParityMode = config.parityMode ?? 'full';
  const setupEntries = [
    ['setup.shared', config.setup.shared], ['setup.parity', config.setup.parity],
    ...RUNTIMES.map(runtime => [`setup.runtimes.${runtime}`, config.setup.runtimes[runtime]] as [string, string[]]),
  ] as [string, string[]][];
  for (const [where, targets] of setupEntries) {
    for (const target of targets) {
      if (!db.targets.has(target)) throw new Error(`${CI_CONFIG}: ${where} names ${target}, which is not a Make target. Fix: declare an existing locked install/build target; the full install target is not a fallback`);
    }
  }
  const files = trackedFiles(root);
  const folders = implementationFolders(files);
  // One runtime set for the plan, the setup and the contexts: the runtimes of the tracked files and those that targets.runtimes
  // names, so a declared runtime is never left out (K910).
  const runtimes = [...new Set([...runtimeSet(files, folders), ...RUNTIMES.filter(runtime => config.targets?.runtimes?.[runtime] !== undefined)])].sort();
  for (const [scope, context] of Object.entries(config.contexts ?? {})) {
    for (const phase of ['prepare', 'cleanup'] as const) {
      const target = context[phase];
      if (!db.targets.has(target)) throw new Error(`${CI_CONFIG}: contexts.${scope}.${phase} names ${target}, which is not a Make target. Fix: declare an existing repository-owned prepare and cleanup target`);
    }
  }
  const parityFile = path.join(root, 'config/parity.json');
  let implementationNames: string[] = [];
  if (!existsSync(parityFile)) {
    parityMode = 'none';
  } else {
    const parity = readConfig<{ implementations: { name: string }[] }>(root, 'config/parity.json', 'parity.schema.json');
    implementationNames = parity.implementations.map(({ name }) => name);
    parityBindingMatrix(implementationNames);
  }
  return { config, runtimes, files, folders, db, parityMode, parityImplementations: implementationNames };
}

/** The default setup of a runtime is the repository's own deps-<runtime> target, a thin call of its package manager (K859). */
function defaultSetup(runtime: Runtime, targets: { has(name: string): boolean }): { target: string; args: string[] }[] {
  const target = `deps-${{ ts: 'node', go: 'go', rust: 'rust', php: 'php', 'php-ext': 'php', python: 'python' }[runtime]}`;
  if (!targets.has(target)) throw new Error(`${CI_CONFIG}: the default setup target ${target} is not present in this Makefile. Fix: define ${target} in the Makefile as the locked install of the package manager, or declare setup.runtimes.${runtime}`);
  return [{ target, args: [] }];
}

function plan(root: string): CIPlan {
  const { config, runtimes, parityMode, parityImplementations } = readAndValidate(root);
  invocations(root, 'shared');
  if (parityMode !== 'none') invocations(root, 'parity');
  for (const runtime of runtimes) invocations(root, 'runtime', runtime);
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
  const parity = existsSync(path.join(root, 'config/parity.json'))
    ? readConfig<{ implementations: { name: string; runner: string }[] }>(root, 'config/parity.json', 'parity.schema.json')
    : { implementations: [] };
  const parityTools = new Set(parity.implementations.flatMap(implementation => parityRunnerTools[implementation.runner] ?? []).filter(name => names.includes(name)));
  for (const runtime of runtimes) for (const tool of config.tools?.[runtime] ?? []) parityTools.add(tool);
  for (const tool of config.tools?.parity ?? []) parityTools.add(tool);
  const symbolExtractors = declared.symbolExtractors;
  const extractors = isJsonObject(symbolExtractors) && Array.isArray(symbolExtractors.extractors)
    ? symbolExtractors.extractors.filter((extractor: unknown): extractor is string => typeof extractor === 'string')
    : [];
  for (const name of [...(extractors.includes('go') ? ['go'] : []), ...(extractors.includes('php') ? ['php', 'composer'] : [])]) if (names.includes(name)) parityTools.add(name);
  // divergence-check of the shared job reads the polyfill guards with the PHP symbol extractor, which is installed with PHP and Composer (K896).
  const sharedTools = extractors.includes('php') ? [...new Set([...commonTools, ...['composer', 'php'].filter(name => names.includes(name))])].sort() : commonTools;
  return {
    runner: config.runner ?? 'ubuntu-24.04',
    parityMode,
    parityImplementations,
    parityMatrix: parityImplementations.length ? parityBindingMatrix(parityImplementations) : [],
    runtimes: runtimeJobs.length ? runtimeJobs : [{ runtime: 'none', installTools: [], targets: [] }],
    commonTools: sharedTools,
    parityTools: [...parityTools].sort(),
    sharedTargets: config.targets?.shared ?? [],
    parityTargets: config.targets?.parity ?? [],
    extractors,
  };
}

export function ciPlan(root: string = repositoryRoot()): CIPlan { return plan(root); }

/** Every Make target that config/ci.json names, which the CI pipeline runs: the setup, context and declared targets (K910). */
export function ciConfigTargets(root: string): string[] {
  const config = readConfig<CIConfig>(root, CI_CONFIG, 'ci.schema.json');
  return [...new Set([
    ...config.setup.shared, ...config.setup.parity, ...Object.values(config.setup.runtimes).flat(),
    ...Object.values(config.contexts ?? {}).flatMap(({ prepare, cleanup }) => [prepare, cleanup]),
    ...(config.targets?.shared ?? []), ...(config.targets?.parity ?? []), ...Object.values(config.targets?.runtimes ?? {}).flat(),
  ])];
}

/** The setup of `runtime`: its declared targets or its deps target. */
function runtimeSetup(runtime: Runtime, config: CIConfig, files: readonly string[], targets: { has(name: string): boolean }): { target: string; args: string[] }[] {
  const configured = config.setup.runtimes[runtime];
  const setup = configured.length ? configured.map(target => ({ target, args: [] })) : defaultSetup(runtime, targets);
  return setup;
}

function invocations(root: string, group: 'shared' | 'parity' | 'runtime', runtime?: Runtime): { target: string; args: string[] }[] {
  const { config, runtimes, files, db } = readAndValidate(root);
  if (group === 'shared') return config.setup.shared.map(target => ({ target, args: [] }));
  if (group === 'runtime') {
    if (runtime === undefined || !runtimes.includes(runtime)) throw new Error(`make kit-ci-setup GROUP=runtime needs a runtime of the plan (the tracked source files and targets.runtimes); choose ${runtimes.join(', ') || '(none)'}`);
    return runtimeSetup(runtime, config, files, db.targets);
  }
  // The parity job builds every implementation, so it runs the setup of every runtime, each target once.
  const targets = [...runtimes.flatMap(selected => runtimeSetup(selected, config, files, db.targets)), ...config.setup.parity.map(target => ({ target, args: [] }))];
  return [...new Map(targets.map(invocation => [invocation.target, invocation])).values()];
}

export function ciSetupInvocations(root: string, group: 'shared' | 'parity' | 'runtime', runtime?: Runtime) {
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

export function runCISetup(root: string, group: 'shared' | 'parity' | 'runtime', runtimeName?: Runtime): void {
  if (!['shared', 'parity', 'runtime'].includes(group)) throw new Error(`unknown CI setup group ${group}; choose shared, parity or runtime`);
  const runtime = runtimeName;
  const commands = invocations(root, group, runtime);
  for (const { target, args } of commands) {
    const result = spawnMake('make', ['--no-print-directory', target, ...args], root);
    if (result !== 0) throw new Error(`make ${target}${args.length ? ` ${args.join(' ')}` : ''} failed in the CI setup ${group}${runtime ? `/${runtime}` : ''}; fix that locked install/build target and rerun this gate`);
  }
}

export function runCIContext(root: string, phase: 'prepare' | 'cleanup', group: string, runtimeName?: Runtime): void {
  if (group !== 'shared' && group !== 'parity' && group !== 'runtime') throw new Error(`unknown CI context group ${group}; choose shared, parity or runtime`);
  const { config, runtimes } = readAndValidate(root);
  let scope: CIJob;
  if (group === 'runtime') {
    if (runtimeName === undefined || !runtimes.includes(runtimeName)) throw new Error(`make kit-ci-context-${phase} GROUP=runtime needs a runtime of the plan (the tracked source files and targets.runtimes); choose ${runtimes.join(', ') || '(none)'}`);
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

// Kept as one small seam for an execution test; commands always contain a validated target name, never config text as shell input.
function spawnMake(command: string, args: string[], cwd: string): number {
  // A setup or context target that runs ci-setup again would spawn without end; the marker of the make that ci-setup starts stops it.
  if (process.env.KIT_CI_DISPATCH) throw new Error(`make ${args.at(-1) ?? ''} runs inside a target that ci-setup started; a setup or context target must not run kit-ci-setup or kit-ci-context again`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, KIT_CI_DISPATCH: '1' } });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return result.status ?? 1;
}

if (isMain(import.meta.url)) {
  try {
    const root = repositoryRoot();
    const [mode = '', group = '', runtime = ''] = process.argv.slice(2);
    if (mode === '--plan') writePlan(root);
    else if (mode === '--context-prepare' || mode === '--context-cleanup') {
      const [, contextGroup = '', contextRuntime = ''] = process.argv.slice(2);
      if (contextRuntime !== '' && !isRuntime(contextRuntime)) throw new Error(`unknown runtime ${contextRuntime}; choose ${RUNTIMES.join(', ')}`);
      runCIContext(root, mode === '--context-prepare' ? 'prepare' : 'cleanup', contextGroup, contextRuntime === '' ? undefined : contextRuntime);
    } else if (mode === '--setup') {
      if (group !== 'shared' && group !== 'parity' && group !== 'runtime') throw new Error(`unknown CI setup group ${group}; choose shared, parity or runtime`);
      if (runtime !== '' && !isRuntime(runtime)) throw new Error(`unknown runtime ${runtime}; choose ${RUNTIMES.join(', ')}`);
      runCISetup(root, group, runtime === '' ? undefined : runtime);
    } else throw new Error(`unknown CI setup mode ${mode}; use --plan, --setup GROUP [RUNTIME], --context-prepare GROUP [RUNTIME], or --context-cleanup GROUP [RUNTIME]`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[ci-setup] ${error.message}`);
    process.exitCode = 1;
  }
}
