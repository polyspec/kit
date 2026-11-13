#!/usr/bin/env node
// The PHP extension of a repository (S10): one model and one build for every repository.
//
//   node scripts/kit/php-extension.mts <command> --extension <folder> --build-dir <folder> [--library <folder>]... [--skip <name>]... [build options]
//                                      [-- <the selection of runtime-targets test: --roots <folder>...> [-- <runner argument>...]]
//   check   the extension that config.m4 declares and, when present, the arginfo stub hash of each stub
//   build [--output <absolute-path>] [--source-copy <source> <output>] [--configure-arg <arg>]
//           the check, then phpize in a temporary source copy under the build folder, the arginfo from the gen_stub.php of
//           <build-dir>/gen-stub (K941), configure and make; publish <build-dir>/<extension>.so, or --output, by a rename
//   test    the classes and functions that the built extension registers, compared by Reflection with those of the PHP libraries
//           that --library names (symbols/php/reflection.php), then the unit tests of the roots that the caller selects after --
//           with runtime-targets.mts test --runner php and the extension loaded (K1106)
//
// The caller names every path (K1103): the folder of the extension with its sources in src/, the build folder, which Git ignores,
// the PHP libraries whose declarations the extension matches, and the folder names under the extension folder that hold no source
// (--skip, such as vendor). A call without the extension and build folders is a usage error (exit 2). When the extension folder
// holds no file, check, build and test say so and pass. The name of the extension is the one that PHP_NEW_EXTENSION of src/config.m4 declares, and its stubs are the
// src/*.stub.php files, each with its <stub>_arginfo.h (K1075: kit sets no naming rule). An extension folder that holds Cargo.toml
// and no src/config.m4 builds with cargo (K1192, ext-php-rs): its name is php-ext.extension-name of its composer.json, its stub is
// generated/<extension>.stub.php, which its bindings generate, and build runs cargo build --release --locked -p <package> of the
// Cargo workspace of the repository, with the php and php-config of the checkout and the target folder <build-dir>/target. phpize, php-config and php are the wrappers of var/tools/bin that install-tools wrote for
// the php of PATH (K862), never whatever PATH holds later (K393-1).
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { packageVendorFile } from './composer-vendor.mts';
import { isJsonObject } from './bootstrap/files.mts';
import { waitForHolderLock } from './holder-lock.mts';
import { SYMBOLS } from './install-symbols.mts';
import { spawnSync } from 'node:child_process';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';
import { cleanupAfter, run, runOutput, Stop } from './process.mts';
import { toolCommand } from './mise-tools.mts';
import { trackedFiles } from './tracked-files.mts';
import { git } from './git.mts';
import { cargoBuild, crateTypes } from './release-native.mts';

/**
 * The paths that the caller names (K1103): the extension folder, the build folder, the PHP library folders and the folder names
 * under the extension folder whose files are no sources.
 */
export type Layout = { extension: string; build: string; libraries: string[]; skip: string[] };

/** A call that the usage does not allow (exit 2). */
class Usage extends Stop {}

// The folder of gen_stub.php in the build folder (K941): its PHP-Parser is fetched once there.
const genStub = (build: string) => `${build}/gen-stub`;

/** The arginfo header that gen_stub.php writes beside the stub `stub`. */
export const arginfoOf = (stub: string): string => stub.replace(/\.stub\.php$/, '_arginfo.h');

/**
 * The names of the extension in the folder `folder` among `files` as it declares them (K1075): the extension that PHP_NEW_EXTENSION
 * of src/config.m4 names, which the build enables and loads, and the stubs of src/; or the finding that config.m4 names none.
 */
