import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installRustToolchain } from '../../scripts/kit/install-rust.mts';

test('installRustToolchain explicitly installs the declared channel, profile, components and targets', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-install-rust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const calls = path.join(root, 'calls.log');
  const rustup = path.join(bin, 'rustup');
  writeFileSync(rustup, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$RUSTUP_CALLS"\n');
  chmodSync(rustup, 0o755);
  writeFileSync(path.join(root, 'rust-toolchain.toml'), [
    '[toolchain]',
    'channel = "1.99.0"',
    'profile = "minimal"',
    'components = ["clippy", "rustfmt"]',
    'targets = ["aarch64-unknown-linux-gnu"]',
    '',
  ].join('\n'));
  const printed: string[] = [];
  const previousPath = process.env.PATH;
  const previousCalls = process.env.RUSTUP_CALLS;
  process.env.PATH = bin;
  process.env.RUSTUP_CALLS = calls;
  try {
    installRustToolchain({ root, print: line => printed.push(line) });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCalls === undefined) delete process.env.RUSTUP_CALLS;
    else process.env.RUSTUP_CALLS = previousCalls;
  }

  assert.deepEqual(printed, ['rustup toolchain install --no-self-update --profile minimal --component clippy --component rustfmt --target aarch64-unknown-linux-gnu 1.99.0']);
  assert.equal(readFileSync(calls, 'utf8'), 'toolchain install --no-self-update --profile minimal --component clippy --component rustfmt --target aarch64-unknown-linux-gnu 1.99.0\n');
});
