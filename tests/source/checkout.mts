// A copy of the tracked files of the kit in a sandbox, for the source tests that run the vendored tests in another layout.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRepository } from '../kit/sandbox-repository.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The npm of packageManager, which make install-tools TOOLS=npm installs; the tests pack with it, not with a machine npm. */
export const NPM = path.join(ROOT, 'var/tools/bin/npm');

/** The entry of @polyspec/kit in the output of `npm pack --json`, which npm 12 keys by the name of the package. */
export function packedKit(output: string): { version: string; filename: string; integrity: string; files: { path: string }[] } {
  const packed = JSON.parse(output)['@polyspec/kit'];
  assert.ok(packed, `npm pack --json names no @polyspec/kit: ${output}`);
  return packed;
}

// The files below `directory`, relative to it, in sorted order.
export function walk(directory: string, prefix = ''): string[] {
  return readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(directory, relative) : [relative];
  }).sort();
}

// Runs `command` in `cwd` with `env`, fails with its output on a nonzero status and returns its standard output.
export const run = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} in ${cwd}: ${result.error?.message ?? ''}${result.stdout}${result.stderr}`);
  return result.stdout;
};

// A copy of the tracked and new files of the kit checkout with its installed node_modules, built with make build.
export function builtCopy(t: { after: (fn: () => void) => void }) {
  const copy = mkdtempSync(path.join(tmpdir(), 'kit-package-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], ROOT).split('\n').filter(Boolean);
  for (const file of files) if (existsSync(path.join(ROOT, file))) cpSync(path.join(ROOT, file), path.join(copy, file));
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(copy, 'node_modules'));
  run('make', ['--no-print-directory', 'build'], copy);
  return copy;
}

/**
 * The timeout of a test that runs make kit-test in a sandbox. The whole vendored suite runs there: it took 998 s and 1226 s
 * under the load of a full source-test (K81), far beyond the 30 s default of the runner, which fires now that runKitTest
 * is asynchronous (K104). Half again the slowest measurement.
 */
export const KIT_TEST_TIMEOUT_MS = 30 * 60_000;

/**
 * Makes `sandbox` a Git repository with all its files committed, as a checkout is: make kit-test compares git status and the
 * diff against HEAD before and after its run, and the checks list the files of a checkout through Git.
 */
export function commitSandbox(sandbox: string) {
  initRepository(sandbox);
  for (const args of [['add', '-A'], ['-c', 'user.name=kit-test', '-c', 'user.email=kit-test@example.com', 'commit', '--quiet', '-m', 'sandbox']]) {
    const run = spawnSync('git', args, { cwd: sandbox, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')} in ${sandbox}: ${run.stderr}`);
  }
}

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
