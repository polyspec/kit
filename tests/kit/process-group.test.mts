// The signals and probes of a process group (scripts/kit/process-group.mts). On macOS a group whose member is in exit answers
// EPERM while the member is already gone from the process table, and ESRCH once the group has ended. The cases inject kill, so no
// test signals a real group.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test, { mock } from 'node:test';
import { descendantsOf, fileTime, processTable, signalGroup, signalWindowsTree, stopGroup, watchRoot } from '../../scripts/kit/process-group.mts';
import type { Kill, ProcessEntry, SpawnedRoot } from '../../scripts/kit/process-group.mts';
import { terminateGroup } from '../../scripts/kit/run-tests.mts';

// K830: a test that starts real processes fails by name within its timeout instead of holding a CI step until the job limit.
const PROCESS_TIMEOUT = { timeout: 60_000 };

/** A kill that fails with each code of `codes` in turn, then succeeds; it records each call. */
function killing(...codes: string[]): { kill: Kill; calls: [number, NodeJS.Signals | number][] } {
  const calls: [number, NodeJS.Signals | number][] = [];
  const kill: Kill = (pid, signal) => {
    calls.push([pid, signal]);
    const code = codes.shift();
    if (code) {
      const error: NodeJS.ErrnoException = new Error(`kill ${pid} ${code}`);
      error.code = code;
      throw error;
    }
  };
  return { kill, calls };
}

test('signalGroup signals the group with a negative pid and reports sent when it succeeds', () => {
  const { kill, calls } = killing();
  assert.equal(signalGroup(4321, 'SIGTERM', kill), 'sent');
  assert.deepEqual(calls, [[-4321, 'SIGTERM']]);
});

test('signalGroup reports exiting for EPERM and ended for ESRCH, and both are not errors', () => {
  assert.equal(signalGroup(4321, 'SIGTERM', killing('EPERM').kill), 'exiting');
  assert.equal(signalGroup(4321, 'SIGTERM', killing('ESRCH').kill), 'ended');
});

test('signalGroup rethrows any other errno', () => {
  assert.throws(() => signalGroup(4321, 'SIGTERM', killing('EACCES').kill), (error: NodeJS.ErrnoException) => error.code === 'EACCES');
});

test('a timed-out test is terminated through its group, and EPERM from a member in exit is not an error', () => {
  const { kill, calls } = killing('EPERM');
  assert.equal(terminateGroup(4321, kill), 'exiting');
  assert.deepEqual(calls, [[-4321, 'SIGTERM']]);
  assert.equal(terminateGroup(4321, killing('ESRCH').kill), 'ended');
});

test('Windows tree cleanup stops original descendants after root exit and reparenting', () => {
  let entries: ProcessEntry[] = [
    { pid: 20, ppid: 1, pgid: 20 },
    { pid: 21, ppid: 20, pgid: 20 },
    { pid: 22, ppid: 21, pgid: 20 },
  ];
  const calls: [number, boolean][] = [];
  const state = signalWindowsTree(20, 'SIGTERM', {
    table: () => entries,
    terminate: (pid, tree) => {
      calls.push([pid, tree]);
      if (pid === 20) entries = entries.filter(entry => entry.pid !== 20).map(entry => entry.pid === 21 ? { ...entry, ppid: 1 } : entry);
      else entries = entries.filter(entry => entry.pid !== pid);
    },
  });
  assert.deepEqual(calls, [[20, true], [22, false], [21, false]], 'surviving descendants are stopped deepest-first from the original snapshot');
  assert.equal(state, 'ended', 'the tree is ended only after the original descendant pids disappear');

  const remaining = signalWindowsTree(30, 'SIGTERM', {
    table: () => [{ pid: 30, ppid: 1, pgid: 30 }, { pid: 31, ppid: 30, pgid: 30 }],
    terminate: () => {},
  });
  assert.equal(remaining, 'sent', 'a surviving process is never reported as ended');
});

