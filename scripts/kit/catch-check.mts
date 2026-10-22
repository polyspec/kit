#!/usr/bin/env node
// The check that no error is swallowed in silence (K537, follows K256): a catch clause, and a callback of .catch, whose block
// holds no statement. oxlint no-empty passes such a block when it holds a comment, so a comment-only catch hid every failure
// of the call it wrapped. Each hit needs a statement: name the outcome, or narrow the error and rethrow the rest. The files are
// the TypeScript and JavaScript files of the checkout, read with oxc-parser, the parser of oxlint.
//
//   node scripts/kit/catch-check.mts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { isMain, repositoryRoot } from './paths.mts';
import { checkedFiles } from './tracked-files.mts';

/** The extensions of the files that the check reads. */
export const SCRIPT_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;

type AstNode = { type: string; start: number } & Record<string, unknown>;
const isNode = (value: unknown): value is AstNode => typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' && 'start' in value && typeof value.start === 'number';
const emptyBlock = (value: unknown): boolean => isNode(value) && value.type === 'BlockStatement' && Array.isArray(value.body) && value.body.length === 0;

/** The 1-based lines of `text` (the file `file`) where a catch clause or a .catch callback holds no statement. */
export function emptyCatches(file: string, text: string): number[] {
  const { program, errors } = parseSync(file, text);
  const first = errors[0];
  if (first !== undefined) throw new Error(`${file}: ${first.message}`);
  const lines: number[] = [];
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isNode(value)) return;
    if (value.type === 'CatchClause' && emptyBlock(value.body)) lines.push(lineOf(value.start));
    if (value.type === 'CallExpression' && isNode(value.callee) && value.callee.type === 'MemberExpression' && isNode(value.callee.property)
      && value.callee.property.name === 'catch' && Array.isArray(value.arguments) && isNode(value.arguments[0]) && emptyBlock(value.arguments[0].body)) {
      lines.push(lineOf(value.start));
    }
    for (const child of Object.values(value)) if (typeof child === 'object') walk(child);
  };
  walk(program);
  return lines;
}

/** The findings of the checkout `root`, one per empty catch, as `file:line: message`. */
export function catchFindings(root: string): string[] {
  return checkedFiles(root).filter(file => SCRIPT_FILE.test(file)).flatMap(file => emptyCatches(file, readFileSync(path.join(root, file), 'utf8'))
    .map(line => `${file}:${line}: a catch holds no statement, so it swallows every error; name the outcome, or narrow the error and rethrow the rest (K537)`));
}

if (isMain(import.meta.url)) {
  const findings = catchFindings(repositoryRoot());
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) process.exitCode = 1;
  else console.log('[catch-check] no catch without a statement');
}
