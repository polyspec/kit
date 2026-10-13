// Running commands. `execute` returns the outcome of a command, `run` returns its output and fails with a Stop when it does
// not end with an accepted status, and `git.mts` runs git through them.
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';

const MAX_BUFFER = 256 * 1024 * 1024;

/** A step of a tool fails; the message names the cause. */
export class Stop extends Error {}

/** Where and with which environment a command runs. */
export type RunPlace = { cwd?: string | undefined; env?: NodeJS.ProcessEnv | undefined };

/** The outcome of a command run to its end, with the output as text. */
export type Outcome = SpawnSyncReturns<string>;

/** Runs a command to its end in `cwd` with `env`; returns `{ status, stdout, stderr, error }` with the output as text. */
export const execute = (command: string, args: readonly string[], { cwd, env }: RunPlace = {}): Outcome => spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: MAX_BUFFER });

/** The standard output of a command; Stop with the command, its exit status or the signal that ended it, and its standard error when the status is not in `statuses`. */
export function run(command: string, args: readonly string[], { cwd, env, statuses = [0] }: RunPlace & { statuses?: readonly number[] | undefined } = {}): string {
  const result = execute(command, args, { cwd, env });
  if (result.error) throw new Stop(`${[command, ...args].join(' ')} could not start: ${result.error.message}`);
  const output = (result.stderr || result.stdout).trim();
  if (result.signal) throw new Stop(`${[command, ...args].join(' ')} ended by signal ${result.signal}: ${output}`);
  if (result.status === null || !statuses.includes(result.status)) throw new Stop(`${[command, ...args].join(' ')} exited with ${result.status}: ${output}`);
  return result.stdout;
}
