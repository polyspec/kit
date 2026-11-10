// Focused contract tests for the callbacks in Playwright's public Reporter API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readJsonFile } from '../../scripts/kit/schema-validate.mts';

const reporter = fileURLToPath(import.meta.resolve('../../scripts/kit/playwright-reporter.mts'));

function report(callbacks: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kit-playwright-reporter-'));
  const resultFile = path.join(directory, 'result.json');
  const script = path.join(directory, 'report.mjs');
  writeFileSync(script, `import Reporter from ${JSON.stringify(reporter)};
const reporter = new Reporter();
reporter.onBegin();
${callbacks}
reporter.onEnd({ status: 'passed' });
`);
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, KIT_TEST_ROOT: process.cwd(), KIT_TEST_RESULT: resultFile },
  });
  try {
    return {
      status: result.status,
      output: result.stdout,
      error: result.stderr,
      summary: existsSync(resultFile) ? readJsonFile<{ passed: number; failed: number; skipped: number; ran: number; cases: { id: string; status: string }[] }>(resultFile, 'test-result.schema.json') : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('Playwright reporter records real case callbacks, retries as one flaky pass, and skips (K747)', () => {
  const testCase = `({ id: 'case-id', titlePath: () => ['chromium', 'tests/store.spec.ts', 'checkout', 'works'], location: { file: ${JSON.stringify(path.join(process.cwd(), 'tests/store.spec.ts'))} }, retries: 1, repeatEachIndex: 0, outcome: () => 'flaky', parent: { project: () => ({ name: 'chromium' }) } })`;
  const result = report(`const test = ${testCase};
reporter.onTestBegin(test, { duration: 0, retry: 0, status: 'failed' });
reporter.onTestEnd(test, { duration: 4, retry: 0, status: 'failed', error: { message: 'retry' }, errors: [{ message: 'retry' }] });
reporter.onTestBegin(test, { duration: 0, retry: 1, status: 'passed' });
reporter.onTestEnd(test, { duration: 7, retry: 1, status: 'passed', errors: [] });
const skipped = { ...test, id: 'skip-id', titlePath: () => ['', 'checkout', 'skips'], retries: 0, outcome: () => 'skipped' };
reporter.onTestEnd(skipped, { duration: 0, retry: 0, status: 'skipped', errors: [] });`);
  assert.equal(result.status, 1, `${result.output}\n${result.error}`);
  assert.ok(result.summary, `${result.output}\n${result.error}`);
  assert.deepEqual(result.summary?.cases.map(item => item.status), ['pass', 'skip']);
  assert.deepEqual([result.summary?.passed, result.summary?.failed, result.summary?.skipped, result.summary?.ran], [1, 0, 1, 1]);
});

test('a case that Playwright ends at its own timeout fails (K747, K1175)', () => {
  const result = report(`const test = { id: 'timeout-id', titlePath: () => ['', 'waits'], location: { file: '/project/tests/slow.spec.ts' }, retries: 0, repeatEachIndex: 0, outcome: () => 'unexpected', parent: { project: () => ({ name: '' }) } };
reporter.onTestBegin(test, { duration: 0, retry: 0, status: 'failed' });
reporter.onTestEnd(test, { duration: 8, retry: 0, status: 'timedOut', error: { message: 'Test timeout' }, errors: [{ message: 'Test timeout' }] });`);
  assert.equal(result.status, 1, `${result.output}\n${result.error}`);
  assert.ok(result.summary, `${result.output}\n${result.error}`);
  assert.deepEqual(result.summary?.cases.map(item => item.status), ['fail']);
  assert.deepEqual([result.summary?.failed, result.summary?.ran], [1, 1]);
});

test('Playwright list-only or zero-case reporter runs fail the executed-case guard (K747)', () => {
  const result = report('');
  assert.equal(result.status, 1, `${result.output}\n${result.error}`);
  assert.equal(result.summary?.ran, 0);
  assert.match(result.output, /no test ran/);
});

test('the native Playwright CLI enforces the case timeout that the caller passes, and run-tests closes the process group (K747, K1175)', { timeout: 30_000 }, async (t) => {
  const root = process.cwd();
  const directory = mkdtempSync(path.join(root, 'tests/kit/playwright-native-'));
  const file = path.join(directory, 'timeout.spec.ts');
  const pidFile = path.join(directory, 'child.pid');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(file, `import { test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
test('native pass', () => {});
test.skip('native skip', () => {});
test('native timeout', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  await new Promise(() => {});
});
`);
  const command = spawn(process.execPath, [fileURLToPath(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'playwright', '--', '--timeout=1000', path.relative(root, file)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = command.stdout;
  const stderr = command.stderr;
  assert.ok(stdout && stderr);
  let output = '';
  stdout.setEncoding('utf8').on('data', text => { output += text; });
  stderr.setEncoding('utf8').on('data', text => { output += text; });
  const fallback = setTimeout(() => command.kill('SIGTERM'), 15_000);
  let status: number | null;
  try {
    status = await new Promise<number | null>((resolve, reject) => {
      command.once('error', reject);
      command.once('close', resolve);
    });
  } finally {
    clearTimeout(fallback);
  }
  assert.equal(status, 1, output);
  assert.match(output, /native timeout/);
  assert.match(output, /1 passed, 1 failed, 1 skipped/);
  assert.match(output, /timeout\.spec\.ts › default › native pass/);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

// printsToStdio is true, so Playwright prints no output of the tests itself: the reporter forwards it (K1147).
test('the reporter forwards the standard output and standard error of the tests and the workers (K1147)', () => {
  const result = report("reporter.onStdOut('printed by a test\\n');\nreporter.onStdErr(Buffer.from('warned by a worker\\n'));");
  assert.match(result.output, /printed by a test/, result.error);
  assert.match(result.error, /warned by a worker/);
});
