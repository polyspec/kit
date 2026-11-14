// Run one command of a long operation (a build, a documentation tool, a declared test command, a
// benchmark driver) to its end. The command has no time limit: its exit ends it
// and its status decides the result. It starts in its own process group; when it exits, the processes it leaves
// behind in that group are stopped, so a process that keeps an output pipe open cannot hold the
// caller. When the caller is interrupted, its running commands stop with it. The result carries
// the elapsed time, which the caller prints with the command's outcome (K430).
import { spawn } from 'node:child_process';
import { signalGroup, stopGroup, watchRoot, type SpawnedRoot } from './process-group.mts';

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** How long the processes that a command leaves in its group have to close after SIGTERM before SIGKILL. */
const LEFT_GRACE_MS = 1000;
// The running groups, each with what its spawn knows of its leader (watchRoot).
interface TrackedGroup {
  root: SpawnedRoot;
  closed: Promise<void>;
  cleanup: boolean;
  stopping?: Promise<void>;
}
const groups = new Map<number, TrackedGroup>();
interface ResourceScope { closed: Promise<unknown[]> }
const resources = new Set<ResourceScope>();
let interrupted: number | undefined;
let listening = false;

function stopTrackedGroup(pid: number, group: TrackedGroup): Promise<void> {
  return group.stopping ??= stopGroup(pid, group.closed, LEFT_GRACE_MS, undefined, group.root).then(() => group.closed);
}

export interface RunCommandOptions {
  command: string;
  args?: readonly string[] | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Standard input is ignored unless the caller explicitly inherits it. */
  stdin?: 'inherit' | 'ignore' | undefined;
  stdout?: 'inherit' | 'pipe' | undefined;
  stderr?: 'inherit' | 'pipe' | undefined;
  /** The captured output of stdout and stderr together that stops the command; 16 MiB by default. */
  maxOutputBytes?: number | undefined;
  /**
   * Called with each complete line of a piped stream as it arrives, and with its last line without the newline when the stream
   * ends, so a caller can print it at once, such as with a prefix of the command (K430-1); the output is collected all the same.
   */
  onLine?: ((stream: 'stdout' | 'stderr', line: string) => void) | undefined;
}
export interface RunCommandResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  stopped?: 'output' | undefined;
  error?: Error | undefined;
}

/** A resource's owned command runner, valid only during its cleanup callback. Failed cleanup commands reject. */
export type CleanupCommand = (options: RunCommandOptions) => Promise<RunCommandResult>;

/** The status selected by the first harness interruption, or undefined while normal work is admitted. */
export const interruptionStatus = (): number | undefined => interrupted;

function containsFailure(root: unknown, failure: unknown, seen = new Set<unknown>()): boolean {
  if (root === failure) return true;
  if (!(root instanceof Error) || seen.has(root)) return false;
  seen.add(root);
  return containsFailure(root.cause, failure, seen)
    || (root instanceof AggregateError && root.errors.some(each => containsFailure(each, failure, seen)));
}

/**
 * Keep resources alive until the controlled action (which awaits its normal commands) and cleanup finish.
 * Interruption waits for this scope; cleanup commands stay owned but are not new work to cancel.
 */
export async function withCommandResources<T>(action: () => T | Promise<T>, cleanup: (run: CleanupCommand) => void | Promise<void>): Promise<T> {
  if (interrupted !== undefined) throw new Error('resource admission stopped because the harness was interrupted');
  const completion = Promise.withResolvers<unknown[]>();
  const resource: ResourceScope = { closed: completion.promise };
  resources.add(resource);
  updateListeners();
  let outcome: { kind: 'value'; value: T } | { kind: 'error'; error: unknown };
  try { outcome = { kind: 'value', value: await action() }; }
  catch (error) { outcome = { kind: 'error', error }; }
  let active = true;
  const commands: Promise<void>[] = [];
  const commandFailures: unknown[] = [];
  const runCleanup: CleanupCommand = options => {
    if (!active) return Promise.reject(new Error('cleanup command admission is closed outside its cleanup callback'));
    const result = runTrackedCommand(options, true).then(done => {
      const failure = failureOf(done);
      if (failure !== undefined) {
        const output = [done.stderr, done.stdout].map(text => text.trim()).filter(Boolean).join('\n');
        throw new Error(`${options.command} ${(options.args ?? []).join(' ')} ${failure}${output ? `: ${output}` : ''}`);
      }
      return done;
    });
    // Observe rejection immediately, even when a callback forgets to await its admitted command.
    commands.push(result.then(() => undefined, error => { commandFailures.push(error); }));
    return result;
  };
  const cleanupErrors: unknown[] = [];
  try { await cleanup(runCleanup); }
  catch (error) { cleanupErrors.push(error); }
  finally {
    active = false;
    try {
      await Promise.all(commands);
      for (const failure of commandFailures) {
        if (!cleanupErrors.some(root => containsFailure(root, failure))) cleanupErrors.push(failure);
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      resources.delete(resource);
      completion.resolve(cleanupErrors);
      updateListeners();
    }
  }
  const errors = [...(outcome.kind === 'error' ? [outcome.error] : []), ...cleanupErrors];
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : String(error)).join('; '));
  // An error outcome always contributes an error above, including a thrown undefined.
  if (outcome.kind === 'error') throw outcome.error;
  return outcome.value;
}

