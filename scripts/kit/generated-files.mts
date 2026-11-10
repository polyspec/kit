#!/usr/bin/env node
// The generated-file check of AGENTS.md "Generated files": a staged path that a glob of the paths of config/generated.json matches
// is refused, naming the path, unless an exception of the config allows it; the repository declares its generated folders there,
// such as **/node_modules/** (K1105). A staged file whose content starts with the header of an executable object of a kind that
// the caller names with --binary (ELF, Mach-O or PE, K416) is refused the same way, whatever its path. A call that names no kind
// and finds no declared path, so that it checks nothing, is a usage error (exit 2). A repository's own pre-commit hook may run
// `staged`.
//
//   node scripts/kit/generated-files.mts staged [--binary <kind>]...
//                                                 fail while a staged path is generated or an executable object of a named kind, and
//                                                 no exception of the config allows it
//   node scripts/kit/generated-files.mts installs <directory> | <manifest>=<directory>...
//                                                 fail while an install directory that the arguments declare is not ignored by Git (K372,
//                                                 K1083): a bare directory of the root, such as var, or the directory beside each tracked
//                                                 <manifest>, such as package.json=node_modules; the vendor-dir of a composer.json counts
//   node scripts/kit/generated-files.mts tracked [--binary <kind>]...
//                                                 fail while a tracked file is generated, an executable object of a named kind (K416) or a text file
//                                                 whose first comment line among its first 5 lines matches a pattern of the headers of
//                                                 the config, unless the config allows it (K426, K1105); `make layout-check` runs it
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { matchesAny } from './glob.mts';
import { readConfigFindings } from './schema-validate.mts';
import { trackedFiles } from './tracked-files.mts';

export const CONFIG = 'config/generated.json';

/** config/generated.json as generated.schema.json describes it. */
export interface GeneratedConfig {
  paths: string[];
  exceptions: { path: string; reason?: string }[];
  tracked?: { path: string; reason?: string }[];
  headers?: string[];
  moduleFiles?: string[];
}

/** The globs of the exceptions of `config`, each with its reason (K958). */
const excepted = (config: Pick<GeneratedConfig, 'exceptions'>) => config.exceptions.map(item => item.path);

/** The kinds of executable object that executableFormat tells apart, which --binary names (K1105). */
export const BINARY_KINDS = ['ELF', 'Mach-O', 'PE'] as const;

// A Mach-O fat file holds up to this many architectures; a Java class file starts with CAFEBABE too, but its next word is a
// version (major 45 and up), so a count above this bound is a class file (K416).
const FAT_MAX_ARCHITECTURES = 30;

// The largest staged blob that is read, as in process.mts (K416).
const MAX_BLOB = 256 * 1024 * 1024;

const MACH_O: Record<string, string> = { feedface: 'Mach-O 32-bit', cefaedfe: 'Mach-O 32-bit', feedfacf: 'Mach-O 64-bit', cffaedfe: 'Mach-O 64-bit' };

/** The format of the executable object whose header `bytes` starts with (ELF, Mach-O thin or fat, PE), or undefined (K416). */
export function executableFormat(bytes: Buffer): string | undefined {
  const head = bytes.subarray(0, 4).toString('hex');
  if (head === '7f454c46') return 'ELF';
  if (head in MACH_O) return MACH_O[head];
  if (head === 'cafebabe' && bytes.length >= 8 && bytes.readUInt32BE(4) >= 1 && bytes.readUInt32BE(4) <= FAT_MAX_ARCHITECTURES) return 'Mach-O fat';
  // A PE file starts with MZ; the word at 0x3C is the offset of its header, which starts with PE and two zero bytes.
  if (head.startsWith('4d5a') && bytes.length >= 0x40) {
    const offset = bytes.readUInt32LE(0x3c);
    if (offset + 4 <= bytes.length && bytes.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) return 'PE';
  }
  return undefined;
}

/**
 * The content of the file `file` of `root` at `rev`: the index for `rev` ':' (a staged file), a commit otherwise; undefined for an
 * entry that is no blob, such as a submodule (K416).
 */
