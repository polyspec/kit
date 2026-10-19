#!/usr/bin/env node
// The language check of the code (`make language-check`, K252): PRINCIPLES.md requires English comments, identifiers, logs,
// error messages and test names, so Hangul in them fails. A string that is data, such as a Korean phrase that a tool writes
// into a Korean document, is not read. A TypeScript or JavaScript file is read with its parser (module-imports.mts): its
// comments, identifiers, the text of an Error or a console call and the name of a test; a file of Go, Python, PHP or Rust is
// read line by line: its comments, and Hangul outside a string literal, which is an identifier. The commit messages are
// checked by the commit check (check-commits.mts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { full, simple } from 'acorn-walk';
import type { CallExpression, Comment, Expression, NewExpression, PrivateIdentifier, SpreadElement, Super } from 'acorn';
import { parseModule } from './module-imports.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';

/** Hangul: the syllables and the jamo of Korean. */
export const HANGUL = /[가-힣ㄱ-ㆎ]/;
const SCRIPT = /\.[cm]?[jt]sx?$/;
const REGISTRATIONS = new Set(['test', 'it', 'describe', 'suite']);

// The comment syntax of each other language: a line comment, and a block comment when it has one.
const LINE_LANGUAGES: { files: RegExp; line: string[]; block?: [string, string] }[] = [
  { files: /\.go$/, line: ['//'], block: ['/*', '*/'] },
  { files: /\.rs$/, line: ['//'], block: ['/*', '*/'] },
  { files: /\.php$/, line: ['//', '#'], block: ['/*', '*/'] },
  { files: /\.py$/, line: ['#'] },
];

type Kind = 'a comment' | 'an identifier' | 'an error or log message' | 'a test name';

/** The text of a string literal or a backquoted string `node`, or undefined for another node. */
function textOf(node: Expression | SpreadElement | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral') return node.quasis.map(quasi => quasi.value.raw).join('');
  return undefined;
}

/** The name of a callee: `name`, or `object.name` for a member. */
function calleeName(node: Expression | Super | PrivateIdentifier): string {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return `${calleeName(node.object)}.${calleeName(node.property)}`;
  return '';
}

/** The findings of a script: its comments, identifiers, Error and console texts and test names, each by its line. */
function scriptFindings(file: string, text: string): { line: number; kind: Kind }[] {
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  const comments: Comment[] = [];
  const program = parseModule(file, text, 'strip-only', comments);
  const found: { line: number; kind: Kind }[] = comments.filter(comment => HANGUL.test(comment.value)).map(comment => ({ line: lineOf(comment.start), kind: 'a comment' }));
  const call = (node: CallExpression | NewExpression) => {
    const name = calleeName(node.callee);
    if (/(?:^|\.)\w*Error$/.test(name) || name.startsWith('console.')) {
      for (const arg of node.arguments) if (HANGUL.test(textOf(arg) ?? '')) found.push({ line: lineOf(arg.start), kind: 'an error or log message' });
    } else if (REGISTRATIONS.has(name.split('.')[0] ?? '') && HANGUL.test(textOf(node.arguments[0]) ?? '')) {
      found.push({ line: lineOf(node.start), kind: 'a test name' });
    }
  };
  // full passes every node, a declared name too, which simple passes as a VariablePattern that its types do not name.
  full(program, (node) => {
    if (node.type === 'Identifier' && HANGUL.test(node.name)) found.push({ line: lineOf(node.start), kind: 'an identifier' });
  });
  simple(program, {
    CallExpression: call,
    NewExpression: call,
  });
  return found;
}

/** `line` without its string literals, in double or single quotes, an escaped quote kept inside. */
const withoutStrings = (line: string) => line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');

/** The findings of a file of another language: its comments, and Hangul outside a string, which is an identifier. */
function lineFindings(text: string, language: (typeof LINE_LANGUAGES)[number]): { line: number; kind: Kind }[] {
  const found: { line: number; kind: Kind }[] = [];
  let inBlock = false;
  text.split('\n').forEach((raw, index) => {
    let code = withoutStrings(raw);
    let comment = '';
    if (language.block) {
      const [open, close] = language.block;
      if (inBlock) {
        const end = code.indexOf(close);
        comment += end === -1 ? code : code.slice(0, end);
        code = end === -1 ? '' : code.slice(end + close.length);
        inBlock = end === -1;
      }
      for (let start = code.indexOf(open); !inBlock && start !== -1; start = code.indexOf(open)) {
        const end = code.indexOf(close, start + open.length);
        comment += end === -1 ? code.slice(start) : code.slice(start, end);
        code = end === -1 ? code.slice(0, start) : `${code.slice(0, start)} ${code.slice(end + close.length)}`;
        inBlock = end === -1;
      }
    }
    const marks = language.line.map(mark => code.indexOf(mark)).filter(at => at !== -1);
    if (marks.length) {
      const at = Math.min(...marks);
      comment += code.slice(at);
      code = code.slice(0, at);
    }
    if (HANGUL.test(comment)) found.push({ line: index + 1, kind: 'a comment' });
    if (HANGUL.test(code)) found.push({ line: index + 1, kind: 'an identifier' });
  });
  return found;
}

/** The findings of the code file `file` with the text `text`, each as `file:line: Hangul in <kind>`; a document has none. */
export function languageFindings(file: string, text: string): string[] {
  const language = LINE_LANGUAGES.find(entry => entry.files.test(file));
  const found = SCRIPT.test(file) ? scriptFindings(file, text) : language ? lineFindings(text, language) : [];
  const seen = new Set<string>();
  return found.sort((a, b) => a.line - b.line).map(entry => `${file}:${entry.line}: Hangul in ${entry.kind}`).filter(line => !seen.has(line) && seen.add(line));
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = trackedFiles(root).flatMap(file => languageFindings(file, readFileSync(path.join(root, file), 'utf8')));
  for (const line of found) console.error(`[language-check] ${line}`);
  if (found.length) {
    console.error(`[language-check] ${found.length} findings; comments, identifiers, logs, error messages and test names are English`);
    process.exit(1);
  }
  console.log('[language-check] the comments, identifiers, messages and test names of the code are English');
}
