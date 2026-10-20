#!/usr/bin/env node
// The generated-file check of AGENTS.md "Generated files": a staged path with a generated segment (node_modules, vendor, .venv,
// venv, __pycache__, target, dist or *.egg-info) is refused, naming the path, unless config/generated.json declares it an
// exception. A staged file whose content starts with the header of an executable object (ELF, Mach-O or PE, K416) is refused
// the same way, whatever its path. The pre-commit hook that `git-hooks install` writes runs `staged` through `make staged-generated-hook`.
//
//   node scripts/kit/generated-files.mts staged   fail while a staged path is generated or an executable object, and no exception of
//                                                 the config allows it, or a staged Korean twin holds a stale source-sha256 (K382)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { matchesAny } from './glob.mts';
import { readConfigFindings } from './schema-validate.mts';
import { stagedTwinFindings } from './check-documents.mts';

export const CONFIG = 'config/generated.json';
export const GENERATED_SEGMENTS = ['node_modules', 'vendor', '.venv', 'venv', '__pycache__', 'target', 'dist'];

/** config/generated.json as generated.schema.json describes it. */
export interface GeneratedConfig {
  schema: 1;
  paths: string[];
  exceptions: string[];
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
export function generatedOffenders(paths: string[], config: Pick<GeneratedConfig, 'paths' | 'exceptions'>) {
  return paths.filter(file => (file.split('/').some(isGeneratedSegment) || matchesAny(config.paths, file)) && !matchesAny(config.exceptions, file));
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

if (isMain(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== 'staged' || rest.length > 0) {
    console.error('Usage: node scripts/kit/generated-files.mts staged');
    process.exitCode = 2;
  } else {
    const root = repositoryRoot();
    const found = [...generatedFindings(stagedPaths(root), loadGeneratedConfig(root), 'unstage it', file => blobContent(root, ':', file)), ...stagedTwinFindings(root)];
    for (const line of found) console.error(`[generated-files] ${line}`);
    if (found.length > 0) process.exitCode = 1;
    else console.log('[generated-files] no generated file is staged');
  }
}
