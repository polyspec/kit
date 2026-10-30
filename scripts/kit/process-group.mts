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

/**
 * Sends `signal` to the process group `pgid`; `kill` is process.kill by default and is injected by the tests. `since` is the time
 * (Date.now) taken before the spawn of `pgid`, which on Windows bounds the creation of its descendants once it has exited (K925).
 */
export function signalGroup(pgid: number, signal: NodeJS.Signals | number, kill: Kill = defaultKill, since?: number): GroupState {
  if (process.platform === 'win32' && kill === defaultKill) return signalWindowsTree(pgid, signal, {}, since);
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

/**
 * Sends a Windows process-tree stop through taskkill, which is available on every supported Windows runner. `since` is the time
 * taken before the spawn of `root` (signalGroup).
 */
export function signalWindowsTree(root: number, signal: NodeJS.Signals | number, operations: WindowsTreeOperations = {}, since?: number): GroupState {
  const table = operations.table ?? processTable;
  const terminate = operations.terminate ?? ((pid, tree) => taskkill(pid, tree, true));
  // A process is told by its id and creation time (K925): a process that takes the id of one that has ended is another process.
  // The root is the one of the first snapshot; a root absent from it has exited, and an entry with its id in a later table is
  // another process.
  const entries = table();
  const rootEntry = entries.find(entry => entry.pid === root);
  const rootStarted = rootStartOf(rootEntry, since);
  const first = descendantsOf(root, entries, { rootStarted });
  if (signal === 0) return rootEntry !== undefined || first.length ? 'sent' : 'ended';
  // Windows has no POSIX process-group signals. Keep the first snapshot so descendants remain targets if the root exits during
  // taskkill and they no longer appear beneath it in the next process table. descendantsOf lists a child after its parent, so the
  // reverse of that order stops the deepest first.
  if (rootEntry !== undefined) terminate(root, true);
  const afterTreeStop = table();
  const known = [...first];
  for (const entry of descendantsOf(root, afterTreeStop, { earlier: entries, rootStarted })) {
    if (!known.some(other => identity(other) === identity(entry))) known.push(entry);
  }
  const alive = new Set(afterTreeStop.map(identity));
  for (const entry of known.filter(entry => alive.has(identity(entry))).reverse()) terminate(entry.pid, false);
  const finalTable = table();
  const final = new Set(finalTable.map(identity));
  const remaining = known.some(entry => final.has(identity(entry))) || (rootEntry !== undefined && final.has(identity(rootEntry)))
    || descendantsOf(root, finalTable, { earlier: [...entries, ...afterTreeStop], rootStarted }).length > 0;
  return remaining ? 'sent' : 'ended';
}

/** The identity of a process: its id and its creation time. */
function identity(entry: ProcessEntry): string {
  return `${entry.pid}@${String(entry.started)}`;
}

/** The creation time of a root: that of its table entry, or, for a root that has exited, the time taken before its spawn. */
function rootStartOf(rootEntry: ProcessEntry | undefined, since: number | undefined): bigint | undefined {
  if (typeof rootEntry?.started === 'bigint') return rootEntry.started;
  return since === undefined ? undefined : fileTime(since);
}

/**
 * Runs taskkill and ignores a process that exited between the CIM snapshot and the command. The descendants of a tree stop whose
 * root had exited are no longer beneath it in a table, so signalWindowsTree stops them one by one from its first snapshot.
 */
function taskkill(pid: number, tree: boolean, force: boolean): void {
  const args = ['/PID', String(pid), ...(tree ? ['/T'] : []), ...(force ? ['/F'] : [])];
  const result = spawnSync('taskkill.exe', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 });
  if (result.error) throw new Error(`taskkill.exe ${args.join(' ')} could not start: ${result.error.message}`);
  if (result.status === 0) return;
  const current = processTable();
  if (!current.some(entry => entry.pid === pid)) return;
  throw new Error(`taskkill.exe ${args.join(' ')} exited with ${result.status}: ${(result.stderr || result.stdout).trim()}`);
}

/**
 * A process of the process table: its id, its parent's id and its process group id, and on Windows its creation time in the
 * 100-nanosecond units of a Windows file time (K925), or null for a process that has none, such as the System process.
 */
export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
  started?: bigint | null;
}