// K925: Windows keeps the parent id of a process whose parent has exited and reuses process ids, so a process created before the
// root, or before the descendant whose id it names as its parent, is no descendant. The creation times are Windows file times.
test('a Windows process created before the process it names as its parent is no descendant (K925)', () => {
  const table: ProcessEntry[] = [
    { pid: 20, ppid: 1, pgid: 20, started: 100n },
    { pid: 8136, ppid: 20, pgid: 8136, started: 50n },
    { pid: 21, ppid: 20, pgid: 21, started: 150n },
    { pid: 22, ppid: 21, pgid: 22, started: 160n },
    { pid: 23, ppid: 21, pgid: 23, started: 140n },
    { pid: 24, ppid: 20, pgid: 24, started: null },
  ];
  assert.deepEqual(descendantsOf(20, table).map(entry => entry.pid), [21, 22]);
  assert.deepEqual(descendantsOf(20, table.filter(entry => entry.pid !== 20)).map(entry => entry.pid), [],
    'a parent whose creation time is unknown proves no child');
  assert.deepEqual(descendantsOf(20, table.filter(entry => entry.pid !== 20), { earlier: table }).map(entry => entry.pid), [21, 22],
    'the creation time of an exited parent comes from the earlier table');
  assert.deepEqual(descendantsOf(20, table.filter(entry => entry.pid !== 20), { rootStarted: 100n }).map(entry => entry.pid), [21, 22],
    'the time taken before the spawn of an exited root stands for it');
  assert.deepEqual(descendantsOf(20, [{ pid: 20, ppid: 1, pgid: 20 }, { pid: 21, ppid: 20, pgid: 20 }]).map(entry => entry.pid), [21],
    'a table without creation times follows the parent ids alone');
});

test('a child created in the clock tick of its parent is a descendant (K925)', () => {
  const table: ProcessEntry[] = [{ pid: 20, ppid: 1, pgid: 20, started: 100n }, { pid: 21, ppid: 20, pgid: 21, started: 100n }];
  assert.deepEqual(descendantsOf(20, table).map(entry => entry.pid), [21]);
});

test('a process whose parent id is the reused id of an exited root is the child of the newer process (K925)', () => {
  const earlier: ProcessEntry[] = [{ pid: 20, ppid: 1, pgid: 20, started: 100n }, { pid: 21, ppid: 20, pgid: 21, started: 150n }];
  const now: ProcessEntry[] = [
    { pid: 21, ppid: 20, pgid: 21, started: 150n },
    { pid: 20, ppid: 7, pgid: 20, started: 300n },
    { pid: 22, ppid: 20, pgid: 22, started: 310n },
  ];
  assert.deepEqual(descendantsOf(20, now, { earlier }).map(entry => entry.pid), [21], 'the child of the newer process 20 is not the root\'s');
});

test('the file time of a Unix time counts 100-nanosecond units from 1601 (K925)', () => {
  assert.equal(fileTime(0), 116_444_736_000_000_000n);
  assert.equal(fileTime(1.9), 116_444_736_000_010_000n);
});

test('the Windows tree stop of an exited root stops its orphans and no older process (K925)', () => {
  let entries: ProcessEntry[] = [
    { pid: 21, ppid: 20, pgid: 21, started: fileTime(1_000) + 5n },
    { pid: 8136, ppid: 20, pgid: 8136, started: fileTime(10) },
  ];
  const calls: [number, boolean][] = [];
  const operations = {
    table: () => entries,
    terminate: (pid: number, tree: boolean) => {
      calls.push([pid, tree]);
      entries = entries.filter(entry => entry.pid !== pid);
    },
  };
  assert.equal(signalWindowsTree(20, 0, operations, exited(1_000)), 'sent', 'an orphan of the exited root keeps its tree running');
  assert.equal(signalWindowsTree(20, 'SIGTERM', operations, exited(1_000)), 'ended');
  assert.deepEqual(calls, [[21, false]]);
  assert.equal(signalWindowsTree(20, 0, { table: () => [{ pid: 8136, ppid: 20, pgid: 8136, started: fileTime(10) }] }, exited(1_000)), 'ended');
});

/** What the spawner knows of a root that has exited: spawned after `since`, with the creation time `started` read while it ran. */
function exited(since: number, started?: bigint): SpawnedRoot {
  return { since, exited: true, started, read: Promise.resolve() };
}