export function blobContent(root: string, rev: string, file: string): Buffer | undefined {
  const run = spawnSync('git', ['cat-file', 'blob', `${rev === ':' ? '' : rev}:${file}`], { cwd: root, maxBuffer: MAX_BLOB });
  if (run.error) throw run.error;
  if (run.status === 0) return run.stdout;
  // A gitlink, as a submodule, is the one entry that is no blob; any other failure of git is an error (K1156).
  const listed = rev === ':' ? gitResult(root, 'ls-files', '--stage', '--', file) : gitResult(root, 'ls-tree', rev, '--', file);
  if (listed.status === 0 && listed.stdout.startsWith('160000 ')) return undefined;
  throw new Error(`git cat-file blob ${rev === ':' ? '' : rev}:${file} exited with ${run.status}: ${run.stderr.toString().trim()}`);
}

/**
 * The paths of `files` whose content, as `read` gives it, is an executable object of one of the `kinds` (K416, K1105) and that no
 * glob of `config.exceptions` allows, with the format.
 */
export function executableOffenders(files: string[], config: Pick<GeneratedConfig, 'exceptions'>, read: (file: string) => Buffer | undefined, kinds: readonly string[]) {
  if (kinds.length === 0) return [];
  return files.flatMap(file => {
    const content = read(file);
    const format = content === undefined ? undefined : executableFormat(content);
    return format !== undefined && kinds.includes(format.split(' ')[0] ?? '') && !matchesAny(excepted(config), file) ? [{ file, format }] : [];
  });
}

/** The paths that a glob of `config.paths` declares generated (K1105) and that no glob of `config.exceptions` allows, in the order given. */
export function generatedOffenders(paths: string[], config: Pick<GeneratedConfig, 'paths' | 'exceptions' | 'tracked'>) {
  const tracked = (config.tracked ?? []).map(item => item.path);
  return paths.filter(file => matchesAny(config.paths, file) && !matchesAny(excepted(config), file) && !matchesAny(tracked, file));
}

/**
 * The generated-file findings of the `changed` paths of a side of a change (K351) against `config` of that side, as lines; `fix`
 * says how the side refuses the path, and `read` gives the content of a changed file, which an executable object of one of the
 * `kinds` fails whatever its path (K416, K1105).
 */
export function generatedFindings(changed: string[], config: GeneratedConfig, fix: string, read: (file: string) => Buffer | undefined, kinds: readonly string[]): string[] {
  return [
    ...generatedOffenders(changed, config).map(file => `${file} is a generated file (AGENTS.md "Generated files"); ${fix}, or declare it in ${CONFIG}`),
    ...executableOffenders(changed, config, read, kinds).map(({ file, format }) => `${file} is an executable object (${format}), whatever its path; ${fix}, or declare it an exception in ${CONFIG}`),
  ];
}

