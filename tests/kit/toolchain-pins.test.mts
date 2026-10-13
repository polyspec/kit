// Tests of scripts/kit/toolchain-pins.mts: kit ships one pin for each toolchain (S4), and every declaration of a checkout
// equals its pin at the pin's precision.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pinning } from '../../scripts/kit/toolchain-exceptions.mts';
import { pinFindings } from '../../scripts/kit/toolchain-floors.mts';
import { PINS, readPins } from '../../scripts/kit/toolchain-pins.mts';

const SHIPPED = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/toolchain-pins.json');

test('kit ships the decided pins: Node.js, Go, Rust and TypeScript by release, Python and PHP by minor release', () => {
  assert.deepEqual(PINS, { node: '26.11.1', python: '3.14', php: '8.5', go: '1.27.2', rust: '1.99.0', typescript: '7.0.2' });
  assert.deepEqual(readPins(JSON.parse(readFileSync(SHIPPED, 'utf8'))), PINS);
});

test('kit declares its own Rust at the pin, which the rustup step of its CI installs for the cargo of its checks', () => {
  const declared = readFileSync(path.join(path.dirname(SHIPPED), '../../rust-toolchain.toml'), 'utf8');
  assert.match(declared, new RegExp(`^channel = "${PINS.rust.replaceAll('.', '\\.')}"$`, 'm'));
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
    php: { minors: ['8.4', '8.5'], source: 'config/toolchain.json php' },
    python: { minor: '3.13', source: '.python-version' },
  };
  assert.deepEqual(pinFindings(declared, new Pinning(PINS)), [
    '.node-version: node is "26.8.1"; kit pins node 26.11.1, so it must be "26.11.1"',
    'rust-toolchain.toml: channel is "1.98.1"; kit pins rust 1.99.0, so it must be "1.99.0"',
    'config/toolchain.json: php is "8.4"; kit pins php 8.5, so it must be "8.5"',
    '.python-version: python is "3.13"; kit pins python 3.14, so it must be "3.14"',
  ]);
  const pinned = {
    node: { version: '26.11.1', source: '.node-version' },
    php: { minors: ['8.5'], source: 'config/toolchain.json php' },
    python: { minor: '3.14', source: 'config/toolchain.json python' },
  };
  assert.deepEqual(pinFindings(pinned, new Pinning(PINS)), [], 'a declaration at its pin passes, and an undeclared tool is not required');
});
