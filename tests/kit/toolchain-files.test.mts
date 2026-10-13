// Tests of scripts/kit/toolchain-files.mts: the Go and Rust declarations are read by the tools of their ecosystems, so a
// form that a regular expression misread before (a comment after the value) reads as the tool reads it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredGo, declaredRust } from '../../scripts/kit/toolchain-files.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

const GO_ENV = { ...process.env, GOTOOLCHAIN: 'local' };
const GO_CONFIG = '{ "schema": 1, "go": { "mod": "packages/a/go.mod" } }';

test('the Go release is the go line of the go.mod of config/toolchain.json go, read by go mod edit -json', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': GO_CONFIG, 'packages/a/go.mod': 'module example.com/a\n\ngo 1.27.2 // the pin of kit\n' });
  assert.deepEqual(declaredGo(root, GO_ENV), { version: '1.27.2', source: 'packages/a/go.mod go directive' });
  assert.equal(declaredGo(toolchainCheckout(t, {}), GO_ENV), undefined, 'without config/toolchain.json go, Go is not declared');
});

test('a go line that is not a release, or a go.mod that go cannot read, fails with the file and the value', (t) => {
  const minor = toolchainCheckout(t, { 'config/toolchain.json': GO_CONFIG, 'packages/a/go.mod': 'module example.com/a\n\ngo 1.27\n\ntoolchain go1.27.2\n' });
  assert.throws(() => declaredGo(minor, GO_ENV), /packages\/a\/go\.mod must declare go as <major>\.<minor>\.<patch>; it declares "1\.27"/);
  const broken = toolchainCheckout(t, { 'config/toolchain.json': GO_CONFIG, 'packages/a/go.mod': 'module\n' });
  assert.throws(() => declaredGo(broken, GO_ENV), /packages\/a\/go\.mod: `go mod edit -json` cannot read it \(exit status 1\): /);
  const missing = toolchainCheckout(t, { 'config/toolchain.json': GO_CONFIG });
  assert.throws(() => declaredGo(missing, GO_ENV), /packages\/a\/go\.mod: `go mod edit -json` cannot read it/);
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