/** The processes of the machine, read with ps or Windows CIM (read only): each process has a pid, parent and group id. */
export function processTable(): ProcessEntry[] {
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object @{Name='pid';Expression={$_.ProcessId}},@{Name='ppid';Expression={$_.ParentProcessId}},@{Name='pgid';Expression={$_.ProcessId}},@{Name='started';Expression={if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { $null }}} | ConvertTo-Json -Compress";
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
      const started = 'started' in row ? row.started : undefined;
      if (typeof pid !== 'number' || typeof ppid !== 'number' || !(started === null || (typeof started === 'string' && /^\d+$/.test(started)))) {
        throw new Error(`powershell.exe printed a line that is no process entry: ${JSON.stringify(row)}`);
      }
      return { pid, ppid, pgid: pid, started: started === null ? null : BigInt(started) };
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

/** The Windows file time (100-nanosecond units since 1601-01-01 UTC) of a time in milliseconds since the Unix epoch. */
export function fileTime(milliseconds: number): bigint {
  return (BigInt(Math.floor(milliseconds)) + 11_644_473_600_000n) * 10_000n;
}

/**
 * The descendants of `root` in `table`: the processes whose parent chain reaches it, `root` itself left out.
 *
 * A table without creation times (POSIX) reparents an orphan, so its parent ids are current and the chain follows them.
 *
 * A table with creation times (Windows, K925) keeps the parent id of a process whose parent has exited, and Windows reuses process
 * ids. So a process is told by its id and its creation time. The parent of a child is the process with the child's parent id that
 * was created last at or before the child, among `table` and `earlier`, a table read before. A child created in the clock tick of
 * its parent has its time, so a child counts when it was not created before its parent. A process without a creation time, such
 * as the System process, is the child of none. The creation time of the root is `rootStarted` when given (the
 * caller's root of a first snapshot, or for a root that has exited the file time taken before its spawn, before which no descendant
 * was created), and otherwise that of the root in `earlier` or `table`. Without either, no child of an exited root is proven.
 */
export function descendantsOf(root: number, table: readonly ProcessEntry[], { earlier = [], rootStarted }: { earlier?: readonly ProcessEntry[]; rootStarted?: bigint | undefined } = {}): ProcessEntry[] {
  if (!table.some(entry => entry.started !== undefined)) {
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
  const starts = new Map<number, bigint[]>();
  const record = (pid: number, started: bigint) => {
    const known = starts.get(pid) ?? [];
    if (!known.includes(started)) starts.set(pid, [...known, started]);
  };
  for (const entry of [...earlier, ...table]) if (typeof entry.started === 'bigint') record(entry.pid, entry.started);
  const rootStart = rootStarted ?? [...earlier, ...table].find(entry => entry.pid === root && typeof entry.started === 'bigint')?.started;
  if (typeof rootStart !== 'bigint') return [];
  record(root, rootStart);
  const key = (pid: number, started: bigint) => `${pid}@${started}`;
  const members = new Set([key(root, rootStart)]);
  const parentStart = (child: ProcessEntry & { started: bigint }): bigint | undefined =>
    (starts.get(child.ppid) ?? []).filter(started => started <= child.started).reduce<bigint | undefined>((latest, started) => latest === undefined || started > latest ? started : latest, undefined);
  const timed = table.filter((entry): entry is ProcessEntry & { started: bigint } => typeof entry.started === 'bigint' && !(entry.pid === root && entry.started === rootStart))
    .sort((left, right) => (left.started < right.started ? -1 : left.started > right.started ? 1 : 0));
  const found: ProcessEntry[] = [];
  for (let added = true; added;) {
    added = false;
    for (const entry of timed) {
      if (members.has(key(entry.pid, entry.started))) continue;
      const parent = parentStart(entry);
      if (parent === undefined || !members.has(key(entry.ppid, parent))) continue;
      members.add(key(entry.pid, entry.started));
      found.push(entry);
      added = true;
    }
  }
  return found;
}

/**
 * Stops the descendants of `root` (K454): SIGTERM goes to each process group that a descendant leads and to each other descendant,
 * and after the grace the same targets get SIGKILL, so a child of a process that ends at its deadline outlives it no longer. The group
 * of `root` is never signalled: it holds the runner that started `root`, which reports the result of its run.
 */
export async function stopDescendants(root: number, { table = processTable, kill = defaultKill, graceMs = 1000, skipGroup, since }: { table?: () => ProcessEntry[]; kill?: Kill | undefined; graceMs?: number; skipGroup?: number | undefined; since?: number | undefined } = {}): Promise<void> {
  const entries = table();
  const found = descendantsOf(root, entries, { rootStarted: rootStartOf(entries.find(entry => entry.pid === root), since) }).filter(entry => entry.pgid !== skipGroup);
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
 * errors (signalGroup). run-tests and run-command (K430) stop their groups with it. `since` is the time taken before the spawn of
 * `pgid` (signalGroup).
 */
export async function stopGroup(pgid: number, closed: Promise<unknown>, graceMs: number, kill?: Kill, since?: number): Promise<void> {
  if (signalGroup(pgid, 0, kill, since) === 'ended') return;
  // The descendants outside pgid go first (K454): a descendant that leads a group of its own is no member of pgid, and once the
  // SIGTERM of the group has ended the leader, such a descendant is reparented to launchd and no longer found. The members of pgid
  // are left to the group signal below.
  await stopDescendants(pgid, { kill, skipGroup: pgid, since });
  if (signalGroup(pgid, 'SIGTERM', kill, since) === 'ended') return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(resolve, graceMs); })]);
  clearTimeout(timer);
  // SIGKILL cannot be caught, so the group ends; the caller's close is awaited so that no stopped process is still listed or
  // unreaped when stopGroup returns (K754).
  if (signalGroup(pgid, 'SIGKILL', kill, since) === 'ended') return;
  await closed;
}

/** Observes parent loss without putting a deadline on a command; the caller releases the observation after completion. */
export function watchParent(onLost: () => void): () => void {
  const parent = process.ppid;
  const watch = setInterval(() => { if (process.ppid !== parent) { clearInterval(watch); onLost(); } }, 200);
  return () => clearInterval(watch);
}
