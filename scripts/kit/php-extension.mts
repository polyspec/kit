#!/usr/bin/env node
// The PHP extension of a repository (S10): one model and one build for every repository.
//
//   node scripts/kit/php-extension.mts check          the names, the one stub and, when present, the arginfo stub hash
//   node scripts/kit/php-extension.mts build [--output <absolute-path>] [--source-copy <source> <output>] [--configure-arg <arg>]
//                                                     the check, then generate arginfo in a temporary source copy, phpize,
//                                                     configure and make; publish the library by a rename
//   node scripts/kit/php-extension.mts arginfo        generate the header under ignored var/php-ext/arginfo with the pinned,
//                                                     installed gen_stub.php and PHP-Parser; offline
//   node scripts/kit/php-extension.mts test           the classes and functions that the built extension registers, compared
//                                                     by Reflection with those of the PHP library (symbols/php/reflection.php),
//                                                     then the unit tests of runtime-targets.mts with the extension loaded
//
// In a repository without packages/php-ext, check, build and test say so and pass: every repository runs them in its CI.
// The PHP library is packages/php, named polyspec/<repository>; the extension lies in packages/php-ext with its sources in src/,
// is named polyspec/<repository>-php-ext and polyspec_<repository> (a hyphen an underscore), and has one stub,
// src/polyspec_<repository>.stub.php. phpize, php-config and php are the wrappers of var/tools/bin of the checkout, the PHP of
// .php-version, never the ones on PATH (K393-1).
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { packageVendorFile } from './composer-vendor.mts';
import { installedGenStub } from './install-php-arginfo.mts';
import { isJsonObject } from './bootstrap/files.mts';
import { SYMBOLS } from './install-symbols.mts';
import { spawnSync } from 'node:child_process';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';
import { run, Stop } from './process.mts';
import { toolCommand } from './mise-tools.mts';
import { trackedFiles } from './tracked-files.mts';
import { git } from './git.mts';
import { loadConfig, type ReleaseGeneratedArtifact } from './release.mts';

export const LIBRARY = 'packages/php';
export const EXTENSION = 'packages/php-ext';
const OUTPUT = 'var/php-ext';
const RELEASE_CONFIG = 'config/release.json';

/** The names of the extension of the repository `repository`: its Composer package, its extension and its stub. */
export function extensionNames(repository: string): { composer: string; extension: string; stub: string; arginfo: string } {
  const extension = `polyspec_${repository.replaceAll('-', '_')}`;
  return { composer: `polyspec/${repository}-php-ext`, extension, stub: `${EXTENSION}/src/${extension}.stub.php`, arginfo: `${EXTENSION}/src/${extension}_arginfo.h` };
}

/** The stub hash that gen_stub.php writes into the arginfo header: the sha1 of the stub with its line ends as LF. */
export const stubHash = (stub: string): string => createHash('sha1').update(stub.replaceAll('\r\n', '\n')).digest('hex');

/** The name of the Composer package of the composer.json text `text`, or undefined. */
function composerName(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const manifest: unknown = JSON.parse(text);
  return isJsonObject(manifest) && typeof manifest.name === 'string' ? manifest.name : undefined;
}

/** Whether the Composer manifest `text` is an application (K433): a package of type project, which is no library of S10. */
export function isApplication(text: string | undefined): boolean {
  if (text === undefined) return false;
  const manifest: unknown = JSON.parse(text);
  return isJsonObject(manifest) && manifest.type === 'project';
}

/**
 * The folders of the PHP libraries among `files` (S10): packages/php, and packages/<component>/php for each component, except an
 * application; `read` gives the text of a file or undefined.
 */
export function libraryFolders(files: readonly string[], read: (file: string) => string | undefined): string[] {
  return files.flatMap(file => (/^packages\/(?:[^/]+\/)?php\/composer\.json$/.test(file) && !isApplication(read(file)) ? [path.posix.dirname(file)] : [])).sort();
}

/**
 * The repository name of the PHP libraries among `files`, and their folders, or a finding: `polyspec/<repository>` in
 * packages/php/composer.json, `polyspec/<repository>-<component>` in packages/<component>/php/composer.json, all of one
 * repository; `read` gives the text of a file or undefined.
 */
