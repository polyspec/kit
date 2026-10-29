// Tests of scripts/kit/toolchain-files.mts: a go.mod and the Rust declaration are read by the tools of their ecosystems, so
// a form that a regular expression misread before (a comment after the value) reads as the tool reads it. The Go release is
// a tool of mise.toml (toolchain-mise.test.mts).
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { declaredRust, goWorkFile, readGoMod } from '../../scripts/kit/toolchain-files.mts';
import { repositoryRoot } from '../../scripts/kit/paths.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseWhere } from '../../scripts/kit/bootstrap/install-mise.mts';

const GO_ENV = { ...process.env, GOTOOLCHAIN: 'local' };

// The go of a checkout is the shim of mise in var/tools/mise/shims (K393-1). These tests read a go.mod with the real go, so the shim
// runs the Go installed by mise in the checkout, resolved by mise itself; a PATH shim must not read the test checkout's config.
function goShim(root: string) {
  const real = path.join(miseWhere(repositoryRoot(), 'go'), 'bin/go');
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  const shim = path.join(root, 'var/tools/mise/shims/go');
  writeFileSync(shim, `#!/bin/sh\nexec '${real}' "$@"\n`);
  chmodSync(shim, 0o755);
  return root;
}

test('go workspace discovery uses the checkout mise environment when the caller has none (K476)', () => {
  const root = repositoryRoot();
  const environment = { PATH: process.env.PATH ?? '' };
  const workspace = goWorkFile(root, 'scripts/kit/symbols/go', environment);
  assert.ok(workspace === null || path.isAbsolute(workspace), `unexpected go env GOWORK output ${JSON.stringify(workspace)}`);
});

test('a go.mod is read by go mod edit -json, so a comment after the go line reads as go reads it', (t) => {
  const root = goShim(toolchainCheckout(t, { 'packages/a/go.mod': 'module example.com/a\n\ngo 1.27.2 // the pin of kit\n\ntoolchain go1.27.2\n' }));
  const mod = readGoMod(root, 'packages/a/go.mod', GO_ENV);
  assert.equal(mod.Go, '1.27.2');
  assert.equal(mod.Toolchain, 'go1.27.2');
  assert.deepEqual(mod.Require ?? [], [], 'the module has no require directives');
  assert.deepEqual(mod.Replace ?? [], [], 'the module has no replace directives');
});

test('null require and replace directives from go mod edit -json are empty directive sets (K661-1)', (t) => {
  const root = toolchainCheckout(t, { 'packages/a/go.mod': 'module example.com/a\n' });
  const bin = path.join(root, 'var/tools/mise/shims');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'go'), '#!/bin/sh\nprintf \'%s\\n\' \'{"Module":{"Path":"example.com/a"},"Require":null,"Replace":null}\'\n', { mode: 0o755 });
  const mod = readGoMod(root, 'packages/a/go.mod', GO_ENV);
  assert.equal(mod.Require, null);
  assert.equal(mod.Replace, null);
});

test('a go.mod that go cannot read fails with the file and the cause', (t) => {
  const broken = goShim(toolchainCheckout(t, { 'packages/a/go.mod': 'module\n' }));
  assert.throws(() => readGoMod(broken, 'packages/a/go.mod', GO_ENV), /packages\/a\/go\.mod: `go mod edit -json` cannot read it \(exit status 1\): /);
  assert.throws(() => readGoMod(goShim(toolchainCheckout(t)), 'packages/a/go.mod', GO_ENV), /packages\/a\/go\.mod: `go mod edit -json` cannot read it/);
});

test('the Rust release is the channel of rust-toolchain.toml, read by smol-toml (readToml) with no Python', (t) => {
  const commented = toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain]\nchannel = "1.99.0" # the pin of kit\nprofile = "minimal"\n' });
  assert.deepEqual(declaredRust(commented), { version: '1.99.0', source: 'rust-toolchain.toml channel' });
  const inline = toolchainCheckout(t, { 'rust-toolchain.toml': "toolchain = { channel = '1.99.0' }\n" });
  assert.deepEqual(declaredRust(inline), { version: '1.99.0', source: 'rust-toolchain.toml channel' });
  assert.equal(declaredRust(toolchainCheckout(t, {})), undefined, 'without rust-toolchain.toml, Rust is not declared');
});

test('the channel of rust-toolchain.toml is read as declared, and rustup judges it (K840)', (t) => {
  assert.deepEqual(declaredRust(toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain]\nchannel = "stable"\n' })), { version: 'stable', source: 'rust-toolchain.toml channel' });
  assert.deepEqual(declaredRust(toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain]\nchannel = "1.90"\n' })), { version: '1.90', source: 'rust-toolchain.toml channel' });
  assert.deepEqual(declaredRust(toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain]\nprofile = "minimal"\n' })), { version: 'as rustup resolves it', source: 'rust-toolchain.toml channel' });
});

test('a rust-toolchain.toml that is no TOML fails with the file and the position', (t) => {
  const broken = toolchainCheckout(t, { 'rust-toolchain.toml': '[toolchain\n' });
  assert.throws(() => declaredRust(broken), /^Error: rust-toolchain\.toml line 1 column 11: Invalid TOML document/);
});
