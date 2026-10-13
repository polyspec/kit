// The symbol extractors of the language-parity check (R1 and R11). An implementation that declares `symbols: { extractor,
// entry }` has its public API read by the standard tool of its ecosystem, never by a parser of kit, in the full check; nothing
// is read from a saved snapshot. Each extractor gives the public symbol ids of `entry`:
//   python  scripts/kit/symbols/python.py, the standard library's ast, run by the python3 of mise.toml -I on a package directory
//           or a module file; ids <module>.<name> and <module>.<class>.<method>
//   go      var/tools/symbols-go/bin/kit-symbols-go (scripts/kit/symbols/go), golang.org/x/tools/go/packages, on a module
//           directory; ids <import path>.<name> and <import path>.<type>.<method or field>; install-tools builds it when
//           config/toolchain.json symbolExtractors names go
//   php     scripts/kit/symbols/php/extract.php, nikic/php-parser, on a source directory or file, such as the *.stub.php of a
//           PHP extension; ids Ns\Class, Ns\Class::method, Ns\Class::CONST, Ns\Class::$property, Ns\function and Ns\CONST
//           of the public declarations; install-tools installs php-parser when config/toolchain.json symbolExtractors names php
//   rust    the JSON of rustdoc (cargo +<nightly> rustdoc -- -Z unstable-options --output-format json) of the library of a
//           Cargo.toml entry; rustdoc JSON is unstable (rust-lang/rust#76578), so the channel is the Rust nightly of
//           config/toolchain.json exceptions whose scope holds the entry; ids <crate>::<path> of each public item reachable
//           from the crate root (re-exports included), with the fields, variants, inherent items and trait items under it
//   ts      the API model of API Extractor (@microsoft/api-extractor) of a .d.ts entry point, such as the one that tsc emits,
//           in the package of the nearest package.json; ids the canonical references, such as @scope/name!Codec#encode:member(1)
// An extractor that cannot run, fails or prints no list of ids is a finding that names the implementation and the command.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Extractor as ApiExtractor, ExtractorConfig } from '@microsoft/api-extractor';
import { ApiModel } from '@microsoft/api-extractor-model';
import type { ApiItem } from '@microsoft/api-extractor-model';
import { toolCommand } from './mise-tools.mts';
import { finding } from './parity-declaration.mts';
import type { Environment, Extractor, Finding, ParityModel } from './parity-declaration.mts';
import { execute } from './process.mts';
import { SYMBOLS, symbolsPrefix } from './install-symbols.mts';
import { readExceptions } from './toolchain-exceptions.mts';

/** The public symbol ids of an entry, or why they cannot be read. */
type Extracted = { symbols: string[]; error?: never } | { error: string };


/** The last lines of standard error, which explain a failed extractor. */
const tail = (text: string): string => text.trim().split('\n').slice(-3).join(' | ');

