// Tests of the node:test reader of scripts/kit/test-output.mts (nodeEvents) and of its package export. The reader reads the
// lines of parity-node-reporter.mts, which node --test prints for each test that ends; a run of node --test over a fixture
// test file in a temporary folder gives those lines. The export test imports the built package by its name and needs
// make build first, since the export resolves to dist/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cargoEvents, nodeEvents, type Sink, type TestRef } from '../../scripts/kit/test-output.mts';
import { outcomesOf, runOf } from '../../scripts/kit/parity-runners.mts';
import { tool } from './kit-tools.mts';

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

// The lines that cargo test of a database target prints when a case's database is missing: the case database
// prints its step between the name of the test and its result, so the result FAILED stands alone on its line (K229).
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

test('@polyspec/kit/test-output resolves and exposes the five readers (K217)', () => {
  const script = "import * as m from '@polyspec/kit/test-output'; console.log(['goEvents', 'cargoEvents', 'pythonEvents', 'phpunitEvents', 'nodeEvents'].map(name => typeof m[name]).join(' '));";
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8', env: ENV });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'function function function function function');
});

test('a malformed line of the parity node reporter fails the parity run and shows the line (K217)', () => {
  const run = runOf({ runner: 'node' }, ROOT, { test: 'tests/kit/example.test.mts' }, 'feature', ENV);
  if (run.error) assert.fail(run.error);
  assert.throws(
    () => outcomesOf(run, { stdout: '{"name":"adds","outcome":"pass"}\nnot a case\n', stderr: '' }),
    /not a case/,
  );
});