export function extensionNames(files: readonly string[], read: (file: string) => string | undefined, folder: string): { extension: string; stubs: string[] } | { finding: string } {
  if (isCargoExtension(files, folder)) return cargoNames(files, read, folder);
  const config = read(`${folder}/src/config.m4`);
  const extension = config === undefined ? undefined : /PHP_NEW_EXTENSION\(\s*\[?([A-Za-z0-9_]+)/.exec(config)?.[1];
  if (extension === undefined) return { finding: `${folder}/src/config.m4 declares no PHP_NEW_EXTENSION, which names the extension that the build enables` };
  const stubs = files.filter(file => path.posix.dirname(file) === `${folder}/src` && file.endsWith('.stub.php')).sort();
  return { extension, stubs };
}

/** Whether the extension of `folder` builds with cargo (K1192): it holds Cargo.toml and no src/config.m4. */
export const isCargoExtension = (files: readonly string[], folder: string): boolean => files.includes(`${folder}/Cargo.toml`) && !files.includes(`${folder}/src/config.m4`);

/**
 * The names of the cargo extension of `folder` (K1192): the extension that php-ext.extension-name of its composer.json names, and
 * its stub generated/<extension>.stub.php when it exists; or the finding that composer.json names none, or that Cargo.toml builds no
 * cdylib, the library that PHP loads.
 */
function cargoNames(files: readonly string[], read: (file: string) => string | undefined, folder: string): { extension: string; stubs: string[] } | { finding: string } {
  const text = read(`${folder}/composer.json`);
  const manifest: unknown = text === undefined ? undefined : JSON.parse(text);
  const pie = isJsonObject(manifest) ? manifest['php-ext'] : undefined;
  const extension = isJsonObject(pie) ? pie['extension-name'] : undefined;
  if (typeof extension !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(extension)) return { finding: `${folder}/composer.json names no php-ext.extension-name, which names the extension that cargo builds and PHP loads` };
  if (!crateTypes(read(`${folder}/Cargo.toml`) ?? '', `${folder}/Cargo.toml`).includes('cdylib')) return { finding: `${folder}/Cargo.toml declares no cdylib in crate-type of [lib], which PHP loads as the extension` };
  const stub = `${folder}/generated/${extension}.stub.php`;
  return { extension, stubs: files.includes(stub) ? [stub] : [] };
}

/** The stub hash that gen_stub.php writes into the arginfo header: the sha1 of the stub with its line ends as LF. */
export const stubHash = (stub: string): string => createHash('sha1').update(stub.replaceAll('\r\n', '\n')).digest('hex');

/** The findings of the extension in the folder `folder` among the `files`; none when the folder holds no file. */
export function extensionFindings(files: readonly string[], read: (file: string) => string | undefined, folder: string): string[] {
  if (!files.some(file => file.startsWith(`${folder}/`))) return [];
  const names = extensionNames(files, read, folder);
  if ('finding' in names) return [names.finding];
  // ext-php-rs registers the extension from its Rust code, so a cargo extension has no arginfo header to compare (K1192).
  if (isCargoExtension(files, folder)) return [];
  return names.stubs.flatMap((stubFile) => {
    const stub = read(stubFile);
    const header = read(arginfoOf(stubFile));
    if (stub === undefined || header === undefined) return [];
    const recorded = /\* Stub hash: ([0-9a-f]+) \*/.exec(header)?.[1];
    return recorded === stubHash(stub) ? [] : [`${arginfoOf(stubFile)}: the stub hash is ${recorded ?? 'missing'}, the stub's is ${stubHash(stub)}. Fix: regenerate it with the gen_stub.php that phpize copies into build/ of the extension source: \`php build/gen_stub.php ${stubFile}\` after phpize (K941)`];
  });
}

/** A declaration that Reflection reads: a class, a function or a constant, a JSON value. */
export type Declarations = { classes: Record<string, unknown>; functions: Record<string, unknown>; constants: Record<string, unknown> };

/** The differences of `extension` against `library` under the path `at`, each as `<path>: extension <a>, library <b>`. */
function differences(at: string, extension: unknown, library: unknown): string[] {
  if (isJsonObject(extension) && isJsonObject(library)) {
    const keys = [...new Set([...Object.keys(extension), ...Object.keys(library)])].sort();
    return keys.flatMap(key => differences(`${at} ${key}`, extension[key], library[key]));
  }
  if (Array.isArray(extension) && Array.isArray(library) && extension.length === library.length) return extension.flatMap((item, index) => differences(`${at} ${index + 1}`, item, library[index]));
  const shown = (value: unknown) => (value === undefined ? 'none' : JSON.stringify(value));
  return JSON.stringify(extension) === JSON.stringify(library) ? [] : [`${at}: extension ${shown(extension)}, library ${shown(library)}`];
}

/** The declarations of the JSON text `text` that reflection.php prints; throws on another value. */
export function declarationsOf(text: string): Declarations {
  const value: unknown = JSON.parse(text);
  if (!isJsonObject(value) || !isJsonObject(value.classes) || !isJsonObject(value.functions) || !isJsonObject(value.constants)) throw new Stop(`reflection.php printed no declarations: ${text.slice(0, 200)}`);
  return { classes: value.classes, functions: value.functions, constants: value.constants };
}

/**
 * The findings of the declarations of the extension against those that the library gives for the same names (S10). A constant
 * is a finding when the library defines none of that name; its value is no part of the comparison (K338).
 */
/** The fully qualified class names that the extension stub explicitly marks @internal. */
export function internalClassesOfStub(stub: string): Set<string> {
  const code = phpCodeWithoutCommentsAndStrings(stub);
  const namespaces = [...code.matchAll(/\bnamespace\s+([^;{]+);/g)];
  const internal = new Set<string>();
  const classes = /\/\*\*([\s\S]*?)\*\/\s*(?:(?:final|abstract|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const match of stub.matchAll(classes)) {
    if (!/@internal\b/.test(match[1] ?? '')) continue;
    const namespace = namespaces.filter(item => item.index !== undefined && item.index < (match.index ?? 0)).at(-1)?.[1]?.trim();
    if (namespace) internal.add(`${namespace}\\${match[2]}`);
  }
  return internal;
}

/** Keeps PHP code tokens and newlines while removing comments and string contents for namespace discovery. */
function phpCodeWithoutCommentsAndStrings(source: string): string {
  const output = source.split('');
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'backtick' = 'code';
  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (state === 'line') {
      if (char === '\n') state = 'code';
      else output[index] = ' ';
    } else if (state === 'block') {
      if (char === '*' && next === '/') {
        output[index] = ' ';
        output[index + 1] = ' ';
        index++;
        state = 'code';
      } else if (char !== '\n') output[index] = ' ';
    } else if (state === 'single' || state === 'double' || state === 'backtick') {
      const end = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (char === '\\') {
        output[index] = ' ';
        if (next !== '\n') output[index + 1] = ' ';
        index++;
      } else if (char === end) {
        output[index] = ' ';
        state = 'code';
      } else if (char !== '\n') output[index] = ' ';
    } else if (char === '/' && next === '/') {
      output[index] = ' ';
      output[index + 1] = ' ';
      index++;
      state = 'line';
    } else if (char === '#') {
      output[index] = ' ';
      state = 'line';
    } else if (char === '/' && next === '*') {
      output[index] = ' ';
      output[index + 1] = ' ';
      index++;
      state = 'block';
    } else if (char === "'") {
      output[index] = ' ';
      state = 'single';
    } else if (char === '"') {
      output[index] = ' ';
      state = 'double';
    } else if (char === '`') {
      output[index] = ' ';
      state = 'backtick';
    }
  }
  return output.join('');
}

export function declarationFindings(extension: Declarations, library: Declarations, internalClasses: ReadonlySet<string> = new Set()): string[] {
  extension = { ...extension, classes: Object.fromEntries(Object.entries(extension.classes).map(([name, declared]) => [name, selfTypes(declared, name)])) };
  library = { ...library, classes: Object.fromEntries(Object.entries(library.classes).map(([name, declared]) => [name, selfTypes(declared, name)])) };
  const of = (kind: 'classes' | 'functions', label: string) => Object.entries(extension[kind]).flatMap(([name, declared]) => {
    const own = library[kind][name];
    if (own === null || own === undefined) {
      if (kind === 'classes' && internalClasses.has(name)) return [];
      return [`${label} ${name}: the extension registers it, and the PHP library declares none`];
    }
    return differences(`${label} ${name}`, declared, own);
  });
  const constants = Object.keys(extension.constants).flatMap(name => ((library.constants[name] ?? null) === null ? [`constant ${name}: the extension registers it, and the PHP library declares none`] : []));
  return [...of('classes', 'class'), ...of('functions', 'function'), ...constants];
}

/** Reflection writes `self` for the PHP library and the declaring class name for an equivalent extension arginfo type. */
function selfTypes(value: unknown, className: string): unknown {
  if (Array.isArray(value)) return value.map(item => selfTypes(item, className));
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if ((key === 'type' || key === 'returnType') && typeof item === 'string') return [key, item.replace(/\bself\b/g, className)];
    return [key, selfTypes(item, className)];
  }));
}

