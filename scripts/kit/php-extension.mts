#!/usr/bin/env node
// The PHP extension of a repository (S10): one model and one build for every repository.
//
//   node scripts/kit/php-extension.mts check          the names, the one stub and the stub hash of the arginfo header
//   node scripts/kit/php-extension.mts build          the check, then phpize, configure and make in var/php-ext, the library
//                                                     published to var/php-ext/<extension>.so by a rename
//   node scripts/kit/php-extension.mts arginfo        the arginfo header written by the rule of phpize, which runs the
//                                                     gen_stub.php of the PHP; gen_stub downloads its PHP-Parser once; ONLINE
//   node scripts/kit/php-extension.mts test           the classes and functions that the built extension registers, compared
//                                                     by Reflection with those of the PHP library (symbols/php/reflection.php),
//                                                     then the unit tests of runtime-targets.mts with the extension loaded
//
// In a repository without packages/php-ext, check, build and test say so and pass: every repository runs them in its CI.
// The PHP library is packages/php, named polyspec/<repository>; the extension lies in packages/php-ext with its sources in src/,
// is named polyspec/<repository>-php-ext and polyspec_<repository> (a hyphen an underscore), and has one stub,
// src/polyspec_<repository>.stub.php. phpize, php-config and php are those on PATH, the PHP of .php-version.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { packageVendorFile } from './composer-vendor.mts';
import { isJsonObject } from './bootstrap/files.mts';
import { SYMBOLS } from './install-symbols.mts';
import { spawnSync } from 'node:child_process';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';
import { run, Stop } from './process.mts';
import { trackedFiles } from './tracked-files.mts';

export const LIBRARY = 'packages/php';
export const EXTENSION = 'packages/php-ext';
const OUTPUT = 'var/php-ext';

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

/**
 * The repository name of the PHP library, `polyspec/<repository>` in packages/php/composer.json, or a finding; `read` gives
 * the text of a tracked file or undefined.
 */
export function repositoryOf(read: (file: string) => string | undefined): { repository: string } | { finding: string } {
  const name = composerName(read(`${LIBRARY}/composer.json`));
  const match = name === undefined ? null : /^polyspec\/([a-z0-9][a-z0-9-]*)$/.exec(name);
  if (!match) return { finding: `${LIBRARY}/composer.json: the PHP library, whose classes the extension registers, is named polyspec/<repository>, not ${name ?? 'nothing'}` };
  return { repository: match[1] ?? '' };
}

/** The findings of the extension among the tracked `files`; none when the repository has no packages/php-ext. */
export function extensionFindings(files: readonly string[], read: (file: string) => string | undefined): string[] {
  if (!files.some(file => file.startsWith(`${EXTENSION}/`))) return [];
  const owner = repositoryOf(read);
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
  const recorded = header === undefined ? undefined : /\* Stub hash: ([0-9a-f]+) \*/.exec(header)?.[1];
  if (recorded !== stubHash(stub)) found.push(`${names.arginfo}: the stub hash is ${recorded ?? 'missing'}, the stub's is ${stubHash(stub)}. Fix: make php-ext-arginfo`);
  return found;
}

/** A declaration that Reflection reads: a class or a function, a JSON value. */
export type Declarations = { classes: Record<string, unknown>; functions: Record<string, unknown> };

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
  if (!isJsonObject(value) || !isJsonObject(value.classes) || !isJsonObject(value.functions)) throw new Stop(`reflection.php printed no declarations: ${text.slice(0, 200)}`);
  return { classes: value.classes, functions: value.functions };
}

/** The findings of the declarations of the extension against those that the library gives for the same names (S10). */
export function declarationFindings(extension: Declarations, library: Declarations): string[] {
  const of = (kind: 'classes' | 'functions', label: string) => Object.entries(extension[kind]).flatMap(([name, declared]) => {
    const own = library[kind][name];
    if (own === null || own === undefined) return [`${label} ${name}: the extension registers it, and the PHP library declares none`];
    return differences(`${label} ${name}`, declared, own);
  });
  return [...of('classes', 'class'), ...of('functions', 'function')];
}

/** The text of the tracked file `file` of `root`, or undefined when it is not tracked. */
const reader = (root: string, files: readonly string[]) => (file: string) => (files.includes(file) ? readFileSync(path.join(root, file), 'utf8') : undefined);

/** The names of the extension of `root`, after its check; throws with the findings. */
function checked(root: string): ReturnType<typeof extensionNames> {
  const files = trackedFiles(root);
  if (!files.some(file => file.startsWith(`${EXTENSION}/`))) throw new Stop(`${EXTENSION} holds no tracked file; the repository has no PHP extension`);
  const found = extensionFindings(files, reader(root, files));
  if (found.length) throw new Stop(found.join('\n'));
  const owner = repositoryOf(reader(root, files));
  if ('finding' in owner) throw new Stop(owner.finding);
  return extensionNames(owner.repository);
}

