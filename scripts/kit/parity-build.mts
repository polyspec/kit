// Compiled parity targets share a build only with identical compiler options, working directory and environment.
// Target selectors are separate from those options; cases are selected later from the resulting executables.
import path from 'node:path';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { parseJson } from './schema-validate.mts';
import { runCommand, type RunCommandResult } from './run-command.mts';
import { capturedExecutableFor, readExecutable, runCargoExecutable, runGoExecutable, type NativeExecutionResult, type CapturedExecutable } from './parity-executable.mts';
import { quote, wrapperText, windowsWrapperText } from './bootstrap/tool-wrappers.mts';
import { siblingTool } from './paths.mts';
import { cargoCfgFacts } from './cargo-cfg.mts';
import { cargoCaptureRunnerType, cargoTargetKey, cargoTargets, mergeCargoConfig, resolvedCargoRunner, resolvedCargoRustc } from './cargo-config.mts';
import { isTable, type TomlTable } from './toml.mts';

/** Resolve target execution contexts from repository configuration and native tool reports. */
export async function cargoNativeContexts(group: BuildGroup, config: TomlTable, command: TomlTable): Promise<{ triple: string; runner: string[]; runnerType?: 'string' }[]> {
  const host = await queryCargoHost(group);
  const merged = mergeCargoConfig(config, command);
  const targets = cargoTargets(group.options, merged, group.env, host);
  const compiler = resolvedCargoRustc(config, command, group.env, group.cwd);
  const conditional = isTable(merged.target) && Object.entries(merged.target).some(([key, value]) =>
    key.startsWith('cfg(') && isTable(value) && value.runner !== undefined);
  const contexts: { triple: string; runner: string[]; runnerType?: 'string' }[] = [];
  for (const triple of targets) {
    const facts = conditional ? await queryRustCfg(compiler, triple, group.cwd, group.env) : new Set<string>();
    contexts.push({ ...(cargoCaptureRunnerType(config, command, triple) === 'string' ? { runnerType: 'string' as const } : {}), triple, runner: resolvedCargoRunner(config, command, group.env, triple, facts, group.cwd) });
  }
  return contexts;
}

