// Tests of scripts/kit/duplication-check.mts: jscpd, a dependency of the package, fails on a piece of code that exists
// twice in the checkout, outside the folders that config/duplication.json excludes with their reasons (K248-3).
import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicationCheck } from '../../scripts/kit/duplication-check.mts';
import { put, tree } from './tree.mts';

// Eight distinct lines, a piece that jscpd reports when it exists twice.
const PIECE = Array.from({ length: 8 }, (_, index) => `export const value${index} = compute(${index}, 'name${index}', [${index}, ${index + 1}]);`).join('\n');

test('a piece of code that exists twice fails with both places, and a tree without one passes (K248-3)', (t) => {
  const root = tree(t, { 'src/a.ts': `${PIECE}\n`, 'src/b.ts': 'export const other = 1;\n' });
  assert.equal(duplicationCheck(root, () => {}).status, 0);
  put(root, { 'src/c.ts': `// another module\n${PIECE}\n` });
  const found = duplicationCheck(root, () => {});
  assert.equal(found.status, 1);
  assert.match(found.output, /src\/a\.ts/);
  assert.match(found.output, /src\/c\.ts/);
});

test('a folder that config/duplication.json excludes with its reason is not read, and an exclusion needs a reason (K248-3)', (t) => {
  const root = tree(t, { 'src/a.ts': `${PIECE}\n`, 'tests/a.test.ts': `${PIECE}\n` });
  assert.equal(duplicationCheck(root, () => {}).status, 1);
  put(root, { 'config/duplication.json': JSON.stringify({ schema: 1, exclude: [{ glob: 'tests/**', reason: 'a test states its case in full' }] }) });
  assert.equal(duplicationCheck(root, () => {}).status, 0);
  put(root, { 'config/duplication.json': JSON.stringify({ schema: 1, exclude: [{ glob: 'tests/**', reason: '' }] }) });
  assert.throws(() => duplicationCheck(root, () => {}), /reason/);
});
