// Tests of scripts/kit/verification.mts: the commands of a Verification cell (K249-3); docs-check requires none (K1132).
import assert from 'node:assert/strict';
import test from 'node:test';
import { commandsOf } from '../../scripts/kit/verification.mts';

test('the commands of a Verification cell are its backticked spans (K249-3)', () => {
  assert.deepEqual(commandsOf('`node --test a.test.mts`, then `make lint-ts` in CI'), ['node --test a.test.mts', 'make lint-ts']);
  assert.deepEqual(commandsOf('a red test'), []);
});

