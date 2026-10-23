#!/usr/bin/env node
// The check that no error is swallowed in silence (K537, follows K256): a catch clause, and a callback of .catch, whose block
// holds no statement. oxlint no-empty passes such a block when it holds a comment, so a comment-only catch hid every failure
// of the call it wrapped. Each hit needs a statement: name the outcome, or narrow the error and rethrow the rest. A catch without
// a binding cannot narrow, so it is a finding too unless the line before it states why every failure means its outcome (K561). The files are
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

/** Calls `visit` with each node of the parsed `text` (the file `file`) and the 1-based line where it starts. */
function eachNode(file: string, text: string, visit: (node: AstNode, line: number) => void): void {
  const { program, errors } = parseSync(file, text);
  const first = errors[0];
  if (first !== undefined) throw new Error(`${file}: ${first.message}`);
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isNode(value)) return;
    visit(value, text.slice(0, value.start).split('\n').length);
    for (const child of Object.values(value)) if (typeof child === 'object') walk(child);
  };
  walk(program);
}

/** The 1-based lines of `text` (the file `file`) where a catch clause or a .catch callback holds no statement. */
export function emptyCatches(file: string, text: string): number[] {
  const lines: number[] = [];
  eachNode(file, text, (value, line) => {
    if (value.type === 'CatchClause' && emptyBlock(value.body)) lines.push(line);
    if (value.type === 'CallExpression' && isNode(value.callee) && value.callee.type === 'MemberExpression' && isNode(value.callee.property)
      && value.callee.property.name === 'catch' && Array.isArray(value.arguments) && isNode(value.arguments[0]) && emptyBlock(value.arguments[0].body)) {
      lines.push(line);
    }
  });
  return lines;
}

// The stated reason of a catch that accepts every failure, on the line before it (K561): `// catch-any -- <reason>`.
const CATCH_ANY = /\/\/\s*catch-any\s+--\s+\S/;

/**
 * The 1-based lines of `text` (the file `file`) where a catch clause has no binding (K561): it cannot inspect what it caught, so it
 * accepts every failure as the outcome that it names. A catch after a line that states its reason with CATCH_ANY is none.
 */
export function bindinglessCatches(file: string, text: string): number[] {
  const source = text.split('\n');
  const lines: number[] = [];
  eachNode(file, text, (value, line) => {
    if (value.type !== 'CatchClause' || value.param !== null) return;
    if (![source[line - 2], source[line - 1]].some(near => near !== undefined && CATCH_ANY.test(near))) lines.push(line);
  });
  return lines;
}

/** The findings of the checkout `root`, one per empty catch (K537) and per catch without a binding (K561), as `file:line: message`. */
export function catchFindings(root: string): string[] {
  return checkedFiles(root).filter(file => SCRIPT_FILE.test(file)).flatMap((file) => {
    const text = readFileSync(path.join(root, file), 'utf8');
    return [
      ...emptyCatches(file, text).map(line => `${file}:${line}: a catch holds no statement, so it swallows every error; name the outcome, or narrow the error and rethrow the rest (K537)`),
      ...bindinglessCatches(file, text).map(line => `${file}:${line}: a catch has no binding, so it cannot inspect what it caught and accepts every failure; bind the error and narrow it, or state the reason on the line before with // catch-any -- <reason> (K561)`),
    ];
  });
}

if (isMain(import.meta.url)) {
  const findings = catchFindings(repositoryRoot());
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) process.exitCode = 1;
  else console.log('[catch-check] no catch without a statement');
}
