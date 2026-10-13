// The signals and probes of a process group (scripts/kit/process-group.mts). On macOS a group whose member is in exit answers
// EPERM while the member is already gone from the process table, and ESRCH once the group has ended. The cases inject kill, so no
// test signals a real group.
import assert from 'node:assert/strict';
import test from 'node:test';
import { signalGroup } from '../../scripts/kit/process-group.mts';
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
