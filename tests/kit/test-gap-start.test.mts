// The gap watch of run-tests bounds the start of a tool's process by the start-up bound, not by the test timeout: a process that
// takes longer than the timeout to start, as an interpreter does on a loaded machine, runs its tests; a silent gap after the
// process reported that it is up still stops the run at the timeout, and a process that never reports it is stopped at the
// start-up bound (K549, follows K371-1).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { run } from '../../scripts/kit/run-tests.mts';
import { tool } from './kit-tools.mts';
import { tree } from './tree.mts';

// The line that a test process writes when it is up: PROCESS_UP of test-gap.mts.
const PROCESS_UP = 'kit-test-process-up';

// The tests of the runner's mechanics run whole directories, which only a CI run may do (ci-only.mts).
const CI = { GITHUB_ACTIONS: 'true' };

// A pause of the process that runs the line, which blocks its event loop as a slow start does.
const pause = (ms: number) => `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});`;

/** A checkout whose python3 is a node script that runs `script`, which writes the lines that unittest writes to stderr. */
function pythonCheckout(t: TestContext, script: string) {
  const root = tree(t);
  const file = path.join(root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(file, 0o755);
  return root;
}

async function runPython(root: string, startUpMs?: number) {
  const lines: string[] = [];
  const status = await run(['python', '--timeout', '2', 'tests'], { root, write: (text: string) => lines.push(text), callerEnv: CI, ...(startUpMs === undefined ? {} : { startUpMs }) });
  return { status, text: lines.join('') };
}

test('a python process that takes longer than the timeout to report that it is up runs its tests (K549)', { timeout: 60_000 }, async (t) => {
  const root = pythonCheckout(t, `${pause(3000)}\nprocess.stderr.write(${JSON.stringify(`${PROCESS_UP}\ntest_a (t.T.test_a) ... ok\n`)});`);
  const { status, text } = await runPython(root);
  assert.equal(status, 0, text);
  assert.match(text, /1 passed, 0 failed, 0 timed out/);
  assert.doesNotMatch(text, new RegExp(PROCESS_UP), 'the report of the process is no output of the run');
});

test('a silent gap after the process reported that it is up stops the run at the timeout (K549)', { timeout: 60_000 }, async (t) => {
  const root = pythonCheckout(t, `process.stderr.write(${JSON.stringify(`${PROCESS_UP}\n`)});\n${pause(5000)}\nprocess.stderr.write('test_a (t.T.test_a) ... ok\\n');`);
  const began = Date.now();
  const { status, text } = await runPython(root);
  assert.equal(status, 1, text);
  assert.match(text, /⏱ no test started within 2 s after the start of the run; the run elapsed/);
  assert.ok(Date.now() - began < 4500, `the run took ${Date.now() - began} ms, expected the stop at 2 s`);
});

test('a process that never reports that it is up is stopped at the start-up bound, which its message names (K549)', { timeout: 60_000 }, async (t) => {
  const root = pythonCheckout(t, 'setInterval(() => {}, 1000);');
  const { status, text } = await runPython(root, 3000);
  assert.equal(status, 1, text);
  assert.match(text, /⏱ the process of the tool did not report that it is up within 3 s after the start of the run; the run elapsed/);
});

test('the process of a node file that starts slower than the timeout, after a file that passed, runs its tests (K549)', { timeout: 60_000 }, (t) => {
  // The process of tests/slow.test.mjs pauses for 3 s before the preload of run-tests runs, as a slow start does.
  const root = tree(t, {
    'tests/fast.test.mjs': "import test from 'node:test';\ntest('fast', () => {});\n",
    'tests/slow.test.mjs': "import test from 'node:test';\ntest('slow', () => {});\n",
    'slow-start.mjs': `if (process.env.NODE_TEST_CONTEXT && process.argv[1]?.endsWith('slow.test.mjs')) ${pause(3000)}\n`,
  });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '2', '--', 'tests/fast.test.mjs', 'tests/slow.test.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import=${path.join(root, 'slow-start.mjs')}` } });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.match(output, /2 passed, 0 failed, 0 timed out/);
  assert.doesNotMatch(output, new RegExp(PROCESS_UP), 'the report of the process is no output of the run');
});
