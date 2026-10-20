// Tests of scripts/kit/run-command.mts (K430): the package export, the status, output and time of a command, the stop of the
// processes that a command leaves in its group, the stop on output beyond the limit, and a command that does not start.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { failureOf, runCommand } from '../../scripts/kit/run-command.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the ./run-command export of the package names its types and its module in dist (K430)', () => {
  const pkg: unknown = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const exported = typeof pkg === 'object' && pkg !== null && 'exports' in pkg ? pkg.exports : undefined;
  const entry = typeof exported === 'object' && exported !== null && './run-command' in exported ? exported['./run-command'] : undefined;
  assert.deepEqual(entry, { types: './dist/run-command.d.mts', default: './dist/run-command.mjs' });
});

test('a command returns its status, its stdout and its elapsed time (K430)', async () => {
  const result = await runCommand({ command: process.execPath, args: ['-e', "process.stdout.write('ok')"], stdout: 'pipe' });
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.error, undefined);
  assert.equal(typeof result.elapsedMs, 'number');
  assert.ok(result.elapsedMs >= 0);
});

test('a command that leaves a background child with its stdout pipe returns promptly, and the child is stopped (K430)', async () => {
  // The shell prints the pid of the background sleep, then exits while the sleep still holds the pipe.
  const result = await runCommand({ command: 'sh', args: ['-c', 'sleep 30 & echo $!; echo done'], stdout: 'pipe' });
  assert.equal(result.status, 0);
  const [pid, done] = result.stdout.trim().split('\n');
  assert.equal(done, 'done');
  assert.ok(result.elapsedMs < 10000, `returned after ${result.elapsedMs} ms`);
  assert.throws(() => process.kill(Number(pid), 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH');
});

test('output beyond maxOutputBytes stops the command and reports stopped output (K430)', async () => {
  const result = await runCommand({ command: process.execPath, args: ['-e', "setInterval(() => process.stdout.write('x'.repeat(1024)), 1)"], stdout: 'pipe', maxOutputBytes: 4096 });
  assert.equal(result.stopped, 'output');
  assert.ok(Buffer.byteLength(result.stdout) <= 4096 + 1024, 'the captured output stays near the limit');
});

test('a command that does not start returns the error of its start (K430)', async () => {
  const result = await runCommand({ command: 'no-such-command-K430', stdout: 'pipe', stderr: 'pipe' });
  assert.ok(result.error instanceof Error);
  assert.equal(result.status, null);
});

test('failureOf states the failure of a finished command in one line, and none for a success (K430)', () => {
  assert.equal(failureOf({ status: 0, signal: null }), undefined);
  assert.equal(failureOf({ status: 2, signal: null }), 'failed with status 2');
  assert.equal(failureOf({ status: null, signal: 'SIGTERM' }), 'ended by SIGTERM');
  assert.equal(failureOf({ status: null, signal: null, error: new Error('spawn x ENOENT') }), 'spawn x ENOENT');
  assert.equal(failureOf({ status: null, signal: 'SIGKILL', stopped: 'output' }), 'wrote more than its output limit; stopped its process group');
});