/** A table seam that answers each call with the next snapshot, and the last one from then on. */
function snapshots(...tables: ProcessEntry[][]): () => ProcessEntry[] {
  let call = 0;
  return () => tables[Math.min(call++, tables.length - 1)] ?? [];
}

test('the Windows tree stop takes no process that reuses the id of a stopped descendant (K925)', () => {
  const calls: [number, boolean][] = [];
  const state = signalWindowsTree(20, 'SIGTERM', {
    // The tree stop ends 20 and 21; the id 21 goes to an unrelated process before the next snapshot.
    table: snapshots(
      [{ pid: 20, ppid: 1, pgid: 20, started: 100n }, { pid: 21, ppid: 20, pgid: 21, started: 150n }],
      [{ pid: 21, ppid: 4, pgid: 21, started: 9_000n }],
    ),
    terminate: (pid, tree) => { calls.push([pid, tree]); },
  });
  assert.deepEqual(calls, [[20, true]]);
  assert.equal(state, 'ended');
});

test('the Windows tree stop of an exited root takes no process that reuses the id of the root (K925)', () => {
  const calls: [number, boolean][] = [];
  const orphan: ProcessEntry = { pid: 21, ppid: 20, pgid: 21, started: fileTime(1_000) + 5n };
  signalWindowsTree(20, 'SIGTERM', {
    // The id of the exited root 20 goes to an unrelated process, which starts a child, before the second snapshot.
    table: snapshots([orphan], [orphan, { pid: 20, ppid: 7, pgid: 20, started: fileTime(9_000) }, { pid: 22, ppid: 20, pgid: 22, started: fileTime(9_100) }], []),
    terminate: (pid, tree) => { calls.push([pid, tree]); },
  }, exited(1_000));
  assert.deepEqual(calls, [[21, false]], 'only the orphan of the exited root is stopped');
});

test('the Windows tree stop never targets a process that names the root as its parent but is older (K925)', () => {
  let entries: ProcessEntry[] = [
    { pid: 20, ppid: 1, pgid: 20, started: 100n },
    { pid: 21, ppid: 20, pgid: 21, started: 150n },
    { pid: 8136, ppid: 20, pgid: 8136, started: 50n },
  ];
  const calls: [number, boolean][] = [];
  const state = signalWindowsTree(20, 'SIGTERM', {
    table: () => entries,
    terminate: (pid, tree) => {
      calls.push([pid, tree]);
      entries = entries.filter(entry => entry.pid !== (pid === 20 ? 20 : pid));
    },
  });
  assert.deepEqual(calls, [[20, true], [21, false]], 'the descendant that outlived the root is stopped and the older process is not');
  assert.equal(state, 'ended');
});

// K927: Node closes the handle of a child before its exit event, and Windows may then give its id to another process, so the root
// of an exited tree is known only from its spawn.
test('the Windows tree stop of an exited root takes no process that took its id before the first snapshot (K927)', () => {
  const calls: [number, boolean][] = [];
  const orphan: ProcessEntry = { pid: 21, ppid: 20, pgid: 21, started: fileTime(1_000) + 50n };
  // The id of the exited root went to an unrelated process 20, which started a child 22, before the first snapshot.
  const reused: ProcessEntry[] = [{ pid: 20, ppid: 7, pgid: 20, started: fileTime(5_000) }, { pid: 22, ppid: 20, pgid: 22, started: fileTime(5_100) }];
  const state = signalWindowsTree(20, 'SIGTERM', {
    // The table before and after the root's tree stop, then after the orphan is stopped.
    table: snapshots([orphan, ...reused], [orphan, ...reused], reused),
    terminate: (pid, tree) => { calls.push([pid, tree]); },
  }, exited(1_000, fileTime(1_000) + 10n));
  assert.deepEqual(calls, [[21, false]], 'the process with the id of the root and its child are not stopped');
  assert.equal(state, 'ended');
});

