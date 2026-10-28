#!/usr/bin/env node
// The locked setup of the shared CI gate partitions (`make kit-ci-plan`, `make kit-ci-setup`, K731): config/ci.json names
// repository-owned Make targets; where none are declared, Kit uses the existing native lock/install/build targets.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';
import { makeDatabase } from './owner-check.mts';
import { trackedFiles } from './tracked-files.mts';
import { implementationFolders } from './parity-declaration.mts';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { declaredMiseTools } from './toolchain-mise.mts';
import { declaredLintTools } from './toolchain-lint.mts';
import { declaredRust } from './toolchain-files.mts';
import { TOOLS as CHECK_TOOLS } from './check-toolchain.mts';
import { isJsonObject } from './bootstrap/files.mts';

export const CI_CONFIG = 'config/ci.json';
const RUNTIMES = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
type Runtime = (typeof RUNTIMES)[number];
type CIJob = 'shared' | 'parity' | Runtime;
const CI_JOBS = ['shared', 'parity', ...RUNTIMES] as const satisfies readonly CIJob[];
type ParityMode = 'full' | 'phases';
type CIConfig = { parityMode?: ParityMode; setup: { shared: string[]; parity: string[]; runtimes: Record<Runtime, string[]> }; tools?: Partial<Record<CIJob, string[]>> };
type RuntimeJob = { runtime: Runtime | 'none'; checkTools: string[]; installTools: string[] };
export type CIPlan = {
  sharedTargets: string[];
  parityMode: ParityMode;
  parityImplementations: string[];
  parityMatrix: { implementation: string }[];
  parityTargets: string[];
  parityRuntimes: Runtime[];
  runtimes: RuntimeJob[];
  commonTools: string[];
  parityTools: string[];
  extractors: string[];
  linkTools: string[];
  phpDirs: string[];
  pythonDirs: string[];
};

/** The exact binding matrix from config/parity.json, with duplicate and empty selections rejected before Actions schedules jobs. */
export function parityBindingMatrix(implementations: readonly string[]): { implementation: string }[] {
  if (implementations.length === 0) throw new Error('config/parity.json declares no implementations. Fix: declare every required implementation before selecting parityMode phases');
  if (implementations.some(name => name === '')) throw new Error('config/parity.json declares an empty implementation name. Fix: use each implementation name as the provider target selector');
  if (new Set(implementations).size !== implementations.length) throw new Error('config/parity.json declares duplicate implementation names. Fix: give every implementation a unique name');
  return implementations.map(implementation => ({ implementation }));
}