export function repositoryOf(files: readonly string[], read: (file: string) => string | undefined): { repository: string; libraries: string[] } | { finding: string } {
  const libraries = libraryFolders(files, read);
  if (libraries.length === 0) {
    // K616: a repository without a PHP library (its packages/php an application, as fsm's test bed) has an extension that implements
    // none; its own composer.json names the repository, and no library declaration is matched.
    const name = composerName(read(`${EXTENSION}/composer.json`));
    const repository = name === undefined ? undefined : /^polyspec\/([a-z0-9][a-z0-9-]*)-php-ext$/.exec(name)?.[1];
    if (!repository) return { finding: `${EXTENSION}/composer.json: the extension of a repository without a PHP library is named polyspec/<repository>-php-ext, not ${name ?? 'nothing'}` };
    return { repository, libraries };
  }
  const repositories = new Map<string, string>();
  for (const folder of libraries) {
    const component = folder === LIBRARY ? undefined : folder.split('/')[1];
    const name = composerName(read(`${folder}/composer.json`));
    const match = name === undefined ? null : /^polyspec\/([a-z0-9][a-z0-9-]*)$/.exec(name);
    const repository = component === undefined ? match?.[1] : match?.[1]?.endsWith(`-${component}`) ? match[1].slice(0, -(component.length + 1)) : undefined;
    if (!repository) return { finding: `${folder}/composer.json: the PHP library, whose classes the extension registers, is named polyspec/<repository>${component === undefined ? '' : `-${component}`}, not ${name ?? 'nothing'}` };
    repositories.set(folder, repository);
  }
  const names = [...new Set(repositories.values())];
  const odd = [...repositories].find(([, repository]) => repository !== names[0]);
  if (odd) return { finding: `${odd[0]}/composer.json: the PHP libraries name two repositories, ${names[0]} and ${odd[1]}; the repository has one extension` };
  return { repository: names[0] ?? '', libraries };
}

