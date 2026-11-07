// A missing native tool is reported without executing a compiler.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ENV, GO_STUB, CARGO_STUB, checkParity, repository } from './parity-support.mts';

test('a built-in go binding whose go cannot start names the program and the cause, (K393-2)', { timeout: 120_000 }, async (t) => {
  // A PATH that holds no go on any machine, an empty folder of the test: a runner may have go in /usr/bin (K973).
  const empty = mkdtempSync(path.join(tmpdir(), 'kit-no-go-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const { findings } = await checkParity(repository(t), { execute: true, env: { ...ENV, PATH: empty }, units: ['codec'], implementations: ['go'], say: () => {} });
  const messages = findings.map(finding => finding.message);
  assert.ok(messages.some(message => /could not start: .*ENOENT/.test(message)), `no start finding; findings: ${JSON.stringify(messages)}`);
});

for (const [implementation, program, stub] of [['go', 'go', GO_STUB], ['rust', 'cargo', CARGO_STUB]] as const) {
  test(`K1035: ${implementation} invokes its native test command once and preserves case outcomes`, { timeout: 20_000 }, async t => {
    const root = repository(t);
    const bin = path.join(root, 'var/tools/bin');
    mkdirSync(bin, { recursive: true });
    const trace = path.join(root, 'native-invocations.jsonl');
    const tool = path.join(bin, program);
    writeFileSync(tool, stub.replace('const args = process.argv.slice(2);',
      `const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n');`));
    chmodSync(tool, 0o755);
    const result = await checkParity(root, {
      execute: true, env: { ...ENV, PATH: `${bin}${path.delimiter}${ENV.PATH}` },
      units: ['codec'], implementations: [implementation], phase: 'bindings', say: () => {},
    });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.ledger.cases.map(entry => [entry.case, entry.outcome]), [['empty', 'pass'], ['ascii', 'pass']]);
    const invocations = readFileSync(trace, 'utf8').trim().split('\n');
    assert.equal(invocations.length, 1, `a binding must invoke its native test tool once: ${invocations.join(' | ')}`);
  });
}

for (const [implementation, program] of [['go', 'go'], ['rust', 'cargo']] as const) {
  test(`K1035: ${implementation} compiler failure preserves its status and diagnostics without executed cases`, { timeout: 20_000 }, async t => {
    const root = repository(t);
    const bin = path.join(root, 'var/tools/bin');
    mkdirSync(bin, { recursive: true });
    const tool = path.join(bin, program);
    writeFileSync(tool, `#!${process.execPath}\nconsole.error('NATIVE_COMPILER_ERROR: malformed source'); process.exitCode = 23;\n`);
    chmodSync(tool, 0o755);
    const result = await checkParity(root, {
      execute: true, env: { ...ENV, PATH: `${bin}${path.delimiter}${ENV.PATH}` },
      units: ['codec'], implementations: [implementation], phase: 'bindings', say: () => {},
    });
    assert.deepEqual(result.ledger.cases, []);
    assert.equal(result.ledger.runs.length, 1);
    assert.equal(result.ledger.runs[0]?.status, 23);
    const finding = result.findings.find(entry => entry.rule === 'R3');
    assert.ok(finding);
    assert.match(finding.message, /exited with 23/);
    assert.match(finding.message, /NATIVE_COMPILER_ERROR: malformed source/);
    assert.match(finding.message, /not executed: empty, ascii/);
  });
}
