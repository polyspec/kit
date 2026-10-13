// A copy of the tracked files of the kit in a sandbox, for the source tests that run the vendored tests in another layout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** Copies every tracked file of `root` that `keep` accepts to the same path under `sandbox`. */
export function copyTracked(root: string, sandbox: string, keep: (file: string) => boolean = () => true) {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    if (!keep(file)) continue;
    mkdirSync(path.join(sandbox, path.dirname(file)), { recursive: true });
    cpSync(path.join(root, file), path.join(sandbox, file));
  }
}

/**
 * Whether `file`, a path of var/ from the checkout root, is part of the installed tools that a consumer holds after make
 * install-tools: var/tools, without the cache of uv (var/tools/uv-cache), which other source tests write while a sandbox
 * copies (K91).
 */
export function installedTool(file: string) {
  const inside = (directory: string) => file === directory || file.startsWith(`${directory}/`);
  return inside('var/tools') && !inside('var/tools/uv-cache');
}

/** Copies the installed tools of the checkout `root` to var/tools of `sandbox`. */
export function copyInstalledTools(root: string, sandbox: string) {
  cpSync(path.join(root, 'var/tools'), path.join(sandbox, 'var/tools'), {
    recursive: true,
    filter: source => installedTool(path.relative(root, source)),
  });
}

/** Runs make kit-test in `cwd` and returns its exit status, its output and the summary counts. */
export function runKitTest(cwd: string) {
  const run = spawnSync('make', ['--no-print-directory', 'kit-test'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  const output = run.stdout + run.stderr;
  const summary = /node --test: (\d+) passed, (\d+) failed/.exec(output);
  assert.ok(summary, `make kit-test printed no summary:\n${output.slice(-2000)}`);
  return { status: run.status, output, passed: Number(summary[1]), failed: Number(summary[2]) };
}
