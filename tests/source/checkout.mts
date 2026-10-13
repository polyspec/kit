// A copy of the tracked files of the kit in a sandbox, for the source tests that run the vendored tests in another layout.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The timeout of a test that runs make kit-test in a sandbox. The whole vendored suite runs there: it took 998 s and 1226 s
 * under the load of a full source-test (K81), far beyond the 30 s default of the runner, which fires now that runKitTest
 * is asynchronous (K104). Half again the slowest measurement.
 */
export const KIT_TEST_TIMEOUT_MS = 30 * 60_000;

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

/**
 * Runs make kit-test in `cwd` and returns its exit status, its output and the summary counts. The nested run is the leader
 * of its own process group, which ends with the case: when the run closes (a process it left behind included), when
 * `signal` aborts (node:test aborts it when the test times out or is cancelled), and when this process receives SIGTERM or
 * SIGINT, which is passed on to the group and then to this process as before. A SIGKILL of this process reaches no handler.
 */
export async function runKitTest(cwd: string, signal: AbortSignal) {
  const child = spawn('make', ['--no-print-directory', 'kit-test'], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const pgid = child.pid;
  assert.ok(pgid !== undefined, `make kit-test did not start in ${cwd}`);
  const end = () => signalGroup(pgid, 'SIGTERM');
  const forward = (received: NodeJS.Signals) => {
    end();
    stop();
    // Without another listener the signal ends this process as it did before; another listener has already received it.
    if (process.listenerCount(received) === 0) process.kill(process.pid, received);
  };
  const stop = () => {
    signal.removeEventListener('abort', end);
    process.removeListener('SIGTERM', forward);
    process.removeListener('SIGINT', forward);
  };
  signal.addEventListener('abort', end);
  process.once('SIGTERM', forward);
  process.once('SIGINT', forward);
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.setEncoding('utf8').on('data', (text: string) => stdout.push(text));
  child.stderr.setEncoding('utf8').on('data', (text: string) => stderr.push(text));
  try {
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    const output = stdout.join('') + stderr.join('');
    const summary = /node --test: (\d+) passed, (\d+) failed/.exec(output);
    assert.ok(summary, `make kit-test printed no summary:\n${output.slice(-2000)}`);
    return { status, output, passed: Number(summary[1]), failed: Number(summary[2]) };
  } finally {
    stop();
    end();
  }
}
