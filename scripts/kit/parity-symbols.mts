// The symbol extractors of the language-parity check (R1 and R11). An implementation that declares `symbols: { extractor,
// entry }` or `entries` has its public API read by the standard tool of its ecosystem, never by a parser of kit, in the full
// check; nothing is read from a saved snapshot. Each input gives public symbol ids, combined when `entries` is declared:
//   python  scripts/kit/symbols/python.py, the standard library's ast, on the source package <entry>: the .py files under it
//           on disk, Git-ignored generated modules included (K977), named from the import root, the folder src beside the nearest pyproject.toml from <entry>
//           up when that folder exists, else the folder of that pyproject.toml (the src and the flat layout of the Python
//           Packaging User Guide); run by the python3 of the checkout, reading no environment or installed distribution;
//           ids <module>.<name> and <module>.<class>.<method>
//   go      var/tools/symbols-go/bin/kit-symbols-go (scripts/kit/symbols/go), golang.org/x/tools/go/packages, on a module
//           directory; ids <import path>.<name> and <import path>.<type>.<method or field>; make kit-install-symbols builds it when
//           config/toolchain.json symbolExtractors names go
//   php     scripts/kit/symbols/php/extract.php, nikic/php-parser, on a source directory or file, such as the *.stub.php of a
//           PHP extension; ids Ns\Class, Ns\Class::method, Ns\Class::CONST, Ns\Class::$property, Ns\function and Ns\CONST
//           of the public declarations; make kit-install-symbols installs php-parser when symbolExtractors names php
//   rust    the JSON of rustdoc (cargo +<nightly> rustdoc -- [--features <features>] -Z unstable-options --output-format json)
//           of each library Cargo.toml entry; rustdoc JSON is unstable (rust-lang/rust#76578), so the channel is the Rust nightly of
//           config/toolchain.json exceptions whose scope holds the entry; ids <crate>::<path> of each public item reachable
//           from the crate root (re-exports included), with the fields, variants, inherent items and trait items under it
//   ts      the API model of API Extractor (@microsoft/api-extractor) of a .d.ts entry point, such as the one that tsc emits,
//           in the package of the nearest package.json; ids the canonical references, such as @scope/name!Codec#encode:member(1)
// An extractor that cannot run, fails or prints no list of ids is a finding that names the implementation and the command.
import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Extractor as ApiExtractor, ExtractorConfig } from '@microsoft/api-extractor';
import { ApiModel } from '@microsoft/api-extractor-model';
import type { ApiItem } from '@microsoft/api-extractor-model';
import { finding, symbolEntries } from './parity-declaration.mts';
import type { Environment, Extractor, Finding, ParityModel, ParitySymbolEntry } from './parity-declaration.mts';
import { execute } from './process.mts';
import { toolCommand } from './mise-tools.mts';
import { SYMBOLS, symbolsPrefix } from './install-symbols.mts';
import { readExceptions } from './toolchain-exceptions.mts';
import { ConfigError, parseJson, readJsonFile } from './schema-validate.mts';
import { isJsonList, isJsonObject } from './bootstrap/files.mts';
import { present } from './present.mts';

/** The public symbol ids of an entry, or why they cannot be read. */
type Extracted = { symbols: string[]; leaks?: string[]; error?: never } | { error: string; symbols?: never; leaks?: never };


/** The last lines of standard error, which explain a failed extractor. */
const tail = (text: string): string => text.trim().split('\n').slice(-3).join(' | ');

/** The ids that the command `command args` prints as a JSON array of strings, run in `root`, or the error of the run. */
function listed(root: string, command: string, args: string[], env: Environment): Extracted {
  const shown = [command, ...args].join(' ');
  const result = execute(command, args, { cwd: root, env });
  if (result.error) return { error: `${shown} could not start: ${result.error.message}` };
  if (result.status !== 0) return { error: `${shown} exited with ${result.status ?? result.signal}: ${tail(result.stderr)}` };
  try {
    return { symbols: parseJson<string[]>(result.stdout, 'symbol-ids.schema.json', shown) };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { error: error.message };
  }
}