/** The ids that the command `command args` prints as a JSON array of strings, run in `root`, or the error of the run. */
function listed(root: string, command: string, args: string[], env: Environment): Extracted {
  const shown = [command, ...args].join(' ');
  const result = execute(command, args, { cwd: root, env });
  if (result.error) return { error: `${shown} could not start: ${result.error.message}` };
  if (result.status !== 0) return { error: `${shown} exited with ${result.status ?? result.signal}: ${tail(result.stderr)}` };
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    return { error: `${shown} printed no JSON: ${(error as Error).message}` };
  }
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) return { error: `${shown} printed no array of symbol ids` };
  return { symbols: value };
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
function apiModel(root: string, entry: string): Extracted {
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
    // An error of the analysis fails the extraction; warnings, such as a missing release tag, are the API report's concern.
    // API Extractor throws on a declaration that it cannot follow, such as a syntax error; that is its failure too.
    let result: ReturnType<typeof ApiExtractor.invoke>;
    try {
      result = ApiExtractor.invoke(config, { localBuild: true, messageCallback: (message) => { message.handled = true; if (message.logLevel === 'error') errors.push(message.text); } });
    } catch (error) {
      return { error: `API Extractor failed on ${entry}: ${(error as Error).message}` };
    }
    if (!result.succeeded || errors.length) return { error: `API Extractor failed on ${entry}: ${errors.join(' | ') || `${result.errorCount} errors`}` };
    const api = new ApiModel().loadPackage(path.join(output, 'api.json'));
    return { symbols: api.entryPoints.flatMap(references) };
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

// The part of rustdoc JSON (format 61) that the rust extractor reads: the crate root and each item by its id.
type RustdocItem = { name: string | null; visibility: string; inner: Record<string, Record<string, unknown>> };
type Rustdoc = { root: number; index: Record<string, RustdocItem> };

/** The public ids of the crate of `doc`: each public item reachable from its root as <crate>::<path>, with its members. */
export function rustdocSymbols(doc: Rustdoc): string[] {
  const found = new Set<string>();
  const visited = new Set<number>();
  const item = (id: unknown): RustdocItem | undefined => doc.index[String(id)];
  const ids = (value: unknown): number[] => (Array.isArray(value) ? value : []);
  // The members of the item `entry` named `name`: public fields, variants, the items of its inherent impls and of a trait.
  const members = (name: string, entry: RustdocItem) => {
    const [kind, inner] = Object.entries(entry.inner)[0] ?? [];
    const plain = (inner?.kind as { plain?: { fields?: unknown } } | undefined)?.plain;
    const children = [
      ...ids(plain?.fields).map(item).filter(field => field?.visibility === 'public'),
      ...ids(inner?.variants).map(item),
      ...(kind === 'trait' ? ids(inner?.items).map(item) : []),
      ...ids(inner?.impls).map(item).filter(impl => impl?.inner.impl?.trait === null).flatMap(impl => ids(impl!.inner.impl!.items).map(item)).filter(member => member?.visibility === 'public'),
    ];
    for (const child of children) if (child?.name) found.add(`${name}::${child.name}`);
  };
  const visit = (moduleId: number, prefix: string) => {
    if (visited.has(moduleId)) return;
    visited.add(moduleId);
    for (const id of ids(item(moduleId)?.inner.module?.items)) {
      const entry = item(id);
      if (!entry || entry.visibility !== 'public') continue;
      const reexport = entry.inner.use as { name: string; id: number | null; is_glob: boolean } | undefined;
      if (reexport?.is_glob) {
        if (reexport.id !== null) visit(reexport.id, prefix);
        continue;
      }
      const name = `${prefix}::${reexport ? reexport.name : entry.name}`;
      const target = reexport ? item(reexport.id) : entry;
      found.add(name);
      if (target?.inner.module) visit(reexport ? reexport.id! : id, name);
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
  if (covering.length === 1) return { channel: covering[0]!.channel };
  if (covering.length > 1) return { error: `config/toolchain.json exceptions holds ${covering.length} Rust nightlies whose scope holds ${entry}: ${covering.map(exception => exception.channel).join(', ')}; keep one` };
  return { error: `rustdoc JSON needs a Rust nightly (rust-lang/rust#76578), and config/toolchain.json exceptions declares none whose scope holds ${entry}; declare { tool: "rust", channel: "nightly-<yyyy-mm-dd>", scope, reason, retry: "rustdoc JSON is stable" }` };
}

/** The public symbols of the library of the Cargo.toml `entry`, read from the rustdoc JSON of the declared nightly. */
function rustdoc(root: string, entry: string, env: Environment): Extracted {
  const nightly = rustNightly(root, entry);
  if (nightly.error !== undefined) return nightly;
  // The build of the extractor keeps its own target directory in the checkout, which holds the JSON of one crate per run.
  const target = path.join(root, 'var/parity/rustdoc');
  rmSync(path.join(target, 'doc'), { recursive: true, force: true });
  const args = [`+${nightly.channel}`, 'rustdoc', '--manifest-path', entry, '--lib', '--target-dir', target, '--', '-Z', 'unstable-options', '--output-format', 'json'];
  const shown = ['cargo', ...args].join(' ');
  // rustup installs no toolchain on its own, so a nightly that is not installed is named.
  const result = execute('cargo', args, { cwd: root, env: { ...env, RUSTUP_AUTO_INSTALL: '0' } });
  if (result.error) return { error: `${shown} could not start: ${result.error.message}` };
  if (result.status !== 0) return { error: `${shown} exited with ${result.status ?? result.signal}: ${tail(result.stderr)}` };
  const written = readdirSync(path.join(target, 'doc')).filter(file => file.endsWith('.json'));
  if (written.length !== 1) return { error: `${shown} wrote ${written.length} JSON files into ${path.relative(root, path.join(target, 'doc'))}, not one` };
  try {
    return { symbols: rustdocSymbols(JSON.parse(readFileSync(path.join(target, 'doc', written[0]!), 'utf8')) as Rustdoc) };
  } catch (error) {
    return { error: `the rustdoc JSON of ${entry} cannot be read: ${(error as Error).message}` };
  }
}

// Each extractor: the public symbol ids of `entry` in the checkout `root`.
const EXTRACTORS: Record<Extractor, (root: string, entry: string, env: Environment) => Extracted> = {
  go: (root, entry, env) => {
    const command = path.join(symbolsPrefix(root, 'go'), 'bin', 'kit-symbols-go');
    if (!existsSync(command)) return { error: `${path.relative(root, command)} does not exist; name go in symbolExtractors of config/toolchain.json and run make install-tools` };
    return listed(root, command, [entry], env);
  },
  php: (root, entry, env) => {
    const autoload = path.join(symbolsPrefix(root, 'php'), 'vendor', 'autoload.php');
    if (!existsSync(autoload)) return { error: `${path.relative(root, autoload)} does not exist; name php in symbolExtractors of config/toolchain.json and run make install-tools` };
    return listed(root, 'php', [path.join(SYMBOLS, 'php', 'extract.php'), autoload, entry], env);
  },
  python: (root, entry, env) => listed(root, toolCommand(root, 'python3'), ['-I', path.join(SYMBOLS, 'python.py'), entry], env),
  rust: (root, entry, env) => rustdoc(root, entry, env),
  ts: (root, entry) => apiModel(root, entry),
};

/**
 * The public symbols of each implementation of `model` that declares symbols, by its name, and a finding for each extractor
 * that fails; `say` prints a line for each extraction.
 */
export function extractSymbols(model: ParityModel, root: string, { env, say }: { env: Environment; say: (line: string) => void }): { snapshots: Map<string, Set<string>>; findings: Finding[] } {
  const snapshots = new Map<string, Set<string>>();
  const findings: Finding[] = [];
  for (const implementation of model.config.implementations) {
    if (implementation.symbols === undefined) continue;
    const { extractor, entry } = implementation.symbols;
    say(`extract the symbols of ${implementation.name}: ${extractor} ${entry}`);
    const extracted = EXTRACTORS[extractor](root, entry, env);
    if (extracted.error !== undefined) findings.push(finding('R1', `the ${extractor} extractor of ${entry} gives no symbols: ${extracted.error}`, { implementation: implementation.name, place: entry }));
    else snapshots.set(implementation.name, new Set(extracted.symbols));
  }
  return { snapshots, findings };
}
