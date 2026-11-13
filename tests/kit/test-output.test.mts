// Tests of the readers of scripts/kit/test-output.mts. The export of the built package is tested in tests/source/package.test.mts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoEvents, goEvents, phpunitEvents, pythonEvents, toProgress, type Sink, type TestRef } from '../../scripts/kit/test-output.mts';
import { createProgress } from '../../scripts/kit/test-progress.mts';

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
    notRun: (count) => { counts.notRun = (counts.notRun ?? 0) + count; },
    line: text => { lines.push(text); },
    raw: text => { raws.push(text); },
  };
}

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
  // go test -json emits run and output events for a benchmark, but no pass event (go1.27.3).
  const lines: string[] = [];
  const progress = createProgress({ write: text => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const feed = goEvents(toProgress(progress));
  const pkg = 'p';
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
  assert.deepEqual([result.passed, result.failed], [5, 0], text);
  assert.doesNotMatch(text, /did not finish/);
  assert.match(text, /BenchmarkWrite\/notes=0-11 \t +1\t +59735625 ns\/op/);
});

test('goEvents reads a benchmark result line that test2json splits into two output events, and keeps unmatched benchmark output (K919)', () => {
  // testing writes the benchmark name and its tab, then the results, in two writes; test2json sends a name that it reads
  // without the line end as its own event, so a reader that wakes between the writes splits the line
  // (cmd/internal/test2json, testdata/benchshort.json).
  const lines: string[] = [];
  const progress = createProgress({ write: text => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const feed = goEvents(toProgress(progress));
  const pkg = 'p';
  for (const event of [
    { Action: 'start', Package: pkg },
    { Action: 'run', Package: pkg, Test: 'BenchmarkShardInsert' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardInsert', Output: '=== RUN   BenchmarkShardInsert\n' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardInsert', Output: 'BenchmarkShardInsert\n' },
    { Action: 'run', Package: pkg, Test: 'BenchmarkShardInsert/flat' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardInsert/flat', Output: '=== RUN   BenchmarkShardInsert/flat\n' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardInsert/flat', Output: 'BenchmarkShardInsert/flat-4         \t' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardInsert/flat', Output: '      16\t  67777667 ns/op\n' },
    { Action: 'run', Package: pkg, Test: 'BenchmarkShardOpen' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardOpen', Output: '=== RUN   BenchmarkShardOpen\n' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardOpen', Output: 'BenchmarkShardOpen-4 \t' },
    { Action: 'output', Package: pkg, Test: 'BenchmarkShardOpen', Output: 'no result in this form\n' },
    { Action: 'pass', Package: pkg, Elapsed: 100 },
  ]) feed(JSON.stringify(event));
  const result = progress.close('go test', { exitCode: 0, build: [] });
  const text = lines.join('');
  assert.equal(result.ok, true, text);
  assert.match(text, /BenchmarkShardInsert\/flat-4 +\t +16\t +67777667 ns\/op/);
  assert.match(text, /BenchmarkShardOpen-4 \tno result in this form/);
  // go prints the bare name of a benchmark with sub-benchmarks; it is no output to show.
  assert.doesNotMatch(text, /^(?:\[[^\]]*\] )?BenchmarkShardInsert\s*$/m, text);
  assert.doesNotMatch(text, /=== RUN/, text);
});

test('goEvents gives a benchmark whose package failed before its result its output without the lines of its runs (K919)', () => {
  const failures: string[] = [];
  const sink = { ...counting(), fail: (_test: TestRef, _ms?: number, text?: string) => { failures.push(text ?? ''); } };
  const feed = goEvents(sink);
  for (const event of [
    { Action: 'start', Package: 'p' },
    { Action: 'run', Package: 'p', Test: 'BenchmarkX' },
    { Action: 'output', Package: 'p', Test: 'BenchmarkX', Output: '=== RUN   BenchmarkX\n' },
    { Action: 'output', Package: 'p', Test: 'BenchmarkX', Output: 'BenchmarkX-4 \t' },
    { Action: 'fail', Package: 'p', Elapsed: 1 },
  ]) feed(JSON.stringify(event));
  assert.deepEqual(failures.slice(0, 1), ['its package failed before the benchmark printed its result\nBenchmarkX-4 \t'.trimEnd()]);
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

/** A progress that keeps its output, with the reader of `make` on it; `close` ends the reader and then the progress. */
function reading<R extends { end(): void }>(make: (sink: Sink) => R): { reader: R; close: () => { ok: boolean; failed: number; text: string } } {
  const lines: string[] = [];
  const progress = createProgress({ write: text => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const reader = make(toProgress(progress, text => lines.push(text)));
  return {
    reader,
    close: () => {
      reader.end();
      const result = progress.close('run');
      return { ok: result.ok, failed: result.failed, text: lines.join('') };
    },
  };
}

test('goEvents fails a test that did not finish when its package ended, or when the output ended, with its output (K1136)', () => {
  const ended = reading(sink => goEvents(sink));
  for (const event of [
    { Action: 'start', Package: 'p' },
    { Action: 'run', Package: 'p', Test: 'TestPanics' },
    { Action: 'output', Package: 'p', Test: 'TestPanics', Output: 'panic: boom\n' },
    { Action: 'output', Package: 'p', Test: 'TestPanics', Output: 'goroutine 7 [running]:\n' },
    { Action: 'fail', Package: 'p', Elapsed: 2 },
  ]) ended.reader(JSON.stringify(event));
  const panicked = ended.close();
  assert.match(panicked.text, /✖ p › TestPanics[^\n]*\n(?:.*\n)*?\s+the test did not finish before its package failed\n\s+panic: boom\n\s+goroutine 7 \[running\]:/, panicked.text);
  assert.doesNotMatch(panicked.text, /the test did not finish\n/);

  const stopped = reading(sink => goEvents(sink));
  for (const event of [
    { Action: 'start', Package: 'p' },
    { Action: 'run', Package: 'p', Test: 'TestHangs' },
    { Action: 'output', Package: 'p', Test: 'TestHangs', Output: '    hang_test.go:9: PROBE\n' },
    { Action: 'output', Package: 'p', Test: 'TestHangs', Output: 'unfinished line' },
  ]) stopped.reader(JSON.stringify(event));
  const timedOut = stopped.close();
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.text, /the test did not finish before the output of go test ended\n\s+hang_test\.go:9: PROBE\n\s+unfinished line/, timedOut.text);
});

test('goEvents fails a benchmark that passed at its result line and then failed, as in its b.Cleanup (K1137)', () => {
  const run = reading(sink => goEvents(sink));
  for (const event of [
    { Action: 'start', Package: 'p' },
    { Action: 'run', Package: 'p', Test: 'BenchmarkA' },
    { Action: 'output', Package: 'p', Test: 'BenchmarkA', Output: 'BenchmarkA   \t     100\t       5.0 ns/op\n' },
    { Action: 'output', Package: 'p', Test: 'BenchmarkA', Output: '    a_test.go:12: cleanup failed\n' },
    { Action: 'fail', Package: 'p', Test: 'BenchmarkA', Elapsed: 0.1 },
    { Action: 'pass', Package: 'p', Elapsed: 0.2 },
  ]) run.reader(JSON.stringify(event));
  const result = run.close();
  assert.equal(result.ok, false, result.text);
  assert.match(result.text, /✖ p › BenchmarkA[^\n]*\n\s+the benchmark failed after its result line\n\s+a_test\.go:12: cleanup failed/, result.text);
});

test('phpunitEvents keeps the failure of a test that never finished, and prints the messages that it does not read (K1138)', () => {
  const run = reading(sink => phpunitEvents(sink));
  for (const line of [
    "##teamcity[testStarted name='testFatal' locationHint='php_qn:///t/ATest.php::\\\\ATest::testFatal' flowId='1']",
    "##teamcity[testStdOut name='testFatal' out='printed by the test|n' flowId='1']",
    "##teamcity[testFailed name='testFatal' message='Allowed memory size exhausted' details='' flowId='1']",
    "##teamcity[unknownMessage name='x' flowId='1']",
  ]) run.reader(line);
  const result = run.close();
  assert.equal(result.ok, false);
  assert.match(result.text, /✖ \\?ATest::testFatal[^\n]*\n\s+the test did not finish\n\s+Allowed memory size exhausted/, result.text);
  assert.match(result.text, /printed by the test/);
  assert.match(result.text, /##teamcity\[unknownMessage name='x' flowId='1'\]/);
});

test('startResultLines prints the rest without a line end and fails a test that did not finish with its lines (K1139)', () => {
  const run = reading(sink => cargoEvents(sink));
  run.reader.stderr('     Running unittests src/lib.rs (target/debug/deps/lib-1)');
  run.reader.stdout('running 1 test\ntest a::aborts ... \nwritten by the test\nthe last line without an end');
  const result = run.close();
  assert.equal(result.ok, false);
  assert.match(result.text, /✖ target\/debug\/deps\/lib-1\) › a::aborts|✖ [^\n]*a::aborts[^\n]*\n\s+the test did not finish before the output ended\n\s+written by the test\n\s+the last line without an end/, result.text);
  assert.match(result.text, /the last line without an end/);
});

test('pythonEvents reads the JSON events of runners/python.py and fails a test without an outcome (K1194)', () => {
  const run = reading(sink => pythonEvents(sink));
  const event = (value: Record<string, string>) => `${JSON.stringify(value)}`;
  run.reader(event({ event: 'start', id: 'test_a (m.C.test_a)' }));
  run.reader(event({ event: 'pass', id: 'test_a (m.C.test_a)' }));
  // The error of a setUpClass comes as an outcome with no start.
  run.reader(event({ event: 'fail', id: 'setUpClass (m.D)', text: 'Traceback: boom' }));
  run.reader(event({ event: 'start', id: 'test_c (m.E.test_c)' }));
  run.reader.end();
  const result = run.close();
  assert.equal(result.ok, false);
  assert.match(result.text, /✔ test_a \(m\.C\.test_a\)/, result.text);
  assert.match(result.text, /✖ setUpClass \(m\.D\)[^\n]*\n\s+Traceback: boom/, result.text);
  assert.match(result.text, /✖ test_c \(m\.E\.test_c\)[^\n]*\n\s+the test started and the run ended before its outcome/, result.text);
});
