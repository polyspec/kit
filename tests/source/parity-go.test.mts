// Real Go compatibility belongs to source checks, which CI runs after installing the pinned tools.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { reportTestOperation } from '../../scripts/kit/test-gap.mts';
import { ENV, checkParity, repository } from '../kit/parity-support.mts';

let observed: Awaited<ReturnType<typeof checkParity>> | undefined;
before(async () => {
  const id = 'parity/native-go-build';
  reportTestOperation({ kind: 'operation-start', id });
  console.log('[native-go] compiler invocation: started');
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'kit-real-go-'));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const lookup = spawnSync('sh', ['-c', 'command -v go'], { encoding: 'utf8' });
    if (lookup.error) throw lookup.error;
    assert.equal(lookup.status, 0, 'Go is missing; run make install-tools TOOLS=go before source-test');
    const realGo = lookup.stdout.trim();
    assert.notEqual(realGo, '', 'Go is missing; run make install-tools TOOLS=go before source-test');
    writeFileSync(path.join(dir, 'go'), `#!/bin/sh\nexec "${realGo}" "$@"\n`);
    chmodSync(path.join(dir, 'go'), 0o755);
    observed = await checkParity(repository({ after }, { files: { 'go/codec_test.go': 'package codec\n\nfunc broken( {\n' } }), {
      execute: true, env: { ...ENV, PATH: `${dir}${path.delimiter}${ENV.PATH}` }, units: ['codec'], implementations: ['go'],
      say: line => console.log(`[native-go] ${line}`),
    });
  } finally {
    console.log('[native-go] compiler invocation: completed');
    reportTestOperation({ kind: 'operation-end', id });
  }
});

test('a failed native Go build preserves its exit and reports no executed case', () => {
  assert.ok(observed);
  assert.equal(observed.ledger.cases.length, 0, 'failed compilation reports no executed case');
  const messages = observed.findings.map(finding => finding.message);
  assert.match(messages.join('\n'), /codec_test\.go/, 'the real compiler diagnosed the malformed source');
  assert.ok(messages.some(message => /the build of the tests exited with [1-9]/.test(message)), JSON.stringify(messages));
});
