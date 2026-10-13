// The vendored tests in a fresh checkout, before make install-tools has created var/ (K90, K81). A vendored test runs in
// every consumer, and a consumer declares only the toolchains it uses (flowmark declares none), so a vendored test needs
// nothing that make install-tools provides: it creates what it needs, and a test of a real toolchain lives in tests/source.
// A test that wrote under var/ without creating it failed with a bare ENOENT (python-lock-check.test.mjs made its temporary
// directories in var/), and a real unittest case in tests/kit/parity.test.mjs failed in flowmark, which cannot install
// the Python it asked for.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyTracked, runKitTest } from './checkout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The failed cases of a kit-test output, each with the indented lines of its error. */
export function failedCases(output) {
  const cases = [];
  let current = null;
  for (const line of output.split('\n')) {
    const failed = /^\[[^\]]*\] ✖ (tests\/kit\/[^\n]*? › [^\n]*?) \(\d[^)]*\)$/.exec(line);
    if (failed) {
      current = { name: failed[1], error: '' };
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

test('in a checkout without var/, every vendored test passes', (t) => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'kit-fresh-checkout-'));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  copyTracked(ROOT, sandbox);
  const { output, passed } = runKitTest(sandbox);
  assert.ok(passed > 0, 'the vendored tests ran');
  assert.deepEqual(failedCases(output).map(failed => `${failed.name}\n  ${failed.error.split('\n')[0]}`), []);
});
