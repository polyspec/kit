import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ciJob } from '../../scripts/kit/ci-job.mts';
import { withCommandResources } from '../../scripts/kit/run-command.mts';

test('K1228-2: native workflow context and child environment agree on key casing, Unicode, last writes and PATH', async () => {
  const windows = process.platform === 'win32';
  const unicodeValue = 'µΜΣς値';
  const pathName = Object.keys(process.env).find(name => windows ? name.toLowerCase() === 'path' : name === 'PATH');
  assert.ok(pathName !== undefined, 'the native source environment declares PATH');
  const ambientPaths = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => name.toLowerCase() === 'path' && value !== undefined));
  const inheritedPath = process.env[pathName];
  assert.equal(typeof inheritedPath, 'string');
  let root: string | undefined;
  await withCommandResources(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'kit-workflow-env-'));
    const directory = root;
    mkdirSync(path.join(directory, '.github/workflows'), { recursive: true });
    const marker = path.join(directory, 'native-path');
    mkdirSync(marker);
    const changedPath = `${marker}${path.delimiter}${inheritedPath}`;
    // A delimiter longer than the entire value cannot be one of its lines.
    const delimiter = `ENV_PATH_END_${'X'.repeat(changedPath.length + 1)}`;
    const writes = ['casekey=file', `path<<${delimiter}`, changedPath, delimiter, ''].join('\n');
    writeFileSync(path.join(directory, 'write-env.mjs'), `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.GITHUB_ENV, ${JSON.stringify(writes)});\n`);
    writeFileSync(path.join(directory, 'observe-env.mjs'), `import { readFileSync, writeFileSync } from 'node:fs';
const context = JSON.parse(readFileSync(0, 'utf8'));
const names = ['CaseKey', 'casekey', 'CASEKEY', 'PATH', 'path', 'UNICODE_VALUE', ...(process.platform === 'win32' ? [] : ['µ', 'Μ'])];
const actual = Object.fromEntries(names.map(name => [name, process.env[name]]));
const pathValues = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() === 'path'));
const pathKeys = Object.keys(pathValues).sort();
writeFileSync('environment.json', JSON.stringify({ context, actual, pathKeys, pathValues }));
`);
    const write = windows ? '& $env:WORKER_NODE write-env.mjs' : '"$WORKER_NODE" write-env.mjs';
    const observe = windows
      ? `@'\n\${{ toJSON(env) }}\n'@ | & $env:WORKER_NODE observe-env.mjs`
      : `"$WORKER_NODE" observe-env.mjs <<'ENV_CONTEXT_END'\n\${{ toJSON(env) }}\nENV_CONTEXT_END`;
    const unicodeNames = windows ? '' : ['  µ: micro', '  Μ: mu', ''].join('\n');
    const expected = windows ? "env.CaseKey == 'step' && env.casekey == 'step'" : "env.CaseKey == 'workflow' && env.casekey == 'file'";
    writeFileSync(path.join(directory, '.github/workflows/ci.yml'), `env:
  CaseKey: workflow
  PATH: ${JSON.stringify(inheritedPath)}
  WORKER_NODE: ${JSON.stringify(process.execPath)}
  UNICODE_VALUE: ${JSON.stringify(unicodeValue)}
${unicodeNames}jobs:
  native:
    env: { casekey: job }
    steps:
      - shell: ${windows ? 'pwsh' : 'bash'}
        run: |
          ${write}
      - shell: ${windows ? 'pwsh' : 'bash'}
        env: { CASEKEY: step }
        if: ${expected}
        run: |
${observe.split('\n').map(line => `          ${line}`).join('\n')}
`);
    const lines: string[] = [];
    const status = await ciJob({ root: directory, workflow: '.github/workflows/ci.yml', job: 'native', print: line => lines.push(line) });
    assert.equal(status, 0, lines.join('\n'));
    const report = path.join(directory, 'environment.json');
    assert.ok(existsSync(report), lines.join('\n'));
    const decoded: unknown = JSON.parse(readFileSync(report, 'utf8'));
    assert.ok(decoded !== null && typeof decoded === 'object' && 'context' in decoded && 'actual' in decoded && 'pathKeys' in decoded && 'pathValues' in decoded);
    const actual = windows
      ? { CaseKey: 'step', casekey: 'step', CASEKEY: 'step', PATH: changedPath, path: changedPath, UNICODE_VALUE: unicodeValue }
      : { CaseKey: 'workflow', casekey: 'file', CASEKEY: 'step', PATH: inheritedPath, path: changedPath, UNICODE_VALUE: unicodeValue, 'µ': 'micro', 'Μ': 'mu' };
    assert.deepEqual(decoded.actual, actual, lines.join('\n'));
    const expectedPaths = windows ? { [pathName]: changedPath } : { ...ambientPaths, PATH: inheritedPath, path: changedPath };
    assert.deepEqual(decoded.pathKeys, Object.keys(expectedPaths).sort());
    assert.deepEqual(decoded.pathValues, expectedPaths);
    assert.deepEqual(decoded.context, windows
      ? { CaseKey: 'step', PATH: changedPath, WORKER_NODE: process.execPath, UNICODE_VALUE: unicodeValue }
      : { CaseKey: 'workflow', PATH: inheritedPath, WORKER_NODE: process.execPath, UNICODE_VALUE: unicodeValue, 'µ': 'micro', 'Μ': 'mu', casekey: 'file', path: changedPath, CASEKEY: 'step' });
    if (windows) {
      writeFileSync(path.join(directory, '.github/workflows/unsupported.yml'), 'jobs:\n  blocked:\n    env: { µ: value }\n    steps: [{ shell: pwsh, run: Set-Content forbidden.log wrong }]\n');
      const refused: string[] = [];
      assert.equal(await ciJob({ root: directory, workflow: '.github/workflows/unsupported.yml', job: 'blocked', print: line => refused.push(line) }), 1, refused.join('\n'));
      assert.match(refused.join('\n'), /Windows environment name.*non-ASCII/);
      assert.equal(existsSync(path.join(directory, 'forbidden.log')), false);
    }
  }, () => { if (root !== undefined) rmSync(root, { recursive: true, force: true }); });
});