test('a process created between the spawn and the creation of the root is no descendant once the time of the root is read (K927)', () => {
  const root = exited(1_000, fileTime(1_000) + 10n);
  const table: ProcessEntry[] = [{ pid: 23, ppid: 20, pgid: 23, started: fileTime(1_000) + 5n }, { pid: 21, ppid: 20, pgid: 21, started: fileTime(1_000) + 50n }];
  const calls: number[] = [];
  signalWindowsTree(20, 'SIGTERM', { table: () => table, terminate: (pid) => { calls.push(pid); } }, root);
  assert.deepEqual(calls, [21]);
});

test('watchRoot keeps a creation time read while the root runs, drops one read after its exit and reports a failed read (K927)', async () => {
  const running = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], { stdio: 'ignore' });
  const kept = watchRoot(running, Date.now(), () => Promise.resolve(42n));
  await kept.read;
  assert.equal(kept.started, 42n);
  await once(running, 'exit');
  assert.equal(kept.exited, true);

  const ended = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  let answer: (value: bigint) => void = () => {};
  const late = watchRoot(ended, Date.now(), () => new Promise(resolve => { answer = resolve; }));
  await once(ended, 'exit');
  answer(42n);
  await late.read;
  assert.equal(late.started, undefined, 'a time read after the exit may be that of another process');

  const failing = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const written = mock.method(process.stderr, 'write', () => true);
  try {
    const failed = watchRoot(failing, Date.now(), () => Promise.reject(new Error('no CIM')));
    await failed.read;
    assert.equal(failed.started, undefined);
    assert.match(String(written.mock.calls[0]?.arguments[0]), /no CIM; the tree stop of \d+ bounds its root by the time before its spawn/);
  } finally {
    written.mock.restore();
  }
  await once(failing, 'exit');
  const orphan: ProcessEntry = { pid: 21, ppid: failing.pid ?? 0, pgid: 21, started: fileTime(Date.now() + 1_000) };
  const calls: number[] = [];
  signalWindowsTree(failing.pid ?? 0, 'SIGTERM', { table: () => [orphan], terminate: (pid) => { calls.push(pid); } }, { since: Date.now(), exited: true, started: undefined, read: Promise.resolve() });
  assert.deepEqual(calls, [21], 'a root whose read failed still has its orphans stopped');
});

test('stopGroup returns only after a root that ignores SIGTERM has ended through SIGKILL (K754)', PROCESS_TIMEOUT, async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);"], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  assert.ok(child.pid);
  assert.ok(child.stdout, 'the root process reports that it ignores SIGTERM');
  const lines = createInterface({ input: child.stdout });
  const closed = once(child, 'close');
  try {
    await once(lines, 'line');
    await stopGroup(child.pid, closed, 50);
    assert.equal(processTable().some(entry => entry.pid === child.pid), false, 'the root process is gone when stopGroup returns');
  } finally {
    await stopGroup(child.pid, closed, 50);
    lines.close();
  }
});

test('stopGroup terminates a real root and descendant process tree', PROCESS_TIMEOUT, async () => {
  const source = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(JSON.stringify({ descendant: child.pid }) + '\\n'); process.on('SIGTERM', () => { child.kill('SIGTERM'); child.once('exit', () => process.exit(0)); }); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['-e', source], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  assert.ok(child.pid);
  assert.ok(child.stdout, 'the root process reports its descendant');
  const lines = createInterface({ input: child.stdout });
  const closed = once(child, 'close');
  try {
    const line = await new Promise<string>((resolve, reject) => {
      lines.once('line', (value: unknown) => {
        if (typeof value !== 'string') reject(new Error('the root process reported a non-string descendant record'));
        else resolve(value);
      });
    });
    const record: unknown = JSON.parse(line);
    assert.ok(typeof record === 'object' && record !== null && 'descendant' in record && typeof record.descendant === 'number');
    const descendant = record.descendant;
    await stopGroup(child.pid, closed, 100);
    const remaining = processTable().map(entry => entry.pid);
    assert.equal(remaining.includes(child.pid), false, 'the root process ended');
    assert.equal(remaining.includes(descendant), false, 'the descendant process ended');
  } finally {
    await stopGroup(child.pid, closed, 100);
    lines.close();
  }
});
