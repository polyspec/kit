// The signals and probes of a process group: kill(-pgid, signal) and kill(-pgid, 0). macOS answers EPERM for a group whose
// member is in exit, although the member is gone from the process table; the group has ended only when the call fails with
// ESRCH. signalGroup returns 'sent' when the call succeeds, 'exiting' for EPERM and 'ended' for ESRCH; any other errno is an
// error.
import { spawnSync } from 'node:child_process';
import { errorCode } from './process.mts';

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
    const code = errorCode(error);
    if (code === 'ESRCH') return 'ended';
    if (code === 'EPERM') return 'exiting';
    throw error;
  }
}

/** A process of the process table: its id, its parent's id and its process group id. */
export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
}

/** The processes of the machine, read with ps (read only): one line of pid, parent and group id for each. */
export function processTable(): ProcessEntry[] {
  const listed = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (listed.error || listed.status !== 0) throw new Error(`ps could not list the processes: ${listed.error?.message ?? listed.stderr}`);
  return listed.stdout.split('\n').filter(line => line.trim() !== '').map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match === null) throw new Error(`ps printed a line that is no process entry: ${line}`);
    return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]) };
  });
}

/** The descendants of `root` in `table`: the processes whose parent chain reaches it, `root` itself left out. */
export function descendantsOf(root: number, table: readonly ProcessEntry[]): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of table) children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry]);
  const found: ProcessEntry[] = [];
  const queue = [root];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const child of children.get(pid) ?? []) {
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

/**
 * Stops the descendants of `root` (K454): SIGTERM goes to each process group that a descendant leads and to each other descendant,
 * and after the grace the same targets get SIGKILL, so a child of a process that ends at its deadline outlives it no longer. The group
 * of `root` is never signalled: it holds the runner that started `root`, which reports the result of its run.
 */
export async function stopDescendants(root: number, { table = processTable, kill = (pid, signal) => process.kill(pid, signal), graceMs = 1000, skipGroup }: { table?: () => ProcessEntry[]; kill?: Kill | undefined; graceMs?: number; skipGroup?: number | undefined } = {}): Promise<void> {
  const found = descendantsOf(root, table()).filter(entry => entry.pgid !== skipGroup);
  const targets = [...new Set(found.map(entry => (entry.pgid === entry.pid ? -entry.pid : entry.pid)))];
  if (targets.length === 0) return;
  const deliver = (signal: NodeJS.Signals) => {
    for (const target of targets) {
      try {
        kill(target, signal);
      } catch (error) {
        // ESRCH: the target has ended; EPERM: a group member is in exit (signalGroup).
        const code = errorCode(error);
        if (code !== 'ESRCH' && code !== 'EPERM') throw error;
      }
    }
  };
  deliver('SIGTERM');
  await new Promise<void>((resolve) => { setTimeout(resolve, graceMs); });
  deliver('SIGKILL');
}

/**
 * Stops the process group `pgid`: SIGTERM, then SIGKILL once `closed` resolves (the tool has closed) or the grace period has
 * passed, whichever comes first, so that no member that survived SIGTERM or outlived the tool remains. ESRCH and EPERM are not
 * errors (signalGroup). run-tests and run-command (K430) stop their groups with it.
 */
export async function stopGroup(pgid: number, closed: Promise<unknown>, graceMs: number, kill?: Kill): Promise<void> {
  if (signalGroup(pgid, 0, kill) === 'ended') return;
  // The descendants outside pgid go first (K454): a descendant that leads a group of its own is no member of pgid, and once the
  // SIGTERM of the group has ended the leader, such a descendant is reparented to launchd and no longer found. The members of pgid
  // are left to the group signal below.
  await stopDescendants(pgid, { kill, skipGroup: pgid });
  if (signalGroup(pgid, 'SIGTERM', kill) === 'ended') return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(resolve, graceMs); })]);
  clearTimeout(timer);
  signalGroup(pgid, 'SIGKILL', kill);
}

/** Observes parent loss without putting a deadline on a command; the caller releases the observation after completion. */
export function watchParent(onLost: () => void): () => void {
  const parent = process.ppid;
  const watch = setInterval(() => { if (process.ppid !== parent) { clearInterval(watch); onLost(); } }, 200);
  return () => clearInterval(watch);
}
