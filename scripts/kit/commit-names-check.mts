#!/usr/bin/env node
// The check that no tracked Markdown file names a Git commit (K1210): a release and a lock pin a commit, and a name written in a
// document is a wrong value once the history changes.
//
//   node scripts/kit/commit-names-check.mts [--except <glob>]...
//
// The check reads each file of trackedFiles whose path ends in `.md`, except the paths that a `--except` glob matches. Exit 0
// with the number of files read; exit 1 with one line per finding and their count, or when no Markdown file was read; exit 2 for a
// usage error.
//
// Boundary rule. A candidate is a run of 7 to 40 lowercase hexadecimal digits (`0-9`, `a-f`) that no ASCII letter and no digit
// touches on either side. Three joins make the run a part of a longer word, which is no candidate: a `.` between the run and a
// letter or a digit (a file name, a version, a decimal), and a `-` or a `_` between the run and a neighbouring run that holds
// hexadecimal digits only (a UUID, a digest written in groups, a date). Every other character ends the name, `:`, `=`, `@`, `#`,
// `/` and a `-` or `_` before a word that is not hexadecimal included, so `abc1234:path`, `repo@abc1234def`, `commit=0a1b2c3d`,
// `0a1b2c3/file` and `abc1234-dirty` hold a candidate, and a digest of 64 digits, a UUID, `0x1a2b3c4d` and `abc1234.md` hold none.
//
// Content rule. A candidate that holds both a digit and a letter is a commit name. A candidate of digits only, or of letters
// only, is a commit name only when a marker stands directly before it on its line: the word `commit`, `commits`, `sha`, `rev` or
// `revision` in any case, followed by optional spaces, at most one of `:`, `=` and `/`, optional spaces and at most one backtick;
// or a `@`, followed by at most one backtick. A date, a size, a run id and a word such as `defaced` have no marker and are no
// commit names.
//
// Accepted misses: an unmarked name of digits only or of letters only (also after the word `at`, which precedes sizes and dates
// as well), a name in uppercase digits, and a name that a `-` or a `_` joins to a word of hexadecimal digits only (`abc1234-dead`).
// Accepted findings that are no commits: every other word of 7 to 40 hexadecimal digits with a digit and a letter, such as a
// SHA-1 digest of a file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';

// A run that no letter or digit touches (first group of each side), that no `.` joins to a letter or a digit (second group), and that
// no `-` or `_` joins to a run of hexadecimal digits only (third group).
const BEFORE = String.raw`(?<![0-9A-Za-z])(?<![0-9A-Za-z]\.)(?<!(?<![0-9A-Za-z])[0-9A-Fa-f]+[-_])`;
const AFTER = String.raw`(?![0-9A-Za-z])(?!\.[0-9A-Za-z])(?![-_][0-9A-Fa-f]+(?![0-9A-Za-z]))`;
const CANDIDATE = new RegExp(`${BEFORE}[0-9a-f]{7,40}${AFTER}`, 'g');

// The marker that makes a candidate of digits only or of letters only a commit name; it ends where the candidate starts.
const MARKER = /(?:(?<![0-9A-Za-z])(?:commits?|sha|rev|revision)[ \t]*[:=/]?[ \t]*`?|@`?)$/i;

/** One commit name of a text: its line and its column, both from 1, and the name. */
export interface CommitName {
  line: number;
  column: number;
  name: string;
}

/** The commit names of `text`, in the order of their lines and columns, by the boundary rule and the content rule of this file. */
export function commitNames(text: string): CommitName[] {
  const found: CommitName[] = [];
  text.split('\n').forEach((content, index) => {
    for (const match of content.matchAll(CANDIDATE)) {
      const name = match[0];
      const mixed = /[0-9]/.test(name) && /[a-f]/.test(name);
      if (mixed || MARKER.test(content.slice(0, match.index))) found.push({ line: index + 1, column: match.index + 1, name });
    }
  });
  return found;
}

/** The Markdown files of the checkout `root` that the check reads: the files of trackedFiles that end in `.md` and match no glob of `except`. */
export function markdownFiles(root: string, except: readonly string[]): string[] {
  return trackedFiles(root).filter(file => file.endsWith('.md') && !matchesAny(except, file));
}

const USAGE = 'usage: node scripts/kit/commit-names-check.mts [--except <glob>]...';

/** The globs of the `--except` arguments of `argv`, or undefined when `argv` holds another argument or an `--except` without a glob. */
function exceptGlobs(argv: readonly string[]): string[] | undefined {
  const globs: string[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const glob = argv[index + 1];
    if (argv[index] !== '--except' || glob === undefined || glob === '') return undefined;
    globs.push(glob);
  }
  return globs;
}

type Output = { root?: string; print?: (text: string) => void; error?: (text: string) => void };

/** Runs the check on the checkout `root` with the arguments `argv` and returns the exit code. */
export function main(argv: readonly string[], { root = repositoryRoot(), print = console.log, error = console.error }: Output = {}): number {
  const except = exceptGlobs(argv);
  if (except === undefined) {
    error(USAGE);
    return 2;
  }
  const files = markdownFiles(root, except);
  print(`[commit-names-check] reading ${files.length} tracked Markdown files${except.length > 0 ? `, except ${except.join(' ')}` : ''}`);
  if (files.length === 0) {
    error('[commit-names-check] no tracked Markdown file was read, so nothing was checked; run the check in a checkout that tracks a *.md file, or narrow the --except globs');
    return 1;
  }
  let count = 0;
  for (const file of files) {
    for (const { line, column, name } of commitNames(readFileSync(path.join(root, file), 'utf8'))) {
      error(`${file}:${line}:${column}: names the Git commit ${name}; a tracked file names no Git commit`);
      count += 1;
    }
  }
  if (count > 0) {
    error(`[commit-names-check] ${count} commit names in ${files.length} tracked Markdown files`);
    return 1;
  }
  print(`[commit-names-check] ${files.length} tracked Markdown files name no Git commit`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