/** Coverage findings for a planned binding matrix, useful to verify a workflow plan against its source declaration. */
export function parityMatrixFindings(implementations: readonly string[], matrix: readonly { implementation: string }[]): string[] {
  try {
    parityBindingMatrix(implementations);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return [error.message];
  }
  const findings: string[] = [];
  for (const name of new Set([...implementations, ...matrix.map(entry => entry.implementation)])) {
    const expected = implementations.filter(value => value === name).length;
    const actual = matrix.filter(entry => entry.implementation === name).length;
    if (expected !== actual) findings.push(`parity binding matrix selects ${name} ${actual} times; config/parity.json requires ${expected}`);
  }
  return findings;
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

function phpDirectories(root: string, files: readonly string[], folders: readonly string[]): string[] {
  const has = (file: string) => files.includes(file) && existsSync(path.join(root, file));
  const dirs = new Set<string>();
  if (has('composer.json') && has('composer.lock')) dirs.add('.');
  for (const folder of folders.filter(folder => ['php', 'php-ext'].includes(path.posix.basename(folder)))) {
    if (has(`${folder}/composer.json`) && has(`${folder}/composer.lock`)) dirs.add(folder);
  }
  return [...dirs].sort();
}

function pythonDirectories(root: string, files: readonly string[], folders: readonly string[]): string[] {
  const has = (file: string) => files.includes(file) && existsSync(path.join(root, file));
  return folders.filter(folder => path.posix.basename(folder) === 'python' && has(`${folder}/pyproject.toml`) && has(`${folder}/uv.lock`)).sort();
}

function readAndValidate(root: string): { config: CIConfig; runtimes: Runtime[]; files: string[]; folders: string[]; db: ReturnType<typeof makeDatabase> } {
  if (!existsSync(path.join(root, CI_CONFIG))) throw new Error(`${CI_CONFIG} is missing. Fix: declare shared, parity and runtime setup targets following docs/operations/tool-inventory.md (schema scripts/kit/schema/ci.schema.json)`);
  const config = readConfig<CIConfig>(root, CI_CONFIG, 'ci.schema.json');
  const db = makeDatabase(root);
  const parityMode = config.parityMode ?? 'full';
  const setupEntries = [
    ['setup.shared', config.setup.shared], ['setup.parity', config.setup.parity],
    ...RUNTIMES.map(runtime => [`setup.runtimes.${runtime}`, config.setup.runtimes[runtime]] as [string, string[]]),
  ] as [string, string[]][];
  for (const [where, targets] of setupEntries) {
    for (const target of targets) {
      if (target === 'install' || target === 'install-kit') throw new Error(`${CI_CONFIG}: ${where} names ${target}, the full install aggregate; name the existing per-runtime locked install/build target instead`);
      if (!db.targets.has(target)) throw new Error(`${CI_CONFIG}: ${where} names ${target}, which is not a Make target. Fix: declare an existing locked install/build target; the full install target is not a fallback`);
    }
  }
  const { names } = toolchainNames(root);
  for (const job of CI_JOBS) {
    for (const tool of config.tools?.[job] ?? []) {
      if (!CHECK_TOOLS.includes(tool)) throw new Error(`${CI_CONFIG}: tools.${job} names unknown Kit tool ${tool}. Fix: choose one of ${CHECK_TOOLS.join(', ')}`);
      if (['node', 'npm', 'mise'].includes(tool)) throw new Error(`${CI_CONFIG}: tools.${job} names ${tool}, which the workflow already provisions. Fix: name an additional installable tool instead`);
      if (!names.includes(tool)) throw new Error(`${CI_CONFIG}: tools.${job} names ${tool}, which this checkout does not declare. Fix: declare and pin ${tool} in the toolchain files before selecting it`);
    }
  }
  const files = trackedFiles(root);
  const folders = implementationFolders(files);
  const runtimes = [...runtimeSet(files, folders)].sort();
  for (const runtime of RUNTIMES) {
    if (!runtimes.includes(runtime) && (config.tools?.[runtime]?.length ?? 0) > 0) throw new Error(`${CI_CONFIG}: tools.${runtime} selects tools for a runtime with no tracked package. Fix: move the tools to an active job or declare the runtime package`);
  }
  const parity = readConfig<{ implementations: { name: string }[] }>(root, 'config/parity.json', 'parity.schema.json');
  const implementationNames = parity.implementations.map(({ name }) => name);
  parityBindingMatrix(implementationNames);
  if (parityMode === 'phases') {
    if (!db.targets.has('parity-api-check')) throw new Error(`config/ci.json selects parityMode phases, but parity-api-check is not a Make target. Fix: use the provider parity targets from kit.mk`);
    if (makeRecipe(db.targets.get('parity-api-check')?.recipe.trim()) !== '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api') throw new Error(`config/ci.json selects parityMode phases, but parity-api-check does not use the provider API recipe. Fix: use the provider target without replacing its recipe`);
    for (const implementation of implementationNames) {
      if (!/^[a-z][a-z0-9-]*$/.test(implementation)) throw new Error(`config/parity.json has implementation name ${implementation}, which cannot select a provider binding target. Fix: use the declared implementation name format`);
      const target = `parity-bindings-${implementation}-check`;
      const recipe = db.targets.get(target)?.recipe.trim();
      if (makeRecipe(recipe) !== `$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation ${implementation}`) throw new Error(`${CI_CONFIG} selects phases, but ${target} is missing its provider binding recipe. Fix: use the generated provider target and add setup prerequisites without replacing its recipe`);
    }
  }
  return { config, runtimes, files, folders, db };
}

/** Make's database retains doubled dollars that were escaped through eval; compare the expanded provider recipe. */
const makeRecipe = (recipe: string | undefined): string | undefined => recipe?.replaceAll('$$(', '$(');

function defaultSetup(root: string, runtime: Runtime, files: readonly string[], folders: readonly string[]): { target: string; args: string[] }[] {
  switch (runtime) {
    case 'ts': return [{ target: 'build-ts', args: [] }];
    case 'go': {
      const dependencyModule = files.find(file => path.posix.basename(file) === 'go.mod' && /^\s*require(?:\s|\()/m.test(readFileSync(path.join(root, file), 'utf8')));
      if (dependencyModule !== undefined) throw new Error(`${CI_CONFIG}: ${dependencyModule} declares Go module requirements, but build-go alone does not fetch them. Fix: declare an existing locked Go setup target under setup.runtimes.go`);
      return [{ target: 'build-go', args: [] }];
    }
    case 'rust': return [{ target: 'cargo-downloads-fetch', args: [] }];
    case 'php':
    case 'php-ext': {
      const dirs = phpDirectories(root, files, folders);
      if (dirs.length === 0) throw new Error(`${CI_CONFIG}: no locked Composer project was found for ${runtime}. Fix: declare an existing locked setup target under setup.runtimes.${runtime}`);
      return dirs.map(dir => ({ target: 'composer-install', args: [`DIR=${dir}`] }));
    }
    case 'python': {
      const dirs = pythonDirectories(root, files, folders);
      if (dirs.length === 0) throw new Error(`${CI_CONFIG}: no locked Python project (pyproject.toml and uv.lock) was found. Fix: declare an existing locked setup target under setup.runtimes.python`);
      return dirs.map(dir => ({ target: 'uv-install', args: [`DIR=${dir}`] }));
    }
  }
}

function plan(root: string): CIPlan {
  const { config, runtimes, files, folders } = readAndValidate(root);
  invocations(root, 'shared');
  invocations(root, 'parity');
  for (const runtime of runtimes) invocations(root, 'runtime', runtime);
  const { declared, names } = toolchainNames(root);
  const activeOwners = new Set(runtimes.flatMap(runtime => runtimeTools[runtime]));
  const assignedElsewhere = new Set([
    ...(config.tools?.parity ?? []),
    ...runtimes.flatMap(runtime => config.tools?.[runtime] ?? []),
  ]);
  const commonTools = [...new Set([
    ...names.filter(name => !['node', 'npm', 'mise'].includes(name) && !activeOwners.has(name) && !assignedElsewhere.has(name)),
    ...(config.tools?.shared ?? []),
  ])].sort();
  const runtimeJobs = runtimes.map(runtime => ({
    runtime,
    checkTools: [...new Set([...runtimeTools[runtime], ...(config.tools?.[runtime] ?? [])])].filter(name => names.includes(name)),
    installTools: [...new Set([...runtimeTools[runtime], ...(config.tools?.[runtime] ?? [])])].filter(name => names.includes(name) && !['node', 'npm', 'mise'].includes(name)),
  }));
  const parity = readConfig<{ implementations: { name: string; runner: string }[] }>(root, 'config/parity.json', 'parity.schema.json');
  const parityTools = new Set(parity.implementations.flatMap(implementation => parityRunnerTools[implementation.runner] ?? []));
  for (const runtime of runtimes) for (const tool of config.tools?.[runtime] ?? []) parityTools.add(tool);
  for (const tool of config.tools?.parity ?? []) parityTools.add(tool);
  const symbolExtractors = declared.symbolExtractors;
  const extractors = isJsonObject(symbolExtractors) && Array.isArray(symbolExtractors.extractors)
    ? symbolExtractors.extractors.filter((extractor: unknown): extractor is string => typeof extractor === 'string')
    : [];
  if (extractors.includes('go')) parityTools.add('go');
  if (extractors.includes('php')) { parityTools.add('php'); parityTools.add('composer'); }
  const linkTools = declared.go === undefined ? [] : ['go'];
  return {
    sharedTargets: config.setup.shared,
    parityMode: config.parityMode ?? 'full',
    parityImplementations: parity.implementations.map(({ name }) => name),
    parityMatrix: parityBindingMatrix(parity.implementations.map(({ name }) => name)),
    parityTargets: config.setup.parity,
    parityRuntimes: runtimes,
    runtimes: runtimeJobs.length ? runtimeJobs : [{ runtime: 'none', checkTools: [], installTools: [] }],
    commonTools,
    parityTools: [...parityTools].filter(name => names.includes(name)).sort(),
    extractors,
    linkTools,
    phpDirs: phpDirectories(root, files, folders),
    pythonDirs: pythonDirectories(root, files, folders),
  };
}

export function ciPlan(root: string = repositoryRoot()): CIPlan { return plan(root); }

function invocations(root: string, group: 'shared' | 'parity' | 'runtime', runtime?: Runtime): { target: string; args: string[] }[] {
  const { config, runtimes, files, folders, db } = readAndValidate(root);
  let targets: { target: string; args: string[] }[];
  if (group === 'shared') targets = config.setup.shared.map(target => ({ target, args: [] }));
  else if (group === 'runtime') {
    if (runtime === undefined || !runtimes.includes(runtime)) throw new Error(`make kit-ci-setup GROUP=runtime needs a runtime present in tracked source files; choose ${runtimes.join(', ') || '(none)'}`);
    const configured = config.setup.runtimes[runtime];
    targets = configured.length ? configured.map(target => ({ target, args: [] })) : defaultSetup(root, runtime, files, folders);
    if (runtime === 'php-ext' && files.some(file => file.startsWith('packages/php-ext/'))) targets.push({ target: 'kit-install-php-arginfo', args: [] });
  } else {
    targets = [];
    for (const selected of runtimes) {
      const configured = config.setup.runtimes[selected];
      targets.push(...(configured.length ? configured.map(target => ({ target, args: [] })) : defaultSetup(root, selected, files, folders)));
    }
    targets.push(...config.setup.parity.map(target => ({ target, args: [] })));
  }
  for (const { target } of targets) {
    if (!db.targets.has(target)) throw new Error(`${CI_CONFIG}: the default setup target ${target} is not present in this Makefile. Fix: declare an existing per-runtime setup target under setup.runtimes instead`);
  }
  return targets;
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
    parity_mode: result.parityMode,
    parity_matrix: result.parityMatrix,
    has_runtimes: result.runtimes.some(({ runtime }) => runtime !== 'none'),
    common_tools: result.commonTools,
    parity_tools: result.parityTools,
    extractors: result.extractors,
    link_tools: result.linkTools,
    php_dirs: result.phpDirs,
    python_dirs: result.pythonDirs,
  };
  for (const [key, value] of Object.entries(outputs)) appendFileSync(output, `${key}=${JSON.stringify(value)}\n`);
}

export const GATE_REQUIRED_NEEDS = ['discover', 'shared', 'parity', 'parity-api', 'parity-bindings', 'runtime'] as const;
export type GateResult = 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';

/** Whether the provider workflow's final aggregate accepted exactly the selected parity path and all required partitions. */
export function gateResultsPass(mode: ParityMode, results: { discover: GateResult; shared: GateResult; parity: GateResult; api: GateResult; bindings: GateResult; runtime: GateResult }, hasRuntimes: boolean): boolean {
  if (results.discover !== 'success' || results.shared !== 'success') return false;
  if (mode === 'full') {
    if (results.parity !== 'success' || results.api !== 'skipped' || results.bindings !== 'skipped') return false;
  } else if (mode === 'phases') {
    if (results.parity !== 'skipped' || results.api !== 'success' || results.bindings !== 'success') return false;
  } else return false;
  return hasRuntimes ? results.runtime === 'success' : results.runtime === 'skipped';
}

function verifyGateResults(): void {
  const mode = process.env.KIT_CI_PARITY_MODE;
  if (mode !== 'full' && mode !== 'phases') throw new Error(`the parity mode is missing or unknown (${mode ?? 'unset'}); fix config/ci.json and rerun the gates`);
  const readResult = (name: string): GateResult => {
    const value = process.env[`KIT_CI_${name.toUpperCase()}_RESULT`];
    return value === 'success' || value === 'failure' || value === 'cancelled' || value === 'skipped' ? value : 'unknown';
  };
  const hasRuntimes = process.env.KIT_CI_HAS_RUNTIMES === 'true';
  const results = { discover: readResult('discover'), shared: readResult('shared'), parity: readResult('parity'), api: readResult('parity_api'), bindings: readResult('parity_bindings'), runtime: readResult('runtime') };
  if (!gateResultsPass(mode, results, hasRuntimes)) {
    throw new Error(`gate result aggregation failed for parityMode ${mode}: ${JSON.stringify(results)}; fix every failed, skipped or unselected required partition and rerun CI`);
  }
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

// Kept as one small seam for an execution test; commands always contain a validated target name, never config text as shell input.
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
    else if (mode === '--verify-gates') verifyGateResults();
    else {
      if (group !== 'shared' && group !== 'parity' && group !== 'runtime') throw new Error(`unknown CI setup group ${group}; choose shared, parity or runtime`);
      if (runtime !== '' && !isRuntime(runtime)) throw new Error(`unknown runtime ${runtime}; choose ${RUNTIMES.join(', ')}`);
      runCISetup(root, group, runtime === '' ? undefined : runtime);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[ci-setup] ${error.message}`);
    process.exitCode = 1;
  }
}