/**
 * A copy of the package of the extension in a new directory under var/php-ext: its composer.json beside src/, as in the package,
 * so that config.m4 reads the version of the package from ../composer.json (K295). src/ is prepared by phpize; returns the
 * copy (`work`, to remove) and its src/ (`source`, where the build runs).
 */
function phpized(root: string, label: string): { work: string; source: string } {
  const work = path.join(root, OUTPUT, `${label}.${process.pid}`);
  const source = path.join(work, 'src');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  cpSync(path.join(root, EXTENSION, 'composer.json'), path.join(work, 'composer.json'));
  cpSync(path.join(root, EXTENSION, 'src'), source, { recursive: true });
  console.log(`[php-extension] phpize (${run('php-config', ['--version']).trim()})`);
  run('phpize', [], { cwd: source });
  return { work, source };
}

/** Builds the extension of `root` into var/php-ext/<extension>.so; returns its path. */
export function build(root: string): string {
  const names = checked(root);
  const { work, source } = phpized(root, 'build');
  try {
    // The copy gives every file a new time, so make could find the stub newer than its header and run gen_stub.php, which
    // downloads; the check above proved the header current, so it is given the time of the stub.
    const stub = statSync(path.join(source, path.basename(names.stub)));
    utimesSync(path.join(source, path.basename(names.arginfo)), stub.atime, stub.mtime);
    console.log('[php-extension] configure');
    run('./configure', [`--enable-${names.extension.replaceAll('_', '-')}`], { cwd: source });
    console.log('[php-extension] make');
    const made = run('make', [], { cwd: source });
    const warnings = made.split('\n').filter(line => /\.[ch]:\d+:\d+: warning:/.test(line));
    if (warnings.length) throw new Stop(`the build of ${names.extension} has compiler warnings:\n${warnings.join('\n')}`);
    const library = path.join(root, OUTPUT, `${names.extension}.so`);
    renameSync(path.join(source, 'modules', `${names.extension}.so`), library);
    console.log(`[php-extension] built ${path.relative(root, library)}`);
    return library;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Writes the arginfo header of the extension of `root` with the rule of phpize, which runs gen_stub.php. */
export function arginfo(root: string): void {
  const files = trackedFiles(root);
  const owner = repositoryOf(reader(root, files));
  if ('finding' in owner) throw new Stop(owner.finding);
  const names = extensionNames(owner.repository);
  const { work, source } = phpized(root, 'arginfo');
  try {
    const header = path.basename(names.arginfo);
    // The rule of the header lies in the Makefile that ./configure writes, so configure runs first.
    run('./configure', [`--enable-${names.extension.replaceAll('_', '-')}`], { cwd: source });
    rmSync(path.join(source, header), { force: true });
    run('make', [header], { cwd: source });
    writeFileSync(path.join(root, names.arginfo), readFileSync(path.join(source, header)));
    console.log(`[php-extension] wrote ${names.arginfo}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The findings of the declarations of the built extension of `root` against the PHP library. */
export function declarations(root: string): string[] {
  const names = checked(root);
  const library = path.join(root, OUTPUT, `${names.extension}.so`);
  if (!existsSync(library)) throw new Stop(`${path.relative(root, library)} is missing. Fix: make build-php-ext`);
  const autoloader = packageVendorFile(root, LIBRARY, 'autoload.php');
  if (!autoloader) throw new Stop(`${LIBRARY} has no Composer autoloader, which the declarations of the library are read through: run composer install in ${LIBRARY}, or in the project that requires it`);
  const script = path.join(SYMBOLS, 'php', 'reflection.php');
  const extension = declarationsOf(run('php', ['-d', `extension=${library}`, script, 'extension', names.extension]));
  const request = path.join(root, OUTPUT, `names.${process.pid}.json`);
  writeFileSync(request, JSON.stringify({ classes: Object.keys(extension.classes), functions: Object.keys(extension.functions) }));
  try {
    const own = declarationsOf(run('php', [script, 'library', path.join(root, autoloader), request]));
    return declarationFindings(extension, own);
  } finally {
    rmSync(request, { force: true });
  }
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const command = process.argv[2] ?? '';
  const files = trackedFiles(root);
  const present = files.some(file => file.startsWith(`${EXTENSION}/`));
  try {
    if (!['check', 'build', 'arginfo', 'test'].includes(command)) throw new Stop('usage: php-extension.mts check | build | arginfo | test');
    if (!present && command !== 'arginfo') {
      console.log(`[php-extension] the repository has no PHP extension: ${EXTENSION} holds no tracked file`);
    } else if (command === 'check') {
      const found = extensionFindings(files, reader(root, files));
      if (found.length) throw new Stop(found.join('\n'));
      console.log('[php-extension] the names, the stub and the arginfo header of the extension match');
    } else if (command === 'build') {
      build(root);
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