/**
 * The files of the repository `root` that the extension reads: the tracked files, and the files of the extension folder `extension` on the disk,
 * since a repository that never tracks generated output generates the sources of its extension (K297); a file in a folder named
 * by `skip`, such as vendor, is no source.
 */
export function extensionFiles(root: string, extension: string, skip: readonly string[] = []): string[] {
  const folder = path.join(root, extension);
  // A file of the extension below a folder that the caller skips is no source, whether it is tracked or only on the disk (K1123).
  const skipped = (file: string) => file.startsWith(`${extension}/`) && file.slice(extension.length + 1).split('/').slice(0, -1).some(part => skip.includes(part));
  const disk = existsSync(folder)
    ? readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    : [];
  return [...new Set([...trackedFiles(root), ...disk])].filter(file => !skipped(file)).sort();
}

/** The text of the file `file` of `root` on the disk, or undefined when there is none. */
const reader = (root: string) => (file: string) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : undefined);

/** The names of the extension of `layout` in `root`, after its check; throws with the findings. */
function checked(root: string, layout: Layout): { extension: string; stubs: string[] } {
  const files = extensionFiles(root, layout.extension, layout.skip);
  if (!files.some(file => file.startsWith(`${layout.extension}/`))) throw new Stop(`${layout.extension} holds no file; the repository has no PHP extension there`);
  const found = extensionFindings(files, reader(root), layout.extension);
  if (found.length) throw new Stop(found.join('\n'));
  const names = extensionNames(files, reader(root), layout.extension);
  if ('finding' in names) throw new Stop(names.finding);
  return names;
}

