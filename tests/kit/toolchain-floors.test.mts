// Tests of scripts/kit/toolchain-floors.mts: every manifest floor of a checkout equals the pin of kit at the pin's
// precision (S4). Each manifest is read with the tool of its ecosystem.
import assert from 'node:assert/strict';
import test from 'node:test';
import { composerFindings, enginesFindings } from '../../scripts/kit/toolchain-floors.mts';
import { PINS } from '../../scripts/kit/toolchain-pins.mts';
import { tree } from './tree.mts';

const json = (value: unknown) => JSON.stringify(value);

// engines.node of every package.json is the floor of the Node.js pin of kit: `>=` the pin.
test('every package.json of the checkout declares engines.node as >= the Node.js pin of kit', (t) => {
  const root = tree(t, {
    '.node-version': '26.8.1\n',
    'package.json': JSON.stringify({ packageManager: 'npm@12.2.0', engines: { node: '>=26.0.0' } }),
    'packages/a/package.json': JSON.stringify({ name: 'a' }),
    'packages/b/package.json': JSON.stringify({ name: 'b', engines: { node: '>=26.11.1' } }),
    'packages/c/package.json': JSON.stringify({ name: 'c', engines: { node: '>=26.8.1' } }),
    'tests/kit/fixture/package.json': JSON.stringify({ name: 'fixture' }),
  });
  assert.deepEqual(enginesFindings(root, PINS), [
    'package.json: engines.node is ">=26.0.0"; kit pins node 26.11.1, so it must be ">=26.11.1"',
    'packages/a/package.json: engines.node is missing; kit pins node 26.11.1, so it must be ">=26.11.1"',
    'packages/c/package.json: engines.node is ">=26.8.1"; kit pins node 26.11.1, so it must be ">=26.11.1"',
  ], 'the floor is the pin of kit, not .node-version');
});

test('every composer.json requires php >= the pin, and a locked one sets config.platform.php to the pin', (t) => {
  const root = tree(t, {
    'composer.json': json({ require: { php: '^8.2' }, config: { platform: { php: '8.2.0' } } }),
    'composer.lock': '{}',
    'packages/a/composer.json': json({ require: { php: '>=8.5' } }),
    'packages/b/composer.json': json({ require: {} }),
    'packages/c/composer.json': json({ require: { php: '>=8.5' } }),
    'packages/c/composer.lock': '{}',
    'packages/d/composer.json': json({ require: { php: '>=8.5' }, config: { platform: { php: '8.5' } } }),
    'packages/d/composer.lock': '{}',
    'tests/kit/fixture/composer.json': json({ require: { php: '>=8.2' } }),
  });
  assert.deepEqual(composerFindings(root, PINS), [
    'composer.json: require.php is "^8.2"; kit pins php 8.5, so it must be ">=8.5"',
    'composer.json: config.platform.php is "8.2.0"; kit pins php 8.5, so it must be "8.5"',
    'packages/b/composer.json: require.php is missing; kit pins php 8.5, so it must be ">=8.5"',
    'packages/c/composer.json: config.platform.php is missing; kit pins php 8.5, so it must be "8.5"',
  ]);
});