/**
 * The .py files under the path `file` of `root`, relative to `root`, from the disk, so a generated module that Git ignores is read as
 * the package ships it (K977): a folder whose name is no Python identifier, such as .venv, holds no module of the package, and
 * __pycache__ holds no source, so neither is entered; a folder link is not followed, and a linked .py file is listed for its refusal.
 */
function pythonFiles(root: string, file: string): string[] {
  const full = path.join(root, file);
  if (!existsSync(full)) return [];
  if (!lstatSync(full).isDirectory()) return file.endsWith('.py') ? [file] : [];
  return readdirSync(full, { withFileTypes: true }).flatMap((item) => {
    const child = path.posix.join(file, item.name);
    if (item.isDirectory()) return /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name) && item.name !== '__pycache__' ? pythonFiles(root, child) : [];
    return item.name.endsWith('.py') && (item.isFile() || item.isSymbolicLink()) ? [child] : [];
  }).sort();
}

/**
 * The source package of the python symbols `entry`: its import root, the folder src beside the nearest pyproject.toml from `entry`
 * up to the checkout when that folder exists, else the folder of that pyproject.toml (the src and the flat layout of the Python
 * Packaging User Guide), and the .py files on disk under both `entry` and the import root (pythonFiles), what the package ships
 * whether Git tracks it or not (K977); an error when no folder holds a pyproject.toml, when a listed file is a symlink, which is
 * reported and never followed, or when no file is listed.
 */
function pythonSource(root: string, entry: string): { base: string; files: string[] } | { error: string } {
  for (let project = path.posix.normalize(entry); ; project = path.posix.dirname(project)) {
    if (existsSync(path.join(root, project, 'pyproject.toml'))) {
      const src = path.posix.join(project, 'src');
      const base = existsSync(path.join(root, src)) ? src : project;
      const files = pythonFiles(root, path.posix.normalize(entry)).filter(file => base === '.' || file.startsWith(`${base}/`));
      const linked = files.find(file => lstatSync(path.join(root, file)).isSymbolicLink());
      if (linked !== undefined) return { error: `${linked} is a symlink; the python symbols read no symlink` };
      if (files.length === 0) return { error: `${entry} holds no .py file under the import root ${base}` };
      return { base, files };
    }
    if (project === '.' || project === '/') return { error: `no pyproject.toml from ${entry} up to the checkout, whose folder or src folder is the import root of the source package` };
  }
}

/**
 * The public symbols of the Python source package `entry`, read by the python3 of the checkout from the files that pythonSource
 * lists, which it reads from a list file rather than its command line; no environment, install or distribution is read, and
 * kit creates and installs nothing.
 */
export function pythonListed(root: string, entry: string, env: Environment, flags: string[] = []): Extracted {
  const source = pythonSource(root, entry);
  if ('error' in source) return { error: source.error };
  const python = toolCommand(root, 'python3');
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-symbols-'));
  try {
    const list = path.join(folder, 'files.txt');
    writeFileSync(list, source.files.map(file => `${file}\n`).join(''));
    return listed(root, python, ['-I', path.join(SYMBOLS, 'python.py'), ...flags, source.base, list], env);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** The directory of the nearest package.json at or above the directory of `file`, or undefined. */
function packageOf(file: string): string | undefined {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, 'package.json'))) return directory;
    if (path.dirname(directory) === directory) return undefined;
  }
}

/** The canonical references of `item` and its members, depth first. */
const references = (item: ApiItem): string[] => item.members.flatMap(member => [member.canonicalReference.toString(), ...references(member)]);

