// Observe real child close events and cooperative cleanup before the interrupted harness exits.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { signalGroup, stopGroup } from '../../scripts/kit/process-group.mts';
import { failureOf, runCommand, withCommandResources, type CleanupCommand } from '../../scripts/kit/run-command.mts';
import { tree } from './tree.mts';
import { filePublished } from './file-events.mts';

test('K1231-1: action and cleanup errors survive and an escaped cleanup runner expires', async t => {
  const root = tree(t);
  const actionError = new Error('action failed');
  const cleanupError = new Error('cleanup failed');
  let escaped: CleanupCommand | undefined;
  await assert.rejects(withCommandResources(() => { throw actionError; }, run => {
    escaped = run;
    throw cleanupError;
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [actionError, cleanupError]);
    return true;
  });
  assert.ok(escaped);
  const later = path.join(root, 'expired-command');
  await assert.rejects(escaped({ command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(later)}, 'bad');`] }), /closed outside its cleanup callback/);
  assert.equal(existsSync(later), false);
});

test('K1231-1: an admitted cleanup command is awaited and its failure is reported even without a caller await', async () => {
  await assert.rejects(withCommandResources(() => 'action completed', run => {
    void run({ command: process.execPath, args: ['-e', 'process.exit(7)'], stdout: 'pipe', stderr: 'pipe' }).catch(() => undefined);
  }), /failed with status 7/);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`K1231-1: ${signal} waits for cleanup commands without interrupting them`, { skip: process.platform === 'win32' && 'POSIX signals' }, async t => {
    const root = tree(t);
    const readyPath = path.join(root, 'ready.json');
    const observedPath = path.join(root, 'signal-observed');
    const ready = filePublished(t, readyPath);
    const observed = filePublished(t, observedPath);
    const gate = path.join(root, 'release-cleanup');
    const body = `
      const fs = require('node:fs');
      const hold = fs.watch(${JSON.stringify(root)}, () => {
        if (!fs.existsSync(${JSON.stringify(gate)})) return;
        fs.writeFileSync(${JSON.stringify(path.join(root, 'cleanup-finished'))}, 'finished');
        hold.close();
      });
      process.on('SIGTERM', () => {
        fs.writeFileSync(${JSON.stringify(path.join(root, 'cleanup-was-terminated'))}, 'bad');
        hold.close();
      });
      fs.writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid }));
    `;
    const driver = `
      import fs from 'node:fs';
      const { runCommand, withCommandResources, interruptionStatus } = await import(${JSON.stringify(new URL('../../scripts/kit/run-command.mts', import.meta.url).href)});
      const originalExit = process.exit;
      process.exit = status => {
        fs.writeFileSync(${JSON.stringify(path.join(root, 'exit.json'))}, JSON.stringify({ cleanupResolved: fs.existsSync(${JSON.stringify(path.join(root, 'cleanup-resolved'))}) }));
        originalExit(status);
      };
      const pending = withCommandResources(() => 'action completed', run => {
        void run({ command: process.execPath, args: ['-e', ${JSON.stringify(body)}], stdout: 'pipe', stderr: 'pipe' }).then(
          () => fs.writeFileSync(${JSON.stringify(path.join(root, 'cleanup-resolved'))}, 'closed'),
          error => fs.writeFileSync(${JSON.stringify(path.join(root, 'cleanup-rejected'))}, String(error)),
        );
      });
      process.on(${JSON.stringify(signal)}, () => fs.writeFileSync(${JSON.stringify(observedPath)}, 'observed'));
      try {
        await pending;
        await runCommand({ command: process.execPath, args: ['-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'later'))}, 'bad');`)}] });
        process.exitCode = interruptionStatus() ?? 0;
      } catch (error) {
        console.error(error);
        process.exitCode = interruptionStatus() ?? 1;
      }
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    const closed = once(child, 'close');
    let complete = false;
    try {
      await Promise.race([ready, closed.then(result => assert.fail(`owner exited before cleanup readiness: ${JSON.stringify(result)}\n${output}`))]);
      child.kill(signal);
      await Promise.race([observed, closed.then(result => assert.fail(`owner exited before cleanup release: ${JSON.stringify(result)}\n${output}`))]);
      writeFileSync(gate, 'release');
      assert.equal((await closed)[0], signal === 'SIGINT' ? 130 : 143, output);
      assert.equal(existsSync(path.join(root, 'cleanup-finished')), true);
      assert.equal(existsSync(path.join(root, 'cleanup-was-terminated')), false);
      assert.equal(existsSync(path.join(root, 'cleanup-rejected')), false);
      assert.equal(existsSync(path.join(root, 'later')), false);
      assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'exit.json'), 'utf8')), { cleanupResolved: true });
      complete = true;
    } finally {
      if (!complete) {
        if (child.pid !== undefined) await stopGroup(child.pid, closed, 1000);
        if (existsSync(readyPath)) {
          const worker: unknown = JSON.parse(readFileSync(readyPath, 'utf8'));
          assert.ok(worker !== null && typeof worker === 'object' && 'pid' in worker && typeof worker.pid === 'number');
          await stopGroup(worker.pid, Promise.resolve(), 1000);
        }
      }
      await closed;
    }
  });
}

