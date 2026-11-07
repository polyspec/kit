// Native verdicts and human diagnostics use separate reporters of the same Node invocation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ENV, checkParity, feature, repository } from './parity-support.mts';

for (const kind of ['suite', 'feature'] as const) {
  test(`K1032: ${kind} preserves failed assertion diagnostics and later native cases`, async t => {
    const failed = "console.log('FIXTURE_STDOUT'); console.error('FIXTURE_STDERR'); assert.deepEqual({ actualMarker: 17 }, { expectedMarker: 23 }, 'NATIVE_ASSERTION');";
    const source = kind === 'suite'
      ? `import assert from 'node:assert/strict'; import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path'; test('empty', () => { ${failed} }); test('ascii', () => { console.log('LATER_CASE_EXECUTED'); });\n`
      : `import assert from 'node:assert/strict'; import { describe, test } from 'node:test'; describe('roundtrip', () => { test('bytes', () => { ${failed} }); test('text', () => { console.log('LATER_CASE_EXECUTED'); }); });\n`;
    const change = kind === 'suite' ? { files: { 'ts/tests/codec.mjs': source } } : feature({ 'ts/tests/roundtrip.test.mjs': source }, unit => {
      assert.ok(unit.bindings);
      unit.bindings.push({ implementation: 'ts', test: 'ts/tests/roundtrip.test.mjs', id: 'roundtrip › text' });
      return unit;
    });
    const root = repository(t, change);
    const lines: string[] = [];
    const unit = kind === 'suite' ? 'codec' : 'roundtrip';
    const result = await checkParity(root, { execute: true, env: ENV, units: [unit], implementations: ['ts'], say: line => lines.push(line) });
    assert.ok(result.findings.some(finding => finding.rule === 'R3'));
    assert.deepEqual(result.ledger.cases.toSorted((a, b) => a.case < b.case ? -1 : a.case > b.case ? 1 : 0).map(entry => [entry.case, entry.outcome]), kind === 'suite'
      ? [['ascii', 'pass'], ['empty', 'fail']]
      : [['roundtrip › bytes', 'fail'], ['roundtrip › text', 'pass']]);
    const output = lines.join('\n');
    for (const marker of ['FIXTURE_STDOUT', 'FIXTURE_STDERR', 'NATIVE_ASSERTION', 'actualMarker', 'expectedMarker', '17', '23', 'LATER_CASE_EXECUTED'])
      assert.ok(output.includes(marker), `the target log lost ${marker}: ${output}`);
    assert.equal(result.ledger.runs.length, 1, 'both reporters observe one native invocation');
    assert.ok(result.ledger.runs.every(run => run.status !== 0), 'a failed native case never becomes a successful run');
  });
}

// A support module reports no native cases; its process status must still be checked.
test('K1032: a failed support module is reported and independent support and bindings continue', async t => {
  const root = repository(t, {
    files: {
      'ts/tests/aaa-helper.mjs': "console.error('SUPPORT_NATIVE_ERROR'); throw new Error('SUPPORT_FAILED');\n",
      'ts/tests/zzz-helper.mjs': "import { writeFileSync } from 'node:fs'; writeFileSync('later-support.marker', 'executed');\n",
    },
    edit: config => {
      const implementation = config.implementations.find(entry => entry.name === 'ts');
      assert.ok(implementation);
      implementation.support = ['ts/tests/aaa-helper.mjs', 'ts/tests/zzz-helper.mjs'];
      return config;
    },
  });
  const lines: string[] = [];
  const result = await checkParity(root, { execute: true, env: ENV, implementations: ['ts'], phase: 'bindings', say: line => lines.push(line) });
  assert.ok(result.findings.some(finding => finding.rule === 'R5' && finding.place === 'ts/tests/aaa-helper.mjs' && finding.message.includes('exited with 1')), JSON.stringify(result.findings));
  assert.match(lines.join('\n'), /SUPPORT_NATIVE_ERROR/);
  assert.match(lines.join('\n'), /SUPPORT_FAILED/);
  assert.equal(readFileSync(path.join(root, 'later-support.marker'), 'utf8'), 'executed');
  assert.ok(result.ledger.cases.some(entry => entry.unit === 'codec' && entry.outcome === 'pass'));
});

test('K1032: unexpected support cases retain their native report even with exit zero', async t => {
  const root = repository(t, {
    files: { 'ts/tests/helper.mjs': "import test from 'node:test'; test('UNDECLARED_SUPPORT_CASE', () => { console.error('SUPPORT_CASE_OUTPUT'); });\n" },
    edit: config => {
      const implementation = config.implementations.find(entry => entry.name === 'ts');
      assert.ok(implementation);
      implementation.support = ['ts/tests/helper.mjs'];
      return config;
    },
  });
  const lines: string[] = [];
  const result = await checkParity(root, { execute: true, env: ENV, implementations: ['ts'], phase: 'bindings', say: line => lines.push(line) });
  assert.ok(result.findings.some(finding => finding.rule === 'R5' && finding.message.includes('UNDECLARED_SUPPORT_CASE')));
  assert.match(lines.join('\n'), /SUPPORT_CASE_OUTPUT/);
});

test('K1032: a zero-exit binding with the wrong cases retains the actual native output', async t => {
  const root = repository(t, { files: { 'ts/tests/codec.mjs': "import test from 'node:test'; test('other', () => { console.log('MISMATCHED_VECTOR_OUTPUT'); });\n" } });
  const lines: string[] = [];
  const result = await checkParity(root, { execute: true, env: ENV, implementations: ['ts'], units: ['codec'], say: line => lines.push(line) });
  assert.ok(result.findings.some(finding => finding.rule === 'R3' && finding.message.includes('not executed: empty')));
  assert.equal(result.ledger.runs[0]?.status, 0, 'the command succeeded while the declared comparison failed');
  assert.match(lines.join('\n'), /MISMATCHED_VECTOR_OUTPUT/);
});

test('K1032: malformed support output fails without suppressing later bindings', async t => {
  const root = repository(t, {
    files: {
      'tools/native-wrapper.mjs': "import { spawnSync } from 'node:child_process'; if (process.argv.at(-1) === 'ts/tests/bad-helper.mjs') { console.log('INVALID_SUPPORT_EVENT'); } else { const child = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' }); if (child.error) throw child.error; process.exitCode = child.status ?? 1; }\n",
      'ts/tests/bad-helper.mjs': 'export const helper = true;\n',
    },
    edit: config => {
      const implementation = config.implementations.find(entry => entry.name === 'ts');
      assert.ok(implementation);
      implementation.command = 'node';
      implementation.args = ['tools/native-wrapper.mjs'];
      implementation.support = ['ts/tests/bad-helper.mjs'];
      return config;
    },
  });
  const lines: string[] = [];
  const result = await checkParity(root, { execute: true, env: { ...ENV, PATH: `${path.dirname(process.execPath)}${path.delimiter}${ENV.PATH}` }, implementations: ['ts'], phase: 'bindings', say: line => lines.push(line) });
  assert.ok(result.findings.some(finding => finding.rule === 'R5' && finding.message.includes('invalid reporter output')), JSON.stringify(result.findings));
  assert.match(lines.join('\n'), /INVALID_SUPPORT_EVENT/);
  assert.ok(result.ledger.cases.some(entry => entry.unit === 'codec' && entry.outcome === 'pass'));
});
