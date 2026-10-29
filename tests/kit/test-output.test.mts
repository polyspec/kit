// Tests of the node:test reader of scripts/kit/test-output.mts (nodeEvents) and of its package export. The reader reads the
// lines of parity-node-reporter.mts, which node --test prints for each test that ends; a run of node --test over a fixture
// test file in a temporary folder gives those lines. The export of the built package is tested in tests/source/package.test.mts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cargoEvents, goEvents, nodeEvents, toProgress, type Sink, type TestRef } from '../../scripts/kit/test-output.mts';
import { outcomesOf, runOf } from '../../scripts/kit/parity-runners.mts';
import { tool } from './kit-tools.mts';
import { createProgress } from '../../scripts/kit/test-progress.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const NODE_REPORTER = tool(import.meta.resolve('../../scripts/kit/parity-node-reporter.mts'));
// A child started from inside node --test must not join that run as its child (parity-runners.mts), so the variable is removed.
const { NODE_TEST_CONTEXT: _joined, ...ENV } = process.env;

/** A sink that counts the calls of each kind and keeps the lines that it receives. */
function counting(): Sink & { counts: Record<string, number>; lines: string[]; raws: string[] } {
  const counts: Record<string, number> = { start: 0, pass: 0, fail: 0, skip: 0, todo: 0 };
  const lines: string[] = [];
  const raws: string[] = [];
  const record = (kind: string) => (_test: TestRef) => { counts[kind] = (counts[kind] ?? 0) + 1; };
  return {
    counts, lines, raws,
    start: record('start'),
    pass: record('pass'),
    fail: record('fail'),
    skip: record('skip'),
    todo: record('todo'),
    line: text => { lines.push(text); },
    raw: text => { raws.push(text); },
  };
}

/** The events of a run: each line of the output of the stream goes through nodeEvents into the sink. */
function readAll(output: string, sink: Sink): void {
  const read = nodeEvents(sink);
  output.split('\n').forEach(line => read(line));
}

test('nodeEvents counts 2 passing and 1 failing node:test case as pass=2 and fail=1 (K217)', () => {
  const sink = counting();
  readAll([
    '{"name":"adds","outcome":"pass"}',
    '{"name":"subtracts","outcome":"pass"}',
    '{"name":"divides","outcome":"fail"}',
    '',
  ].join('\n'), sink);
  assert.equal(sink.counts.pass, 2);
  assert.equal(sink.counts.fail, 1);
  assert.equal(sink.counts.skip, 0);
  assert.deepEqual(sink.lines, []);
});

test('nodeEvents reports a line that is no case through the line path, and counts no case of it (K217)', () => {
  const sink = counting();
  readAll('not json\n{"name":"adds","outcome":"maybe"}\n', sink);
  assert.equal(sink.counts.pass, 0);
  assert.equal(sink.counts.fail, 0);
  assert.deepEqual(sink.lines, ['not json', '{"name":"adds","outcome":"maybe"}']);
});

