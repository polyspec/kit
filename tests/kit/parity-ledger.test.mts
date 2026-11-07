// A missing native tool is reported without executing a compiler.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ENV, checkParity, repository } from './parity-support.mts';

test('a built-in go binding whose go cannot start names the program and the cause, as before its build step (K936, K393-2)', { timeout: 120_000 }, async (t) => {
  // A PATH that holds no go on any machine, an empty folder of the test: a runner may have go in /usr/bin (K973).
  const empty = mkdtempSync(path.join(tmpdir(), 'kit-no-go-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const { findings } = await checkParity(repository(t), { execute: true, env: { ...ENV, PATH: empty }, units: ['codec'], implementations: ['go'], say: () => {} });
  const messages = findings.map(finding => finding.message);
  assert.ok(messages.some(message => /could not start: .*ENOENT/.test(message)), `no start finding; findings: ${JSON.stringify(messages)}`);
});
