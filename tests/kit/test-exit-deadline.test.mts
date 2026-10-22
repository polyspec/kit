// The events of a node test reach run-tests when the test ends, also when the tests block the event loop: a file of synchronous
// tests that together run longer than the deadline, each well within it, passes, instead of being stopped by the gap watch of
// run-tests (K371-1) because its events arrived only when the file ended.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { tool } from './kit-tools.mts';
import { tree } from './tree.mts';

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
