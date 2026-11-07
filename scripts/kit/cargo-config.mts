// Cargo discovers .cargo/config in the invocation directory and its ancestors, then CARGO_HOME.
// The extensionless legacy file wins over config.toml at the same location; the result is highest priority first.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isStringArray, isTable, readToml, type TomlTable, type TomlValue } from './toml.mts';
import { cargoCfgMatches } from './cargo-cfg.mts';

const runnerOrigins = new WeakMap<TomlTable, Map<string, string>>();
const compilerOrigins = new WeakMap<TomlTable, string>();
export const cargoTargetKey = (triple: string): string => triple.endsWith('.json') ? path.basename(triple, '.json') : triple;
const runnerVariable = (key: string): string => `CARGO_TARGET_${key.toUpperCase().replace(/[-.]/g, '_')}_RUNNER`;

/** Match the exact runner's stored type when a CLI capture override is merged by Cargo. */
export function cargoCaptureRunnerType(config: TomlTable, command: TomlTable, triple: string): 'string' | 'array' {
  const merged = mergeCargoConfig(config, command);
  const key = cargoTargetKey(triple);
  const value = isTable(merged.target) && isTable(merged.target[key]) ? merged.target[key].runner : undefined;
  return typeof value === 'string' ? 'string' : 'array';
}

/** Combine runner precedence and its defining path for one native Cargo target. */
export function resolvedCargoRunner(config: TomlTable, command: TomlTable, env: NodeJS.ProcessEnv,
  triple: string, facts: ReadonlySet<string>, cwd: string): string[] {
  const merged = mergeCargoConfig(config, command);
  const key = cargoTargetKey(triple), variable = runnerVariable(key);
  const commandExact = cargoTripleRunner(command, {}, triple);
  const effectiveEnv = commandExact === undefined ? env : { ...env, [variable]: undefined };
  const words = cargoRunner(merged, effectiveEnv, triple, facts);
  if (!words.length) return [];
  if (commandExact === undefined && env[variable] !== undefined) return cargoRunnerPath(words, { cwd });
  let selected = key;
  if (cargoTripleRunner(merged, {}, triple) === undefined && isTable(merged.target)) {
    const match = Object.entries(merged.target).find(([condition, entry]) => condition.startsWith('cfg(')
      && isTable(entry) && entry.runner !== undefined && cargoCfgMatches(condition, facts));
    if (!match) throw new Error(`Cargo runner for ${triple} lost its configuration origin; inspect its target configuration`);
    selected = match[0];
  }
  const file = cargoRunnerOrigin(merged, selected);
  return cargoRunnerPath(words, file === undefined ? { cwd } : { cwd, file });
}

function rememberRunnerOrigins(config: TomlTable, file: string): TomlTable {
  if (isTable(config.build) && config.build.rustc !== undefined) compilerOrigins.set(config, file);
  const origins = new Map<string, string>();
  if (isTable(config.target)) for (const [key, value] of Object.entries(config.target))
    if (isTable(value) && value.runner !== undefined) origins.set(key, file);
  runnerOrigins.set(config, origins);
  return config;
}

/** The file that supplied the highest-priority runner program. */
export function cargoRunnerOrigin(config: TomlTable, key: string): string | undefined {
  return runnerOrigins.get(config)?.get(key) || undefined;
}


/** Resolve only a runner's program against its configuration origin; arguments remain literal. */
export function cargoRunnerPath(words: readonly string[], origin: { cwd: string; file?: string }): string[] {
  const program = words[0];
  if (!program) throw new Error('Cargo runner has no program; declare its executable and optional arguments');
  const base = origin.file ? path.dirname(path.dirname(path.resolve(origin.cwd, origin.file))) : origin.cwd;
  const hasSeparator = program.includes('/') || (process.platform === 'win32' && program.includes('\\'));
  return [hasSeparator ? path.resolve(base, program) : program, ...words.slice(1)];
}

/** An exact target runner takes precedence over cfg runners; ambiguous cfg matches are errors. */
export function cargoRunner(config: TomlTable, env: NodeJS.ProcessEnv, triple: string,
  facts: ReadonlySet<string>): string[] {
  const exact = cargoTripleRunner(config, env, triple);
  if (exact !== undefined) return exact;
  if (!isTable(config.target)) return [];
  const matches: { condition: string; runner: string[] }[] = [];
  for (const [condition, entry] of Object.entries(config.target)) {
    if (!condition.startsWith('cfg(') || !isTable(entry) || entry.runner === undefined) continue;
    if (cargoCfgMatches(condition, facts)) matches.push({ condition, runner: cargoRunnerWords(entry.runner, `target.${condition}.runner`) });
  }
  if (matches.length > 1)
    throw new Error(`multiple Cargo cfg runners match ${triple}: ${matches.map(entry => entry.condition).join(', ')}; make the target runner selection unambiguous`);
  return matches[0]?.runner ?? [];
}

