// Tests of scripts/kit/install-tools.mts and scripts/kit/toolchain-lock.mts (K127): install-tools has mise install every tool
// of mise.lock (`mise install --locked`, by the wrapper of the bootstrap) before the tools that mise does not install, takes no
// tool names, and stops on a failed mise install; toolchain-lock writes mise.lock with `mise lock` for the platforms of kit,
// locks a pypi: tool with the uv and the Python of mise.toml, installed first, at the head of PATH, and fails on a lock that
// misses a digest.
// var/tools/bin/mise is a stub that logs its calls, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseReleaseStub, miseStub, toolchainStubs } from './toolchain-stubs.mts';
import { KIT, tool } from './kit-tools.mts';
import type { JSONSchemaType } from 'ajv/dist/2020.js';
import { readStubLines, TEXTS } from './stub-json.mts';
import { known } from './known.mts';

/** A call of the mise stub: its arguments, PATH and UV_PYTHON. */
const MISE_CALL: JSONSchemaType<{ args: string[]; PATH: string; UV_PYTHON?: string }> = { type: 'object', required: ['args', 'PATH'], properties: { args: TEXTS, PATH: { type: 'string' }, UV_PYTHON: { type: 'string', nullable: true } } };

const ROOT = path.resolve(KIT, '../..');
const SUM = `sha256:${'a'.repeat(64)}`;

const start = (name: string, root: string, env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, [tool(name), ...args], { cwd: root, env, encoding: 'utf8' });

// A checkout with mise.toml `toml` and the stub wrapper of mise, and the stubs of the test; removed with `t.after`.
function checkout(t: TestContext, toml: string, files: Record<string, string> = {}) {
  const root = toolchainCheckout(t, { 'mise.toml': toml, ...files });
  miseStub(root);
  return { root, stubs: toolchainStubs(t) };
}

test('install-tools has mise install every tool of mise.lock in the checkout, and installs nothing else that is undeclared', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nruff = "0.17.0"\n');
  const result = start('install-tools', root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stubs.calls(), ['mise install --locked']);
  assert.match(result.stdout, new RegExp(`^\\[install-tools\\] ${path.join(root, 'var/tools/bin/mise').replaceAll('.', '\\.')} install --locked$`, 'm'));
});

test('a second install-tools with var/tools/bin and the shims first on PATH is a clean no-op (K127)', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nuv = "0.12.24"\npython = "3.14.8"\n');
  // As under make: var/tools/bin and the shims of mise come first on PATH, and a python3 of the shims is present. kit does not
  // look a Python up among installations, so no second interpreter on PATH can make a run fail (as uv python list did).
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/mise/shims/python3'), '#!/bin/sh\necho "the python3 of the shims ran" >&2\nexit 1\n', { mode: 0o755 });
  const env = { ...stubs.env, PATH: [path.join(root, 'var/tools/bin'), path.join(root, 'var/tools/mise/shims'), stubs.env.PATH].join(path.delimiter) };
  const first = start('install-tools', root, env);
  const second = start('install-tools', root, env);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout, 'the second run does what the first did: mise install --locked, which mise keeps');
  assert.deepEqual(stubs.calls(), ['mise install --locked', 'mise install --locked']);
});

test('a mise install that fails stops install-tools with the error of mise, before any install of kit', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nruff = "0.17.0"\n', { 'config/toolchain.json': JSON.stringify({ schema: 1, pythonBackend: { requirement: 'setuptools==84.0.0', sha256: 'b'.repeat(64) } }) });
  const result = start('install-tools', root, { ...stubs.env, STUB_MISE_FAILS: 'ruff@0.17.0 is not in the lockfile' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mise ERROR ruff@0\.17\.0 is not in the lockfile/);
  assert.match(result.stderr, /\[install-tools\] .*var\/tools\/bin\/mise install --locked ended with exit status 1/);
  assert.doesNotMatch(result.stdout, /backend/, 'the backend is not installed');
});

test('install-tools takes no tool names, and needs the mise of the bootstrap', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n');
  const named = start('install-tools', root, stubs.env, 'ruff');
  assert.equal(named.status, 1);
  assert.match(named.stderr, /\[install-tools\] install-tools takes no tool names; it installs every tool of mise\.lock and the declared tools that mise does not install, and it was given ruff/);
  assert.deepEqual(stubs.calls(), []);
  const bare = toolchainCheckout(t, { 'mise.toml': '[tools]\n' });
  const missing = start('install-tools', bare, stubs.env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /\[install-tools\] var\/tools\/bin\/mise is missing; run make install-tools TOOLS=npm, the bootstrap that installs mise/);
});

