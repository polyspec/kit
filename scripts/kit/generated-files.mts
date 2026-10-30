#!/usr/bin/env node
// The generated-file check of AGENTS.md "Generated files": a staged path with a generated segment (node_modules, vendor, .venv,
// venv, __pycache__, target, dist or *.egg-info) is refused, naming the path, unless config/generated.json declares it an
// exception. A staged file whose content starts with the header of an executable object (ELF, Mach-O or PE, K416) is refused
// the same way, whatever its path. The pre-commit hook that `git-hooks install` writes runs `staged` through `make staged-generated-hook`.
//
//   node scripts/kit/generated-files.mts staged   fail while a staged path is generated or an executable object, and no exception of
//                                                 the config allows it
//   node scripts/kit/generated-files.mts installs fail while an install directory of the checkout is not ignored by Git (K372): node_modules
//                                                 beside each package.json, the vendor directory of each composer.json, .venv beside each
//                                                 pyproject.toml and var at the root; `make layout-check` runs it
//   node scripts/kit/generated-files.mts tracked  fail while a tracked file is generated, an executable object (K416) or a text file
//                                                 whose first comment line among its first 5 lines is a generated-file header
//                                                 (Code generated ... DO NOT EDIT), unless the config allows it (K426); `make layout-check` runs it
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
export const GENERATED_SEGMENTS = ['node_modules', 'vendor', '.venv', 'venv', '__pycache__', 'target', 'dist'];

/** config/generated.json as generated.schema.json describes it. */
export interface GeneratedConfig {
  schema: 1;
  paths: string[];
  exceptions: string[];
  tracked?: { path: string; reason: string }[];
}

const isGeneratedSegment = (segment: string) => GENERATED_SEGMENTS.includes(segment) || segment.endsWith('.egg-info');

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
  return run.status === 0 ? run.stdout : undefined;
}

/** The paths of `files` whose content, as `read` gives it, is an executable object (K416) and that no glob of `config.exceptions` allows, with the format. */
export function executableOffenders(files: string[], config: Pick<GeneratedConfig, 'exceptions'>, read: (file: string) => Buffer | undefined) {
  return files.flatMap(file => {
    const content = read(file);
    const format = content === undefined ? undefined : executableFormat(content);
    return format !== undefined && !matchesAny(config.exceptions, file) ? [{ file, format }] : [];
  });
}

/** The paths that are generated (a segment of GENERATED_SEGMENTS, or a glob of `config.paths`) and that no glob of `config.exceptions` allows, in the order given. */
export function generatedOffenders(paths: string[], config: Pick<GeneratedConfig, 'paths' | 'exceptions' | 'tracked'>) {
  const tracked = (config.tracked ?? []).map(item => item.path);
  return paths.filter(file => (file.split('/').some(isGeneratedSegment) || matchesAny(config.paths, file)) && !matchesAny(config.exceptions, file) && !matchesAny(tracked, file));
}

/**
 * The generated-file findings of the `changed` paths of a side of a change (K351) against `config` of that side, as lines; `fix`
 * says how the side refuses the path, and `read` gives the content of a changed file, which an executable object fails whatever
 * its path (K416). The staged check and the commit check of check-commits.mts read the same rule.
 */
export function generatedFindings(changed: string[], config: GeneratedConfig, fix: string, read: (file: string) => Buffer | undefined): string[] {
  return [
    ...generatedOffenders(changed, config).map(file => `${file} is a generated file (AGENTS.md "Generated files"); ${fix}, or declare it in ${CONFIG}`),
    ...executableOffenders(changed, config, read).map(({ file, format }) => `${file} is an executable object (${format}), whatever its path; ${fix}, or declare it an exception in ${CONFIG}`),
  ];
}

