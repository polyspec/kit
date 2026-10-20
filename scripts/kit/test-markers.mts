#!/usr/bin/env node
// The check that no test is skipped or narrowed by a marker (`make test-markers-check`, K255): PRINCIPLES.md forbids lowering
// a standard while testing, and a skip or focus marker lowers it without a trace. The tracked test files of each runner of
// kit (S3) are read: a TypeScript or JavaScript test, JSX and TSX included, with its parser (script-ast.mts), so a marker inside a string, such
// as the fixture of a test, is no marker; a Python test with the syntax tree of the python3 of the checkout (scripts/kit/markers/python.py,
// K345), so a marker inside a string or a comment is no marker either; a test of Go, PHP or Rust by the marker on a line of code, its comment
// left out. Each finding names the file, the line and the marker.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestFile } from './check-commits.mts';
import { calleeName, isNode, parseScript, walk } from './script-ast.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { parseJson } from './schema-validate.mts';
import { trackedFiles } from './tracked-files.mts';

// The registrations of node:test and vitest, and their methods and options that skip or narrow a test.
const REGISTRATIONS = new Set(['test', 'it', 'describe', 'suite']);
const NARROWING = new Set(['skip', 'only', 'todo']);
const SCRIPT = /\.[cm]?[jt]sx?$/;
const PYTHON = /\.py$/;
// The Python helper that reads the markers of a Python test from its syntax tree (K345), run by the python3 of the checkout. It lies
// beside this module, in scripts/kit of kit and in dist of the package, since a consumer holds no scripts/kit (K345-1).
export const PYTHON_HELPER = fileURLToPath(new URL('./markers/python.py', import.meta.url));
// The names that the context of a node:test test goes by.
const TEST_CONTEXT = /^(?:t|tt|ctx|context|subtest)$/;

// The markers of the other runners, each on a line of code: the comment of the line is left out first.
const LINE_MARKERS: { files: RegExp; comment: RegExp; markers: RegExp }[] = [
  { files: /\.go$/, comment: /\/\/.*$/, markers: /\bt\.(?:Skip|SkipNow|Skipf)\b|\btesting\.Short\(\)/ },
  { files: /\.php$/, comment: /(?:\/\/|#(?!\[)).*$/, markers: /\bmarkTest(?:Skipped|Incomplete)\b|@requires\b|#\[Requires\w*\(/ },
  { files: /\.rs$/, comment: /\/\/.*$/, markers: /#\[ignore\b[^\]]*\]/ },
];

// K315 added testing.Short, pytest.importorskip, @requires and #[Requires...], and the skip of a test context.
const finding = (file: string, line: number, marker: string) => `${file}:${line}: ${marker} skips or narrows a test`;

// K344: a skip in a fixture of this convention is no finding, since the skip of a fixture is the behaviour its test checks.
const FIXTURE_NAME = /_fixture_test\.go$|[._]fixture\.test\.[a-z]+$|^test_.*_fixture\.py$|FixtureTest\.php$/;
const SKIP_NAME = /skip/i;

/** Whether `file` is a fixture of the convention (K344): in a folder `fixtures` or `testdata`, or named as one. */
export function isFixtureFile(file: string): boolean {
  const segments = file.split('/');
  const basename = segments.pop() ?? '';
  return segments.some(segment => segment === 'fixtures' || segment === 'testdata') || FIXTURE_NAME.test(basename);
}

/** The reading of a Python file by the helper (scripts/kit/markers/python.py, K345): its markers, or the error of a syntax error. */
type PythonReading = { path: string; markers: { line: number; marker: string }[]; error: { line: number; message: string } | null };

/** The findings of the Python test `text` of `file`, read by the python3 of the checkout `root` (K345). */
function pythonFindings(root: string, file: string, text: string): string[] {
  const result = spawnSync(toolCommand(root, 'python3'), ['-I', PYTHON_HELPER, '-'], { cwd: root, env: toolsEnvironment(root), input: text, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`the marker helper ${PYTHON_HELPER} could not read ${file}: ${result.error?.message ?? result.stderr.trim()}`);
  const [reading] = parseJson<PythonReading[]>(result.stdout, 'python-markers.schema.json', `${PYTHON_HELPER} ${file}`);
  if (reading === undefined) throw new Error(`${PYTHON_HELPER} printed no reading of ${file}`);
  if (reading.error) return [`${file}:${reading.error.line}: does not parse (${reading.error.message}), so its markers are not read`];
  const fixture = isFixtureFile(file);
  return reading.markers.filter(entry => !(fixture && SKIP_NAME.test(entry.marker))).map(entry => finding(file, entry.line, entry.marker));
}

/** The markers of a script `text` of `file`: a call of a narrowing method of a registration, or a narrowing option. */
function scriptMarkers(file: string, text: string): string[] {
  const fixture = isFixtureFile(file);
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
  return found.filter(entry => !(fixture && SKIP_NAME.test(entry.text))).sort((a, b) => a.line - b.line).map(entry => finding(file, entry.line, entry.text));
}

/**
 * The findings of the test file `file` with the text `text`, a Python test read by the python3 of the checkout `root`; a file
 * that is no test of a runner of kit has none.
 */
export function markerFindings(file: string, text: string, root: string = repositoryRoot()): string[] {
  if (!isTestFile(file)) return [];
  if (SCRIPT.test(file)) return scriptMarkers(file, text);
  if (PYTHON.test(file)) return pythonFindings(root, file, text);
  const kind = LINE_MARKERS.find(entry => entry.files.test(file));
  if (!kind) return [];
  return text.split('\n').flatMap((line, index) => {
    const marker = kind.markers.exec(line.replace(kind.comment, ''));
    return marker && !(isFixtureFile(file) && SKIP_NAME.test(marker[0])) ? [finding(file, index + 1, marker[0])] : [];
  });
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = trackedFiles(root).flatMap(file => markerFindings(file, readFileSync(path.join(root, file), 'utf8'), root));
  for (const line of found) console.error(`[test-markers] ${line}`);
  if (found.length) {
    console.error(`[test-markers] ${found.length} markers; a test runs in full or is removed with its reason in the checklist`);
    process.exit(1);
  }
  console.log('[test-markers] no test is skipped or narrowed by a marker');
}
