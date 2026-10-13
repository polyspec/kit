// The vendored tests in a fresh checkout (K90, K81, K127). A vendored test runs in every consumer and needs only node and the
// stubs of the tools that it reads. The fresh checkout runs the documented install, as a consumer and CI do: make
// install-tools TOOLS=npm (npm and mise), make install-packages, make install-tools (the tools of mise.lock), then make
// kit-test. The installs download, so this test runs ONLINE, as CI does: the wrapper of mise keeps its downloads in the
// var/tools/mise of each checkout, and the sandbox has no clean way to read the cache of this one. A test that wrote under
// var/ without creating it failed with a bare ENOENT (python-lock-check.test.mts made its temporary directories in var/), and
// a real unittest case in tests/kit/parity.test.mts failed in flowmark, which cannot install the Python it asked for.
import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { commitSandbox, copyTracked, KIT_TEST_TIMEOUT_MS, run, runKitTest } from './checkout.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The failed cases of a kit-test output, each with the indented lines of its error, and each test file that failed as a
 * whole, without a failed case of its own (an error outside the cases), with its error.
 */
export function failedCases(output: string) {
  const cases: Array<{ name: string; error: string }> = [];
  let current: { name: string; error: string } | null = null;
  for (const line of output.split('\n')) {
    const failed = /^\[[^\]]*\] ✖ (tests\/kit\/[^\n]*?) \(\d[^)]*\)$/.exec(line);
    if (failed) {
      const name = failed[1];
      if (name === undefined) throw new Error(`failedCases: the line names no case: ${line}`);
      current = { name, error: '' };
      cases.push(current);
    } else if (current && /^\s{2,}\S/.test(line) && !line.startsWith('[')) {
      current.error += `${line.trim()}\n`;
    } else {
      current = null;
    }
  }
  // A file line closes the cases of a file that failed; it names a failure of its own only when no case of it failed.
  const files = new Set(cases.filter(entry => entry.name.includes(' › ')).map(entry => entry.name.split(' › ')[0]));
  return cases.filter(entry => entry.name.includes(' › ') || !files.has(entry.name));
}

/**
 * Fails unless the kit-test run `run` passed: the message names every failed case and file with its whole error, read from
 * the whole output; a failure that names no case gives the whole output.
 */
export function assertKitTestPassed(run: { output: string; passed: number; failed: number }) {
  assert.ok(run.passed > 0, 'the vendored tests ran');
  const failures = failedCases(run.output);
  if (run.failed === 0 && failures.length === 0) return;
  const report = failures.map(failed => `${failed.name}\n${failed.error.replace(/^/gm, '  ').trimEnd()}`).join('\n');
  assert.fail(`make kit-test: ${run.failed} failed\n${report || run.output}`);
}

test('a failed run names every failed case and file with its whole error, however long the output after it (K129)', () => {
  const output = [
    '[  0.1s] ✖ tests/kit/early.test.mts › breaks first (0.1s)',
    '           AssertionError: the first line',
    '           the second line of the error',
    '[  0.2s] ✖ tests/kit/early.test.mts (0.2s)',
    '           test failed',
    ...Array.from({ length: 200 }, (_, index) => `[  1.0s] ✔ tests/kit/late.test.mts › case ${index} (0.0s)`),
    '[  2.0s] ✖ tests/kit/release.test.mts (1.0s)',
    '           Error: the file failed as a whole',
    '[  3.0s] ✖ node --test: 200 passed, 2 failed, 0 timed out, 0 skipped (3.0s)',
  ].join('\n');
  assert.throws(() => assertKitTestPassed({ output, passed: 200, failed: 2 }), (error: Error) => {
    for (const part of ['tests/kit/early.test.mts › breaks first', 'the first line', 'the second line of the error', 'tests/kit/release.test.mts', 'the file failed as a whole']) {
      assert.ok(error.message.includes(part), `the message lacks ${part}:\n${error.message}`);
    }
    return true;
  });
});

test('failedCases reads each failed case with its error, and no passed case', () => {
  const output = [
    '[  1.0s] ✔ tests/kit/a.test.mjs › passes (0.1s)',
    '[  1.0s] ✖ tests/kit/a.test.mjs › needs tools (0.1s)',
    '           Error: run make install-tools TOOLS="python"',
    '               at x',
    '[  1.1s] ✖ tests/kit/a.test.mjs (0.2s)',
    '           test failed',
  ].join('\n');
  assert.deepEqual(failedCases(output), [
    { name: 'tests/kit/a.test.mjs › needs tools', error: 'Error: run make install-tools TOOLS="python"\nat x\n' },
  ]);
});

test('in a fresh checkout after the documented install, every vendored test passes', { timeout: KIT_TEST_TIMEOUT_MS }, async (t) => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'kit-fresh-checkout-'));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  copyTracked(ROOT, sandbox);
  commitSandbox(sandbox);
  for (const args of [['install-tools', 'TOOLS=npm'], ['install-packages'], ['install-tools']]) run('make', ['--no-print-directory', ...args], sandbox);
  // The fresh checkout installs its packages; it links none (AGENTS: this repository creates no symbolic link).
  assert.ok(!lstatSync(path.join(sandbox, 'node_modules')).isSymbolicLink(), 'node_modules of the fresh checkout is a link');
  assertKitTestPassed(await runKitTest(sandbox, t.signal));
});
