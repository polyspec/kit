// The run of one make target for the guard of the full run (full-run.mjs): `make -k <target>` runs in the checkout, its
// output goes to the terminal as it arrives and to the log of the target, and the last lines of the output are kept for the
// record of a failed target.
//
//   <report>/targets/<target>.log   the whole output of `make -k <target>` and the way it ended
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FAILURE_LINES, logPath, TARGET_NAME } from './target-report.mjs';

/**
 * Runs `make -k <target>` in `root` (`-k` keeps going after a failed prerequisite, so one run reports every failure), prints
 * its output as it arrives and writes it to the log of the target in `directory`. Resolves `{ passed, lastLines }`: whether
 * make ended with status 0, and the last FAILURE_LINES lines of its standard output and standard error in the order of arrival.
 */
export function runMakeTarget(root, target, directory) {
  if (!TARGET_NAME.test(target)) throw new Error(`the target name ${JSON.stringify(target)} does not match ${TARGET_NAME}`);
  mkdirSync(path.join(directory, 'targets'), { recursive: true });
  const log = createWriteStream(logPath(directory, target));
  return new Promise((resolve, reject) => {
    const child = spawn('make', ['-k', target], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    // Each stream that make leaves without a final newline gets one, so the next line of the guard starts at column 0.
    const keep = (stream, output) => {
      let pending = '';
      let last = '\n';
      stream.on('data', (data) => {
        output.write(data);
        log.write(data);
        const text = String(data);
        if (text.length > 0) last = text.at(-1);
        const parts = (pending + text).split('\n');
        pending = parts.pop();
        lines.push(...parts);
        lines.splice(0, Math.max(0, lines.length - FAILURE_LINES));
      });
      return () => {
        if (pending !== '') lines.push(pending);
        if (last !== '\n') output.write('\n');
      };
    };
    const flushOut = keep(child.stdout, process.stdout);
    const flushErr = keep(child.stderr, process.stderr);
    child.once('error', error => log.end(() => reject(error)));
    child.once('close', (status, signal) => {
      flushOut();
      flushErr();
      log.write(`\n[full-run] make -k ${target} ended with ${signal ? `signal ${signal}` : `status ${status}`}\n`);
      log.end(() => resolve({ passed: status === 0, lastLines: lines.slice(-FAILURE_LINES) }));
    });
  });
}