// What phpize, configure and make write into a folder that is built in place: a stale one in src/ must never reach a build (K302).
const BUILD_FOLDERS = new Set(['modules', '.libs', 'build', 'autom4te.cache']);

/**
 * Whether the copy takes the file or folder `entry` of src/: the sources of the extension, which are its stub, its C and header
 * files, config.m4 and config.w32; no folder of build products and no product (objects, libtool files, the module, Makefile,
 * configure, config.h).
 */
function isSource(entry: string): boolean {
  const name = path.basename(entry);
  if (statSync(entry).isDirectory()) return !BUILD_FOLDERS.has(name);
  return name === 'config.m4' || name === 'config.w32' || name.endsWith('.stub.php') || (/\.[ch]$/.test(name) && name !== 'config.h');
}

/**
 * A copy of the package of the extension in a new directory under the build folder: its composer.json beside src/, as in the package,
 * so that config.m4 reads the version of the package from ../composer.json (K295). src/ is prepared by phpize; returns the
 * copy (`work`, to remove) and its src/ (`source`, where the build runs).
 */
// The lock of the gen-stub folder (K941): one build at a time copies and runs the generator. It sits beside the folder, since a
// failed run removes the folder, and a lock inside it would be removed under its holder.
const GEN_STUB_LOCK_POLL_MS = 500;
const GEN_STUB_LOCK_WAIT_MS = 10 * 60 * 1000;

/** Takes the lock of the gen-stub folder and returns its release; a running build is waited for (K941). */
function takeGenStubLock(root: string, build: string): () => void {
  return waitForHolderLock(path.join(root, `${genStub(build)}.lock`), { checkout: root, command: 'php-extension build', timeoutMs: GEN_STUB_LOCK_WAIT_MS, pollMs: GEN_STUB_LOCK_POLL_MS }).release;
}

