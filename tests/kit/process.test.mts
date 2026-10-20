// Tests of scripts/kit/process.mts: `run` returns the output of a command and stops with the cause when it fails.
import assert from 'node:assert/strict';
import test from 'node:test';
import { run, Stop } from '../../scripts/kit/process.mts';

test('run stops with the exit status of a command that fails, and with the signal of one that a signal ended (K118)', () => {
  assert.equal(run(process.execPath, ['-e', 'console.log("out")']), 'out\n');
  assert.throws(() => run(process.execPath, ['-e', 'console.error("bad"); process.exit(3)']), (error: unknown) => error instanceof Stop && error.message.endsWith('exited with 3: stderr: bad'));
  assert.throws(() => run(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")']), (error: unknown) => error instanceof Stop && error.message.endsWith('ended by signal SIGKILL: '));
});

test('the message of a failed command holds both its streams (K352)', () => {
  // The texts are split in the script, so that the command line in the message does not hold them.
  assert.throws(() => run(process.execPath, ['-e', 'process.stderr.write("progress " + "on stderr\\n"); process.stdout.write("the real " + "error on stdout\\n"); process.exit(1)']), (error: unknown) => error instanceof Stop && error.message.includes('progress on stderr') && error.message.includes('the real error on stdout'));
});
