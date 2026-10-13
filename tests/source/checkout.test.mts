// The parts of var/ that a sandbox takes from the checkout (K91). Other source tests write under var/ while a sandbox copies
// it: python-lock-real.test.mts keeps its run in var/python-lock-real-<pid>, and uv writes its cache var/tools/uv-cache. A
// copy of all of var/ met a file that such a run removed (ENOENT under var/python-lock-real-<pid>/tmp/pip-build-env-*).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtCopy, installedTool, runKitTest } from './checkout.mts';

test('a sandbox takes the installed tools of var/tools and neither the cache of uv nor the runs of other tests', () => {
  assert.equal(installedTool('var/tools/bin/python3'), true);
  assert.equal(installedTool('var/tools/uv-python/cpython-3.14/bin/python3'), true);
  assert.equal(installedTool('var/tools'), true);
  assert.equal(installedTool('var/tools/uv-cache'), false);
  assert.equal(installedTool('var/tools/uv-cache/archive-v0/x/a.py'), false);
  assert.equal(installedTool('var/python-lock-real-83112/tmp/pip-build-env-x/overlay'), false);
  assert.equal(installedTool('var/kit-test.log'), false);
});

// The nested make kit-test of runKitTest runs in its own process group, which ends with the case: when the run closes,
// when the test is cancelled or times out, and when the test process receives SIGTERM or SIGINT (K104). A stub Makefile
// stands in for the kit: its kit-test target starts a sleep in the background and records its pid.
const CHECKOUT = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'checkout.mts')).href;
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/run-tests.mts');

/** Whether the process `pid` exists. */
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; // process.kill throws an errno error.
    return true;
  }
}

/** Waits until `ready` holds, polling every 50 ms, for at most `ms` milliseconds; whether it held. */
async function until(ready: () => boolean, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) if (ready()) return true;
  return ready();
}

/**
 * A stub checkout whose make kit-test starts `sleep 30` in the background and records its pid in sleep.pid. With `wait` the
 * target waits for the sleep; without it the target prints a summary and exits while the sleep runs on. The sleep is
 * killed with `t.after` when it is still alive.
 */
function stubCheckout(t: TestContext, wait: boolean) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-run-kit-test-'));
  const pidFile = path.join(directory, 'sleep.pid');
  writeFileSync(path.join(directory, 'Makefile'), `kit-test:\n\t@sleep 30 > /dev/null 2>&1 & echo $$! > sleep.pid; ${wait ? 'wait' : "echo 'node --test: 3 passed, 0 failed'"}\n`);
  writeFileSync(path.join(directory, 'stub.test.mts'), `import test from 'node:test';\nimport { runKitTest } from ${JSON.stringify(CHECKOUT)};\ntest('the nested run', async (t) => { await runKitTest(${JSON.stringify(directory)}, t.signal); });\n`);
  const sleepPid = () => (existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : undefined);
  t.after(() => {
    const pid = sleepPid();
    if (pid !== undefined && alive(pid)) process.kill(pid, 'SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, sleepPid };
}

test('runKitTest returns the summary of the nested run and ends what the run left in its process group', async (t) => {
  const { directory, sleepPid } = stubCheckout(t, false);
  const run = await runKitTest(directory, t.signal);
  assert.deepEqual([run.status, run.passed, run.failed], [0, 3, 0]);
  const pid = sleepPid();
  assert.ok(pid, 'the stub recorded no sleep');
  assert.ok(await until(() => !alive(pid), 5000), `the sleep ${pid} that the run left is still alive`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`a ${signal} to the test process ends the process group of its nested run`, async (t) => {
    const { directory, sleepPid } = stubCheckout(t, true);
    const child = spawn(process.execPath, [path.join(directory, 'stub.test.mts')], { stdio: 'ignore' });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    assert.ok(await until(() => sleepPid() !== undefined, 10000), 'the nested run started no sleep');
    const pid = sleepPid();
    assert.ok(pid);
    child.kill(signal);
    assert.ok(await until(() => !alive(pid), 5000), `the sleep ${pid} of the nested run outlived the ${signal} to the test process`);
  });
}

test('a test that run-tests times out ends the process group of its nested run', async (t) => {
  const { directory, sleepPid } = stubCheckout(t, true);
  const child = spawn(process.execPath, [RUNNER, 'node', '--timeout', '1', '--', path.join(directory, 'stub.test.mts')], { cwd: directory, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  assert.ok(await until(() => sleepPid() !== undefined, 10000), 'the nested run started no sleep');
  const pid = sleepPid();
  assert.ok(pid);
  assert.ok(await until(() => child.exitCode !== null && !alive(pid), 10000), `the run did not end with its 1 s timeout, or the sleep ${pid} outlived it`);
  assert.equal(child.exitCode, 1, 'the run of a timed-out test fails');
});

test('builtCopy installs the packages of kit into the copy and links none', (t) => {
  const copy = builtCopy(t);
  // AGENTS: this repository creates no symbolic link; the copy installs its packages as a checkout does.
  assert.ok(!lstatSync(path.join(copy, 'node_modules')).isSymbolicLink(), 'node_modules of the copy is a link');
  assert.ok(existsSync(path.join(copy, 'node_modules/typescript/package.json')), 'the copy holds the packages of package-lock.json');
  assert.ok(existsSync(path.join(copy, 'dist/kit.mk')), 'make build ran in the copy');
});