function generateArginfo(root: string, build: string, source: string, stub: string): string {
  const php = toolCommand(root, 'php');
  // phpize copies the gen_stub.php of the PHP into build/ of the source (K941), which names the PHP build directory by itself, so
  // php-config --prefix is not used. gen_stub keeps the PHP-Parser that it fetches for its own release in its own directory, so it
  // runs from one folder per checkout: PHP's tool fetches its parser once, and a later build finds it there (K941). Its check
  // for that directory is not under gen_stub's own lock, so the folder is used under this build's lock (K941).
  const release = takeGenStubLock(root, build);
  try {
    const folder = path.join(root, genStub(build));
    mkdirSync(folder, { recursive: true });
    // The PHP-Parser directories that an earlier build fetched stay; a failed run removes only the ones it created (K941).
    const before = new Set(readdirSync(folder));
    const generator = path.join(folder, 'gen_stub.php');
    const staged = `${generator}.${process.pid}`;
    copyFileSync(path.join(source, 'build', 'gen_stub.php'), staged);
    renameSync(staged, generator);
    const file = path.join(source, path.basename(stub));
    try {
      run(php, [generator, file], { cwd: source });
    } catch (error) {
      // A failed run may leave a partial PHP-Parser behind, which every later build would trust; the next build fetches it again.
      cleanupAfter(error, () => { for (const name of readdirSync(folder)) if (!before.has(name) && name.startsWith('PHP-Parser-')) rmSync(path.join(folder, name), { recursive: true, force: true }); });
    }
  } finally {
    release();
  }
  return path.join(source, path.basename(arginfoOf(stub)));
}

/** A tracked repository source that `--source-copy` stages into the build (K247-3). */
type SourceCopy = { source: string; output: string };

interface BuildOptions {
  output?: string;
  sourceCopies?: SourceCopy[];
  configureArgs?: string[];
}

function safeRelativePath(value: string): boolean {
  return value !== '' && !value.startsWith('~') && !value.startsWith('/') && path.win32.parse(value).root === '' && !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** Copy a tracked repository source to the declared `src/` path of the temporary phpize package. */
function stageSourceCopies(root: string, extension: string, source: string, copies: readonly SourceCopy[]): void {
  const tracked = new Set(git(root, 'ls-files', '--cached', '-z').split('\0').filter(Boolean));
  for (const item of copies) {
    if (!safeRelativePath(item.source)) throw new Stop(`--source-copy: source ${JSON.stringify(item.source)} is not a repository-relative path`);
    if (!safeRelativePath(item.output)) throw new Stop(`--source-copy: output ${JSON.stringify(item.output)} is not a package-relative path`);
    if (!tracked.has(item.source)) throw new Stop(`--source-copy: ${item.source} is not a tracked source file`);
    if (!item.output.startsWith('src/')) throw new Stop(`--source-copy: output ${item.output} must be below src/ for the PHP extension build`);
    const input = path.join(root, item.source);
    const stat = lstatSync(input, { throwIfNoEntry: false });
    if (stat === undefined) throw new Stop(`--source-copy: ${item.source} is missing from the working tree`);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Stop(`--source-copy: ${item.source} must be a regular tracked file, not a link or directory`);
    const relative = item.output.slice('src/'.length);
    if (relative.startsWith('~') || path.win32.parse(relative).root !== '' || relative.includes('\\')) throw new Stop(`--source-copy: output ${item.output} must be a package-relative path below src/`);
    const destination = path.resolve(source, relative);
    if (!destination.startsWith(`${path.resolve(source)}${path.sep}`)) throw new Stop(`--source-copy: output ${item.output} escapes the temporary PHP extension source`);
    let directory = path.resolve(source);
    for (const part of path.posix.dirname(relative).split('/').filter(Boolean)) {
      directory = path.join(directory, part);
      if (existsSync(directory)) {
        const parent = lstatSync(directory);
        if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Stop(`--source-copy: output ${item.output} crosses a non-directory or symbolic link`);
      } else mkdirSync(directory);
    }
    if (existsSync(destination)) throw new Stop(`--source-copy: output ${item.output} collides with a file already in ${extension}/src`);
    copyFileSync(input, destination);
  }
}

function phpized(root: string, layout: Layout, label: string, stubs: readonly string[], sourceCopies: readonly SourceCopy[] = []): { work: string; source: string } {
  const work = path.join(root, layout.build, `${label}.${process.pid}`);
  const source = path.join(work, 'src');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    cpSync(path.join(root, layout.extension, 'composer.json'), path.join(work, 'composer.json'));
    cpSync(path.join(root, layout.extension, 'src'), source, { recursive: true, filter: isSource });
    stageSourceCopies(root, layout.extension, source, sourceCopies);
    for (const stub of stubs) rmSync(path.join(source, path.basename(arginfoOf(stub))), { force: true });
    // The tools of the PHP of the checkout are its wrappers, never the ones on PATH.
    console.log(`[php-extension] phpize (${run(toolCommand(root, 'php-config'), ['--version']).trim()})`);
    run(toolCommand(root, 'phpize'), [], { cwd: source });
    for (const stub of stubs) generateArginfo(root, layout.build, source, stub);
    return { work, source };
  } catch (error) {
    cleanupAfter(error, () => rmSync(work, { recursive: true, force: true }));
  }
}