// The tracked check reads at most this many bytes of a file: an executable header and a generated-file header both lie within them
// A file whose head holds a NUL byte is binary, so it is never read for a generated-file header.
const HEAD_BYTES = 64 * 1024;
const HEADER_LINES = 5;
const COMMENT = /^\s*(#|\/\/|\/\*|--|;|%|<!--)/;
const GENERATED_HEADER = /Code generated .* DO NOT EDIT/;

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
 * shebang left out, matches it, and it is text.
 */
function hasGeneratedHeader(head: Buffer): boolean {
  if (head.includes(0)) return false;
  const first = head.toString('utf8').split('\n', HEADER_LINES).find(line => COMMENT.test(line) && !line.startsWith('#!'));
  return first !== undefined && GENERATED_HEADER.test(first);
}

/**
 * The findings of the tracked files of `root`: each tracked path with a generated segment or glob, each one whose first bytes are an
 * executable object (K416) and each text file with a generated-file header, that no glob of `config.exceptions` allows, each naming the path.
 */
export function trackedFindings(root: string, config: GeneratedConfig): string[] {
  const files = trackedFiles(root);
  const heads = new Map<string, Buffer>();
  const head = (file: string): Buffer => {
    const known = heads.get(file);
    if (known) return known;
    const read = readHead(root, file);
    heads.set(file, read);
    return read;
  };
  return [
    ...generatedOffenders(files, config).map(file => `${file} is a generated file (AGENTS.md "Generated files"); untrack it, or declare it in ${CONFIG}`),
    ...executableOffenders(files, config, head).map(({ file, format }) => `${file} is an executable object (${format}), whatever its path; untrack it, or declare it an exception in ${CONFIG}`),
    ...files.filter(file => !matchesAny(config.exceptions, file) && hasGeneratedHeader(head(file))).map(file => `${file} has a generated-file header (Code generated ... DO NOT EDIT); untrack it, or declare it an exception in ${CONFIG}`),
  ];
}

/** The configuration of the checkout `root`; throws with every finding when it breaks the schema, and when it is missing. */
export function loadGeneratedConfig(root: string): GeneratedConfig {
  if (!existsSync(path.join(root, CONFIG))) throw new Error(`${CONFIG} does not exist in ${root}; the repository declares its generated-file exceptions there`);
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

/** The install directories of the checkout `root` and the folder of the manifest that makes each one (K372); the root's var is always one. */
export function installDirectories(root: string): { directory: string; folder: string }[] {
  const found = [{ directory: 'var', folder: '.' }];
  for (const file of trackedFiles(root)) {
    const folder = path.posix.dirname(file);
    const name = path.posix.basename(file);
    if (name === 'package.json') found.push({ directory: path.posix.join(folder, 'node_modules'), folder });
    if (name === 'pyproject.toml') found.push({ directory: path.posix.join(folder, '.venv'), folder });
    // A Composer project keeps its packages in the vendor-dir of its composer.json, which defaults to vendor (Composer's own rule, as
    // composer-vendor.mts reads it); a Go vendor folder is a committed source, so only a composer.json makes one of these.
    if (name === 'composer.json') {
      const { config } = readJsonObject(root, file);
      const vendorDir = isJsonObject(config) ? config['vendor-dir'] : undefined;
      const directory = path.posix.normalize(path.posix.join(folder, typeof vendorDir === 'string' ? vendorDir : 'vendor'));
      if (directory !== '.' && directory !== '..' && !directory.startsWith('../')) found.push({ directory, folder });
    }
  }
  return found;
}

/**
 * The install directories of `root` that Git does not ignore, as lines naming the directory and the .gitignore to change (K372).
 * `git check-ignore` takes the directory with its trailing slash, so a directory-only pattern such as vendor/ matches it whether or
 * not it exists. A symlink, such as a worktree's link to the install of main, is a file to Git: it is checked without the slash, which
 * a pattern such as vendor matches and vendor/ does not (K814).
 */
export function installFindings(root: string): string[] {
  return installDirectories(root).flatMap(({ directory, folder }) => {
    const entry = lstatSync(path.join(root, directory), { throwIfNoEntry: false })?.isSymbolicLink() ? directory : `${directory}/`;
    const run = gitResult(root, 'check-ignore', '-q', entry);
    if (run.error) throw run.error;
    if (run.status === 0) return [];
    if (run.status !== 1) throw new Error(`git check-ignore failed in ${root}: ${run.stderr.trim()}`);
    const gitignore = folder === '.' ? '.gitignore' : `${folder}/.gitignore`;
    return [`${entry} is not ignored by Git (K372); add ${entry} to ${gitignore}`];
  });
}

if (isMain(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  if ((mode !== 'staged' && mode !== 'installs' && mode !== 'tracked') || rest.length > 0) {
    console.error('Usage: node scripts/kit/generated-files.mts staged|installs|tracked');
    process.exitCode = 2;
  } else if (mode === 'tracked') {
    const root = repositoryRoot();
    const found = trackedFindings(root, loadGeneratedConfig(root));
    for (const line of found) console.error(`[generated-files] ${line}`);
    if (found.length > 0) process.exitCode = 1;
    else console.log('[generated-files] no tracked file is generated');
  } else if (mode === 'installs') {
    const found = installFindings(repositoryRoot());
    for (const line of found) console.error(`[generated-files] ${line}`);
    if (found.length > 0) process.exitCode = 1;
    else console.log('[generated-files] every install directory is ignored by Git');
  } else {
    const root = repositoryRoot();
    const found = [...generatedFindings(stagedPaths(root), loadGeneratedConfig(root), 'unstage it', file => blobContent(root, ':', file))];
    for (const line of found) console.error(`[generated-files] ${line}`);
    if (found.length > 0) process.exitCode = 1;
    else console.log('[generated-files] no generated file is staged');
  }
}