test('install-tools removes each file of var/tools/bin that no installer of kit writes any more (K149)', (t) => {
  // kit 0.0.38 wrote wrappers of go, gofmt, python3 and alint, which now come from mise; left in var/tools/bin, which comes
  // first on PATH, they shadowed the shims of mise. The bootstrap writes mise, npm and npx, which are kept.
  const { root, stubs } = checkout(t, '[tools]\n');
  const bin = path.join(root, 'var/tools/bin');
  for (const name of ['npm', 'npx', 'go', 'gofmt', 'python3', 'alint']) writeFileSync(path.join(bin, name), '#!/bin/sh\n# A wrapper (scripts/kit/install-tools.mts).\n', { mode: 0o755 });
  const result = start('install-tools', root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(bin).sort(), ['mise', 'npm', 'npx']);
  for (const name of ['alint', 'go', 'gofmt', 'python3']) assert.match(result.stdout, new RegExp(`^\\[install-tools\\] removed var/tools/bin/${name}$`, 'm'));
  const second = start('install-tools', root, stubs.env);
  assert.doesNotMatch(second.stdout, /removed/, 'a second run removes nothing');
});

// A checkout whose config/toolchain.json declares the Rust nightly of rust/ as an exception.
const NIGHTLY_EXCEPTION = { tool: 'rust', channel: 'nightly-2026-10-01', scope: 'rust', reason: 'rustdoc JSON is unstable', retry: 'rustdoc JSON is stable' };
const NIGHTLY_FILES = { 'rust/Cargo.toml': '[package]\nname = "codec"\n', 'config/toolchain.json': JSON.stringify({ schema: 1, exceptions: [NIGHTLY_EXCEPTION] }) };
// A rustup that logs its arguments and lists the channels of RUSTUP_INSTALLED as installed.
const RUSTUP = '#!/bin/sh\necho "rustup $*" >> "$STUB_LOG"\nif [ "$1 $2" = "toolchain list" ]; then printf "%s\\n" $RUSTUP_INSTALLED; fi\n';

test('install-tools installs each Rust channel that an exception declares with rustup, and keeps an installed one', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n', NIGHTLY_FILES);
  writeFileSync(path.join(stubs.directory, 'bin', 'rustup'), RUSTUP, { mode: 0o755 });
  const first = start('install-tools', root, { ...stubs.env, RUSTUP_INSTALLED: 'stable-aarch64-apple-darwin' });
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('rustup')), ['rustup toolchain list', 'rustup toolchain install nightly-2026-10-01 --profile minimal']);
  const kept = start('install-tools', root, { ...stubs.env, RUSTUP_INSTALLED: 'nightly-2026-10-01-aarch64-apple-darwin' });
  assert.equal(kept.status, 0, kept.stderr);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('rustup')).slice(2), ['rustup toolchain list'], 'an installed channel is kept');
});