export const formatSeconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`;

// A forced synchronous exit cannot await cleanup; this emergency hook stops only still-owned groups.
// Handled interruption uses graceful cleanup and child close events instead.
function stopAll() {
  for (const [pid, group] of groups) signalGroup(pid, 'SIGKILL', undefined, group.root);
}
const onSignal = (signal: NodeJS.Signals): void => {
  if (interrupted !== undefined) return;
  interrupted = signal === 'SIGINT' ? 130 : 143;
  const status = interrupted;
  const activeResources = [...resources];
  void Promise.allSettled([...groups].filter(([, group]) => !group.cleanup).map(([pid, group]) => stopTrackedGroup(pid, group))).then(async results => {
    for (const result of results) {
      if (result.status !== 'rejected') continue;
      const error: unknown = result.reason;
      process.stderr.write(`[run-command] interruption cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    const cleanupResults = await Promise.all(activeResources.map(resource => resource.closed));
    for (const errors of cleanupResults) for (const error of errors) {
      process.stderr.write(`[run-command] resource cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(status);
  });
};
function updateListeners(): void {
  const needed = groups.size > 0 || resources.size > 0 || interrupted !== undefined;
  if (needed && !listening) {
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('exit', stopAll);
    listening = true;
  } else if (!needed && listening) {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', stopAll);
    listening = false;
  }
}
function track(pid: number, group: TrackedGroup): void {
  groups.set(pid, group);
  updateListeners();
}
function untrack(pid: number): void {
  groups.delete(pid);
  updateListeners();
}

/**
 * Runs `command` to its end in its own process group. The result is the status and signal of the command, the captured
 * stdout and stderr, the elapsed time, `stopped: 'output'` when the output passed `maxOutputBytes`,
 * and `error` when the command did not start.
 */
export function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  return runTrackedCommand(options, false);
}

function runTrackedCommand(
  { command, args = [], cwd, env = process.env, stdin = 'ignore', stdout = 'inherit', stderr = 'inherit', maxOutputBytes = MAX_OUTPUT_BYTES, onLine }: RunCommandOptions,
  cleanupCommand: boolean,
): Promise<RunCommandResult> {
  if (interrupted !== undefined && !cleanupCommand) return Promise.resolve({ status: null, signal: null, stdout: '', stderr: '', elapsedMs: 0, error: new Error('command admission stopped because the harness was interrupted; start a new harness invocation to run commands') });
  const started = performance.now();
  return new Promise<RunCommandResult>(resolve => {
    const since = Date.now();
    const child = spawn(command, args, { cwd, env, stdio: [stdin, stdout, stderr], detached: true });
    const root = watchRoot(child, since);
    const output = { stdout: '', stderr: '' };
    let bytes = 0, done = false;
    let stopped: RunCommandResult['stopped'];
    let exit: { status: number | null, signal: NodeJS.Signals | null } | undefined;
    let cleanup: Promise<void> | undefined;
    const finish = (result: Partial<RunCommandResult>): void => {
      if (done) return;
      done = true;
      if (child.pid !== undefined) untrack(child.pid);
      resolve({ ...output, elapsedMs: performance.now() - started, stopped, status: null, signal: null, ...result });
    };
    const closed = new Promise<void>(resolveClosed => child.once('close', () => resolveClosed()));
    const group: TrackedGroup = { root, closed, cleanup: cleanupCommand };
    // A command that did not start has no pid and no group to track.
    if (child.pid !== undefined) track(child.pid, group);
    let cleanupError: Error | undefined;
    const beginCleanup = (): void => {
      if (child.pid !== undefined) cleanup ??= stopTrackedGroup(child.pid, group).catch((error: Error) => { cleanupError = error; });
    };
    for (const name of ['stdout', 'stderr'] as const) {
      // The text of the stream after its last newline, which waits for the rest of its line.
      let pending = '';
      const stream = child[name]?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        if (stopped !== undefined) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxOutputBytes) {
          stopped = 'output';
          beginCleanup();
          return;
        }
        output[name] += chunk;
        if (onLine === undefined) return;
        const lines = `${pending}${chunk}`.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) onLine(name, line);
      });
      stream?.on('end', () => {
        if (onLine !== undefined && pending !== '') onLine(name, pending);
        pending = '';
      });
    }
    child.once('error', error => finish({ error }));
    // The command's exit is its end: the processes it left in its group are stopped (SIGTERM, then SIGKILL after the grace), which
    // closes every output pipe they hold, and the result follows the close of the output.
    child.once('exit', (status, signal) => {
      exit = { status, signal };
      beginCleanup();
    });
    child.once('close', (status, signal) => {
      // A descendant may close its pipes on SIGTERM and keep running. Wait for the
      // cleanup's SIGKILL before returning or removing the group from tracking.
      void (cleanup ?? Promise.resolve()).then(
        () => finish({ ...(exit ?? { status, signal }), ...(cleanupError === undefined ? {} : { error: cleanupError }) }),
        (error: Error) => finish({ error }),
      );
    });
  });
}

/** The failure of a finished command in one line, or undefined when it succeeded, as the callers of runCommand print it. */
export function failureOf(result: Pick<RunCommandResult, 'status' | 'signal' | 'stopped' | 'error'>): string | undefined {
  if (result.stopped === 'output') return 'wrote more than its output limit; stopped its process group';
  if (result.error) return result.error.message;
  if (result.status !== 0) return result.status === null ? `ended by ${result.signal}` : `failed with status ${result.status}`;
  return undefined;
}