// The tracked check reads at most this many bytes of a file: an executable header and a generated-file header both lie within them
// A file whose head holds a NUL byte is binary, so it is never read for a generated-file header.
const HEAD_BYTES = 64 * 1024;
const HEADER_LINES = 5;
const COMMENT = /^\s*(#|\/\/|\/\*|--|;|%|<!--)/;

/** The first bytes of the file `file` of `root`, at most HEAD_BYTES; none for a symbolic link or a file that the work tree lacks. */
function readHead(root: string, file: string): Buffer {
  const stat = lstatSync(path.join(root, file), { throwIfNoEntry: false });
  if (!stat?.isFile()) return Buffer.alloc(0);
  const fd = openSync(path.join(root, file), 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    return buffer.subarray(0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Whether the file whose first bytes are `head` has a generated-file header: its first comment line among the first five lines, a
 * shebang left out, matches one of the `headers` that config/generated.json declares (K1105), and it is text.
 */
function hasGeneratedHeader(head: Buffer, headers: readonly RegExp[]): boolean {
  if (headers.length === 0 || head.includes(0)) return false;
  const first = head.toString('utf8').split('\n', HEADER_LINES).find(line => COMMENT.test(line) && !line.startsWith('#!'));
  return first !== undefined && headers.some(header => header.test(first));
}

/**
 * The findings of the tracked files of `root`: each tracked path that a generated glob matches, each one whose first bytes are an
 * executable object of one of the `kinds` (K416, K1105) and each text file with a generated-file header, that no glob of `config.exceptions` allows, each naming the path.
 */
export function trackedFindings(root: string, config: GeneratedConfig, kinds: readonly string[]): string[] {
  const files = trackedFiles(root);
  const headers = (config.headers ?? []).map(header => new RegExp(header));
  const heads = new Map<string, Buffer>();
  const head = (file: string): Buffer => {
    const known = heads.get(file);
    if (known) return known;
    const read = readHead(root, file);
    heads.set(file, read);
    return read;
  };
  return [
    ...trackedRuleFindings(root, config),
    ...generatedOffenders(files, config).map(file => `${file} is a generated file (AGENTS.md "Generated files"); untrack it, or declare it in ${CONFIG}`),
    ...executableOffenders(files, config, head, kinds).map(({ file, format }) => `${file} is an executable object (${format}), whatever its path; untrack it, or declare it an exception in ${CONFIG}`),
    ...files.filter(file => !matchesAny(excepted(config), file) && !matchesAny((config.tracked ?? []).map(item => item.path), file) && hasGeneratedHeader(head(file), headers)).map(file => `${file} has a generated-file header of ${CONFIG}; untrack it, or declare it an exception in ${CONFIG}`),
  ];
}

/** The directory of a glob: the literal path before its first glob character, without the last segment; '' for the root. */
function globDirectory(glob: string): string {
  const literal = glob.split(/[*?[{]/)[0] ?? '';
  return literal.includes('/') ? literal.slice(0, literal.lastIndexOf('/')) : '';
}

/**
 * The findings of the tracked entries of config/generated.json (P34): a tracked generated source is a tagged tree that consumers
 * install, so the directory of each entry, or one of its parents, holds a module file that the moduleFiles of the config name, such
 * as go.mod, and that Git tracks (K1105). A config that names no module file has none to find.
 */
export function trackedRuleFindings(root: string, config: GeneratedConfig): string[] {
  const moduleFiles = config.moduleFiles ?? [];
  if (moduleFiles.length === 0) return [];
  const files = new Set(trackedFiles(root));
  return (config.tracked ?? []).flatMap(({ path: glob }) => {
    const parts = globDirectory(glob).split('/').filter(Boolean);
    const holders = ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))];
    const accepted = holders.some(dir => moduleFiles.some(name => files.has(dir === '' ? name : `${dir}/${name}`)));
    return accepted ? [] : [`${CONFIG}: tracked ${glob} is not under a directory that holds ${moduleFiles.join(' or ')}; a tracked generated source is a tagged tree that consumers install (P34)`];
  });
}

/** The configuration of the checkout `root`, or no path and no exception when it declares none (K1073); throws with every finding when it breaks the schema. */
export function loadGeneratedConfig(root: string): GeneratedConfig {
  if (!existsSync(path.join(root, CONFIG))) return { paths: [], exceptions: [] };
  const { value, errors } = readConfigFindings<GeneratedConfig>(root, CONFIG, 'generated.schema.json');
  if (errors) throw new Error(errors.join('\n'));
  return value;
}

/** The staged paths of the checkout `root` that are added, copied, modified or renamed. */
export function stagedPaths(root: string) {
  const run = gitResult(root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z');
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`git diff --cached failed in ${root}: ${run.stderr.trim()}`);
  return run.stdout.split('\0').filter(Boolean);
}

/**
 * The install directories that the arguments `declared` name, each with the folder of the .gitignore that ignores it (K372, K1083):
 * a bare directory such as `var` is a directory of the root, and `<manifest>=<directory>` is the directory beside each tracked file
 * named <manifest>, such as `package.json=node_modules`. Beside a composer.json it is the vendor-dir of that composer.json when it
 * sets one (Composer's own rule, as composer-vendor.mts reads it). An entry of another form throws.
 */
export function installDirectories(root: string, declared: readonly string[]): { directory: string; folder: string }[] {
  const found: { directory: string; folder: string }[] = [];
  const pairs = declared.flatMap((entry) => {
    const [manifest, directory, ...more] = entry.split('=');
    if (directory === undefined && manifest) {
      found.push({ directory: entry, folder: '.' });
      return [];
    }
    if (!manifest || !directory || more.length > 0) throw new Error(`generated-files installs: ${JSON.stringify(entry)} is neither <directory> nor <manifest>=<directory>`);
    return [{ manifest, directory }];
  });
  if (pairs.length === 0) return found;
  for (const file of trackedFiles(root)) {
    const folder = path.posix.dirname(file);
    const name = path.posix.basename(file);
    for (const { directory: declaredDirectory } of pairs.filter(pair => pair.manifest === name)) {
      let directory = path.posix.join(folder, declaredDirectory);
      if (name === 'composer.json') {
        const { config } = readJsonObject(root, file);
        const vendorDir = isJsonObject(config) ? config['vendor-dir'] : undefined;
        if (typeof vendorDir === 'string') directory = path.posix.normalize(path.posix.join(folder, vendorDir));
      }
      if (directory !== '.' && directory !== '..' && !directory.startsWith('../')) found.push({ directory, folder });
    }
  }
  return found;
}

/** Whether `entry` is a declaration of installs (K1083): a directory, or <manifest>=<directory> with both parts and one `=`. */
export const isInstallDeclaration = (entry: string): boolean => /^[^=]+(?:=[^=]+)?$/.test(entry);

/**
 * The install directories that `declared` names in `root` that Git does not ignore, as lines naming the directory and the .gitignore
 * to change (K372). `git check-ignore` takes the directory with its trailing slash, so a directory-only pattern such as vendor/
 * matches it whether or not it exists. A symlink, such as a worktree's link to the install of main, is a file to Git: it is checked
 * without the slash, which a pattern such as vendor matches and vendor/ does not (K814).
 */
export function installFindings(root: string, declared: readonly string[]): string[] {
  return installDirectories(root, declared).flatMap(({ directory, folder }) => {
    const entry = lstatSync(path.join(root, directory), { throwIfNoEntry: false })?.isSymbolicLink() ? directory : `${directory}/`;
    const run = gitResult(root, 'check-ignore', '-q', entry);
    if (run.error) throw run.error;
    if (run.status === 0) return [];
    if (run.status !== 1) throw new Error(`git check-ignore failed in ${root}: ${run.stderr.trim()}`);
    const gitignore = folder === '.' ? '.gitignore' : `${folder}/.gitignore`;
    return [`${entry} is not ignored by Git (K372); add ${entry} to ${gitignore}`];
  });
}

/** The kinds that the arguments `args` name with --binary (K1105); undefined when an argument is anything else. */
export function binaryKinds(args: readonly string[]): string[] | undefined {
  const kinds: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const kind = args[index + 1];
    if (args[index] !== '--binary' || kind === undefined || !(BINARY_KINDS as readonly string[]).includes(kind)) return undefined;
    kinds.push(kind);
  }
  return kinds;
}

if (isMain(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  const kinds = mode === 'installs' ? [] : binaryKinds(rest);
  // installs checks what the caller declares, so a call that declares nothing, or an entry of another form, is a usage error (K1083).
  const usage = mode === 'installs' ? rest.length === 0 || !rest.every(isInstallDeclaration) : (mode !== 'staged' && mode !== 'tracked') || kinds === undefined;
  // staged and tracked check the kinds that the caller names and what config/generated.json declares: its paths, its tracked
  // entries together with module files (the check of either alone has nothing to find), and for tracked its headers. A call
  // that has none of them checks nothing, so it is a usage error too (K1105).
  const config = usage || mode === 'installs' ? undefined : loadGeneratedConfig(repositoryRoot());
  const declared = config !== undefined && (config.paths.length > 0 || ((config.tracked ?? []).length > 0 && (config.moduleFiles ?? []).length > 0) || (mode === 'tracked' && (config.headers ?? []).length > 0));
  const empty = config !== undefined && kinds?.length === 0 && !declared;
  if (usage || kinds === undefined || empty) {
    if (empty) console.error(`generated-files ${mode} checks nothing: name a kind with --binary, or declare paths, tracked entries with moduleFiles${mode === 'tracked' ? ' or headers' : ''} in ${CONFIG}`);
    console.error(`Usage: node scripts/kit/generated-files.mts staged|tracked [--binary ${BINARY_KINDS.join('|')}]..., or installs <directory> | <manifest>=<directory>...`);
    process.exitCode = 2;
  } else if (mode === 'tracked' && config) {
    const root = repositoryRoot();
    const found = trackedFindings(root, config, kinds);
    for (const line of found) console.error(`[generated-files] ${line}`);
    if (found.length > 0) process.exitCode = 1;
    else console.log('[generated-files] no tracked file is generated');
  } else if (mode === 'installs') {
    const found = installFindings(repositoryRoot(), rest);
    for (const line of found) console.error(`[generated-files] ${line}`);
    if (found.length > 0) process.exitCode = 1;
    else console.log('[generated-files] every declared install directory is ignored by Git');
  } else if (config) {
    const root = repositoryRoot();
    const found = [...trackedRuleFindings(root, config), ...generatedFindings(stagedPaths(root), config, 'unstage it', file => blobContent(root, ':', file), kinds)];
    for (const line of found) console.error(`[generated-files] ${line}`);
    if (found.length > 0) process.exitCode = 1;
    else console.log('[generated-files] no generated file is staged');
  }
}
