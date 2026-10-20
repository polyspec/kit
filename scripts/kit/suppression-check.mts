#!/usr/bin/env node
// The check that every suppression of a lint finding states its need (`make suppression-check`, P8, K334). A suppression hides a
// finding of a rule that enforces P8, so it is legal only with the reason that the code needs it, in the form that the tool of its
// ecosystem gives a reason:
//   TypeScript, JavaScript  // eslint-disable… and // oxlint-disable… with ` -- <reason>`
//   Python                  # noqa: <codes> with ` - <reason>` or ` -- <reason>` after the codes
//   PHP                     @phpstan-ignore <identifier> (<reason>), and // phpcs:ignore or phpcs:disable with ` -- <reason>`
//   Go                      //nolint:<linter> with ` // <reason>` after it
//   Rust                    #[allow(…)], #![allow(…)], #[expect(…)] and #![expect(…)] with `reason = "<reason>"`
// A directive inside a string literal is text, not a suppression: the real lint tests of kit plant suppressions in the files that
// they write. Each finding names the file, the line and the directive.
//
//   node scripts/kit/suppression-check.mts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';

/** A kind of suppression: the files it applies to, the directive, whether a match states its reason, and the form of the reason. */
type Directive = { files: RegExp; name: string; pattern: RegExp; stated: (rest: string) => boolean; form: string };

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const DIRECTIVES: Directive[] = [
  { files: SCRIPT, name: 'eslint-disable', pattern: /\/[/*]\s*(eslint-disable(?:-next-line|-line)?)\b(.*)$/, stated: rest => /\s--\s+\S/.test(rest), form: '-- <reason>' },
  { files: SCRIPT, name: 'oxlint-disable', pattern: /\/[/*]\s*(oxlint-disable(?:-next-line|-line)?)\b(.*)$/, stated: rest => /\s--\s+\S/.test(rest), form: '-- <reason>' },
  { files: /\.py$/, name: 'noqa', pattern: /#\s*(noqa)\b(.*)$/i, stated: rest => /^:\s*[A-Z]+[0-9]+(?:\s*,\s*[A-Z]+[0-9]+)*\s+--?\s+\S/.test(rest), form: '# noqa: <codes> - <reason>' },
  { files: /\.php$/, name: '@phpstan-ignore', pattern: /(@phpstan-ignore(?:-next-line|-line)?)\b(.*)$/, stated: rest => /\(\s*\S[^)]*\)/.test(rest), form: '@phpstan-ignore <identifier> (<reason>)' },
  { files: /\.php$/, name: 'phpcs:ignore', pattern: /\/\/\s*(phpcs:(?:ignore|disable))\b(.*)$/, stated: rest => /\s--\s+\S/.test(rest), form: 'phpcs:ignore <sniff> -- <reason>' },
  { files: /\.go$/, name: 'nolint', pattern: /\/\/\s*(nolint)\b(.*)$/, stated: rest => /^:[A-Za-z0-9_,-]+\s*\/\/\s*\S/.test(rest), form: '//nolint:<linter> // <reason>' },
  { files: /\.rs$/, name: 'allow', pattern: /(#!?\[(?:allow|expect))\((.*)$/, stated: rest => /\breason\s*=\s*"[^"]+"/.test(rest), form: '#[allow(<lint>, reason = "<reason>")]' },
];

/** Whether the position `index` of `line` lies inside a string literal: an odd count of unescaped quotes of one kind before it. */
function insideString(line: string, index: number): boolean {
  const before = line.slice(0, index).replace(/\\./g, '');
  return ['"', "'", '`'].some(quote => (before.split(quote).length - 1) % 2 === 1);
}

/** The findings of the file `file` with the text `text`: each suppression that states no reason. */
export function suppressionFindings(file: string, text: string): string[] {
  const directives = DIRECTIVES.filter(directive => directive.files.test(file));
  if (directives.length === 0) return [];
  return text.split('\n').flatMap((line, index) => directives.flatMap((directive) => {
    const match = directive.pattern.exec(line);
    if (match === null || insideString(line, match.index) || directive.stated(match[2] ?? '')) return [];
    return [`${file}:${index + 1}: ${match[1] ?? directive.name} states no reason; a suppression names the need of the code, as ${directive.form}`];
  }));
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = trackedFiles(root).flatMap(file => suppressionFindings(file, readFileSync(path.join(root, file), 'utf8')));
  for (const line of found) console.error(`[suppression-check] ${line}`);
  if (found.length) {
    console.error(`[suppression-check] ${found.length} suppressions without a reason (P8)`);
    process.exit(1);
  }
  console.log('[suppression-check] every suppression of a lint finding states its reason');
}
