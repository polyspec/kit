// Tests of scripts/kit/process.mts: `run` returns the output of a command and stops with the cause when it fails.
import assert from 'node:assert/strict';
import test from 'node:test';
import { run, Stop } from '../../scripts/kit/process.mts';
import { commandPath, writeNativeWrapper } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { tree } from './tree.mts';

test('run stops with the exit status of a command that fails, and with the signal of one that a signal ended (K118)', () => {
  assert.equal(run(process.execPath, ['-e', 'console.log("out")']), 'out\n');
  assert.throws(() => run(process.execPath, ['-e', 'console.error("bad"); process.exit(3)']), (error: unknown) => error instanceof Stop && error.message.endsWith('exited with 3: bad'), 'a single stream keeps the form of the message');
  assert.throws(() => run(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")']), (error: unknown) => error instanceof Stop && error.message.endsWith('ended by signal SIGKILL: '));
});

test('the message of a failed command holds both its streams (K352)', () => {
  // The texts are split in the script, so that the command line in the message does not hold them.
  assert.throws(() => run(process.execPath, ['-e', 'process.stderr.write("progress " + "on stderr\\n"); process.stdout.write("the real " + "error on stdout\\n"); process.exit(1)']), (error: unknown) => error instanceof Stop && error.message.includes('progress on stderr') && error.message.includes('the real error on stdout'));
});

test('native wrappers preserve spaced arguments and exit status on POSIX and Windows', (t) => {
  const root = tree(t, {});
  const script = 'if(process.argv[1]===String.fromCharCode(102,97,105,108)){process.stderr.write(String.fromCharCode(119,114,97,112,112,101,114,32,102,97,105,108,117,114,101));process.exit(7)}process.stdout.write(JSON.stringify(process.argv.slice(1)))';
  writeNativeWrapper(root, 'probe', { comment: 'process launch fixture', executable: process.execPath, args: ['-e', script] }, () => {});
  const command = commandPath(root, 'probe');
  const values = ['value with spaces', 'literal & (parentheses)', 'tail'];
  assert.equal(run(command, values), JSON.stringify(values));
  assert.throws(() => run(command, ['fail']), (error: unknown) => error instanceof Stop && error.message.includes('exited with 7') && error.message.includes('wrapper failure'));
});
