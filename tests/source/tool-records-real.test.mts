// The records of tests/kit/tool-records.json against the real tools (K127). The go and composer stubs of the vendored tests
// answer go mod edit and composer validate from these records and never run a tool, so a consumer without Go or Composer
// runs them; this test runs each recorded request with the pinned go and Composer of this checkout (`mise which`, make
// install-tools first) and requires what the record says. make kit-tool-record writes the records.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runRequest } from '../kit/record-tools.mts';
import { TOOL_RECORDS } from '../kit/registry.mts';
import { TOOL_RECORDS_FILE } from '../kit/record-tools.mts';
import { readStub } from '../kit/stub-json.mts';
import { known } from '../kit/known.mts';

const records = Object.values(readStub(TOOL_RECORDS, TOOL_RECORDS_FILE)).flat();

test('the records hold a request of each tool that the stubs answer', () => {
  assert.deepEqual([...new Set(records.map(record => record.tool))].sort(), ['composer', 'go']);
});

for (const record of records) {
  const { status, stdout: _stdout, stderr: _stderr, ...request } = record;
  test(`${request.tool} ${request.args.join(' ')} of ${Object.keys(request.files).filter(file => request.files[file] !== null).join(', ')} prints its record (status ${status})`, () => {
    assert.deepEqual(runRequest(request), record);
  });
}

// The pinned tools run by the absolute path of mise which, and the PATH that they run with holds no directory of a stub: a
// stub directory first on the PATH of the caller, as kit-test has one, does not run (K127).
test('a request runs no command of a stub directory on the PATH of the caller', (t) => {
  const stubs = mkdtempSync(path.join(tmpdir(), 'kit-record-stubs-'));
  t.after(() => rmSync(stubs, { recursive: true, force: true }));
  const marker = path.join(stubs, 'ran');
  for (const name of ['go', 'php', 'composer', 'mise']) {
    writeFileSync(path.join(stubs, name), `#!/bin/sh\necho ${name} >> '${marker}'\nexit 1\n`);
    chmodSync(path.join(stubs, name), 0o755);
  }
  const saved = process.env.PATH;
  process.env.PATH = `${stubs}${path.delimiter}${saved}`;
  try {
    for (const tool of ['go', 'composer']) {
      const record = known(records.find(entry => entry.tool === tool), 'records.find(entry => entry.tool === tool)');
      const { status: _status, stdout: _stdout, stderr: _stderr, ...request } = record;
      assert.deepEqual(runRequest(request), record);
    }
  } finally {
    process.env.PATH = saved;
  }
  assert.equal(existsSync(marker) ? readFileSync(marker, 'utf8') : '', '');
});