/** The API model of the .d.ts entry point `entry` of the checkout `root`, read by API Extractor. */
export function apiModel(root: string, entry: string): Extracted {
  const file = path.join(root, entry);
  if (!existsSync(file)) return { error: `${entry} does not exist` };
  const project = packageOf(file);
  if (project === undefined) return { error: `no package.json lies above ${entry}` };
  // The compiler options of the package's own tsconfig.json; without one, the standard library of ESNext and no @types, so
  // that a declaration of the ES2015+ library, such as ReadonlyMap, resolves and the folder that the check runs in adds nothing.
  const tsconfig = path.join(project, 'tsconfig.json');
  const compiler = existsSync(tsconfig)
    ? { tsconfigFilePath: tsconfig }
    : { overrideTsconfig: { compilerOptions: { target: 'esnext', lib: ['esnext'], types: [], skipLibCheck: true } } };
  const output = mkdtempSync(path.join(tmpdir(), 'kit-parity-api-'));
  try {
    const config = ExtractorConfig.prepare({
      configObject: {
        projectFolder: project,
        mainEntryPointFilePath: file,
        compiler,
        docModel: { enabled: true, apiJsonFilePath: path.join(output, 'api.json') },
        apiReport: { enabled: false },
        dtsRollup: { enabled: false },
        tsdocMetadata: { enabled: false },
      },
      configObjectFullPath: undefined,
      packageJsonFullPath: path.join(project, 'package.json'),
    });
    const errors: string[] = [];
    // A type that a public signature names and the entry point does not export is a leak of an internal symbol (K307-1).
    const leaks: string[] = [];
    // An error of the analysis fails the extraction; warnings, such as a missing release tag, are the API report's concern.
    // API Extractor throws on a declaration that it cannot follow, such as a syntax error; that is its failure too.
    let result: ReturnType<typeof ApiExtractor.invoke>;
    try {
      result = ApiExtractor.invoke(config, { localBuild: true, messageCallback: (message) => { message.handled = true; if (message.logLevel === 'error') errors.push(message.text); else if (message.messageId === 'ae-forgotten-export') leaks.push(message.text); } });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { error: `API Extractor failed on ${entry}: ${error.message}` };
    }
    if (!result.succeeded || errors.length) return { error: `API Extractor failed on ${entry}: ${errors.join(' | ') || `${result.errorCount} errors`}` };
    const api = new ApiModel().loadPackage(path.join(output, 'api.json'));
    return { symbols: api.entryPoints.flatMap(references), leaks: [...new Set(leaks)].sort() };
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

// The part of rustdoc JSON (format 61) that the rust extractor reads: the crate root and each item by its id.
type RustdocItem = {
  name: string | null;
  visibility: string | Record<string, unknown>;
  inner: { use?: { name: string; id: number | null; is_glob: boolean }; module?: { items: number[] }; impl?: { trait?: unknown; items: number[] }; [kind: string]: Record<string, unknown> | undefined };
};
type Rustdoc = { root: number; index: Record<string, RustdocItem> };

/** The public ids of the crate of `doc`: each public item reachable from its root as <crate>::<path>, with its members. */
export function rustdocSymbols(doc: Rustdoc): string[] {
  const found = new Set<string>();
  const visited = new Set<number>();
  const item = (id: unknown): RustdocItem | undefined => doc.index[String(id)];
  // A list of ids, or none where the inner item has no such list.
  const ids = (value: unknown): number[] => (isJsonList(value) ? value.filter(id => typeof id === 'number') : []);
  // The members of the item `entry` named `name`: public fields, variants, the items of its inherent impls and of a trait.
  const members = (name: string, entry: RustdocItem) => {
    const [first] = Object.entries(entry.inner);
    const kind = first?.[0];
    // The inner item of each kind is a JSON object of its own fields.
    const inner: Record<string, unknown> | undefined = first?.[1];
    const plain = isJsonObject(inner?.kind) && isJsonObject(inner.kind.plain) ? inner.kind.plain : undefined;
    const children = [
      ...ids(plain?.fields).map(item).filter(field => field?.visibility === 'public'),
      ...ids(inner?.variants).map(item),
      ...(kind === 'trait' ? ids(inner?.items).map(item) : []),
      ...ids(inner?.impls).map(item).flatMap(impl => (impl?.inner.impl?.trait === null ? impl.inner.impl.items.map(item) : [])).filter(member => member?.visibility === 'public'),
    ];
    for (const child of children) if (child?.name) found.add(`${name}::${child.name}`);
  };
  const visit = (moduleId: number, prefix: string) => {
    if (visited.has(moduleId)) return;
    visited.add(moduleId);
    for (const id of ids(item(moduleId)?.inner.module?.items)) {
      const entry = item(id);
      if (!entry || entry.visibility !== 'public') continue;
      const reexport = entry.inner.use;
      if (reexport?.is_glob) {
        if (reexport.id !== null) visit(reexport.id, prefix);
        continue;
      }
      const name = `${prefix}::${reexport ? reexport.name : entry.name}`;
      const targetId = reexport ? reexport.id : id;
      const target = targetId === null ? undefined : item(targetId);
      found.add(name);
      if (target?.inner.module && targetId !== null) visit(targetId, name);
      else if (target) members(name, target);
    }
  };
  const root = item(doc.root);
  if (!root?.name) throw new Error('the rustdoc JSON has no crate root');
  visit(doc.root, root.name);
  return [...found];
}

/** The Rust nightly of config/toolchain.json exceptions whose scope holds `entry`, or why there is none. */
function rustNightly(root: string, entry: string): { channel: string; error?: never } | { error: string } {
  const covering = readExceptions(root).exceptions.filter(exception => exception.tool === 'rust' && exception.channel.startsWith('nightly-') && (exception.scope === '.' || entry.startsWith(`${exception.scope}/`)));
  if (covering.length === 1) return { channel: present(covering[0], 'covering[0]').channel };
  if (covering.length > 1) return { error: `config/toolchain.json exceptions holds ${covering.length} Rust nightlies whose scope holds ${entry}: ${covering.map(exception => exception.channel).join(', ')}; keep one` };
  return { error: `rustdoc JSON needs a Rust nightly (rust-lang/rust#76578), and config/toolchain.json exceptions declares none whose scope holds ${entry}; declare { tool: "rust", channel: "nightly-<yyyy-mm-dd>", scope, reason, retry: "rustdoc JSON is stable" }` };
}

/** The public symbols of the library of the Cargo.toml `entry`, with its declared Cargo features, from rustdoc JSON. */
function rustdoc(root: string, entry: string, env: Environment, features?: string[]): Extracted {
  const nightly = rustNightly(root, entry);
  if (nightly.error !== undefined) return nightly;
  // The build of the extractor keeps its own target directory in the checkout, which holds the JSON of one crate per run.
  const target = path.join(root, 'var/parity/rustdoc');
  rmSync(path.join(target, 'doc'), { recursive: true, force: true });
  const args = [`+${nightly.channel}`, 'rustdoc', '--manifest-path', entry, '--lib', ...(features === undefined ? [] : ['--features', features.join(',')]), '--target-dir', target, '--', '-Z', 'unstable-options', '--output-format', 'json'];
  const shown = ['cargo', ...args].join(' ');
  // rustup installs no toolchain on its own, so a nightly that is not installed is named.
  const result = execute('cargo', args, { cwd: root, env: { ...env, RUSTUP_AUTO_INSTALL: '0' } });
  if (result.error) return { error: `${shown} could not start: ${result.error.message}` };
  if (result.status !== 0) return { error: `${shown} exited with ${result.status ?? result.signal}: ${tail(result.stderr)}` };
  const written = readdirSync(path.join(target, 'doc')).filter(file => file.endsWith('.json'));
  if (written.length !== 1) return { error: `${shown} wrote ${written.length} JSON files into ${path.relative(root, path.join(target, 'doc'))}, not one` };
  try {
    return { symbols: rustdocSymbols(readJsonFile<Rustdoc>(path.join(target, 'doc', present(written[0], 'written[0]')), 'rustdoc.schema.json')) };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { error: `the rustdoc JSON of ${entry} cannot be read: ${error.message}` };
  }
}

/** `symbols` with the leaks that `leaks` prints (K307-1), or the error of either run. */
function withLeaks(symbols: Extracted, leaks: () => Extracted): Extracted {
  if (symbols.error !== undefined) return symbols;
  const found = leaks();
  return found.error === undefined ? { symbols: symbols.symbols, leaks: found.symbols } : found;
}

// Each extractor: the public symbol ids of `entry` in the checkout `root`.
const EXTRACTORS: Record<Extractor, (root: string, input: ParitySymbolEntry, env: Environment) => Extracted> = {
  go: (root, { entry }, env) => {
    const command = path.join(symbolsPrefix(root, 'go'), 'bin', 'kit-symbols-go');
    if (!existsSync(command)) return { error: `${path.relative(root, command)} does not exist; name go in symbolExtractors of config/toolchain.json and run make install, whose install-kit runs make kit-install-symbols (K861)` };
    return listed(root, command, [entry], env);
  },
  php: (root, { entry }, env) => {
    const autoload = path.join(symbolsPrefix(root, 'php'), 'vendor', 'autoload.php');
    if (!existsSync(autoload)) return { error: `${path.relative(root, autoload)} does not exist; name php in symbolExtractors of config/toolchain.json and run make install, whose install-kit runs make kit-install-symbols (K861)` };
    return withLeaks(listed(root, 'php', [path.join(SYMBOLS, 'php', 'extract.php'), autoload, entry], env), () => listed(root, 'php', [path.join(SYMBOLS, 'php', 'extract.php'), autoload, entry, '--leaks'], env));
  },
  python: (root, { entry }, env) => withLeaks(pythonListed(root, entry, env), () => pythonListed(root, entry, env, ['--leaks'])),
  rust: (root, { entry, features }, env) => rustdoc(root, entry, env, features),
  ts: (root, { entry }) => apiModel(root, entry),
};

/**
 * The public symbols of each implementation of `model` that declares symbols, by its name, and a finding for each extractor
 * that fails; `say` prints a line for each extraction.
 */
export function extractSymbols(model: ParityModel, root: string, { env, say }: { env: Environment; say: (line: string) => void }): {
  snapshots: Map<string, Set<string>>;
  entrySnapshots: Map<string, Map<string, Set<string>>>;
  findings: Finding[];
} {
  const snapshots = new Map<string, Set<string>>();
  const entrySnapshots = new Map<string, Map<string, Set<string>>>();
  const findings: Finding[] = [];
  for (const implementation of model.config.implementations) {
    if (implementation.symbols === undefined) continue;
    const { extractor } = implementation.symbols;
    const entries = symbolEntries(implementation.symbols);
    const symbols: string[] = [];
    const perEntry = new Map<string, Set<string>>();
    let failed = false;
    for (const input of entries) {
      const { entry, features } = input;
      const label = features === undefined ? entry : `${entry} (features: ${features.join(', ')})`;
      say(`extract the symbols of ${implementation.name}: ${extractor} ${label}`);
      const extracted = EXTRACTORS[extractor](root, input, env);
      if (extracted.error !== undefined) {
        failed = true;
        findings.push(finding('R1', `the ${extractor} extractor of ${label} gives no symbols: ${extracted.error}`, { implementation: implementation.name, place: label }));
      } else {
        symbols.push(...extracted.symbols);
        const entrySymbols = perEntry.get(entry) ?? new Set<string>();
        for (const symbol of extracted.symbols) entrySymbols.add(symbol);
        perEntry.set(entry, entrySymbols);
        for (const leak of extracted.leaks ?? []) findings.push(finding('R17', `${leak}: a public signature, parent or interface names a symbol that is no public API`, { implementation: implementation.name, place: label }));
      }
    }
    if (!failed) {
      snapshots.set(implementation.name, new Set(symbols));
      entrySnapshots.set(implementation.name, perEntry);
    }
  }
  return { snapshots, entrySnapshots, findings };
}
