// The records of tests/kit/tool-records.json against the real tools (K127). The go and composer stubs of the vendored tests
// answer go mod edit and composer validate from these records and never run a tool, so a consumer without Go or Composer
// runs them; this test runs each recorded request with the pinned go and Composer of this checkout (`mise which`, make
// install-tools first) and requires what the record says. make kit-tool-record writes the records.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runRequest } from '../kit/record-tools.mts';
import type { ToolRecord } from '../kit/record-tools.mts';
import { TOOL_RECORDS } from '../kit/registry.mts';

const records = Object.values(JSON.parse(readFileSync(TOOL_RECORDS, 'utf8')) as Record<string, ToolRecord[]>).flat();

test('the records hold a request of each tool that the stubs answer', () => {
  assert.deepEqual([...new Set(records.map(record => record.tool))].sort(), ['composer', 'go']);
});

for (const record of records) {
  const { status, stdout, stderr, ...request } = record;
  test(`${request.tool} ${request.args.join(' ')} of ${Object.keys(request.files).filter(file => request.files[file] !== null).join(', ')} prints its record (status ${status})`, () => {
    assert.deepEqual(runRequest(request), record);
  });
}
