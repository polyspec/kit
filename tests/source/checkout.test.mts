// The parts of var/ that a sandbox takes from the checkout (K91). Other source tests write under var/ while a sandbox copies
// it: python-lock-real.test.mts keeps its run in var/python-lock-real-<pid>, and uv writes its cache under var/tools/mise/cache. A
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
import { initRepository } from '../kit/sandbox-repository.mts';
import { errorCode } from '../../scripts/kit/process.mts';

test('a sandbox takes the installed tools of var/tools and neither the caches of mise and uv nor the runs of other tests', () => {
  assert.equal(installedTool('var/tools/mise/shims/python3'), true);
  assert.equal(installedTool('var/tools/mise/installs/python/3.14.8/bin/python3'), true);
  assert.equal(installedTool('var/tools'), true);
  assert.equal(installedTool('var/tools/mise/cache'), false);
  assert.equal(installedTool('var/tools/mise/cache/uv/archive-v0/x/a.py'), false);
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
    if (errorCode(error) === 'ESRCH') return false; // process.kill throws an errno error.
    return true;
  }
}

/**
 * Waits until `ready` holds, looking every 50 ms. There is no window of time: a case waits for the state it asserts, and the
 * timeout of the case ends one whose state never comes (CASE, or the shorter one of run-tests), so a slow machine is no
 * failure (K34-3-1).
 */
async function until(ready: () => boolean) {
  while (!ready()) await new Promise(resolve => setTimeout(resolve, 50));
}

// The timeout of each case below: far beyond what a loaded machine takes, and far below the sleep of the stub, which
// therefore never ends by itself within a case.
const CASE = { timeout: 120_000 };

/**
 * A stub checkout whose make kit-test starts `sleep 600` in the background and records its pid in sleep.pid. With `wait` the
 * target waits for the sleep; without it the target prints a summary and exits while the sleep runs on. The sleep is
 * killed with `t.after` when it is still alive.
 */
function stubCheckout(t: TestContext, wait: boolean) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-run-kit-test-'));
  // The tools of kit run in a checkout and resolve its root through Git (K144), so the stub is a repository.
  initRepository(directory);
  const pidFile = path.join(directory, 'sleep.pid');
  writeFileSync(path.join(directory, 'Makefile'), `kit-test:\n\t@sleep 600 > /dev/null 2>&1 & echo $$! > sleep.pid; ${wait ? 'wait' : "echo 'node --test: 3 passed, 0 failed'"}\n`);
  writeFileSync(path.join(directory, 'stub.test.mts'), `import test from 'node:test';\nimport { runKitTest } from ${JSON.stringify(CHECKOUT)};\ntest('the nested run', async (t) => { await runKitTest(${JSON.stringify(directory)}, t.signal); });\n`);
  // The shell creates sleep.pid before it writes the pid and its newline, so only a whole line is the pid.
  const sleepPid = () => {
    const text = existsSync(pidFile) ? readFileSync(pidFile, 'utf8') : '';
    return text.endsWith('\n') ? Number(text.trim()) : undefined;
  };
  t.after(() => {
    const pid = sleepPid();
    if (pid !== undefined && alive(pid)) process.kill(pid, 'SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, sleepPid };
}

test('runKitTest returns the summary of the nested run and ends what the run left in its process group', CASE, async (t) => {
  const { directory, sleepPid } = stubCheckout(t, false);
  const run = await runKitTest(directory, t.signal);
  assert.deepEqual([run.status, run.passed, run.failed], [0, 3, 0]);
  const pid = sleepPid();
  assert.ok(pid, 'the stub recorded no sleep');
  // runKitTest has signaled the group when it returns; the sleep ends with that signal.
  await until(() => !alive(pid));
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`a ${signal} to the test process ends the process group of its nested run`, CASE, async (t) => {
    const { directory, sleepPid } = stubCheckout(t, true);
    const child = spawn(process.execPath, [path.join(directory, 'stub.test.mts')], { stdio: 'ignore' });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    await until(() => sleepPid() !== undefined);
    const pid = sleepPid();
    assert.ok(pid);
    const exited = new Promise(resolve => child.once('exit', (code, received) => resolve(received)));
    child.kill(signal);
    // The test process signals the group before it ends with the signal, so the sleep ends after it.
    assert.equal(await exited, signal, `the test process did not end with the ${signal}`);
    await until(() => !alive(pid));
  });
}

test('a test that run-tests times out ends the process group of its nested run', CASE, async (t) => {
  const { directory, sleepPid } = stubCheckout(t, true);
  const child = spawn(process.execPath, [RUNNER, 'node', '--timeout', '1', '--', path.join(directory, 'stub.test.mts')], { cwd: directory, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await until(() => sleepPid() !== undefined);
  const pid = sleepPid();
  assert.ok(pid);
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  // run-tests ends the test at its 1 s timeout; node:test aborts it and runKitTest signals the group.
  assert.equal(await exited, 1, 'the run of a timed-out test fails');
  await until(() => !alive(pid));
});

test('builtCopy installs the packages of kit into the copy and links none', (t) => {
  const copy = builtCopy(t);
  // AGENTS: this repository creates no symbolic link; the copy installs its packages as a checkout does.
  assert.ok(!lstatSync(path.join(copy, 'node_modules')).isSymbolicLink(), 'node_modules of the copy is a link');
  assert.ok(existsSync(path.join(copy, 'node_modules/typescript/package.json')), 'the copy holds the packages of package-lock.json');
  assert.ok(existsSync(path.join(copy, 'dist/kit.mk')), 'make build ran in the copy');
});
