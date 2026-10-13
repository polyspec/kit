// Tests of scripts/kit/toolchain-pins.mts: kit ships one pin for each toolchain (S4), and every declaration of a checkout
// equals its pin at the pin's precision.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PINS, pinFindings, readPins } from '../../scripts/kit/toolchain-pins.mts';

const SHIPPED = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/toolchain-pins.json');

test('kit ships the decided pins: Node.js, Go, Rust and TypeScript by release, Python and PHP by minor release', () => {
  assert.deepEqual(PINS, { node: '26.11.1', python: '3.14', php: '8.5', go: '1.27.2', rust: '1.99.0', typescript: '7.0.2' });
  assert.deepEqual(readPins(JSON.parse(readFileSync(SHIPPED, 'utf8'))), PINS);
});

test('a pin of the wrong precision, a missing pin or an unknown key fails with the key and the value', () => {
  assert.throws(() => readPins({ ...PINS, node: '26.11' }), /toolchain-pins\.json must record node as <major>\.<minor>\.<patch>; it records "26\.11"/);
  assert.throws(() => readPins({ ...PINS, python: '3.14.8' }), /toolchain-pins\.json must record python as <major>\.<minor>; it records "3\.14\.8"/);
  const { go, ...withoutGo } = PINS;
  assert.equal(go, '1.27.2');
  assert.throws(() => readPins(withoutGo), /toolchain-pins\.json must record go as <major>\.<minor>\.<patch>; it records undefined/);
  assert.throws(() => readPins({ ...PINS, java: '25.0.1' }), /toolchain-pins\.json records java, which is no pin; the pins are node, python, php, go, rust, typescript/);
});

test('every declaration equals its pin at the pin\'s precision; each other names the declaring file, the pin and the fix', () => {
  const declared = {
    node: { version: '26.8.1', source: '.node-version' },
    rust: { version: '1.98.1', source: 'rust-toolchain.toml channel' },
    go: { version: '1.27.1', source: 'go.mod go directive' },
    php: { minors: ['8.4', '8.5'], source: 'config/toolchain.json php' },
    python: { minor: '3.13', source: '.python-version' },
  };
  assert.deepEqual(pinFindings(declared, PINS), [
    '.node-version declares node 26.8.1; kit pins node 26.11.1, so declare 26.11.1',
    'rust-toolchain.toml channel declares rust 1.98.1; kit pins rust 1.99.0, so declare 1.99.0',
    'go.mod go directive declares go 1.27.1; kit pins go 1.27.2, so declare 1.27.2',
    'config/toolchain.json php declares php 8.4; kit pins php 8.5, so declare 8.5',
    '.python-version declares python 3.13; kit pins python 3.14, so declare 3.14',
  ]);
  const pinned = {
    node: { version: '26.11.1', source: '.node-version' },
    php: { minors: ['8.5'], source: 'config/toolchain.json php' },
    python: { minor: '3.14', source: 'config/toolchain.json python' },
  };
  assert.deepEqual(pinFindings(pinned, PINS), [], 'a declaration at its pin passes, and an undeclared tool is not required');
});
