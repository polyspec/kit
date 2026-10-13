// Tests of scripts/kit/toolchain-floors.mts: every manifest floor of a checkout equals the pin of kit at the pin's
// precision (S4). Each manifest is read with the tool of its ecosystem.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoFindings, composerFindings, enginesFindings, goModFindings, pyprojectFindings, typescriptFindings } from '../../scripts/kit/toolchain-floors.mts';
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
  assert.throws(() => pyprojectFindings(root, PINS, process.env), /pyproject\.toml: tomllib of python3 cannot read it \(exit status 1\): .*TOMLDecodeError/s);
});

// go.mod is read by `go mod edit -json` of the Go on PATH; GOTOOLCHAIN=local keeps it from switching to the declared Go.
test('every go.mod declares go <the Go pin> and no toolchain line, which the go command drops when it equals the go line', (t) => {
  const root = tree(t, {
    'go.mod': 'module example.com/a\n\ngo 1.27.2\n',
    'packages/b/go.mod': 'module example.com/b\n\ngo 1.21\n',
    'packages/c/go.mod': 'module example.com/c\n\ngo 1.27\n\ntoolchain go1.27.2\n',
    'packages/d/go.mod': 'module example.com/d\n\ngo 1.27.2 // the pin of kit\n',
  });
  assert.deepEqual(goModFindings(root, PINS, { ...process.env, GOTOOLCHAIN: 'local' }), [
    'packages/b/go.mod: go is "1.21"; kit pins go 1.27.2, so it must be "1.27.2"',
    'packages/c/go.mod: go is "1.27"; kit pins go 1.27.2, so it must be "1.27.2"',
    'packages/c/go.mod: toolchain is "go1.27.2"; kit pins go 1.27.2 in the go line, so remove the toolchain line',
  ]);
});

// Cargo.toml is read by `cargo metadata`, which resolves rust-version.workspace = true from the workspace.
test('every Cargo package declares rust-version as the Rust pin, also through its workspace', (t) => {
  const crate = (name: string, extra = '') => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n${extra}`;
  const root = tree(t, {
    'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\nresolver = "3"\n\n[workspace.package]\nrust-version = "1.99.0"\n',
    'crates/a/Cargo.toml': crate('a', 'rust-version.workspace = true\n'),
    'crates/a/src/lib.rs': '',
    'crates/b/Cargo.toml': crate('b'),
    'crates/b/src/lib.rs': '',
    'tools/c/Cargo.toml': crate('c', 'rust-version = "1.89"\n\n[workspace]\n'),
    'tools/c/src/lib.rs': '',
    'tools/d/Cargo.toml': crate('d', "rust-version = '1.99.0' # the pin of kit\n\n[workspace]\n"),
    'tools/d/src/lib.rs': '',
  });
  assert.deepEqual(cargoFindings(root, PINS, process.env), [
    'crates/b/Cargo.toml: package.rust-version is missing; kit pins rust 1.99.0, so it must be "1.99.0"',
    'tools/c/Cargo.toml: package.rust-version is "1.89"; kit pins rust 1.99.0, so it must be "1.99.0"',
  ]);
});

test('every package.json that names typescript names the TypeScript pin, and every lock resolves it to the pin', (t) => {
  const root = tree(t, {
    'package.json': json({ devDependencies: { typescript: '7.0.2' } }),
    'package-lock.json': json({ packages: { '': {}, 'node_modules/typescript': { version: '7.0.2' }, 'node_modules/x/node_modules/typescript': { version: '6.0.3' } } }),
    'packages/a/package.json': json({ dependencies: { typescript: '^7.0.2' }, peerDependencies: { typescript: '>=6' } }),
    'packages/b/package.json': json({ name: 'b' }),
    'packages/c/package.json': json({ optionalDependencies: { typescript: '7.0.2' } }),
    'packages/c/package-lock.json': json({ packages: { 'node_modules/typescript-plugin': { version: '1.0.0' } } }),
  });
  assert.deepEqual(typescriptFindings(root, PINS), [
    'package-lock.json: packages["node_modules/x/node_modules/typescript"].version is "6.0.3"; kit pins typescript 7.0.2, so it must be "7.0.2"',
    'packages/a/package.json: dependencies.typescript is "^7.0.2"; kit pins typescript 7.0.2, so it must be "7.0.2"',
    'packages/a/package.json: peerDependencies.typescript is ">=6"; kit pins typescript 7.0.2, so it must be "7.0.2"',
  ]);
});
