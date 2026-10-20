#!/usr/bin/env node
// The check that a stale text is gone from a tracked file (`make text-absent FILE=<path> TEXT=<text>`, K431): the red of a row
// whose whole change is text, such as a comment or a document that a change left stale. P19 makes its Verification a command that
// fails while the stale text is there, so the Claude Code hook and docs-check take it as a Verification command. The text is a
// literal, not a regular expression. Exit 0 once the file no longer holds the text, 1 while it does (one finding per occurrence,
// naming the line), and 2 for a file that Git does not track, a missing file or an empty text.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { git } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';

/** The line numbers (1-based) of each occurrence of the literal `text` in `content`; a line that holds it twice is listed twice. */
export function occurrences(content: string, text: string): number[] {
  const lines: number[] = [];
  if (text === '') return lines;
  for (let index = content.indexOf(text); index !== -1; index = content.indexOf(text, index + text.length)) {
    lines.push(content.slice(0, index).split('\n').length);
  }
  return lines;
}

/** Reports `reason` on stderr and exits 2, the code of a run that cannot check the file. */
function fail(reason: string): never {
  console.error(`[text-absent] ${reason}`);
  process.exit(2);
}

if (isMain(import.meta.url)) {
  const [file, text] = process.argv.slice(2);
  if (process.argv.length !== 4 || file === undefined || text === undefined) fail('usage: text-absent <file> <text>');
  if (text === '') fail('TEXT is empty; name the stale text');
  const root = repositoryRoot();
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  const tracked = git(root, 'ls-files', '-z').split('\0').includes(relative);
  if (!tracked) fail(`${relative} is not tracked by Git; name a file of the repository that Git tracks`);
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) fail(`${relative} is tracked by Git but missing from the working tree`);
  const lines = occurrences(readFileSync(absolute, 'utf8'), text);
  for (const line of lines) console.error(`[text-absent] ${relative}:${line}: holds the stale text "${text}"`);
  if (lines.length) process.exit(1);
  console.log(`[text-absent] ${relative} no longer holds the text`);
}
