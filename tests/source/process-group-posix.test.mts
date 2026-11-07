// Native POSIX defunct process groups are observed on Linux source CI and macOS bootstrap.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { stopGroup } from '../../scripts/kit/process-group.mts';

const PROCESS_TIMEOUT = { timeout: 60_000 };

test('K1039: a native defunct group needs neither termination nor survivor grace', PROCESS_TIMEOUT, async t => {
  const disconnected = Promise.withResolvers<number>();
  const server = createServer(socket => {
    let text = '';
    socket.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; });
    socket.once('close', () => {
      if (/^[1-9][0-9]*$/.test(text)) disconnected.resolve(Number(text));
      else disconnected.reject(new Error(`native child sent no pid: ${JSON.stringify(text)}`));
    });
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const child = `const socket = require('node:net').connect(${address.port}, '127.0.0.1', () => socket.write(String(process.pid), () => process.exit(0)));`;
  // The parent blocks before entering its event loop, leaving its exited child unreaped until stdin releases it.
  const parent = spawn(process.execPath, ['-e', `
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { detached: true, stdio: 'ignore' });
    require('node:fs').readSync(0, Buffer.alloc(1), 0, 1);
    child.once('close', () => {});
  `], { stdio: ['pipe', 'ignore', 'pipe'] });
  const closed = once(parent, 'close');
  let cleaned = false;
  const release = () => {
    if (cleaned) return;
    cleaned = true;
    parent.stdin.end('release');
    server.close();
  };
  t.after(release);
  let stderr = '';
  parent.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  try {
    const pid = await Promise.race([disconnected.promise, closed.then(result => assert.fail(`native parent ended before child exit: ${JSON.stringify(result)}; ${stderr}`))]);
    const listed = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout.trim(), /^Z/, 'the native fixture owns an exited but unreaped group member');
    const signals: (NodeJS.Signals | number)[] = [];
    await stopGroup(pid, Promise.resolve(), 20, (target, signal) => {
      signals.push(signal);
      process.kill(target, signal);
    });
    assert.deepEqual(signals.filter(signal => signal !== 0), [], 'no termination signal is sent to a group containing only a defunct member');
  } finally {
    release();
    assert.equal((await closed)[0], 0, stderr);
  }
});