test('a node:test run with a zero-match name pattern gives 0 cases through nodeEvents (K217)', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'node-events-'));
  try {
    writeFileSync(path.join(folder, 'cases.test.mjs'), [
      "import test from 'node:test';",
      "test('adds', () => {});",
      "test('subtracts', () => {});",
      '',
    ].join('\n'));
    const run = spawnSync(process.execPath, ['--test', `--test-reporter=${NODE_REPORTER}`, '--test-name-pattern=no such case', path.join(folder, 'cases.test.mjs')], { cwd: folder, encoding: 'utf8', env: ENV });
    const sink = counting();
    readAll(run.stdout, sink);
    assert.equal(sink.counts.pass, 0);
    assert.equal(sink.counts.fail, 0);
    assert.equal(sink.counts.skip, 0);
    assert.deepEqual(sink.lines, []);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a node:test run of 2 passing and 1 failing case gives pass=2 and fail=1 through nodeEvents (K217)', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'node-events-'));
  try {
    writeFileSync(path.join(folder, 'cases.test.mjs'), [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('adds', () => {});",
      "test('subtracts', () => {});",
      "test('divides', () => assert.equal(1, 2));",
      '',
    ].join('\n'));
    const run = spawnSync(process.execPath, ['--test', `--test-reporter=${NODE_REPORTER}`, path.join(folder, 'cases.test.mjs')], { cwd: folder, encoding: 'utf8', env: ENV });
    assert.equal(run.status, 1);
    const sink = counting();
    readAll(run.stdout, sink);
    assert.equal(sink.counts.pass, 2);
    assert.equal(sink.counts.fail, 1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// A Go package without test files is a group with no cases, not a skipped named case.
test('goEvents treats no-test packages as groups while preserving named skips, empty-run failure, and build failure', () => {
  const run = (events: Record<string, unknown>[], exitCode = 0) => {
    const lines: string[] = [];
    const progress = createProgress({ write: text => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
    const build: string[] = [];
    const feed = goEvents(toProgress(progress), build);
    for (const event of events) feed(JSON.stringify(event));
    return { result: progress.close('go test', { exitCode, build }), lines: lines.join('') };
  };

  const withHelpers = run([
    { Action: 'start', Package: 'helper/benchmark' },
    { Action: 'output', Package: 'helper/benchmark', Output: '? helper/benchmark [no test files]\n' },
    { Action: 'skip', Package: 'helper/benchmark' },
    { Action: 'start', Package: 'helper/probe' },
    { Action: 'pass', Package: 'helper/probe', Elapsed: 0 },
    { Action: 'start', Package: 'library' },
    { Action: 'run', Package: 'library', Test: 'TestValue' },
    { Action: 'pass', Package: 'library', Test: 'TestValue', Elapsed: 0.01 },
    { Action: 'pass', Package: 'library', Elapsed: 0.02 },
  ]);
  assert.equal(withHelpers.result.ok, true, withHelpers.lines);
  assert.deepEqual([withHelpers.result.passed, withHelpers.result.skipped, withHelpers.result.ran], [1, 0, 1]);
  assert.match(withHelpers.lines, /helper\/benchmark: package has no test files/);
  assert.match(withHelpers.lines, /helper\/probe: package ran no test case/);
  assert.doesNotMatch(withHelpers.lines, /skipped cases:/);

  const namedSkip = run([
    { Action: 'start', Package: 'library' },
    { Action: 'run', Package: 'library', Test: 'TestLater' },
    { Action: 'skip', Package: 'library', Test: 'TestLater' },
    { Action: 'pass', Package: 'library', Elapsed: 0.02 },
  ]);
  assert.equal(namedSkip.result.ok, false);
  assert.deepEqual([namedSkip.result.skipped, namedSkip.result.ran], [1, 0]);
  assert.match(namedSkip.lines, /skipped cases: library › TestLater/);

  const empty = run([
    { Action: 'start', Package: 'helper/benchmark' },
    { Action: 'skip', Package: 'helper/benchmark' },
  ]);
  assert.equal(empty.result.ok, false);
  assert.match(empty.lines, /no test ran/);

  const compileFailure = run([
    { Action: 'build-output', ImportPath: 'helper/broken', Output: '# helper/broken\nhelper.go:3: undefined: missing\n' },
    { Action: 'build-fail', ImportPath: 'helper/broken' },
  ], 1);
  assert.equal(compileFailure.result.ok, false);
  assert.match(compileFailure.lines, /build errors: helper.go:3: undefined: missing/);
});

// The lines that cargo test of a database target prints when a case's database is missing: the case database
// prints its step between the name of the test and its result, so the result FAILED stands alone on its line (K229).
test('goEvents ends a benchmark at its result line, at the next benchmark that is not its child, or with its package (K760)', () => {
  // go test -json emits run and output events for a benchmark, but no pass event (flowmark, go1.27.3).
  const lines: string[] = [];
  const progress = createProgress({ write: text => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const feed = goEvents(toProgress(progress));
  const pkg = 'flowmark/writepath';
  for (const event of [
    { Action: 'start', Package: pkg },
    { Action: 'run', Package: pkg, Test: 'BenchmarkWrite' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkWrite', Output: '=== RUN   BenchmarkWrite\n' },
    { Action: 'run', Package: pkg, Test: 'BenchmarkWrite/notes=0' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkWrite/notes=0', Output: '=== RUN   BenchmarkWrite/notes=0\n' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkWrite/notes=0', Output: 'BenchmarkWrite/notes=0-11 \t       1\t  59735625 ns/op\t  1024 B/op\t  12 allocs/op\n' },
    { Action: 'run', Package: pkg, Test: 'BenchmarkWrite/notes=1' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkWrite/notes=1', Output: 'BenchmarkWrite/notes=1 \t       1\t  61000000 ns/op\n' },
    { Action: 'run', Package: pkg, Test: 'BenchmarkRead' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkRead', Output: '=== RUN   BenchmarkRead\n' },
    { Action: 'run', Package: pkg, Test: 'BenchmarkTail' },
    { Action: 'pass', Package: pkg, Elapsed: 100 },
  ]) feed(JSON.stringify(event));
  const result = progress.close('go test', { exitCode: 0, build: [] });
  const text = lines.join('');
  assert.equal(result.ok, true, text);
  assert.deepEqual([result.passed, result.failed, result.timedOut], [5, 0, 0], text);
  assert.doesNotMatch(text, /did not finish/);
  assert.match(text, /BenchmarkWrite\/notes=0-11 \t +1\t +59735625 ns\/op/);
});

test('cargoEvents reads the result of a test whose output lies between its name and its result (K229)', () => {
  const outcomes: string[] = [];
  const record = (kind: string) => (test: TestRef) => { outcomes.push(`${test.name} ${kind}`); };
  const sink = { ...counting(), pass: record('pass'), fail: record('fail'), skip: record('skip') };
  const { stdout } = cargoEvents(sink);
  stdout(`test identity_load::restart_identity_takes_only_entity ... ok
test identity_load::execute_load_then_restart          ... mysql: case database

thread 'main' (1069775896) panicked at case-database/src/lib.rs:43:14:
ORM_TEST_MYSQL_DSN is required; database tests never skip
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace
FAILED
test identity_load::execute_restart_after_delete       ... mysql: case database
postgres: case database
ok
`);
  assert.deepEqual(outcomes, ['identity_load::restart_identity_takes_only_entity pass', 'identity_load::execute_load_then_restart fail', 'identity_load::execute_restart_after_delete pass']);
});

test('a malformed line of the parity node reporter fails the parity run and shows the line (K217)', () => {
  const run = runOf({ runner: 'node' }, ROOT, { test: 'tests/kit/example.test.mts' }, 'feature', ENV);
  if (run.error) assert.fail(run.error);
  assert.throws(
    () => outcomesOf(run, { stdout: '{"name":"adds","outcome":"pass"}\nnot a case\n', stderr: '' }),
    /not a case/,
  );
});