/** Run compiler introspection without building targets or applying a test deadline. */
async function compilerOutput(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await runCommand({ command, args, cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (result.error || result.status !== 0 || result.signal || result.stopped)
    throw new Error(`cannot query ${command} ${args.join(' ')}: ${result.error?.message || result.stderr || result.signal || result.status}; inspect the declared compiler`);
  return result.stdout;
}

export async function queryRustCfg(command: string, target: string, cwd: string, env: NodeJS.ProcessEnv): Promise<Set<string>> {
  return cargoCfgFacts(await compilerOutput(command, ['--print=cfg', '--target', target], cwd, env));
}

export async function queryCargoHost(group: BuildGroup): Promise<string> {
  return cargoHost(await compilerOutput(group.command, ['-vV'], group.cwd, group.env));
}

/** Build selectors and execution selectors before the native tool's binary execution adapter. */
export interface CompiledBinding {
  runner: 'go' | 'cargo';
  options: string[];
  target: string[];
  selection: string[];
  testCwd: string;
}

/** Read Cargo's host identity instead of inferring a Rust target from the operating system. */
export function cargoHost(output: string): string {
  const hosts = [...output.matchAll(/^host:\s+(\S+)\s*$/gm)].map(match => match[1]);
  const host = hosts[0];
  if (hosts.length !== 1 || !host)
    throw new Error('Cargo verbose version did not report one host; run the declared cargo -vV and inspect its output');
  return host;
}

/** One binding's native compilation request, before case selection. */
export interface BuildRequest {
  id: string;
  runner: 'go' | 'cargo';
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  options: string[];
  target: string[];
}

/** A compatible build and all bindings that need its executables. */
export interface BuildGroup {
  runner: BuildRequest['runner'];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  options: string[];
  targets: string[][];
  requests: BuildRequest[];
}

/** Group without changing the declarations; repeated targets compile once and retain every binding. */
export function buildGroups(requests: readonly BuildRequest[]): BuildGroup[] {
  const groups = new Map<string, BuildGroup>();
  for (const request of requests) {
    const environment = Object.keys(request.env).sort().map(name => [name, request.env[name]]);
    const key = JSON.stringify([request.runner, request.command, request.cwd, request.options, environment]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { runner: request.runner, command: request.command, cwd: request.cwd,
        env: { ...request.env }, options: [...request.options], targets: [], requests: [] };
      groups.set(key, group);
    }
    group.requests.push(request);
    if (!group.targets.some(target => target.length === request.target.length && target.every((value, index) => value === request.target[index])))
      group.targets.push([...request.target]);
  }
  return [...groups.values()];
}

/** A native executable named by a Cargo compiler-artifact message. */
export interface CargoExecutable {
  manifest: string;
  target: { name: string; kind: string[]; src_path: string };
  test: boolean;
  executable: string;
}

interface CargoMessage {
  reason: string;
  manifest_path?: string;
  target?: CargoExecutable['target'];
  profile?: { test: boolean };
  executable?: string | null;
}

/** Read Cargo's JSON lines; non-JSON progress is left to the build log, never interpreted as a path. */
export function cargoExecutables(output: string): CargoExecutable[] {
  const artifacts = new Map<string, CargoExecutable>();
  for (const line of output.split('\n')) {
    if (!line.startsWith('{')) continue;
    const message = parseJson<CargoMessage>(line, 'cargo-build-message.schema.json', 'cargo build output');
    if (message.reason !== 'compiler-artifact' || message.executable === null) continue;
    const { manifest_path: manifest, target, profile, executable } = message;
    if (manifest === undefined || target === undefined || profile === undefined || executable === undefined)
      throw new Error('cargo build output lacks an executable identity; run make parity-check to rebuild and collect the compiler report');
    if (!path.isAbsolute(manifest) || !path.isAbsolute(executable))
      throw new Error('cargo build output contains a non-absolute manifest or executable; run make parity-check from the checkout with its pinned Cargo');
    const artifact = { manifest: path.normalize(manifest), target, test: profile.test, executable: path.normalize(executable) };
    artifacts.set(JSON.stringify(artifact), artifact);
  }
  return [...artifacts.values()];
}

/** Select by manifest and target, retaining custom integration harnesses that do not use rustc --test. */
export function selectCargoExecutable(artifacts: readonly CargoExecutable[], manifest: string, target: readonly string[]): string {
  const kind = target[0]?.replace(/^--/, '');
  const canonical = (file: string) => existsSync(file) ? realpathSync(file) : path.normalize(file);
  const matches = artifacts.filter(artifact => canonical(artifact.manifest) === canonical(manifest)
    && (kind === 'lib' ? artifact.test && artifact.target.kind.some(value => ['lib', 'rlib', 'dylib', 'staticlib', 'cdylib', 'proc-macro'].includes(value))
      : artifact.target.kind.includes(kind ?? '') && artifact.target.name === target[1]));
  const executables = [...new Set(matches.map(artifact => artifact.executable))];
  if (executables.length !== 1)
    throw new Error(`cargo build reported ${executables.length === 0 ? 'no executable' : 'more than one executable'} for ${manifest} ${target.join(' ')}; run make parity-check and inspect that target's compiler report`);
  const executable = executables[0];
  if (executable === undefined) throw new Error('cargo executable selection is empty; run make parity-check to collect the compiler report');
  return executable;
}

/** One compiler process and the executable or artifact error belonging to each binding. */
export interface CompiledGroup {
  result: RunCommandResult;
  executables: Map<string, string>;
  errors: Map<string, string>;
}

/** A Go build also retains the native test invocation for execution through test2json. */
export interface GoCompiledGroup extends CompiledGroup {
  invocations: Map<string, CapturedExecutable>;
}

/** Own a compiler group and retain every independent binding outcome before cleaning its artifacts. */
async function runCompiledGroup<T extends CompiledGroup>(group: BuildGroup,
  selections: ReadonlyMap<string, readonly string[]>, parent: string, label: 'Go' | 'Cargo',
  compile: (directory: string) => Promise<T>,
  execute: (built: T, directory: string, request: BuildRequest, selection: readonly string[]) => Promise<NativeExecutionResult>,
  say: (line: string) => void): Promise<{ build: RunCommandResult; runs: Map<string, NativeExecutionResult>; errors: Map<string, string> }> {
  for (const request of group.requests)
    if (!selections.has(request.id)) throw new Error(`${label} binding ${request.id} has no selection; provide its declared native test filter`);
  const directory = mkdtempSync(path.join(parent, `parity-${label.toLowerCase()}-`));
  try {
    const built = await compile(directory);
    say(`${label} group build: exit ${built.result.status ?? built.result.signal ?? 'none'}, ${built.result.elapsedMs.toFixed(1)} ms${label === 'Go' ? `, ${group.targets.length} packages` : ''}`);
    const runs = new Map<string, NativeExecutionResult>();
    const errors = new Map(built.errors);
    for (const request of group.requests) {
      if (!built.executables.has(request.id)) {
        if (!errors.has(request.id)) errors.set(request.id, built.result.error?.message ??
          `${label} build ended with ${built.result.signal ?? built.result.status} without an executable for ${request.id}; inspect its compiler report`);
        continue;
      }
      try {
        const selection = selections.get(request.id);
        if (selection === undefined) throw new Error(`${label} binding ${request.id} lost its declared selection`);
        const result = await execute(built, directory, request, selection);
        runs.set(request.id, result);
        say(`${label} binding ${request.id} execution: exit ${result.status ?? result.signal ?? 'none'}, ${result.elapsedMs.toFixed(1)} ms`);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        errors.set(request.id, error.message);
      }
    }
    return { build: built.result, runs, errors };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Build Cargo targets once and execute their captured invocations inside one owned artifact lifetime. */
export async function runCargoGroup(group: BuildGroup, selections: ReadonlyMap<string, readonly string[]>,
  parent: string, native: { triple: string; runner: readonly string[]; runnerType?: 'string' | 'array' }, silenceMs: number, say: (line: string) => void) {
  return runCompiledGroup(group, selections, parent, 'Cargo',
    directory => compileCargoGroup(group, say, { directory, triple: native.triple, ...(native.runnerType ? { runnerType: native.runnerType } : {}) }),
    async (built, directory, request, selection) => {
      const source = built.executables.get(request.id);
      if (!source) throw new Error(`Cargo binding ${request.id} lost its compiler artifact; inspect its compiler report`);
      const captured = capturedExecutableFor(directory, source);
      return runCargoExecutable(captured.executable, captured.invocation, selection, silenceMs, say, native.runner);
    }, say);
}

/** Build Go packages once and replay each declared selection through the native JSON reporter. */
export async function runGoGroup(group: BuildGroup, selections: ReadonlyMap<string, readonly string[]>,
  parent: string, silenceMs: number, say: (line: string) => void) {
  return runCompiledGroup(group, selections, parent, 'Go', directory => compileGoGroup(group, directory, say),
    (built, _directory, request, selection) => executeGoBinding(group, built, request.id, selection, silenceMs, say), say);
}

/** Execute one binding from its completed group; a missing artifact remains a build error. */
export async function executeGoBinding(group: BuildGroup, built: GoCompiledGroup, id: string,
  selection: readonly string[], silenceMs: number, say: (line: string) => void): Promise<NativeExecutionResult> {
  const executable = built.executables.get(id);
  const invocation = built.invocations.get(id);
  if (!executable || !invocation) throw new Error(built.errors.get(id) ?? `Go binding ${id} has no built executable; inspect its compiler report`);
  return runGoExecutable(group.command, executable, invocation, selection, silenceMs, say);
}

/** Go's -exec uses quoted words, not shell expansion or backslash escaping. */
export function goExecCommand(words: readonly string[]): string {
  return words.map(word => {
    if (word !== '' && !/[\s'"]/.test(word)) return word;
    if (!word.includes('"')) return `"${word}"`;
    if (!word.includes("'")) return `'${word}'`;
    throw new Error('Go exec path contains both quote characters; run make parity-check from a path without both kinds of quote');
  }).join(' ');
}

/** Build the packages together and let Go supply each executable's native working directory and arguments. */
export async function compileGoGroup(group: BuildGroup, directory: string, say: (line: string) => void): Promise<GoCompiledGroup> {
  if (group.runner !== 'go') throw new Error('the Go builder received another runner; group requests by their declared compiler');
  if (readdirSync(directory).length) throw new Error('the parity build directory is not empty; create a fresh directory for this build group');
  const adapter = siblingTool(import.meta.url, 'parity-executable');
  const result = await runCommand({ command: group.command,
    args: [...group.options, '-json', '-count=1', '-exec', goExecCommand([process.execPath, adapter, directory]), ...group.targets.flat()],
    cwd: group.cwd, env: group.env, stdout: 'pipe', stderr: 'pipe', maxOutputBytes: 256 * 1024 * 1024,
    onLine: (_stream, line) => say(line),
  });
  const executables = new Map<string, string>();
  const invocations = new Map<string, CapturedExecutable>();
  const errors = new Map<string, string>();
  if (result.error || result.stopped || result.signal) return { result, executables, invocations, errors };
  let captured: { id: string; invocation: CapturedExecutable }[];
  try {
    captured = readdirSync(directory).map(id => ({ id, invocation: readExecutable(directory, id) }));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    for (const request of group.requests) errors.set(request.id, `invalid Go compiler capture: ${error.message}`);
    return { result, executables, invocations, errors };
  }
  for (const request of group.requests) {
    const target = request.target[0];
    if (request.target.length !== 1 || !target) throw new Error('a Go binding must name one package directory; declare its native test file');
    let cwd: string;
    try { cwd = realpathSync(path.resolve(group.cwd, target)); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      errors.set(request.id, `cannot resolve Go test package ${target}: ${error.message}; inspect that package's compiler output`);
      continue;
    }
    const matches = captured.filter(entry => entry.invocation.cwd === cwd);
    const selected = matches[0];
    if (matches.length !== 1 || !selected) {
      errors.set(request.id, `Go build captured ${matches.length} executables for ${target}; inspect that package's compiler output`);
      continue;
    }
    executables.set(request.id, path.join(directory, selected.id, selected.invocation.executable));
    invocations.set(request.id, selected.invocation);
  }
  return { result, executables, invocations, errors };
}

/** Compile selected Cargo targets together, retaining independently completed targets after a compiler failure. */
export async function compileCargoGroup(group: BuildGroup, say: (line: string) => void,
  capture?: { directory: string; triple: string; runnerType?: 'string' | 'array' }): Promise<CompiledGroup> {
  if (group.runner !== 'cargo') throw new Error('the Cargo builder received another runner; group the requests by their declared compiler');
  if (capture && (!capture.triple || readdirSync(capture.directory).length))
    throw new Error('Cargo capture needs a target triple and an empty owned directory; provide the native target and a fresh run directory');
  let environment = group.env;
  const adapter = capture ? [process.execPath, siblingTool(import.meta.url, 'parity-executable'), capture.directory] : [];
  let runner: string | string[] = adapter;
  if (capture?.runnerType === 'string') {
    // A bare wrapper name keeps Cargo's whitespace-delimited runner string independent of checkout path spelling.
    const name = 'kit-parity-capture';
    const args = adapter.slice(1);
    const text = process.platform === 'win32'
      ? windowsWrapperText('Retain the native parity executable.', process.execPath, { args })
      : wrapperText('Retain the native parity executable.', `exec ${adapter.map(quote).join(' ')} "$@"`);
    writeFileSync(path.join(capture.directory, name + (process.platform === 'win32' ? '.cmd' : '')), text, { mode: 0o755 });
    environment = { ...group.env, PATH: [capture.directory, group.env.PATH ?? ''].join(path.delimiter) };
    runner = name;
  }
  const execution = capture ? ['--config', `target.${JSON.stringify(cargoTargetKey(capture.triple))}.runner=${JSON.stringify(runner)}`] : ['--no-run'];
  const result = await runCommand({ command: group.command,
    args: [...group.options, ...group.targets.flat(), ...execution, '--keep-going', '--message-format=json-render-diagnostics'],
    cwd: group.cwd, env: environment, stdout: 'pipe', stderr: 'pipe', maxOutputBytes: 256 * 1024 * 1024,
    onLine: (_stream, line) => say(line),
  });
  const executables = new Map<string, string>();
  const errors = new Map<string, string>();
  if (result.error || result.stopped || result.signal) return { result, executables, errors };
  try {
    const at = group.options.lastIndexOf('--manifest-path');
    const declared = at === -1 ? group.options.findLast(option => option.startsWith('--manifest-path='))?.slice('--manifest-path='.length) : group.options[at + 1];
    if (!declared) throw new Error('Cargo build has no manifest path; declare the manifest of each compiled binding');
    const manifest = path.resolve(group.cwd, declared);
    const artifacts = cargoExecutables(result.stdout);
    for (const request of group.requests) {
      try { executables.set(request.id, selectCargoExecutable(artifacts, manifest, request.target)); }
      catch (error) {
        if (!(error instanceof Error)) throw error;
        errors.set(request.id, error.message);
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    for (const request of group.requests) errors.set(request.id, error.message);
  }
  return { result, executables, errors };
}
