// The events of a node test reach run-tests when the test ends, also when the tests block the event loop: a file of synchronous
// tests that together run longer than the deadline, each well within it, passes, instead of being stopped by the gap watch of
// run-tests (K371-1) because its events arrived only when the file ended.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { tool } from './kit-tools.mts';
import { tree } from './tree.mts';

test('declared setup and teardown may outlast the case deadline while their short test still runs (K662)', { timeout: 30_000 }, (t) => {
  const hooks = pathToFileURL(tool(import.meta.resolve('../../scripts/kit/test-hooks.mts'))).href;
  const source = `import test from 'node:test';\nimport { spawnSync } from 'node:child_process';\nimport { setup, teardown } from ${JSON.stringify(hooks)};\nsetup('installation', async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });\nteardown('cleanup', () => { const result = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1200)']); if (result.status !== 0) throw new Error('cleanup failed'); });\ntest('short assertion', () => {});\n`;
  const root = tree(t, { 'tests/setup.test.mjs': source });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '1', '--', 'tests/setup.test.mjs'], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.match(output, /1 passed, 0 failed, 0 timed out/);
  assert.match(output, /\[setup\] installation: finished/);
  assert.match(output, /\[teardown\] cleanup: finished/);
  assert.doesNotMatch(output, /kit-test-operation /, 'structured control events are not test output');
});

test('a declared setup failure fails the run and keeps its original error (K662)', (t) => {
  const hooks = pathToFileURL(tool(import.meta.resolve('../../scripts/kit/test-hooks.mts'))).href;
  const source = `import test from 'node:test';\nimport { setup } from ${JSON.stringify(hooks)};\nsetup('installation', () => { throw new Error('installation fixture failed'); });\ntest('short assertion', () => {});\n`;
  const root = tree(t, { 'tests/setup-failure.test.mjs': source });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '1', '--', 'tests/setup-failure.test.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /installation fixture failed/);
});

test('a file of synchronous tests that together outlast the deadline reports each test when it ends', { timeout: 60_000 }, (t) => {
  // Three tests of 1.5 s each block the event loop for 4.5 s in all; the deadline is 2 s.
  const sync = "import test from 'node:test';\nimport { spawnSync } from 'node:child_process';\nfor (const n of [1, 2, 3]) test(`sync ${n}`, () => { spawnSync('sleep', ['1.5']); });\n";
  const root = tree(t, { 'tests/sync.test.mjs': sync });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '2', '--', 'tests/sync.test.mjs'], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.match(output, /3 passed, 0 failed, 0 timed out/);
});

test('a test that mocks setTimeout ends, since the turn around each test keeps the setTimeout of the process start (K547)', { timeout: 60_000 }, (t) => {
  const mocked = "import test from 'node:test';\ntest('mocks the timers', (t) => { t.mock.timers.enable({ apis: ['setTimeout'] }); });\ntest('runs after it', () => {});\n";
  const root = tree(t, { 'tests/mocked.test.mjs': mocked });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '2', '--', 'tests/mocked.test.mjs'], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.match(output, /2 passed, 0 failed, 0 timed out/);
});

// K943: a running test is bounded by its own declared timeout, which node applies, and the file default applies only when a test
// declares none; the watch of the preload stays off while a test runs.
test('a case that declares 60 s and takes 40 s passes under a 30 s file default (K943)', { timeout: 120_000 }, (t) => {
  const slow = "import test from 'node:test';\ntest('declares 60 s and takes 40 s', { timeout: 60000 }, async () => { await new Promise(resolve => setTimeout(resolve, 40000)); });\n";
  const root = tree(t, { 'tests/slow40.test.mjs': slow });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '30', '--', 'tests/slow40.test.mjs'], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.match(output, /1 passed, 0 failed, 0 timed out/);
});

// Guard: node ends a test that never settles at its declared timeout, and the process then exits by its own means.
test('a case that never settles is ended by node at its declared timeout, not at the file default (K943)', { timeout: 60_000 }, (t) => {
  const stuck = "import test from 'node:test';\ntest('never settles', { timeout: 2000 }, async () => { await new Promise(() => {}); });\n";
  const root = tree(t, { 'tests/stuck-declared.test.mjs': stuck });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '30', '--', 'tests/stuck-declared.test.mjs'], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, output);
  assert.match(output, /timed out after 2000ms/);
});

// Guard: the watch after the last test still ends a process that does not exit.
test('a process that outlives its last test is ended after the deadline with its open handle named (K943)', { timeout: 60_000 }, (t) => {
  const leak = "import test from 'node:test';\ntest('passes and leaves a timer', () => { setInterval(() => {}, 1000); });\n";
  const root = tree(t, { 'tests/leak-after.test.mjs': leak });
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '2', '--', 'tests/leak-after.test.mjs'], { cwd: root, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, output);
  assert.match(output, /did not exit 2000 ms after its last test/);
});
