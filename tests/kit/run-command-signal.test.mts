// Observe real child close events and cooperative cleanup before the interrupted harness exits.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { tree } from './tree.mts';
import { filePublished } from './file-events.mts';

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
