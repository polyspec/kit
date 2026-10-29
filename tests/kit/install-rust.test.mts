import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { installRustToolchain } from '../../scripts/kit/install-rust.mts';

// The calls of a rustup stub that installRustToolchain makes for the rust-toolchain.toml `lines`, with what it printed.
function installed(t: TestContext, lines: string[]) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-install-rust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const calls = path.join(root, 'calls.log');
  const rustup = path.join(bin, 'rustup');
  writeFileSync(rustup, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$RUSTUP_CALLS"\n');
  chmodSync(rustup, 0o755);
  writeFileSync(path.join(root, 'rust-toolchain.toml'), [...lines, ''].join('\n'));
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
  return { printed, calls: readFileSync(calls, 'utf8') };
}

test('installRustToolchain explicitly installs the declared channel, profile, components and targets', (t) => {
  const { printed, calls } = installed(t, ['[toolchain]', 'channel = "1.99.0"', 'profile = "minimal"', 'components = ["clippy", "rustfmt"]', 'targets = ["aarch64-unknown-linux-gnu"]']);
  assert.deepEqual(printed, ['rustup toolchain install --no-self-update --profile minimal --component clippy --component rustfmt --target aarch64-unknown-linux-gnu 1.99.0']);
  assert.equal(calls, 'toolchain install --no-self-update --profile minimal --component clippy --component rustfmt --target aarch64-unknown-linux-gnu 1.99.0\n');
});

// K840: rustup judges rust-toolchain.toml; without a channel it installs the active toolchain, so kit passes what is declared.
test('installRustToolchain passes a rust-toolchain.toml without a channel to rustup, which installs the active toolchain (K840)', (t) => {
  assert.equal(installed(t, ['[toolchain]', 'profile = "minimal"']).calls, 'toolchain install --no-self-update --profile minimal\n');
  assert.equal(installed(t, ['[toolchain]', 'channel = "stable"']).calls, 'toolchain install --no-self-update stable\n');
});
