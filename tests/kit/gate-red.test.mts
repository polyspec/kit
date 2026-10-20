// Tests of the gate commands of a Verification (gate-red.mts, K357): which commands run a gate of kit-gates, and how a Red-Gate
// line of a commit proves the red of one of them on its parent.
import assert from 'node:assert/strict';
import test from 'node:test';
import { gateCommands, provesRed } from '../../scripts/kit/gate-red.mts';

const GATES = new Set(['parity-declarations-check', 'lint-ts']);

// K357-2: a gate scoped by make variables, as UNITS of K400 and RULES of K414, is the gate that a row of a document rule verifies.
test('a gate command takes make variables after its target, and its Red-Gate line proves its red (K357-2)', () => {
  const commands = [
    'make parity-declarations-check RULES=R9',
    'make parity-declarations-check UNITS="codec width"',
    'make lint-ts',
    'make parity-declarations-check extra',
    'make test-x RULES=R9',
    'node --test tests/kit/a.test.mts',
  ];
  assert.deepEqual(gateCommands(commands, GATES), ['make parity-declarations-check RULES=R9', 'make parity-declarations-check UNITS="codec width"', 'make lint-ts']);
  const parent = 'abcdef1234567890abcdef1234567890abcdef12';
  const rows = () => gateCommands(commands, GATES);
  assert.equal(provesRed('fix(x): Y (#T1)\n\nBody.\n\nRed-Gate: make parity-declarations-check RULES=R9 exit 2 at abcdef123456\n', rows, parent), true);
  assert.equal(provesRed('fix(x): Y (#T1)\n\nBody.\n\nRed-Gate: make parity-declarations-check UNITS="codec width" exit 2 at abcdef123456\n', rows, parent), true);
  assert.equal(provesRed('fix(x): Y (#T1)\n\nBody.\n\nRed-Gate: make parity-declarations-check RULES=R10 exit 2 at abcdef123456\n', rows, parent), false, 'a gate that the Verification does not name');
  assert.equal(provesRed('fix(x): Y (#T1)\n\nBody.\n\nRed-Gate: make parity-declarations-check RULES=R9 exit 2 at 0123456789ab\n', rows, parent), false, 'a red of another parent');
});
