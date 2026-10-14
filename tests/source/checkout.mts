// A copy of the tracked files of the kit in a sandbox, for the source tests that run the vendored tests in another layout.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRepository } from '../kit/sandbox-repository.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The npm of packageManager, which make install-tools TOOLS=npm installs; the tests pack with it, not with a machine npm. */
export const NPM = path.join(ROOT, 'var/tools/bin/npm');

/** An entry of package-lock.json of kit. */
export type LockEntry = { version: string; resolved: string; integrity: string; dev?: boolean; devOptional?: boolean };

/** The entries of package-lock.json of kit that `keep` accepts, as [node_modules/<name>, entry]. */
function lockEntries(keep: (item: LockEntry) => boolean = () => true): [string, LockEntry][] {
  const packages = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages as Record<string, LockEntry>;
  return Object.entries(packages).filter(([entry, item]) => entry !== '' && keep(item));
}

/**
 * The entries of lockEntries(keep) that the npm ci of this checkout installed: an optional package of another platform is
 * not installed here, and an npm ci from the primed cache skips it as this one did.
 */
export const installedLockEntries = (keep: (item: LockEntry) => boolean = () => true): [string, LockEntry][] =>
  lockEntries(keep).filter(([entry]) => existsSync(path.join(ROOT, entry)));

let primed: string | undefined;

/**
 * An npm cache primed once per process with every package of package-lock.json of kit that this machine installed
 * (primeCache), removed when the process exits. A copy or a sandbox of the checkout installs from it with npm ci --offline.
 */
function primedCache(): string {
  if (primed) return primed;
  const work = mkdtempSync(path.join(tmpdir(), 'kit-npm-cache-'));
  process.on('exit', () => rmSync(work, { recursive: true, force: true }));
  const cache = path.join(work, 'npm-cache');
  primeCache(cache, work, installedLockEntries());
  primed = cache;
  return cache;
}

/**
 * Whether a package of package-lock.json of kit is one that kit depends on at run time. A devOptional package, such as
 * @types/node, is a dev dependency of kit and only an optional peer of a dependency, which npm ci of a consumer leaves out.
 */
export const runtimePackage = (item: LockEntry): boolean => !item.dev && !item.devOptional;

/**
 * The package.json (with the fields of `manifest`) and package-lock.json of a consumer that installs the packed kit
 * `packed` as a dev dependency by the URL of its release asset, as config/release.json names it (release.mts archiveName),
 * with the packages that kit depends on at run time at the versions of its package-lock.
 */
export function kitConsumer(packed: { version: string; integrity: string }, manifest: Record<string, unknown> = {}) {
  const kit = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const asset = `https://github.com/polyspec/kit/releases/download/v${packed.version}/polyspec-kit-npm-${packed.version}.tgz`;
  const devDependencies = { '@polyspec/kit': asset };
  const lock = {
    name: 'consumer', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'consumer', devDependencies, ...(manifest.engines ? { engines: manifest.engines } : {}) },
      'node_modules/@polyspec/kit': { version: packed.version, resolved: asset, integrity: packed.integrity, dev: true, license: kit.license, dependencies: kit.dependencies, engines: kit.engines },
      ...Object.fromEntries(lockEntries(runtimePackage).map(([entry, item]) => [entry, { ...item, dev: true }])),
    },
  };
  return { manifest: { name: 'consumer', private: true, ...manifest, devDependencies }, lock };
}

/**
 * Adds each package of `entries` to the npm cache `cache`, from the npm cache of this checkout, which its npm ci filled:
 * npm pack --offline writes the registry tarball of each, whose integrity is the one of package-lock, into `work`. An npm ci
 * with `--offline --cache <cache>` then reads no registry.
 */
export function primeCache(cache: string, work: string, entries: readonly [string, LockEntry][]): void {
  for (const [entry, item] of entries) {
    const name = entry.split('node_modules/').at(-1)!;
    const dependency: { filename: string } | undefined = JSON.parse(run(NPM, ['pack', '--json', '--offline', '--allow-remote=all', '--pack-destination', work, item.resolved], work))[name];
    assert.ok(dependency, `npm pack printed no ${name}`);
    run(NPM, ['cache', 'add', path.join(work, dependency.filename), '--cache', cache], work);
  }
}

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
  // The copy installs the packages of package-lock.json as a checkout does: npm ci of the npm of packageManager, offline,
  // from the primed cache.
  run(NPM, ['ci', '--offline', '--cache', primedCache(), '--ignore-scripts', '--no-audit', '--no-fund'], copy);
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
 * install-tools: var/tools, without the caches of mise and uv (var/tools/mise/cache), which other source tests write while a
 * sandbox copies (K91).
 */
export function installedTool(file: string) {
  const inside = (directory: string) => file === directory || file.startsWith(`${directory}/`);
  return inside('var/tools') && !inside('var/tools/mise/cache');
}

/**
 * Runs make kit-test in `cwd` and returns its exit status, its output and the summary counts. The nested run is the leader
 * of its own process group, which ends with the case: when the run closes (a process it left behind included), when
 * `signal` aborts (node:test aborts it when the test times out or is cancelled), and when this process receives SIGTERM or
 * SIGINT, which is passed on to the group and then to this process as before. A SIGKILL of this process reaches no handler.
 */
export async function runKitTest(cwd: string, signal: AbortSignal) {
  // The handlers come before the spawn: make runs as soon as it is forked, so a signal that arrives once the run has begun
  // finds them, and it ends the group even before spawn returns to this process.
  let pgid: number | undefined;
  const end = () => (pgid === undefined ? 'ended' : signalGroup(pgid, 'SIGTERM'));
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
  const child = spawn('make', ['--no-print-directory', 'kit-test'], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  pgid = child.pid;
  if (pgid === undefined) stop();
  assert.ok(pgid !== undefined, `make kit-test did not start in ${cwd}`);
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
    assert.ok(summary, `make kit-test printed no summary:\n${output}`);
    return { status, output, passed: Number(summary[1]), failed: Number(summary[2]) };
  } finally {
    stop();
    end();
  }
}
