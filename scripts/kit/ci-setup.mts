#!/usr/bin/env node
// The locked setup of the jobs of the CI pipeline (`make kit-ci-plan`, `make kit-ci-setup`, K731, K910): config/ci.json names
// repository-owned Make targets; where none are declared, Kit uses the repository's deps-<runtime> targets (K859). The plan
// also passes the targets that config/ci.json declares for each job (targets.shared, targets.parity, targets.runtimes).
import { appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';
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
type SetupGroup = 'shared' | 'parity' | 'runtime' | 'parity-binding';
type BindingSetup = { setup: string[]; tools: string[] };
type ParityMode = 'full' | 'phases' | 'none';
type Runner = 'ubuntu-24.04' | 'ubuntu-26.04-arm';
type CIConfig = {
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

function readAndValidate(root: string): { config: CIConfig; runtimes: Runtime[]; files: string[]; folders: string[]; parityMode: ParityMode } {
  if (!existsSync(path.join(root, CI_CONFIG))) throw new Error(`${CI_CONFIG} is missing. Fix: declare shared, parity and runtime setup targets following docs/operations/tool-inventory.md (schema scripts/kit/schema/ci.schema.json)`);
  const config = readConfig<CIConfig>(root, CI_CONFIG, 'ci.schema.json');
  const files = trackedFiles(root);
  const folders = implementationFolders(files);
  // One runtime set for the plan, the setup and the contexts: the runtimes of the tracked files and those that targets.runtimes
  // names, so a declared runtime is never left out (K910).
  const runtimes = [...new Set([...runtimeSet(files, folders), ...RUNTIMES.filter(runtime => config.targets?.runtimes?.[runtime] !== undefined)])].sort();
  // A declared setup, binding or context target runs as declared (K1068): make reports a target that does not exist when it runs.
  // The plan is what config/ci.json declares (K1068): a declared parityMode is planned as declared, and without a declaration a
  // repository with config/parity.json has full parity and one without it has none; only the plan reads the file, for its runner tools.
  const parityMode: ParityMode = config.parityMode ?? (existsSync(path.join(root, 'config/parity.json')) ? 'full' : 'none');
  return { config, runtimes, files, folders, parityMode };
}

/** The default setup of a runtime is the repository's own deps-<runtime> target, a thin call of its package manager (K859); make reports it when it is missing. */
function defaultSetup(runtime: Runtime): { target: string; args: string[] }[] {
  return [{ target: `deps-${{ ts: 'node', go: 'go', rust: 'rust', php: 'php', 'php-ext': 'php', python: 'python' }[runtime]}`, args: [] }];
}

function plan(root: string): CIPlan {
  const { config, runtimes, parityMode } = readAndValidate(root);
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

export function ciPlan(root: string = repositoryRoot()): CIPlan { return plan(root); }

/** The setup of `runtime`: its declared targets or its deps target. */
function runtimeSetup(runtime: Runtime, config: CIConfig): { target: string; args: string[] }[] {
  const configured = config.setup.runtimes[runtime] ?? [];
  return configured.length ? configured.map(target => ({ target, args: [] })) : defaultSetup(runtime);
}

function invocations(root: string, group: SetupGroup, selector?: string): { target: string; args: string[] }[] {
  const { config, runtimes } = readAndValidate(root);
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
    if (runtime === undefined || !isRuntime(runtime) || !runtimes.includes(runtime)) throw new Error(`make kit-ci-setup GROUP=runtime needs a runtime of the plan (the tracked source files and targets.runtimes); choose ${runtimes.join(', ') || '(none)'}`);
    return [...runtimeSetup(runtime, config), ...(php && runtime === 'php' ? [PHP_EXTRACTOR] : [])];
  }
  // The parity job builds every implementation, so it runs the setup of every runtime, each target once.
  const targets = [...runtimes.flatMap(selected => runtimeSetup(selected, config)), ...config.setup.parity.map(target => ({ target, args: [] }))];
  return [...new Map(targets.map(invocation => [invocation.target, invocation])).values()];
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

export function runCISetup(root: string, group: SetupGroup, runtimeName?: string): void {
  if (!['shared', 'parity', 'runtime', 'parity-binding'].includes(group)) throw new Error(`unknown CI setup group ${group}; choose shared, parity, parity-binding or runtime`);
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
      const [, contextGroup = '', contextRuntime = ''] = process.argv.slice(2);
      if (contextRuntime !== '' && !isRuntime(contextRuntime)) throw new Error(`unknown runtime ${contextRuntime}; choose ${RUNTIMES.join(', ')}`);
      runCIContext(root, mode === '--context-prepare' ? 'prepare' : 'cleanup', contextGroup, contextRuntime === '' ? undefined : contextRuntime);
    } else if (mode === '--setup') {
      if (group !== 'shared' && group !== 'parity' && group !== 'runtime' && group !== 'parity-binding') throw new Error(`unknown CI setup group ${group}; choose shared, parity, parity-binding or runtime`);
      if (group === 'runtime' && runtime !== '' && !isRuntime(runtime)) throw new Error(`unknown runtime ${runtime}; choose ${RUNTIMES.join(', ')}`);
      runCISetup(root, group, runtime === '' ? undefined : runtime);
    } else throw new Error(`unknown CI setup mode ${mode}; use --plan, --setup GROUP [RUNTIME|IMPLEMENTATION], --context-prepare GROUP [RUNTIME], or --context-cleanup GROUP [RUNTIME]`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[ci-setup] ${error.message}`);
    process.exitCode = 1;
  }
}
