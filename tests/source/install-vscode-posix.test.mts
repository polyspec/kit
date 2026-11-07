// Observe actual POSIX helper termination and owned child close without downloading VS Code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { tree as directory } from '../kit/tree.mts';

for (const cooperative of [true, false]) {
  for (const failed of [false, true]) {
    test(`K1044: settled ${failed ? 'failed' : 'successful'} download ${cooperative ? 'cleans up cooperatively' : 'receives termination before escalation'}`, { timeout: 10_000 }, async t => {
      const root = directory(t);
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
      const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'] });
      let complete = false;
      t.after(() => {
        if (complete) return;
        child.kill('SIGKILL');
        if (existsSync(pidPath)) signalGroup(Number(readFileSync(pidPath, 'utf8')), 'SIGKILL');
      });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      const closed: unknown[] = await once(child, 'close');
      assert.equal(closed[0], 0, stderr);
      assert.equal(closed[1], null, stderr);
      assert.equal(existsSync(termPath), true, 'settlement requested cooperative termination');
      const report: unknown = JSON.parse(stdout);
      assert.deepEqual(report, { outcome: settled, close: { closed: true, status: cooperative ? 0 : null, signal: cooperative ? null : 'SIGKILL' } });
      assert.throws(() => process.kill(Number(readFileSync(pidPath, 'utf8')), 0), { code: 'ESRCH' });
      complete = true;
    });
  }
}