/** Builds the extension of `layout` in `root` into <build>/<extension>.so, or the --output path; returns its path. */
export function build(root: string, layout: Layout, options: BuildOptions = {}): string {
  const names = checked(root, layout);
  if (options.output !== undefined && !path.isAbsolute(options.output)) throw new Stop('php-extension build --output must be an absolute module path');
  for (const argument of options.configureArgs ?? []) {
    if (!/^--[A-Za-z0-9][A-Za-z0-9_-]*(?:=[A-Za-z0-9._-]+)?$/.test(argument)) throw new Stop(`php-extension build: invalid configure argument ${JSON.stringify(argument)}`);
  }
  const library = path.resolve(options.output ?? path.join(root, layout.build, `${names.extension}.so`));
  const outputDirectory = path.dirname(library);
  mkdirSync(outputDirectory, { recursive: true });
  if (existsSync(library)) {
    const outputStat = lstatSync(library);
    if (!outputStat.isFile() || outputStat.isSymbolicLink()) throw new Stop(`php-extension build output ${library} must be a regular file when it already exists`);
  }
  const temporaryLibrary = `${library}.tmp.${process.pid}`;
  if (isCargoExtension(extensionFiles(root, layout.extension, layout.skip), layout.extension)) return cargoExtension(root, layout, options, library, temporaryLibrary);
  const sourceCopies = options.sourceCopies ?? [];
  const { work, source } = phpized(root, layout, 'build', names.stubs, sourceCopies);
  try {
    // P8 for C (K334): the flags of php-config do not fail a call whose result must be checked; the compiler's check does.
    const env = { ...process.env, CFLAGS: `${process.env.CFLAGS ?? ''} -Werror=unused-result`.trim() };
    console.log('[php-extension] configure');
    // configure takes the php-config of the checkout, so it builds the module for the php that loads it (K632).
    try {
      run('./configure', [`--enable-${names.extension.replaceAll('_', '-')}`, `--with-php-config=${toolCommand(root, 'php-config')}`, ...(options.configureArgs ?? [])], { cwd: source, env });
    } catch (error) {
      // config.log explains a failed configure, and the work folder is removed below: its copy is kept under var/, replacing the
      // one of an earlier failure, and the message names the copy only when it was copied (K946).
      const message = error instanceof Error ? error.message : String(error);
      const log = path.join(source, 'config.log');
      if (!existsSync(log)) throw new Stop(message);
      const kept = path.join(root, layout.build, 'config.log');
      copyFileSync(log, kept);
      throw new Stop(`${message}\nconfig.log is kept at ${kept}`);
    }
    console.log('[php-extension] make');
    // The compiler writes its warnings to standard error, which is printed and read with the standard output (K1142).
    const made = runOutput('make', [], { cwd: source, env });
    if (made.stderr.trim()) console.error(made.stderr.trimEnd());
    const warnings = `${made.stdout}\n${made.stderr}`.split('\n').filter(line => /\.[ch]:\d+:\d+: warning:/.test(line));
    if (warnings.length) throw new Stop(`the build of ${names.extension} has compiler warnings:\n${warnings.join('\n')}`);
    renameSync(path.join(source, 'modules', `${names.extension}.so`), temporaryLibrary);
    renameSync(temporaryLibrary, library);
    // A successful build leaves no failure log of an earlier build behind (K946).
    rmSync(path.join(root, layout.build, 'config.log'), { force: true });
    console.log(`[php-extension] built ${path.relative(root, library)}`);
    return library;
  } finally {
    rmSync(temporaryLibrary, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Builds the cargo extension of `layout` (K1192): cargo build --release --locked -p <package of its Cargo.toml> in the Cargo
 * workspace of the repository, with the php and php-config of the checkout in PHP and PHP_CONFIG, which ext-php-rs reads, and the
 * target folder <build-dir>/target; the cdylib is published at `library` by a rename. Returns `library`.
 */
function cargoExtension(root: string, layout: Layout, options: BuildOptions, library: string, temporaryLibrary: string): string {
  if ((options.sourceCopies ?? []).length || (options.configureArgs ?? []).length) throw new Stop(`--source-copy and --configure-arg belong to a phpize extension; ${layout.extension} builds with cargo`);
  const env = { ...process.env, PHP: toolCommand(root, 'php'), PHP_CONFIG: toolCommand(root, 'php-config') };
  try {
    const built = cargoBuild({ root, source: root, directory: layout.extension, kind: 'cdylib', env, target: path.join(root, layout.build, 'target'), log: text => console.log(`[php-extension] ${text}`) });
    copyFileSync(built, temporaryLibrary);
    renameSync(temporaryLibrary, library);
    console.log(`[php-extension] built ${path.relative(root, library)}`);
    return library;
  } finally {
    rmSync(temporaryLibrary, { force: true });
  }
}

function buildOptions(args: readonly string[]): BuildOptions {
  const options: BuildOptions = { sourceCopies: [], configureArgs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--output') {
      const value = args[++index];
      if (!value || options.output !== undefined) throw new Usage('usage: php-extension.mts build [--output <absolute-path>] [--source-copy <source> <output>] [--configure-arg <arg>]');
      options.output = value;
    } else if (option === '--source-copy') {
      const source = args[++index];
      const output = args[++index];
      if (!source || !output) throw new Usage('usage: --source-copy requires a tracked repository source and package-relative output');
      options.sourceCopies?.push({ source, output });
    } else if (option === '--configure-arg') {
      const value = args[++index];
      if (!value) throw new Usage('usage: --configure-arg requires one configure option');
      options.configureArgs?.push(value);
    } else {
      throw new Usage(`unknown PHP extension build option ${JSON.stringify(option)}`);
    }
  }
  return options;
}

/** The library that build published for the extension `extension` of `layout`; throws when it is missing. */
function builtLibrary(root: string, layout: Layout, extension: string): string {
  const library = path.join(root, layout.build, `${extension}.so`);
  if (!existsSync(library)) throw new Stop(`${path.relative(root, library)} is missing. Fix: make build-php-ext`);
  return library;
}

const USAGE = 'usage: php-extension.mts check|build|test --extension <folder> --build-dir <folder> [--library <folder>]... [--skip <name>]... [build options] [-- <test selection>]';

/** The layout that the arguments `args` name with --extension, --build-dir, --library and --skip (K1103), and the other arguments. */
export function layoutOptions(args: readonly string[]): { layout: Layout; rest: string[] } {
  let extension: string | undefined;
  let build: string | undefined;
  const libraries: string[] = [];
  const skip: string[] = [];
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== '--extension' && option !== '--build-dir' && option !== '--library' && option !== '--skip') {
      rest.push(option ?? '');
      continue;
    }
    const value = args[++index];
    if (!value) throw new Usage(`${option} needs a folder; ${USAGE}`);
    if (option === '--extension') extension = value;
    else if (option === '--build-dir') build = value;
    else if (option === '--skip') skip.push(value);
    else libraries.push(value);
  }
  if (extension === undefined || build === undefined) throw new Usage(`the caller names the extension and build folders; ${USAGE}`);
  return { layout: { extension, build, libraries, skip }, rest };
}