/** Cargo program strings split on whitespace; arrays preserve each argument, including spaces. */
export function cargoRunnerWords(value: unknown, where: string): string[] {
  const words = typeof value === 'string' ? value.trim().split(/\s+/) : value;
  if (!isStringArray(words) || !words.length || words.some(word => !word))
    throw new Error(`${where} must name a runner program and optional arguments; provide a string or a nonempty string array`);
  return [...words];
}

/** Resolve the exact target runner above cfg runners; environment overrides the file declaration. */
export function cargoTripleRunner(config: TomlTable, env: NodeJS.ProcessEnv, triple: string): string[] | undefined {
  const key = cargoTargetKey(triple);
  const variable = runnerVariable(key);
  if (env[variable] !== undefined) return cargoRunnerWords(env[variable], variable);
  if (config.target === undefined) return undefined;
  if (!isTable(config.target)) throw new Error('Cargo target configuration must be a table; declare [target.<triple>]');
  const target = config.target[key];
  if (target === undefined) return undefined;
  if (!isTable(target)) throw new Error(`Cargo target.${key} must be a table; declare its runner inside that table`);
  return target.runner === undefined ? undefined : cargoRunnerWords(target.runner, `target.${key}.runner`);
}

/** Select target identities while preserving multiple explicit targets for separate build groups. */
export function cargoTargets(args: readonly string[], config: TomlTable, env: NodeJS.ProcessEnv, host: string): string[] {
  const explicit: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? '';
    if (argument === '--') break;
    if (argument !== '--target' && !argument.startsWith('--target=')) continue;
    const value = argument === '--target' ? args[++index] : argument.slice('--target='.length);
    if (!value) throw new Error('Cargo --target has no value; provide its target triple or specification path');
    explicit.push(value);
  }
  const configured = isTable(config.build) ? config.build.target : undefined;
  const value = explicit.length ? explicit : env.CARGO_BUILD_TARGET ?? configured ?? host;
  const targets = typeof value === 'string' ? [value] : value;
  if (!isStringArray(targets) || !targets.length || targets.some(target => !target))
    throw new Error('Cargo build.target must name targets; provide a target string or a nonempty array of target strings');
  return [...new Set(targets.map(target => target === 'host-tuple' ? host : target))];
}

const programLists = ['credential-alias.*', 'doc.browser', 'host.runner', 'registries.*.credential-provider', 'registry.credential-provider', 'target.*.runner'];

/** Merge Cargo tables, replacing program lists and appending ordinary arrays by priority. */
export function mergeCargoConfig(lower: TomlTable, higher: TomlTable, where = 'Cargo configuration', keys: readonly string[] = []): TomlTable {
  const result = { ...lower, ...Object.fromEntries(Object.entries(higher).map(([key, value]) => {
    const previous = lower[key];
    const field = `${where}.${key}`;
    const parts = [...keys, key];
    const replaces = programLists.some(pattern => {
      const match = pattern.split('.');
      return match.length === parts.length && match.every((part, index) => part === '*' || part === parts[index]);
    });
    let merged: TomlValue = value;
    if (previous !== undefined) {
      if (isTable(previous) && isTable(value)) merged = mergeCargoConfig(previous, value, field, parts);
      else if (Array.isArray(previous) && Array.isArray(value)) merged = replaces ? [...value] : [...previous, ...value];
      else if (Array.isArray(previous) || Array.isArray(value) || isTable(previous) || isTable(value) || typeof previous !== typeof value)
        throw new Error(`${field} has conflicting configuration types; use the same value type in its Cargo configuration files`);
    }
    return [key, merged];
  })) };
  const origins = new Map(runnerOrigins.get(lower));
  for (const [key, file] of runnerOrigins.get(higher) ?? []) origins.set(key, file);
  runnerOrigins.set(result, origins);
  const compilerOrigin = isTable(higher.build) && higher.build.rustc !== undefined
    ? compilerOrigins.get(higher) : compilerOrigins.get(lower);
  if (compilerOrigin !== undefined) compilerOrigins.set(result, compilerOrigin);
  return result;
}