for (const cooperative of [true, false]) {
  test(`K1036: interruption ${cooperative ? 'allows cooperative cleanup' : 'escalates an uncooperative child'} and reaps owned commands`, { timeout: 10_000 }, async t => {
    const root = tree(t);
    const readyPath = path.join(root, 'ready');
    const ready = filePublished(t, readyPath);
    const pidPath = path.join(root, 'pid');
    const termPath = path.join(root, 'termination-request');
    const reportPath = path.join(root, 'close-report.json');
    const laterPath = path.join(root, 'later-command-started');
    const body = `
      const fs = require('node:fs');
      const hold = fs.watch(${JSON.stringify(root)}, () => {});
      process.on('SIGTERM', () => {
        fs.writeFileSync(${JSON.stringify(termPath)}, 'requested');
        ${cooperative ? 'hold.close();' : ''}
      });
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
    `;
    const driver = `
      import { syncBuiltinESMExports } from 'node:module';
      import { writeFileSync } from 'node:fs';
      const cp = process.getBuiltinModule('node:child_process');
      const originalSpawn = cp.spawn;
      const records = [];
      cp.spawn = (...args) => {
        const child = originalSpawn(...args);
        const record = { closed: false, status: null, signal: null };
        records.push(record);
        child.once('close', (status, signal) => Object.assign(record, { closed: true, status, signal }));
        return child;
      };
      syncBuiltinESMExports();
      const originalExit = process.exit;
      process.exit = code => {
        writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(records));
        originalExit(code);
      };
      const { runCommand } = await import(${JSON.stringify(new URL('../../scripts/kit/run-command.mts', import.meta.url).href)});
      await runCommand({ command: process.execPath, args: ['-e', ${JSON.stringify(body)}], stdout: 'pipe', stderr: 'pipe' });
      await runCommand({ command: process.execPath, args: ['-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(laterPath)}, 'started');`)}] });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    let complete = false;
    t.after(() => {
      if (complete) return;
      child.kill('SIGKILL');
      if (existsSync(pidPath)) signalGroup(Number(readFileSync(pidPath, 'utf8')), 'SIGKILL');
    });
    const closed = once(child, 'close');
    await Promise.race([ready, closed.then(result => assert.fail(`harness ended before ready: ${JSON.stringify(result)}; ${stderr}`))]);
    assert.equal(child.kill('SIGTERM'), true);
    assert.equal((await closed)[0], 143, stderr);
    assert.equal(existsSync(termPath), true, 'the child receives a graceful termination request');
    const report: unknown = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.deepEqual(report, [{ closed: true, status: cooperative ? 0 : null, signal: cooperative ? null : 'SIGKILL' }]);
    assert.equal(existsSync(laterPath), false, 'interruption admits no later command');
    complete = true;
  });
}

for (const cooperative of [true, false]) {
  test(`K1043: output limit ${cooperative ? 'awaits cooperative cleanup' : 'escalates only after requesting termination'}`, { timeout: 10_000 }, async t => {
    const root = tree(t);
    const pidPath = path.join(root, 'pid');
    const termPath = path.join(root, 'termination-request');
    const body = `
      const fs = require('node:fs');
      const hold = fs.watch(${JSON.stringify(root)}, () => {});
      process.on('SIGTERM', () => {
        fs.writeFileSync(${JSON.stringify(termPath)}, 'requested');
        ${cooperative ? 'hold.close();' : ''}
      });
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      process.stdout.write('x'.repeat(256));
    `;
    let complete = false;
    t.after(() => {
      if (!complete && existsSync(pidPath)) signalGroup(Number(readFileSync(pidPath, 'utf8')), 'SIGKILL');
    });
    const result = await runCommand({ command: process.execPath, args: ['-e', body], stdout: 'pipe', stderr: 'pipe', maxOutputBytes: 128 });
    assert.equal(existsSync(termPath), true, 'the output bound requests termination before forcing');
    assert.equal(result.stopped, 'output');
    assert.equal(result.status, cooperative ? 0 : null);
    assert.equal(result.signal, cooperative ? null : 'SIGKILL');
    assert.equal(failureOf(result), 'wrote more than its output limit; stopped its process group', 'cooperative exit still fails the output bound');
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 128);
    assert.throws(() => process.kill(Number(readFileSync(pidPath, 'utf8')), 0), { code: 'ESRCH' }, 'the owned child is reaped before returning');
    complete = true;
  });
}