/**
 * The findings of the declarations of the built extension of `layout` in `root` against the PHP libraries that it names: each name
 * that the extension registers is compared with the library that declares it (S10).
 */
export function declarations(root: string, layout: Layout): string[] {
  const names = checked(root, layout);
  // A caller that names no PHP library has no library declaration to match (K616, K1103).
  if (!layout.libraries.length) return [];
  const library = builtLibrary(root, layout, names.extension);
  const script = path.join(SYMBOLS, 'php', 'reflection.php');
  const php = toolCommand(root, 'php');
  const extension = declarationsOf(run(php, ['-d', `extension=${library}`, script, 'extension', names.extension]));
  const request = path.join(root, layout.build, `names.${process.pid}.json`);
  writeFileSync(request, JSON.stringify({ classes: Object.keys(extension.classes), functions: Object.keys(extension.functions), constants: Object.keys(extension.constants) }));
  try {
    const own: Declarations = { classes: {}, functions: {}, constants: {} };
    for (const folder of layout.libraries) {
      const autoloader = packageVendorFile(root, folder, 'autoload.php');
      if (!autoloader) throw new Stop(`${folder} has no Composer autoloader, which the declarations of the library are read through: run composer install in ${folder}, or in the project that requires it`);
      const found = declarationsOf(run(php, [script, 'library', path.join(root, autoloader), request]));
      for (const kind of ['classes', 'functions', 'constants'] as const) {
        for (const [name, declared] of Object.entries(found[kind])) if (declared !== null && declared !== undefined) own[kind][name] = declared;
      }
    }
    const internal = new Set(names.stubs.flatMap(stub => [...internalClassesOfStub(readFileSync(path.join(root, stub), 'utf8'))]));
    return declarationFindings(extension, own, internal);
  } finally {
    rmSync(request, { force: true });
  }
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const command = process.argv[2] ?? '';
  try {
    if (!['check', 'build', 'test'].includes(command)) throw new Usage(USAGE);
    const args = process.argv.slice(3);
    const separator = args.indexOf('--');
    const { layout, rest } = layoutOptions(separator === -1 ? args : args.slice(0, separator));
    // The roots of the unit tests are the caller's selection after --, which runtime-targets test reads with the runner arguments
    // after its own -- (K1106).
    const selection = separator === -1 ? [] : args.slice(separator + 1);
    if (command !== 'build' && rest.length) throw new Usage(USAGE);
    if (command === 'test' && selection.length === 0) throw new Usage(`test needs the selection of its unit tests after --; ${USAGE}`);
    const files = extensionFiles(root, layout.extension, layout.skip);
    if (!files.some(file => file.startsWith(`${layout.extension}/`))) {
      console.log(`[php-extension] the repository has no PHP extension: ${layout.extension} holds no file`);
    } else if (command === 'check') {
      const found = extensionFindings(files, reader(root), layout.extension);
      if (found.length) throw new Stop(found.join('\n'));
      console.log('[php-extension] the extension is declared and the arginfo header of each stub matches it');
    } else if (command === 'build') {
      build(root, layout, buildOptions(rest));
    } else {
      const found = declarations(root, layout);
      if (found.length) throw new Stop(`the extension differs from the PHP library:\n${found.join('\n')}`);
      console.log('[php-extension] the extension registers the classes and functions of the PHP library as it declares them');
      // The unit tests load the library that build published, which runtime-targets takes with --php-extension (K1103, K1106).
      const names = checked(root, layout);
      const tests = spawnSync(process.execPath, [siblingTool(import.meta.url, 'runtime-targets'), 'test', '--runner', 'php', '--php-extension', builtLibrary(root, layout, names.extension), ...selection], { cwd: root, stdio: 'inherit' });
      if (tests.error) throw new Stop(`runtime-targets test could not start: ${tests.error.message}`);
      if (tests.status !== 0) {
        console.error(`[php-extension] runtime-targets test ${tests.signal ? `ended by signal ${tests.signal}` : `exited with ${tests.status}`}`);
        process.exit(1);
      }
    }
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    for (const line of error.message.split('\n')) console.error(`[php-extension] ${line}`);
    process.exit(error instanceof Usage ? 2 : 1);
  }
}
