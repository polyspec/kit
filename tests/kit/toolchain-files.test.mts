// Tests of scripts/kit/toolchain-files.mts: a go.mod and the Rust declaration are read by the tools of their ecosystems, so
// a form that a regular expression misread before (a comment after the value) reads as the tool reads it. The Go release is
// a tool of mise.toml (toolchain-mise.test.mts).
import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredRust, readGoMod } from '../../scripts/kit/toolchain-files.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

const GO_ENV = { ...process.env, GOTOOLCHAIN: 'local' };

test('a go.mod is read by go mod edit -json, so a comment after the go line reads as go reads it', (t) => {
  const root = toolchainCheckout(t, { 'packages/a/go.mod': 'module example.com/a\n\ngo 1.27.2 // the pin of kit\n\ntoolchain go1.27.2\n' });
  const mod = readGoMod(root, 'packages/a/go.mod', GO_ENV);
  assert.equal(mod.Go, '1.27.2');
  assert.equal(mod.Toolchain, 'go1.27.2');
});

test('a go.mod that go cannot read fails with the file and the cause', (t) => {
  const broken = toolchainCheckout(t, { 'packages/a/go.mod': 'module\n' });
  assert.throws(() => readGoMod(broken, 'packages/a/go.mod', GO_ENV), /packages\/a\/go\.mod: `go mod edit -json` cannot read it \(exit status 1\): /);
  assert.throws(() => readGoMod(toolchainCheckout(t), 'packages/a/go.mod', GO_ENV), /packages\/a\/go\.mod: `go mod edit -json` cannot read it/);
});

test('the Rust release is the channel of rust-toolchain.toml, read by smol-toml (readToml) with no Python', (t) => {
  const commented = toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain]\nchannel = "1.99.0" # the pin of kit\nprofile = "minimal"\n' });
  assert.deepEqual(declaredRust(commented), { version: '1.99.0', source: 'rust-toolchain.toml channel' });
  const inline = toolchainCheckout(t, { 'rust-toolchain.toml': "toolchain = { channel = '1.99.0' }\n" });
  assert.deepEqual(declaredRust(inline), { version: '1.99.0', source: 'rust-toolchain.toml channel' });
  assert.equal(declaredRust(toolchainCheckout(t, {})), undefined, 'without rust-toolchain.toml, Rust is not declared');
});

test('a channel that is no release fails with the file and the value', (t) => {
  const stable = toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain]\nchannel = "stable"\n' });
  assert.throws(() => declaredRust(stable), /rust-toolchain\.toml must declare toolchain\.channel as <major>\.<minor>\.<patch>; it declares "stable"/);
  const none = toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain]\nprofile = "minimal"\n' });
  assert.throws(() => declaredRust(none), /rust-toolchain\.toml must declare toolchain\.channel as <major>\.<minor>\.<patch>; it declares undefined/);
  const broken = toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain\n' });
  assert.throws(() => declaredRust(broken), /^Error: rust-toolchain\.toml line 1 column 11: Invalid TOML document/);
});
