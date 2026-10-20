// Run one command of a long operation (a build, a documentation tool, a declared test command, a
// benchmark driver) to its end. The command has no time limit: its exit ends it and its status
// decides the result. It starts in its own process group; when it exits, the processes it leaves
// behind in that group are stopped, so a process that keeps an output pipe open cannot hold the
// caller. When the caller is interrupted, its running commands stop with it. The result carries
// the elapsed time, which the caller prints with the command's outcome (K430).
import { spawn } from 'node:child_process';
import { signalGroup, stopGroup } from './process-group.mts';

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** How long the processes that a command leaves in its group have to close after SIGTERM before SIGKILL. */
const LEFT_GRACE_MS = 1000;
const groups = new Set<number>();

export interface RunCommandOptions {
  command: string;
  args?: readonly string[] | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  stdout?: 'inherit' | 'pipe' | undefined;
  stderr?: 'inherit' | 'pipe' | undefined;
  /** The captured output of stdout and stderr together that stops the command; 16 MiB by default. */
  maxOutputBytes?: number | undefined;
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

export const formatSeconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`;

// An interrupted or ending caller takes its running commands with it.
function stopAll() {
  for (const pid of groups) signalGroup(pid, 'SIGKILL');
}
const onSignal = (signal: NodeJS.Signals): void => {
  stopAll();
  process.exit(signal === 'SIGINT' ? 130 : 143);
};
function track(pid: number): void {
  if (groups.size === 0) {
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('exit', stopAll);
  }
  groups.add(pid);
}
function untrack(pid: number): void {
  groups.delete(pid);
  if (groups.size === 0) {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', stopAll);
  }
}

/**
 * Runs `command` to its end in its own process group. The result is the status and signal of the command, the captured
 * stdout and stderr, the elapsed time, `stopped: 'output'` when the output passed `maxOutputBytes`, and `error` when the command
 * did not start.
 */
export function runCommand(
  { command, args = [], cwd, env = process.env, stdout = 'inherit', stderr = 'inherit', maxOutputBytes = MAX_OUTPUT_BYTES }: RunCommandOptions,
): Promise<RunCommandResult> {
  const started = performance.now();
  return new Promise<RunCommandResult>(resolve => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', stdout, stderr], detached: true });
    const output = { stdout: '', stderr: '' };
    let bytes = 0, done = false;
    let stopped: 'output' | undefined;
    let exit: { status: number | null, signal: NodeJS.Signals | null } | undefined;
    const finish = (result: Partial<RunCommandResult>): void => {
      if (done) return;
      done = true;
      if (child.pid !== undefined) untrack(child.pid);
      resolve({ ...output, elapsedMs: performance.now() - started, stopped, status: null, signal: null, ...result });
    };
    // A command that did not start has no pid and no group to track.
    if (child.pid !== undefined) track(child.pid);
    const closed = new Promise<void>(resolveClosed => child.once('close', () => resolveClosed()));
    for (const name of ['stdout', 'stderr'] as const) {
      child[name]?.setEncoding('utf8').on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxOutputBytes) {
          if (!stopped && child.pid !== undefined) signalGroup(child.pid, 'SIGKILL');
          stopped = 'output';
          return;
        }
        output[name] += chunk;
      });
    }
    child.once('error', error => finish({ error }));
    // The command's exit is its end: the processes it left in its group are stopped (SIGTERM, then SIGKILL after the grace), which
    // closes every output pipe they hold, and the result follows the close of the output.
    child.once('exit', (status, signal) => {
      exit = { status, signal };
      if (child.pid !== undefined) stopGroup(child.pid, closed, LEFT_GRACE_MS).catch((error: Error) => finish({ error }));
    });
    child.once('close', (status, signal) => finish(exit ?? { status, signal }));
  });
}
