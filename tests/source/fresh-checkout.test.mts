// The vendored tests in a fresh checkout (K90, K81, K127). A vendored test runs in every consumer. One that runs a tool of
// mise.toml runs the pinned tool, never one of the machine: the dependency tests forward go mod edit and composer validate
// to the go and the Composer that the checkout installed (tests/kit/registry.mts). So a fresh checkout runs the documented
// install first, as a consumer and CI do: make install-tools TOOLS=npm (npm and mise), make install-packages, make
// install-tools (the tools of mise.lock), then make kit-test. The installs download, so this test runs ONLINE, as CI does:
// mise keeps its downloads in the var/tools/mise of the checkout, which the wrapper of mise sets, so the sandbox cannot use the
// cache of this checkout without a second setting of its own. A test that wrote under var/ without creating it failed with a
// bare ENOENT (python-lock-check.test.mts made its temporary directories in var/), and a real unittest case in
// tests/kit/parity.test.mts failed in flowmark, which cannot install the Python it asked for.
import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { commitSandbox, copyTracked, KIT_TEST_TIMEOUT_MS, run, runKitTest } from './checkout.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The failed cases of a kit-test output, each with the indented lines of its error. */
export function failedCases(output: string) {
  const cases: Array<{ name: string; error: string }> = [];
  let current: { name: string; error: string } | null = null;
  for (const line of output.split('\n')) {
    const failed = /^\[[^\]]*\] ✖ (tests\/kit\/[^\n]*? › [^\n]*?) \(\d[^)]*\)$/.exec(line);
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
  return cases;
}

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
  const { output, passed } = await runKitTest(sandbox, t.signal);
  assert.ok(passed > 0, 'the vendored tests ran');
  assert.deepEqual(failedCases(output).map(failed => `${failed.name}\n  ${failed.error.split('\n')[0]}`), []);
});