/** Resolve Cargo's compiler override without splitting executable paths containing spaces. */
export function resolvedCargoRustc(config: TomlTable, command: TomlTable, env: NodeJS.ProcessEnv, cwd: string): string {
  const merged = mergeCargoConfig(config, command);
  const explicit = isTable(command.build) ? command.build.rustc : undefined;
  const configured = isTable(merged.build) ? merged.build.rustc : undefined;
  const program = env.RUSTC ?? explicit ?? env.CARGO_BUILD_RUSTC ?? configured ?? 'rustc';
  if (typeof program !== 'string' || !program)
    throw new Error('Cargo rustc must name a compiler executable; set RUSTC or build.rustc to its program path');
  const fromEnv = env.RUSTC !== undefined || (explicit === undefined && env.CARGO_BUILD_RUSTC !== undefined);
  const file = fromEnv ? undefined : compilerOrigins.get(merged) || undefined;
  const resolved = cargoRunnerPath([program], file === undefined ? { cwd } : { cwd, file })[0];
  if (!resolved) throw new Error('Cargo compiler resolution produced no program; inspect its rustc declaration');
  return resolved;
}

/** Read files discovered in highest-priority-first order, preserving Cargo's merge direction. */
export function readCargoConfig(files: readonly string[], read: (file: string) => string = file => readFileSync(file, 'utf8')): TomlTable {
  const load = (file: string, parents: ReadonlySet<string>, optionalFile = false): TomlTable => {
    const absolute = path.resolve(file);
    if (parents.has(absolute)) throw new Error(`Cargo configuration include cycle at ${file}; remove the circular include`);
    let text: string;
    try { text = read(file); }
    catch (error) {
      if (optionalFile && error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
    const config = readToml(text, file);
    const { include, ...own } = config;
    if (include !== undefined && !Array.isArray(include)) throw new Error(`${file}: include must be an array of TOML paths or include tables`);
    let included: TomlTable = {};
    const seen = new Set([...parents, absolute]);
    for (const entry of include ?? []) {
      const name = typeof entry === 'string' ? entry : isTable(entry) ? entry.path : undefined;
      const optional = isTable(entry) ? entry.optional : undefined;
      if (typeof name !== 'string' || !name.endsWith('.toml') || (optional !== undefined && typeof optional !== 'boolean'))
        throw new Error(`${file}: include needs a .toml path and an optional boolean; correct its include declaration`);
      const target = path.resolve(path.dirname(absolute), name);
      const child = load(target, seen, optional === true);
      included = mergeCargoConfig(included, child, target);
    }
    return mergeCargoConfig(included, rememberRunnerOrigins(own, absolute), file);
  };
  let merged: TomlTable = {};
  for (const file of [...files].reverse()) merged = mergeCargoConfig(merged, load(file, new Set()), file);
  return merged;
}

/** Cargo --config overrides are applied in command-line order, above files and environment. */
export function cargoCommandConfig(args: readonly string[], cwd: string,
  read: (file: string) => string = file => readFileSync(file, 'utf8')): TomlTable {
  let config: TomlTable = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? '';
    if (argument === '--') break;
    if (argument !== '--config' && !argument.startsWith('--config=')) continue;
    const value = argument === '--config' ? args[++index] : argument.slice('--config='.length);
    if (!value) throw new Error('Cargo --config has no value; provide KEY=VALUE or a configuration file');
    const file = value.includes('=') ? '--config' : path.resolve(cwd, value);
    const text = value.includes('=') ? value : read(file);
    config = mergeCargoConfig(config, rememberRunnerOrigins(readToml(text, file), file === '--config' ? '' : file), file);
  }
  return config;
}

export function cargoConfigFiles(cwd: string, env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean = existsSync): string[] {
  const directories: string[] = [];
  for (let current = path.resolve(cwd);; current = path.dirname(current)) {
    directories.push(path.join(current, '.cargo'));
    if (path.dirname(current) === current) break;
  }
  const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) ?? homedir();
  directories.push(path.resolve(cwd, env.CARGO_HOME ?? path.join(home, '.cargo')));
  const files: string[] = [];
  for (const directory of directories) {
    const file = ['config', 'config.toml'].map(name => path.join(directory, name)).find(exists);
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}
