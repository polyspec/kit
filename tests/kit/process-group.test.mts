// The signals and probes of a process group (scripts/kit/process-group.mts). On macOS a group whose member is in exit answers
// EPERM while the member is already gone from the process table, and ESRCH once the group has ended. The cases inject kill, so no
// test signals a real group.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { processTable, signalGroup, stopGroup } from '../../scripts/kit/process-group.mts';
import type { Kill } from '../../scripts/kit/process-group.mts';
import { terminateGroup } from '../../scripts/kit/run-tests.mts';

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

test('stopGroup terminates a real root and descendant process tree', async () => {
  const source = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(JSON.stringify({ descendant: child.pid }) + '\\n'); process.on('SIGTERM', () => { child.kill('SIGTERM'); child.once('exit', () => process.exit(0)); }); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['-e', source], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  assert.ok(child.pid);
  assert.ok(child.stdout, 'the root process reports its descendant');
  const lines = createInterface({ input: child.stdout });
  const closed = once(child, 'close');
  try {
    const [line] = await once(lines, 'line');
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
