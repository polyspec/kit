// Tests of scripts/kit/install-tools.mts and scripts/kit/toolchain-lock.mts (K127): install-tools has mise install every tool
// of mise.lock (`mise install --locked`, by the wrapper of the bootstrap) before the tools that mise does not install, takes no
// tool names, and stops on a failed mise install; toolchain-lock writes mise.lock with `mise lock` for the platforms of kit,
// locks a pypi: tool with the uv and the Python of mise.toml, installed first, at the head of PATH, and fails on a lock that
// misses a digest.
// var/tools/bin/mise is a stub that logs its calls, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseStub, toolchainStubs } from './toolchain-stubs.mts';
import { KIT, tool } from './kit-tools.mts';

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

// A mise.lock that pins ruff for both platforms, and pypi:vulture with the digest of its uv lock when `graph` says so.
const lockText = (graph: boolean) => `[[tools.ruff]]\nversion = "0.17.0"\n${['linux-x64', 'macos-arm64'].map(platform => `[tools.ruff."platforms.${platform}"]\nchecksum = "${SUM}"\n`).join('')}
[[tools."pypi:vulture"]]\nversion = "2.16"\n${graph ? `uv = { path = ".mise/locks/pypi-vulture/2.16", digest = "${SUM}" }\n` : ''}`;

test('toolchain-lock runs mise lock for linux-x64 and macos-arm64 and passes a lock that pins every tool', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nruff = "0.17.0"\n', { 'mise.lock': lockText(true) });
  const result = start('toolchain-lock', root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stubs.calls(), ['mise lock --platform linux-x64,macos-arm64']);
  assert.match(result.stdout, /\[toolchain-lock\] mise\.lock pins every tool of mise\.toml/);
});

// The uv and the Python that the stub of mise names as its own, by `mise which`.
const MISE_UV = '/mise/installs/uv/0.12.24/bin/uv';
const MISE_PYTHON = '/mise/installs/python/3.14.8/bin/python3';
const WHICH = { 'which uv': MISE_UV, 'which python3': MISE_PYTHON };

test('a pypi: tool is locked with the uv and the Python of mise first on PATH, never with a uv of the machine', (t) => {
  const toml = '[tools]\nuv = "0.12.24"\npython = "3.14.8"\n"pypi:vulture" = "2.16"\n';
  const root = toolchainCheckout(t, { 'mise.toml': toml, 'mise.lock': lockText(false) });
  miseStub(root, WHICH);
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
    'mise lock uv python --platform linux-x64,macos-arm64',
    'mise install --locked uv python',
    'mise which uv',
    'mise which python3',
    'mise lock --platform linux-x64,macos-arm64',
  ]);
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { args: string[]; PATH: string; UV_PYTHON?: string });
  const last = calls.at(-1)!;
  assert.deepEqual(last.PATH.split(path.delimiter).slice(0, 2), [path.dirname(MISE_UV), path.dirname(MISE_PYTHON)], 'the uv and the Python of mise come first');
  assert.equal(last.UV_PYTHON, MISE_PYTHON, 'uv resolves with the Python of mise');
  assert.match(result.stderr, /mise\.lock pins pypi:vulture 2\.16 without the digest of its uv lock/);
});

test('a pypi: tool without the uv or the Python of mise.toml is refused before any lock', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n"pypi:vulture" = "2.16"\n');
  const alone = start('toolchain-lock', root, stubs.env);
  assert.equal(alone.status, 1);
  assert.match(alone.stderr, /a pypi: tool of mise\.toml needs the uv and the Python of mise\.toml, which lock it; declare uv and python/);
  assert.deepEqual(stubs.calls(), []);
});

test('the make targets install-tools and toolchain-lock run their tools online, and TOOLS=npm runs the bootstrap of KIT', () => {
  const dry = (...args: string[]) => spawnSync('make', ['-n', '--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'ONLINE=online-wrapper', ...args], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(dry('install-tools').stdout.trim(), 'online-wrapper node scripts/kit/install-tools.mts');
  assert.equal(dry('toolchain-lock').stdout.trim(), 'online-wrapper node scripts/kit/toolchain-lock.mts');
  // In kit, `make install-tools TOOLS=npm` is the first step of a checkout: install-tools.mts imports modules that import the
  // packages of package-lock.json, which npm ci installs only after it.
  assert.equal(dry('install-tools', 'TOOLS=npm').stdout.trim(), 'online-wrapper node scripts/kit/bootstrap/bootstrap.mts');
});
