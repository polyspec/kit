#!/usr/bin/env node
// The check that no test is skipped or narrowed by a marker (`make test-markers-check`, K255): PRINCIPLES.md forbids lowering
// a standard while testing, and a skip or focus marker lowers it without a trace. The tracked test files of each runner of
// kit (S3) are read: a TypeScript or JavaScript test, JSX and TSX included, with its parser (script-ast.mts), so a marker inside a string, such
// as the fixture of a test, is no marker; a test of Go, Python, PHP or Rust by the marker on a line of code, its comment left
// out. Each finding names the file, the line and the marker.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isTestFile } from './check-commits.mts';
import { calleeName, isNode, parseScript, walk } from './script-ast.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';

// The registrations of node:test and vitest, and their methods and options that skip or narrow a test.
const REGISTRATIONS = new Set(['test', 'it', 'describe', 'suite']);
const NARROWING = new Set(['skip', 'only', 'todo']);
const SCRIPT = /\.[cm]?[jt]sx?$/;
// The names that the context of a node:test test goes by.
const TEST_CONTEXT = /^(?:t|tt|ctx|context|subtest)$/;

// The markers of the other runners, each on a line of code: the comment of the line is left out first.
const LINE_MARKERS: { files: RegExp; comment: RegExp; markers: RegExp }[] = [
  { files: /\.go$/, comment: /\/\/.*$/, markers: /\bt\.(?:Skip|SkipNow|Skipf)\b|\btesting\.Short\(\)/ },
  { files: /\.py$/, comment: /#.*$/, markers: /\bunittest\.skip(?:If|Unless)?\b|\bpytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.skip\b|\bpytest\.importorskip\b|\bskipTest\b/ },
  { files: /\.php$/, comment: /(?:\/\/|#(?!\[)).*$/, markers: /\bmarkTest(?:Skipped|Incomplete)\b|@requires\b|#\[Requires\w*\(/ },
  { files: /\.rs$/, comment: /\/\/.*$/, markers: /#\[ignore\b[^\]]*\]/ },
];

// K315 added testing.Short, pytest.importorskip, @requires and #[Requires...], and the skip of a test context.
const finding = (file: string, line: number, marker: string) => `${file}:${line}: ${marker} skips or narrows a test`;

/** The markers of a script `text` of `file`: a call of a narrowing method of a registration, or a narrowing option. */
function scriptMarkers(file: string, text: string): string[] {
  const found: { line: number; text: string }[] = [];
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  walk(parseScript(file, text).program, (node) => {
    if (node.type !== 'CallExpression' || !Array.isArray(node.arguments)) return;
    const [registration = '', method, ...rest] = calleeName(node.callee).split('.');
    // A skip or todo of the context of a test (node:test t.skip()) skips the test that it runs in (K315).
    if (method !== undefined && rest.length === 0 && (method === 'skip' || method === 'todo') && TEST_CONTEXT.test(registration)) {
      found.push({ line: lineOf(node.start), text: `${registration}.${method}` });
      return;
    }
    if (method !== undefined && rest.length === 0 && REGISTRATIONS.has(registration) && NARROWING.has(method)) {
      found.push({ line: lineOf(node.start), text: `${registration}.${method}` });
      return;
    }
    if (method !== undefined || !REGISTRATIONS.has(registration)) return;
    for (const argument of node.arguments) {
      if (!isNode(argument) || argument.type !== 'ObjectExpression' || !Array.isArray(argument.properties)) continue;
      for (const property of argument.properties) {
        if (isNode(property) && property.type === 'Property' && isNode(property.key) && property.key.type === 'Identifier' && typeof property.key.name === 'string' && NARROWING.has(property.key.name)) {
          found.push({ line: lineOf(property.start), text: `the option ${property.key.name}` });
        }
      }
    }
  });
  return found.sort((a, b) => a.line - b.line).map(entry => finding(file, entry.line, entry.text));
}

/** The findings of the test file `file` with the text `text`; a file that is no test of a runner of kit has none. */
export function markerFindings(file: string, text: string): string[] {
  if (!isTestFile(file)) return [];
  if (SCRIPT.test(file)) return scriptMarkers(file, text);
  const kind = LINE_MARKERS.find(entry => entry.files.test(file));
  if (!kind) return [];
  return text.split('\n').flatMap((line, index) => {
    const marker = kind.markers.exec(line.replace(kind.comment, ''));
    return marker ? [finding(file, index + 1, marker[0])] : [];
  });
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = trackedFiles(root).flatMap(file => markerFindings(file, readFileSync(path.join(root, file), 'utf8')));
  for (const line of found) console.error(`[test-markers] ${line}`);
  if (found.length) {
    console.error(`[test-markers] ${found.length} markers; a test runs in full or is removed with its reason in the checklist`);
    process.exit(1);
  }
  console.log('[test-markers] no test is skipped or narrowed by a marker');
}
