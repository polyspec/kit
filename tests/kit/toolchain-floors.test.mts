// Tests of scripts/kit/toolchain-floors.mts: every manifest floor of a checkout equals the pin of kit at the pin's
// precision (S4). Each manifest is read with the tool of its ecosystem.
import assert from 'node:assert/strict';
import test from 'node:test';
import { composerFindings, enginesFindings, pyprojectFindings } from '../../scripts/kit/toolchain-floors.mts';
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

// The TOML of a pyproject is read by tomllib of the Python on PATH, so every form of TOML reads as Python reads it.
test('every pyproject.toml with a project table requires-python >= the Python pin', (t) => {
  const root = tree(t, {
    'pyproject.toml': '[project]\nname = "a"\nrequires-python = ">=3.11"\n',
    'packages/b/pyproject.toml': '[project]\nname = "b"\n',
    'packages/c/pyproject.toml': "project = { name = 'c', requires-python = '>=3.14' } # an inline table and a literal string\n",
    'packages/d/pyproject.toml': '[tool.ruff]\nline-length = 120\n',
    'packages/e/pyproject.toml': '[project]\nname = "e"\n"requires-python" = """>=3.14"""\n',
  });
  assert.deepEqual(pyprojectFindings(root, PINS, process.env), [
    'packages/b/pyproject.toml: project.requires-python is missing; kit pins python 3.14, so it must be ">=3.14"',
    'pyproject.toml: project.requires-python is ">=3.11"; kit pins python 3.14, so it must be ">=3.14"',
  ]);
});

test('a pyproject.toml that is no TOML fails with the file and the error of tomllib', (t) => {
  const root = tree(t, { 'pyproject.toml': '[project\n' });
  assert.throws(() => pyprojectFindings(root, PINS, process.env), /pyproject\.toml: tomllib cannot read it: .*/);
});
