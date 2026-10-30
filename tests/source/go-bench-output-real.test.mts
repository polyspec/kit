// The test runner reads the result line of a real Go benchmark on every platform of CI (K919). testing writes the name of the
// result line and its results in two writes; whether test2json reads them as one output event or two depends on the pipe of
// the platform, so this test runs the whole path on each runner rather than forcing a split. Runs the pinned go of this checkout.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../../scripts/kit/run-tests.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the runner prints the result line of a real Go benchmark (K919)', async (t) => {
  const module = mkdtempSync(path.join(tmpdir(), 'kit-go-bench-'));
  t.after(() => rmSync(module, { recursive: true, force: true }));
  writeFileSync(path.join(module, 'go.mod'), 'module example.com/bench\n\ngo 1.27\n');
  writeFileSync(path.join(module, 'bench_test.go'), 'package bench\n\nimport (\n\t"testing"\n\t"time"\n)\n\nfunc BenchmarkSleep(b *testing.B) {\n\tfor range b.N {\n\t\ttime.Sleep(200 * time.Millisecond)\n\t}\n}\n');
  const lines: string[] = [];
  const status = await run(['go', '--cwd', module, '--', '-run', '^$', '-bench', '.', '-benchtime', '1x', '.'], { root: ROOT, write: text => lines.push(text) });
  const text = lines.join('');
  assert.equal(status, 0, text);
  assert.match(text, /BenchmarkSleep(?:-\d+)?\s+1\s+\d+ ns\/op/, text);
});
