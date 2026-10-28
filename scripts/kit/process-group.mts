// The signals and probes of a process group: kill(-pgid, signal) and kill(-pgid, 0) on POSIX; taskkill and a CIM process
// tree on Windows. macOS answers EPERM for a group whose
// member is in exit, although the member is gone from the process table; the group has ended only when the call fails with
// ESRCH. signalGroup returns 'sent' when the call succeeds, 'exiting' for EPERM and 'ended' for ESRCH; any other errno is an
// error.
import { spawnSync } from 'node:child_process';
import { errorCode } from './process.mts';

/** The answer of a signal to a process group. */
export type GroupState = 'sent' | 'exiting' | 'ended';

/** Sends a signal to a process: process.kill or the stand-in of a test. */
export type Kill = (pid: number, signal: NodeJS.Signals | number) => unknown;

const defaultKill: Kill = (pid, signal) => process.kill(pid, signal);

/** Narrows JSON.parse's array result from any[] to unknown[]. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Sends `signal` to the process group `pgid`; `kill` is process.kill by default and is injected by the tests. */
export function signalGroup(pgid: number, signal: NodeJS.Signals | number, kill: Kill = defaultKill): GroupState {
  if (process.platform === 'win32' && kill === defaultKill) return signalWindowsTree(pgid, signal);
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

/** The process snapshot and termination seam of the Windows tree stop. */
export type WindowsTreeOperations = {
  table?: () => ProcessEntry[];
  terminate?: (pid: number, tree: boolean) => void;
};

/** Sends a Windows process-tree stop through taskkill, which is available on every supported Windows runner. */
export function signalWindowsTree(root: number, signal: NodeJS.Signals | number, operations: WindowsTreeOperations = {}): GroupState {
  const table = operations.table ?? processTable;
  const terminate = operations.terminate ?? ((pid, tree) => taskkill(pid, tree, true));
  const entries = table();
  const descendants = descendantsOf(root, entries).map(entry => entry.pid);
  const present = entries.some(entry => entry.pid === root);
  if (signal === 0) return present || descendants.length ? 'sent' : 'ended';
  // Windows has no POSIX process-group signals. Keep the first snapshot so descendants remain targets if the root exits during
  // taskkill and they no longer appear beneath it in the next process table.
  const depths = new Map<number, number>([[root, 0]]);
  for (const entry of descendantsOf(root, entries)) depths.set(entry.pid, (depths.get(entry.ppid) ?? 0) + 1);
  if (present) terminate(root, true);
  const afterTreeStop = table();
  for (const entry of descendantsOf(root, afterTreeStop)) {
    depths.set(entry.pid, Math.max(depths.get(entry.pid) ?? 0, (depths.get(entry.ppid) ?? 0) + 1));
  }
  const known = new Set([...descendants, ...descendantsOf(root, afterTreeStop).map(entry => entry.pid)]);
  const alive = new Set(afterTreeStop.map(entry => entry.pid));
  const survivors = [...known].filter(pid => alive.has(pid)).sort((left, right) => (depths.get(right) ?? 0) - (depths.get(left) ?? 0));
  for (const pid of survivors) terminate(pid, false);
  const final = table();
  const finalPids = new Set(final.map(entry => entry.pid));
  const remaining = [...known].some(pid => finalPids.has(pid)) || finalPids.has(root) || descendantsOf(root, final).length > 0;
  return remaining ? 'sent' : 'ended';
}

/** Runs taskkill and ignores a process that exited between the CIM snapshot and the command. */
function taskkill(pid: number, tree: boolean, force: boolean): void {
  const args = ['/PID', String(pid), ...(tree ? ['/T'] : []), ...(force ? ['/F'] : [])];
  const result = spawnSync('taskkill.exe', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 });
  if (result.error) throw new Error(`taskkill.exe ${args.join(' ')} could not start: ${result.error.message}`);
  if (result.status === 0) return;
  const current = processTable();
  if (!current.some(entry => entry.pid === pid) && (!tree || descendantsOf(pid, current).length === 0)) return;
  throw new Error(`taskkill.exe ${args.join(' ')} exited with ${result.status}: ${(result.stderr || result.stdout).trim()}`);
}

/** A process of the process table: its id, its parent's id and its process group id. */
export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
}

/** The processes of the machine, read with ps or Windows CIM (read only): each process has a pid, parent and group id. */
export function processTable(): ProcessEntry[] {
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object @{Name='pid';Expression={$_.ProcessId}},@{Name='ppid';Expression={$_.ParentProcessId}},@{Name='pgid';Expression={$_.ProcessId}} | ConvertTo-Json -Compress";
    const listed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 28 });
    if (listed.error || listed.status !== 0) throw new Error(`powershell.exe could not list the processes: ${listed.error?.message ?? listed.stderr}`);
    const decoded: unknown = JSON.parse(listed.stdout || '[]');
    const rows: readonly unknown[] = isUnknownArray(decoded) ? decoded : [decoded];
    return rows.map(row => {
      if (typeof row !== 'object' || row === null || !('pid' in row) || !('ppid' in row)) {
        throw new Error(`powershell.exe printed a line that is no process entry: ${JSON.stringify(row)}`);
      }
      const pid = row.pid;
      const ppid = row.ppid;
      if (typeof pid !== 'number' || typeof ppid !== 'number') throw new Error(`powershell.exe printed a line that is no process entry: ${JSON.stringify(row)}`);
      return { pid, ppid, pgid: pid };
    });
  }
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
export async function stopDescendants(root: number, { table = processTable, kill = defaultKill, graceMs = 1000, skipGroup }: { table?: () => ProcessEntry[]; kill?: Kill | undefined; graceMs?: number; skipGroup?: number | undefined } = {}): Promise<void> {
  const found = descendantsOf(root, table()).filter(entry => entry.pgid !== skipGroup);
  if (process.platform === 'win32' && kill === defaultKill) {
    for (const entry of [...found].reverse()) taskkill(entry.pid, false, true);
    return;
  }
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
