// A binding can prepare work before a native case exists; the harness must not time that operation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { filePublished } from './file-events.mts';
import { ENV, NODE_CODEC, VITEST_STUB, checkParity, feature, repository, vitestRepository } from './parity-support.mts';

type Kind = 'suite' | 'feature' | 'vitest';

function operation(t: TestContext, kind: Kind, caseDeadline = false) {
  let cleanup = () => {};
  t.after(() => cleanup());
  const gate = `
const { existsSync, watch, writeFileSync } = process.getBuiltinModule('node:fs');
writeFileSync('operation.pid', String(${kind === 'vitest' ? 'process.pid' : 'process.ppid'}));
await new Promise(resolve => {
  const observer = watch('.', () => {
    if (existsSync('operation-release')) { observer.close(); resolve(); }
  });
  writeFileSync('operation-ready', '');
});
`;
  const body = caseDeadline
    ? "import test from 'node:test'; import { setTimeout } from 'node:timers/promises'; test('empty', { timeout: 10 }, async () => { await setTimeout(80); }); test('ascii', () => {});\n"
    : NODE_CODEC;
  const change = kind === 'feature' ? feature({
    'ts/tests/roundtrip.test.mjs': gate + "import { describe, test } from 'node:test'; describe('roundtrip', () => { test('bytes', () => {}); test('text', () => {}); });\n",
  }, unit => { unit.bindings?.push({ implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'roundtrip › text' }); return unit; })
    : { files: { 'ts/tests/codec.mjs': gate + body } };
  const originalEdit = 'edit' in change ? change.edit : undefined;
  const root = kind === 'vitest'
    ? vitestRepository(t, { 'node_modules/vitest/vitest.mjs': gate + VITEST_STUB.replaceAll('require(', 'process.getBuiltinModule(') })
    : repository(t, { ...change, edit: config => {
      config = originalEdit?.(config) ?? config;
      const implementation = config.implementations.find(entry => entry.name === 'ts');
      assert.ok(implementation);
      implementation.args = ['--test-isolation=process'];
      return config;
    } });
  let finished = false;
  const pidFile = path.join(root, 'operation.pid');
  const release = () => writeFileSync(path.join(root, 'operation-release'), '');
  cleanup = () => {
    if (!finished && existsSync(pidFile)) signalGroup(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
  };
  return { root, pidFile, release, complete: () => { finished = true; }, options: {
    execute: true, env: ENV, phase: 'bindings' as const, units: [kind === 'feature' ? 'roundtrip' : 'codec'],
    implementations: [kind === 'vitest' ? 'web' : 'ts'], say: () => {},
  } };
}

async function completeAfterClock(t: TestContext, fixture: ReturnType<typeof operation>) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ready = filePublished(t, path.join(fixture.root, 'operation-ready'));
  const running = checkParity(fixture.root, fixture.options);
  await Promise.race([ready, running.then(result => assert.fail(`binding ended before its ready event: ${JSON.stringify(result.findings)}`))]);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  fixture.release();
  const result = await running;
  fixture.complete();
  return result;
}

for (const kind of ['suite', 'feature', 'vitest'] as const) {
  test(`K1033: quiet ${kind} preparation survives elapsed parent time`, { timeout: 10_000 }, async t => {
    const result = await completeAfterClock(t, operation(t, kind));
    assert.deepEqual(result.findings, []);
    assert.equal(result.ledger.cases.length, 2);
    assert.ok(result.ledger.cases.every(entry => entry.outcome === 'pass'));
  });
}

test('K1033: native case deadlines still fail the timed case and allow later cases', { timeout: 10_000 }, async t => {
  const result = await completeAfterClock(t, operation(t, 'suite', true));
  assert.ok(result.findings.some(finding => finding.rule === 'R3' && finding.message.includes('failed: empty')));
  assert.deepEqual(result.ledger.cases.map(entry => [entry.case, entry.outcome]), [['empty', 'fail'], ['ascii', 'pass']]);
});

test('K1033: interrupting the checker ends its quiet binding process group', { timeout: 10_000 }, async t => {
  const fixture = operation(t, 'suite');
  const ready = filePublished(t, path.join(fixture.root, 'operation-ready'));
  const driver = `const { checkParity } = await import(${JSON.stringify(new URL('../../scripts/kit/parity.mts', import.meta.url).href)}); const result = await checkParity(${JSON.stringify(fixture.root)}, ${JSON.stringify(fixture.options)}); process.exitCode = result.findings.length ? 1 : 0;`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  const closed = once(child, 'close');
  await Promise.race([ready, closed.then(result => assert.fail(`checker ended before ready: ${JSON.stringify(result)}`))]);
  assert.equal(child.kill('SIGTERM'), true);
  assert.equal((await closed)[0], 143);
  assert.equal(signalGroup(Number(readFileSync(fixture.pidFile, 'utf8')), 0), 'ended');
  fixture.complete();
});
