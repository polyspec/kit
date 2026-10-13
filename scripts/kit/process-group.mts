// The signals and probes of a process group: kill(-pgid, signal) and kill(-pgid, 0). macOS answers EPERM for a group whose
// member is in exit, although the member is gone from the process table; the group has ended only when the call fails with
// ESRCH. signalGroup returns 'sent' when the call succeeds, 'exiting' for EPERM and 'ended' for ESRCH; any other errno is an
// error.

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
