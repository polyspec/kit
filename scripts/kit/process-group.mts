// The signals and probes of a process group: kill(-pgid, signal) and kill(-pgid, 0). macOS answers EPERM for a group whose
// member is in exit, although the member is gone from the process table; the group has ended only when the call fails with
// ESRCH. signalGroup returns 'sent' when the call succeeds, 'exiting' for EPERM and 'ended' for ESRCH; any other errno is an
// error. waitGroupEnd probes a group until ESRCH. No event reports the end of a group of processes that are not children of
// this process, so waitGroupEnd polls the group at a fixed interval until its deadline; the poll is the only source of the end.

/** The answer of a signal to a process group. */
export type GroupState = 'sent' | 'exiting' | 'ended';

/** Sends a signal to a process: process.kill or the stand-in of a test. */
export type Kill = (pid: number, signal: NodeJS.Signals | number) => unknown;

/** Sends `signal` to the process group `pgid`; `kill` is process.kill by default and is injected by the tests. */
export function signalGroup(pgid: number, signal: NodeJS.Signals | number, kill: Kill = (pid, sig) => process.kill(pid, sig)): GroupState {
  try {
    kill(-pgid, signal);
    return 'sent';
  } catch (error) {
    // process.kill throws an errno error; a test's kill throws an object with the same code.
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ESRCH') return 'ended';
    if (errno.code === 'EPERM') return 'exiting';
    throw error;
  }
}

/**
 * Resolves when the group `pgid` has ended (its probe fails with ESRCH). The group is probed at `intervalMs`; when the group has
 * not ended at `deadlineMs`, the error names the pgid, the state of the last probe (EPERM while a member is in exit) and the
 * elapsed time. `now` and `sleep` are injected by the tests.
 */
export async function waitGroupEnd(pgid: number, {
  deadlineMs,
  intervalMs = 50,
  kill,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}: {
  deadlineMs?: number | undefined;
  intervalMs?: number | undefined;
  kill?: Kill | undefined;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<unknown>) | undefined;
} = {}): Promise<void> {
  const started = now();
  for (;;) {
    const state = signalGroup(pgid, 0, kill);
    if (state === 'ended') return;
    const elapsed = now() - started;
    // Without deadlineMs the wait has no end, as `elapsed >= undefined` is false.
    if (deadlineMs !== undefined && elapsed >= deadlineMs) {
      const last = state === 'exiting' ? 'failed with EPERM' : 'succeeded (the group still exists)';
      throw new Error(`process group ${pgid} has not ended after ${elapsed} ms; its last probe ${last}`);
    }
    await sleep(intervalMs);
  }
}
