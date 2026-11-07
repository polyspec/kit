// A native command waits for its progress to be observed before running real Node cases.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { ENV, checkParity, repository, runOf } from './parity-support.mts';

for (const fails of [false, true]) {
  test(`K1034: ${fails ? 'failed' : 'passed'} native output is live and appears once`, { timeout: 10_000 }, async t => {
    let cleanup = () => {};
    t.after(() => cleanup());
    t.signal.addEventListener('abort', () => cleanup(), { once: true });
    const root = repository(t, {
      files: {
        'ts/progress.mjs': '',
        'ts/tests/codec.mjs': `import test from 'node:test'; test('empty', () => { console.log('NATIVE_STDOUT_ONCE'); console.error('NATIVE_STDERR_ONCE'); ${fails ? "throw new Error('NATIVE_ASSERTION');" : ''} }); test('ascii', () => {});\n`,
      },
      edit: config => {
        const unit = config.units.find(entry => entry.id === 'codec');
        const binding = unit?.bindings?.find(entry => entry.implementation === 'ts');
        assert.ok(binding);
        binding.command = ['node', 'progress.mjs'];
        return config;
      },
    });
    const native = runOf({ name: 'ts', runner: 'node' }, root, { test: 'ts/tests/codec.mjs' }, 'suite', ENV);
    if (native.error) throw new Error(native.error);
    const ack = path.join(root, 'progress-ack');
    const pid = path.join(root, 'progress.pid');
    writeFileSync(path.join(root, 'ts/progress.mjs'), `
import { existsSync, watch, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
writeFileSync(${JSON.stringify(pid)}, String(process.pid));
await new Promise(resolve => {
  const observer = watch(${JSON.stringify(root)}, () => {
    if (existsSync(${JSON.stringify(ack)})) { observer.close(); resolve(); }
  });
  console.error('NATIVE_PROGRESS_READY');
});
const child = spawnSync(process.execPath, ${JSON.stringify(native.args)}, { cwd: ${JSON.stringify(root)}, stdio: 'inherit' });
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
`);
    let completed = false;
    cleanup = () => {
      if (!completed && existsSync(pid)) signalGroup(Number(readFileSync(pid, 'utf8')), 'SIGKILL');
    };
    const lines: string[] = [];
    let progressSeen = false;
    const result = await checkParity(root, {
      execute: true, env: { ...ENV, PATH: `${path.dirname(process.execPath)}${path.delimiter}${ENV.PATH}` },
      units: ['codec'], implementations: ['ts'], phase: 'bindings',
      say: line => {
        lines.push(line);
        if (line.endsWith('NATIVE_PROGRESS_READY') && !t.signal.aborted) {
          progressSeen = true;
          writeFileSync(ack, 'observed before native cases');
        }
      },
    });
    completed = true;
    // Cancellation already fails the enclosing native test and closes the owned process group.
    if (t.signal.aborted) return;
    assert.equal(progressSeen, true);
    assert.equal(result.findings.some(finding => finding.rule === 'R3'), fails);
    assert.equal(result.ledger.runs.length, 1);
    assert.equal(lines.filter(line => line.includes('"name":"empty"') && line.includes('"outcome":')).length, 1, 'the original stdout case event is forwarded once');
    assert.deepEqual(result.ledger.cases.map(entry => [entry.case, entry.outcome]), [['empty', fails ? 'fail' : 'pass'], ['ascii', 'pass']]);
    for (const marker of ['NATIVE_PROGRESS_READY', 'NATIVE_STDOUT_ONCE', 'NATIVE_STDERR_ONCE'])
      assert.equal(lines.filter(line => line.endsWith(marker)).length, 1, `native output repeated or lost: ${marker}`);
  });
}
