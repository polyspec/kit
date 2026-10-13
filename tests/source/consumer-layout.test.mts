// The vendored tests in the layout of a consumer. kit vendors scripts/kit and tests/kit to every repository, and a consumer
// holds neither workflows/ (its workflow is the vendored copy .github/workflows/release.yml) nor tests/source. A vendored test
// that reads a kit-only path passes in kit and fails in every consumer, as K66 did on v0.0.29. This case builds that layout
// from the tracked files of the kit (with the installed tools of var/tools, which the consumer has after make install-tools) and
// runs the vendored tests there.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyInstalledTools, copyTracked, KIT_TEST_TIMEOUT_MS, runKitTest } from './checkout.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The copies of the kit (kit.copies of its package.json), and the paths of the kit that no consumer holds: the source of each
// copy at another path, and the kit's own tests.
const COPIES: Record<string, string> = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).kit?.copies ?? {};
const KIT_ONLY = [...Object.entries(COPIES).filter(([copy, source]) => copy !== source).map(([, source]) => source), 'tests/source/'];

test('the vendored tests pass in the layout of a consumer', { timeout: KIT_TEST_TIMEOUT_MS }, async (t) => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'kit-consumer-layout-'));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  copyTracked(ROOT, sandbox, file => !KIT_ONLY.some(only => (only.endsWith('/') ? file.startsWith(only) : file === only)));
  for (const [copy, source] of Object.entries(COPIES)) {
    mkdirSync(path.join(sandbox, path.dirname(copy)), { recursive: true });
    cpSync(path.join(ROOT, source), path.join(sandbox, copy));
  }
  copyInstalledTools(ROOT, sandbox);
  // The consumer's own command: make kit-test runs the vendored tests through the kit's test runner.
  const { status, output, passed } = await runKitTest(sandbox, t.signal);
  assert.ok(passed > 0, 'the vendored tests ran');
  // A failed case prints `✖ tests/kit/<file> › <case> (<time>)`, a file that failed to load `✖ tests/kit/<file> (<time>)`.
  const failed = [...output.matchAll(/✖ (tests\/kit\/[^\n]*?) \(\d[^)]*\)/g)].map(match => match[1]);
  assert.equal(status, 0, `vendored tests failed in the consumer layout:\n${[...new Set(failed)].join('\n')}`);
});
