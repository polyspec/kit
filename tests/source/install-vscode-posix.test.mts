// Observe actual POSIX helper termination and owned child close without downloading VS Code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { stopGroup, watchRoot } from '../../scripts/kit/process-group.mts';
import { tree as directory } from '../kit/tree.mts';

for (const cooperative of [true, false]) {
  for (const failed of [false, true]) {
    test(`K1044 K1232: settled ${failed ? 'failed' : 'successful'} download ${cooperative ? 'cleans up cooperatively' : 'receives termination before escalation'}`, async t => {
      let resourcesClosed = false;
      const root = directory({ after: cleanup => t.after(() => {
        assert.ok(resourcesClosed, `fixture retained because owned processes did not finish cleanup: ${root}`);
        cleanup();
      }) });
      const helper = path.join(root, 'download.cjs');
      const pidPath = path.join(root, 'pid');
      const termPath = path.join(root, 'termination-request');
      const settled = failed ? { error: 'download rejected' } : { executable: '/fixture/vscode' };
      writeFileSync(helper, `
        const fs = require('node:fs');
        const hold = fs.watch(${JSON.stringify(root)}, () => {});
        process.on('SIGTERM', () => {
          fs.writeFileSync(${JSON.stringify(termPath)}, 'requested');
          ${cooperative ? 'hold.close(); process.disconnect();' : ''}
        });
        fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
        process.send(${JSON.stringify(settled)});
      `);
      const driver = `
        import { syncBuiltinESMExports } from 'node:module';
        const cp = process.getBuiltinModule('node:child_process');
        const originalFork = cp.fork;
        const close = { closed: false, status: null, signal: null };
        cp.fork = (_file, _args, options) => {
          const child = originalFork(${JSON.stringify(helper)}, [], options);
          child.once('close', (status, signal) => Object.assign(close, { closed: true, status, signal }));
          return child;
        };
        syncBuiltinESMExports();
        const { downloadInOwnProcess } = await import(${JSON.stringify(new URL('../../scripts/kit/install-vscode.mts', import.meta.url).href)});
        let outcome;
        try { outcome = { executable: await downloadInOwnProcess({version:'1.138.0',platform:'linux-x64',cachePath:${JSON.stringify(root)}}) }; }
        catch (error) { outcome = { error: error.message }; }
        console.log(JSON.stringify({ outcome, close }));
      `;
      const since = Date.now();
      const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const spawned = watchRoot(child, since);
      const closed = once(child, 'close');
      let complete = false;
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      try {
        const result: unknown[] = await closed;
        assert.equal(result[0], 0, stderr);
        assert.equal(result[1], null, stderr);
        assert.equal(existsSync(termPath), true, 'settlement requested cooperative termination');
        const report: unknown = JSON.parse(stdout);
        assert.deepEqual(report, { outcome: settled, close: { closed: true, status: cooperative ? 0 : null, signal: cooperative ? null : 'SIGKILL' } });
        assert.throws(() => process.kill(Number(readFileSync(pidPath, 'utf8')), 0), { code: 'ESRCH' });
        complete = true;
      } finally {
        if (child.pid !== undefined) await stopGroup(child.pid, closed, 1000, undefined, spawned);
        if (!complete && existsSync(pidPath)) await stopGroup(Number(readFileSync(pidPath, 'utf8')), Promise.resolve(), 1000);
        resourcesClosed = true;
      }
    });
  }
}
