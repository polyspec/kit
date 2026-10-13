// A copy of the tracked files of the kit in a sandbox, for the source tests that run the vendored tests in another layout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** Copies every tracked file of `root` that `keep` accepts to the same path under `sandbox`. */
export function copyTracked(root, sandbox, keep = () => true) {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    if (!keep(file)) continue;
    mkdirSync(path.join(sandbox, path.dirname(file)), { recursive: true });
    cpSync(path.join(root, file), path.join(sandbox, file));
  }
}

/** Runs make kit-test in `cwd` and returns its exit status, its output and the summary counts. */
export function runKitTest(cwd) {
  const run = spawnSync('make', ['--no-print-directory', 'kit-test'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  const output = run.stdout + run.stderr;
  const summary = /node --test: (\d+) passed, (\d+) failed/.exec(output);
  assert.ok(summary, `make kit-test printed no summary:\n${output.slice(-2000)}`);
  return { status: run.status, output, passed: Number(summary[1]), failed: Number(summary[2]) };
}
