// Tests of scripts/kit/verification.mts: an open item names the commands that verify it (K249-3); kit refuses none of them
// (K1053).
import assert from 'node:assert/strict';
import test from 'node:test';
import { commandsOf, verificationFindings } from '../../scripts/kit/verification.mts';
import type { Tracker } from '../../scripts/kit/checklist.mts';

const TRACKER: Tracker = { path: 'docs/plans/p/checklist.md', translation: 'docs/plans/p/checklist.ko.md', idPattern: 'T[0-9]+' };
const HEADER = '| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n';
const row = (id: string, verification: string, state: string) => `| ${id} | Task | \`a.mts\` | ${verification} | ${state} |\n`;

test('the commands of a Verification cell are its backticked spans (K249-3)', () => {
  assert.deepEqual(commandsOf('`node --test a.test.mts`, then `make lint-ts` in CI'), ['node --test a.test.mts', 'make lint-ts']);
  assert.deepEqual(commandsOf('a red test'), []);
});

test('an open item fails without a command, any command passes, and a closed item is history (K249-3, K1053)', () => {
  const text = HEADER
    + row('T1', '`node --test tests/a.test.mts`', '[ ]')
    + row('T2', '`make kit-test`', '[~]')
    + row('T3', 'a red test', '[ ]')
    + row('T4', '`make kit-test`', '[o]')
    + row('T5', '`go test ./...`', '[!] cause: x; retry: y');
  const findings = verificationFindings([TRACKER], file => (file === TRACKER.path ? text : undefined));
  assert.deepEqual(findings.map(({ file, finding }) => [file, finding.line, finding.rule, finding.message.replace(/: .*/s, '')]), [
    ['docs/plans/p/checklist.md', 5, 'checklist-verification', 'the open item T3 names no command in backticks in its Verification cell; name the unit tests that verify it'],
  ]);
});