test('a declared Rust channel without rustup fails with the one prerequisite of the machine', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n', NIGHTLY_FILES);
  // PATH holds the stubs, the node of the stub of mise and the system commands, and no rustup.
  const result = start('install-tools', root, { ...stubs.env, PATH: [path.join(stubs.directory, 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\/toolchain\.json exceptions declare the Rust channel nightly-2026-10-01, and rustup is missing; rustup is the one tool that the machine provides \(AGENTS\.md\): install it from https:\/\/rustup\.rs/);
});

// A checkout whose rust-toolchain.toml pins the Rust toolchain with a component, as a Rust repository does.
const TOOLCHAIN_FILES = { 'rust-toolchain.toml': '[toolchain]\nchannel = "1.99.0"\nprofile = "minimal"\ncomponents = ["clippy"]\n' };

test('install-tools installs the toolchain of rust-toolchain.toml with rustup, which reads the file (K151)', (t) => {
  // rustup 1.28 no longer installs that toolchain as cargo first runs; `rustup toolchain install` without a name installs the
  // active toolchain, which the file names, with its profile and components.
  const { root, stubs } = checkout(t, '[tools]\n', TOOLCHAIN_FILES);
  writeFileSync(path.join(stubs.directory, 'bin', 'rustup'), RUSTUP, { mode: 0o755 });
  const result = start('install-tools', root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stubs.calls(), ['mise install --locked', 'rustup toolchain install --no-self-update']);
  assert.match(result.stdout, /^\[install-tools\] rustup toolchain install --no-self-update$/m);
});

test('a rust-toolchain.toml without rustup fails with the one prerequisite of the machine (K151)', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n', TOOLCHAIN_FILES);
  const result = start('install-tools', root, { ...stubs.env, PATH: [path.join(stubs.directory, 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[install-tools\] rust-toolchain\.toml pins the Rust toolchain, and rustup is missing; rustup is the one tool that the machine provides \(AGENTS\.md\): install it from https:\/\/rustup\.rs/);
});

// A mise.lock that pins ruff for both platforms, and pypi:vulture with the digest of its uv lock when `graph` says so.
const lockText = (graph: boolean) => `[[tools.ruff]]\nversion = "0.17.0"\n${['linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64'].map(platform => `[tools.ruff."platforms.${platform}"]\nchecksum = "${SUM}"\n`).join('')}
[[tools."pypi:vulture"]]\nversion = "2.16"\n${graph ? `uv = { path = ".mise/locks/pypi-vulture/2.16", digest = "${SUM}" }\n` : ''}`;

test('toolchain-lock runs mise lock for the four platforms of the bootstrap and passes a lock that pins every tool', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nruff = "0.17.0"\n', { 'mise.lock': lockText(true) });
  miseReleaseStub(root);
  const result = start('toolchain-lock', root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stubs.calls(), ['mise lock --global --platform linux-x64,linux-arm64,macos-arm64,macos-x64']);
  assert.match(result.stdout, /\[toolchain-lock\] mise\.lock pins every tool of mise\.toml/);
});

// The uv and the Python that the stub of mise names as its own, by `mise which`.
const MISE_UV = '/mise/installs/uv/0.12.24/bin/uv';
const MISE_PYTHON = '/mise/installs/python/3.14.8/bin/python3';
const WHICH = { 'which uv': MISE_UV, 'which python3': MISE_PYTHON };

test('a pypi: tool is locked with the uv and the Python of mise first on PATH, never with a uv of the machine', (t) => {
  const toml = '[tools]\nuv = "0.12.24"\npython = "3.14.8"\n"pypi:vulture" = "2.16"\n';
  const root = toolchainCheckout(t, { 'mise.toml': toml, 'mise.lock': lockText(false) });
  miseReleaseStub(root, WHICH);
  const stubs = toolchainStubs(t);
  // A uv of the machine comes first on the PATH of the caller.
  const machine = path.join(stubs.directory, 'machine');
  mkdirSync(machine);
  writeFileSync(path.join(machine, 'uv'), '#!/bin/sh\necho "the uv of the machine ran" >&2\nexit 1\n', { mode: 0o755 });
  const log = path.join(stubs.directory, 'env.log');
  const result = start('toolchain-lock', root, { ...stubs.env, PATH: `${machine}${path.delimiter}${stubs.env.PATH}`, STUB_MISE_ENV_LOG: log });
  // The stub writes no lock, so the lock still misses the uv lock and the command fails with the findings.
  assert.equal(result.status, 1);
  assert.deepEqual(stubs.calls(), [
    'mise lock uv python --global --platform linux-x64,linux-arm64,macos-arm64,macos-x64',
    'mise install --locked uv python',
    'mise which uv',
    'mise which python3',
    'mise lock --global --platform linux-x64,linux-arm64,macos-arm64,macos-x64',
  ]);
  const calls = readStubLines(log, MISE_CALL);
  const last = known(calls.at(-1), 'calls.at(-1)');
  // The wrapper of the installed mise puts the directory of its binary first (miseWrapper), then the uv and the Python of mise.
  assert.deepEqual(last.PATH.split(path.delimiter).slice(0, 3), [path.join(root, 'var/tools/mise-release/mise/bin'), path.dirname(MISE_UV), path.dirname(MISE_PYTHON)], 'the uv and the Python of mise come first');
  assert.equal(last.UV_PYTHON, MISE_PYTHON, 'uv resolves with the Python of mise');
  assert.match(result.stderr, /mise\.lock pins pypi:vulture 2\.16 without the digest of its uv lock/);
});

test('a pypi: tool without the uv or the Python of mise.toml is refused before any lock', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n"pypi:vulture" = "2.16"\n');
  miseReleaseStub(root);
  const alone = start('toolchain-lock', root, stubs.env);
  assert.equal(alone.status, 1);
  assert.match(alone.stderr, /a pypi: tool of mise\.toml needs the uv and the Python of mise\.toml, which lock it; declare uv and python/);
  assert.deepEqual(stubs.calls(), []);
});

test('the make targets install-tools and toolchain-lock run their tools online, and TOOLS=npm runs the bootstrap of KIT', () => {
  const dry = (...args: string[]) => spawnSync('make', ['-n', '--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'ONLINE=online-wrapper', ...args], { cwd: ROOT, encoding: 'utf8' });
  // The tools run with the node of the checkout by its absolute path; the bootstrap, which installs it, with the node of the
  // machine (K171), and toolchain-lock too, which writes the mise.lock that the bootstrap installs that node from (K174).
  const node = path.join(ROOT, 'var/tools/bin/node');
  assert.equal(dry('install-tools').stdout.trim(), `online-wrapper ${node} scripts/kit/install-tools.mts`);
  assert.equal(dry('toolchain-lock').stdout.trim(), 'online-wrapper node scripts/kit/toolchain-lock.mts');
  // In kit, `make install-tools TOOLS=npm` is the first step of a checkout: install-tools.mts imports modules that import the
  // packages of package-lock.json, which npm ci installs only after it.
  assert.equal(dry('install-tools', 'TOOLS=npm').stdout.trim(), 'online-wrapper node scripts/kit/bootstrap/bootstrap.mts');
});