/** The findings of the extension among the `files`; none when the repository has no packages/php-ext. */
export function extensionFindings(files: readonly string[], read: (file: string) => string | undefined): string[] {
  if (!files.some(file => file.startsWith(`${EXTENSION}/`))) return [];
  const owner = repositoryOf(files, read);
  if ('finding' in owner) return [owner.finding];
  const names = extensionNames(owner.repository);
  const found: string[] = [];
  const composer = composerName(read(`${EXTENSION}/composer.json`));
  if (composer !== names.composer) found.push(`${EXTENSION}/composer.json: the extension is named ${names.composer}, not ${composer ?? 'nothing'}`);
  const stubs = files.filter(file => file.startsWith(`${EXTENSION}/`) && file.endsWith('.stub.php'));
  for (const stub of stubs.filter(file => file !== names.stub)) found.push(`${stub}: the extension has one stub, ${names.stub}`);
  const config = read(`${EXTENSION}/src/config.m4`);
  const declared = config === undefined ? undefined : /PHP_NEW_EXTENSION\(\s*\[?([A-Za-z0-9_]+)/.exec(config)?.[1];
  if (declared !== names.extension) found.push(`${EXTENSION}/src/config.m4: PHP_NEW_EXTENSION names the extension ${names.extension}, not ${declared ?? 'nothing'}`);
  const stub = read(names.stub);
  if (stub === undefined) return [...found, `${names.stub}: the stub of the extension is missing`];
  const header = read(names.arginfo);
  if (header !== undefined) {
    const recorded = /\* Stub hash: ([0-9a-f]+) \*/.exec(header)?.[1];
    if (recorded !== stubHash(stub)) found.push(`${names.arginfo}: the stub hash is ${recorded ?? 'missing'}, the stub's is ${stubHash(stub)}. Fix: make php-ext-arginfo`);
  }
  return found;
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
 * The files of the repository `root` that the extension reads: the tracked files, and the files of packages/php-ext on the disk,
 * since a repository that never tracks generated output generates the sources of its extension (K297); the vendor and
 * node_modules folders are no sources.
 */
export function extensionFiles(root: string): string[] {
  const folder = path.join(root, EXTENSION);
  const disk = existsSync(folder)
    ? readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
      .filter(file => !/(?:^|\/)(?:vendor|node_modules)\//.test(file))
    : [];
  return [...new Set([...trackedFiles(root), ...disk])].sort();
}

/** The text of the file `file` of `root` on the disk, or undefined when there is none. */
const reader = (root: string) => (file: string) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : undefined);

/** The names of the extension of `root`, after its check; throws with the findings. */
function checked(root: string): ReturnType<typeof extensionNames> & { libraries: string[] } {
  const files = extensionFiles(root);
  if (!files.some(file => file.startsWith(`${EXTENSION}/`))) throw new Stop(`${EXTENSION} holds no file; the repository has no PHP extension`);
  const found = extensionFindings(files, reader(root));
  if (found.length) throw new Stop(found.join('\n'));
  const owner = repositoryOf(files, reader(root));
  if ('finding' in owner) throw new Stop(owner.finding);
  return { ...extensionNames(owner.repository), libraries: owner.libraries };
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
 * A copy of the package of the extension in a new directory under var/php-ext: its composer.json beside src/, as in the package,
 * so that config.m4 reads the version of the package from ../composer.json (K295). src/ is prepared by phpize; returns the
 * copy (`work`, to remove) and its src/ (`source`, where the build runs).
 */
function generateArginfo(root: string, source: string, stub: string): string {
  let installed: ReturnType<typeof installedGenStub>;
  try { installed = installedGenStub(root); }
  catch (error) { throw new Stop(error instanceof Error ? error.message : String(error)); }
  const php = toolCommand(root, 'php');
  const file = path.join(source, path.basename(stub));
  run(php, ['-n', installed.file, file], { cwd: source });
  return path.join(source, path.basename(stub).replace(/\.stub\.php$/, '_arginfo.h'));
}

type SourceCopy = Extract<ReleaseGeneratedArtifact, { kind: 'source-copy' }>;

interface BuildOptions {
  output?: string;
  sourceCopies?: SourceCopy[];
  configureArgs?: string[];
}

function safeRelativePath(value: string): boolean {
  return value !== '' && !value.startsWith('~') && !value.startsWith('/') && path.win32.parse(value).root === '' && !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** The declared sources of the PHP extension that the Composer archive also carries. */
function extensionSourceCopies(root: string): SourceCopy[] {
  if (!existsSync(path.join(root, RELEASE_CONFIG))) return [];
  const extension = loadConfig(root).packages.find(item => item.directory === EXTENSION);
  return (extension?.generated ?? []).filter((item): item is SourceCopy => item.kind === 'source-copy');
}

/** Copy a tracked repository source to the declared `src/` path of the temporary phpize package. */
function stageSourceCopies(root: string, source: string, copies: readonly SourceCopy[]): void {
  const tracked = new Set(git(root, 'ls-files', '--cached', '-z').split('\0').filter(Boolean));
  for (const item of copies) {
    if (!safeRelativePath(item.source)) throw new Stop(`${RELEASE_CONFIG}: source-copy source ${JSON.stringify(item.source)} is not a repository-relative path`);
    if (!safeRelativePath(item.output)) throw new Stop(`${RELEASE_CONFIG}: source-copy output ${JSON.stringify(item.output)} is not a package-relative path`);
    if (!tracked.has(item.source)) throw new Stop(`${RELEASE_CONFIG}: source-copy ${item.source} is not a tracked source file`);
    if (!item.output.startsWith('src/')) throw new Stop(`${RELEASE_CONFIG}: source-copy output ${item.output} must be below src/ for the PHP extension build`);
    const input = path.join(root, item.source);
    const stat = lstatSync(input, { throwIfNoEntry: false });
    if (stat === undefined) throw new Stop(`${RELEASE_CONFIG}: source-copy ${item.source} is missing from the working tree`);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Stop(`${RELEASE_CONFIG}: source-copy ${item.source} must be a regular tracked file, not a link or directory`);
    const relative = item.output.slice('src/'.length);
    if (relative.startsWith('~') || path.win32.parse(relative).root !== '' || relative.includes('\\')) throw new Stop(`${RELEASE_CONFIG}: source-copy output ${item.output} must be a package-relative path below src/`);
    const destination = path.resolve(source, relative);
    if (!destination.startsWith(`${path.resolve(source)}${path.sep}`)) throw new Stop(`${RELEASE_CONFIG}: source-copy output ${item.output} escapes the temporary PHP extension source`);
    let directory = path.resolve(source);
    for (const part of path.posix.dirname(relative).split('/').filter(Boolean)) {
      directory = path.join(directory, part);
      if (existsSync(directory)) {
        const parent = lstatSync(directory);
        if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Stop(`${RELEASE_CONFIG}: source-copy output ${item.output} crosses a non-directory or symbolic link`);
      } else mkdirSync(directory);
    }
    if (existsSync(destination)) throw new Stop(`${RELEASE_CONFIG}: source-copy output ${item.output} collides with a file already in ${EXTENSION}/src`);
    copyFileSync(input, destination);
  }
}

function phpized(root: string, label: string, stub: string, sourceCopies: readonly SourceCopy[] = []): { work: string; source: string } {
  const work = path.join(root, OUTPUT, `${label}.${process.pid}`);
  const source = path.join(work, 'src');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    cpSync(path.join(root, EXTENSION, 'composer.json'), path.join(work, 'composer.json'));
    cpSync(path.join(root, EXTENSION, 'src'), source, { recursive: true, filter: isSource });
    stageSourceCopies(root, source, sourceCopies);
    rmSync(path.join(source, path.basename(stub).replace(/\.stub\.php$/, '_arginfo.h')), { force: true });
    generateArginfo(root, source, stub);
    // The tools of the PHP of the checkout are its wrappers, never the ones on PATH.
    console.log(`[php-extension] phpize (${run(toolCommand(root, 'php-config'), ['--version']).trim()})`);
    run(toolCommand(root, 'phpize'), [], { cwd: source });
    return { work, source };
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

/** Builds the extension of `root` into var/php-ext/<extension>.so; returns its path. */
export function build(root: string, options: BuildOptions = {}): string {
  const names = checked(root);
  if (options.output !== undefined && !path.isAbsolute(options.output)) throw new Stop('php-extension build --output must be an absolute module path');
  for (const argument of options.configureArgs ?? []) {
    if (!/^--[A-Za-z0-9][A-Za-z0-9_-]*(?:=[A-Za-z0-9._-]+)?$/.test(argument)) throw new Stop(`php-extension build: invalid configure argument ${JSON.stringify(argument)}`);
  }
  const library = path.resolve(options.output ?? path.join(root, OUTPUT, `${names.extension}.so`));
  const outputDirectory = path.dirname(library);
  mkdirSync(outputDirectory, { recursive: true });
  if (existsSync(library)) {
    const outputStat = lstatSync(library);
    if (!outputStat.isFile() || outputStat.isSymbolicLink()) throw new Stop(`php-extension build output ${library} must be a regular file when it already exists`);
  }
  const temporaryLibrary = `${library}.tmp.${process.pid}`;
  const sourceCopies = [...extensionSourceCopies(root), ...(options.sourceCopies ?? [])];
  const { work, source } = phpized(root, 'build', names.stub, sourceCopies);
  try {
    // P8 for C (K334): the flags of php-config do not fail a call whose result must be checked; the compiler's check does.
    const env = { ...process.env, CFLAGS: `${process.env.CFLAGS ?? ''} -Werror=unused-result`.trim() };
    console.log('[php-extension] configure');
    // configure finds a php-config on PATH by itself; the PHP of the checkout builds the module that its php loads (K632).
    run('./configure', [`--enable-${names.extension.replaceAll('_', '-')}`, `--with-php-config=${toolCommand(root, 'php-config')}`, ...(options.configureArgs ?? [])], { cwd: source, env });
    console.log('[php-extension] make');
    const made = run('make', [], { cwd: source, env });
    const warnings = made.split('\n').filter(line => /\.[ch]:\d+:\d+: warning:/.test(line));
    if (warnings.length) throw new Stop(`the build of ${names.extension} has compiler warnings:\n${warnings.join('\n')}`);
    renameSync(path.join(source, 'modules', `${names.extension}.so`), temporaryLibrary);
    renameSync(temporaryLibrary, library);
    console.log(`[php-extension] built ${path.relative(root, library)}`);
    return library;
  } finally {
    rmSync(temporaryLibrary, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

function buildOptions(args: readonly string[]): BuildOptions {
  const options: BuildOptions = { sourceCopies: [], configureArgs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--output') {
      const value = args[++index];
      if (!value || options.output !== undefined) throw new Stop('usage: php-extension.mts build [--output <absolute-path>] [--source-copy <source> <output>] [--configure-arg <arg>]');
      options.output = value;
    } else if (option === '--source-copy') {
      const source = args[++index];
      const output = args[++index];
      if (!source || !output) throw new Stop('usage: --source-copy requires a tracked repository source and package-relative output');
      options.sourceCopies?.push({ kind: 'source-copy', source, output });
    } else if (option === '--configure-arg') {
      const value = args[++index];
      if (!value) throw new Stop('usage: --configure-arg requires one configure option');
      options.configureArgs?.push(value);
    } else {
      throw new Stop(`unknown PHP extension build option ${JSON.stringify(option)}`);
    }
  }
  return options;
}

/** Writes the arginfo header of the extension of `root` with the rule of phpize, which runs gen_stub.php. */
export function arginfo(root: string): void {
  const files = extensionFiles(root);
  const owner = repositoryOf(files, reader(root));
  if ('finding' in owner) throw new Stop(owner.finding);
  const names = extensionNames(owner.repository);
  const output = path.join(root, OUTPUT, 'arginfo');
  const work = path.join(output, `generate.${process.pid}`);
  const source = path.join(work, 'src');
  mkdirSync(source, { recursive: true });
  let temporary: string | undefined;
  try {
    cpSync(path.join(root, names.stub), path.join(source, path.basename(names.stub)));
    const generated = generateArginfo(root, source, names.stub);
    const destination = path.join(output, path.basename(names.arginfo));
    temporary = `${destination}.tmp.${process.pid}`;
    copyFileSync(generated, temporary);
    renameSync(temporary, destination);
    console.log(`[php-extension] wrote ${path.relative(root, destination)}`);
  } finally {
    if (temporary) rmSync(temporary, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The findings of the declarations of the built extension of `root` against the PHP libraries: each name that the extension
 * registers is compared with the library that declares it (S10).
 */
export function declarations(root: string): string[] {
  const names = checked(root);
  // A repository without a PHP library has no library declaration to match (K616).
  if (!names.libraries.length) return [];
  const library = path.join(root, OUTPUT, `${names.extension}.so`);
  if (!existsSync(library)) throw new Stop(`${path.relative(root, library)} is missing. Fix: make build-php-ext`);
  const script = path.join(SYMBOLS, 'php', 'reflection.php');
  const php = toolCommand(root, 'php');
  const extension = declarationsOf(run(php, ['-d', `extension=${library}`, script, 'extension', names.extension]));
  const request = path.join(root, OUTPUT, `names.${process.pid}.json`);
  writeFileSync(request, JSON.stringify({ classes: Object.keys(extension.classes), functions: Object.keys(extension.functions), constants: Object.keys(extension.constants) }));
  try {
    const own: Declarations = { classes: {}, functions: {}, constants: {} };
    for (const folder of names.libraries) {
      const autoloader = packageVendorFile(root, folder, 'autoload.php');
      if (!autoloader) throw new Stop(`${folder} has no Composer autoloader, which the declarations of the library are read through: run composer install in ${folder}, or in the project that requires it`);
      const found = declarationsOf(run(php, [script, 'library', path.join(root, autoloader), request]));
      for (const kind of ['classes', 'functions', 'constants'] as const) {
        for (const [name, declared] of Object.entries(found[kind])) if (declared !== null && declared !== undefined) own[kind][name] = declared;
      }
    }
    return declarationFindings(extension, own, internalClassesOfStub(readFileSync(path.join(root, names.stub), 'utf8')));
  } finally {
    rmSync(request, { force: true });
  }
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const command = process.argv[2] ?? '';
  const files = extensionFiles(root);
  const present = files.some(file => file.startsWith(`${EXTENSION}/`));
  try {
    if (!['check', 'build', 'arginfo', 'test'].includes(command)) throw new Stop('usage: php-extension.mts check | build | arginfo | test');
    if (!present && command !== 'arginfo') {
      console.log(`[php-extension] the repository has no PHP extension: ${EXTENSION} holds no file`);
    } else if (command === 'check') {
      const found = extensionFindings(files, reader(root));
      if (found.length) throw new Stop(found.join('\n'));
      console.log('[php-extension] the names, the stub and the arginfo header of the extension match');
    } else if (command === 'build') {
      build(root, buildOptions(process.argv.slice(3)));
    } else if (command === 'arginfo') {
      arginfo(root);
    } else {
      const found = declarations(root);
      if (found.length) throw new Stop(`the extension differs from the PHP library:\n${found.join('\n')}`);
      console.log('[php-extension] the extension registers the classes and functions of the PHP library as it declares them');
      const tests = spawnSync(process.execPath, [siblingTool(import.meta.url, 'runtime-targets'), 'php-ext'], { cwd: root, stdio: 'inherit' });
      if (tests.status !== 0) process.exit(1);
    }
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    for (const line of error.message.split('\n')) console.error(`[php-extension] ${line}`);
    process.exit(1);
  }
}
