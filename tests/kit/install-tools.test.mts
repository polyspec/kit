// Tests of scripts/kit/install-tools.mts (K127): install-tools has mise install every tool of mise.lock (`mise install --locked`,
// by the wrapper of the bootstrap) before the tools that mise does not install, takes no tool names, and stops on a failed mise
// install; toolchain-lock is the mise lock of kit.mk (K836).
// var/tools/bin/mise is a stub that logs its calls, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseStub, toolchainStubs } from './toolchain-stubs.mts';
import { KIT, tool } from './kit-tools.mts';
import type { JSONSchemaType } from 'ajv/dist/2020.js';
import { readStubLines, TEXTS } from './stub-json.mts';

const ROOT = path.resolve(KIT, '../..');
/** A call of the mise stub: its arguments, PATH and UV_PYTHON. */
const MISE_CALL: JSONSchemaType<{ args: string[]; PATH: string; UV_PYTHON?: string }> = { type: 'object', required: ['args', 'PATH'], properties: { args: TEXTS, PATH: { type: 'string' }, UV_PYTHON: { type: 'string', nullable: true } } };

const INSTALL_TOOLS = import.meta.resolve('../../scripts/kit/install-tools.mts');
/** The run of the tool of the module URL `module` in `root`. */
const start = (module: string, root: string, env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, [tool(module), ...args], { cwd: root, env, encoding: 'utf8' });

// A checkout with mise.toml `toml` and the stub wrapper of mise, and the stubs of the test; removed with `t.after`.
function checkout(t: TestContext, toml: string, files: Record<string, string> = {}) {
  const root = toolchainCheckout(t, { 'mise.toml': toml, ...files });
  miseStub(root);
  return { root, stubs: toolchainStubs(t) };
}

test('install-tools has mise install every tool of mise.lock in the checkout, and installs nothing else that is undeclared', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nruff = "0.17.0"\n');
  const result = start(INSTALL_TOOLS, root, stubs.env);
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
  const first = start(INSTALL_TOOLS, root, env);
  const second = start(INSTALL_TOOLS, root, env);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout, 'the second run does what the first did: mise install --locked, which mise keeps');
  assert.deepEqual(stubs.calls(), ['mise install --locked', 'mise install --locked']);
});

test('a mise install that fails stops install-tools with the error of mise, before any install of kit', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nruff = "0.17.0"\n', { 'config/toolchain.json': JSON.stringify({ schema: 1 }) });
  const result = start(INSTALL_TOOLS, root, { ...stubs.env, STUB_MISE_FAILS: 'ruff@0.17.0 is not in the lockfile' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mise ERROR ruff@0\.17\.0 is not in the lockfile/);
  assert.match(result.stderr, /\[install-tools\] .*var\/tools\/bin\/mise install --locked ended with exit status 1/);
});

test('install-tools selects only declared tools and rejects empty or unknown selectors before mutation', (t) => {
  const { root, stubs } = checkout(t, '[tools]\ngo = "1.27.3"\npython = "3.14.8"\nruff = "0.17.0"\n');
  writeFileSync(path.join(root, 'var/tools/bin/go'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(path.join(root, 'var/tools/bin/php'), '#!/bin/sh\n', { mode: 0o755 });
  const selected = start(INSTALL_TOOLS, root, stubs.env, 'go', 'python');
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(stubs.calls(), ['mise install --locked go python']);
  assert.equal(readdirSync(path.join(root, 'var/tools/bin')).includes('go'), false, 'the selected Go shim is not shadowed by a legacy wrapper');
  assert.equal(readdirSync(path.join(root, 'var/tools/bin')).includes('php'), true, 'an unrelated wrapper remains installed');

  const unknown = start(INSTALL_TOOLS, root, stubs.env, 'go', 'not-declared');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown TOOLS selector not-declared; choose /);
  assert.deepEqual(stubs.calls(), ['mise install --locked go python'], 'unknown selectors fail before another mise install');

  const empty = start(INSTALL_TOOLS, root, stubs.env, '');
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /TOOLS must name one or more declared tool selectors/);
  assert.deepEqual(stubs.calls(), ['mise install --locked go python'], 'empty selectors fail before another mise install');
});

test('selected tools include only their declared mise prerequisites, and a missing prerequisite fails before install', (t) => {
  const toml = '[tools]\ngo = "1.27.3"\npython = "3.14.8"\nuv = "0.13.0"\n"pypi:vulture" = "2.16"\n"go:golang.org/x/tools/cmd/deadcode" = "0.52.0"\n';
  const { root, stubs } = checkout(t, toml);
  const result = start(INSTALL_TOOLS, root, stubs.env, 'deadcode', 'vulture');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stubs.calls(), ['mise install --locked go:golang.org/x/tools/cmd/deadcode go pypi:vulture python uv']);

  const { root: incomplete, stubs: incompleteStubs } = checkout(t, '[tools]\n"go:golang.org/x/tools/cmd/deadcode" = "0.52.0"\n');
  const missing = start(INSTALL_TOOLS, incomplete, incompleteStubs.env, 'deadcode');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /go is needed by the selected TOOLS, but mise\.toml does not declare go/);
  assert.deepEqual(incompleteStubs.calls(), [], 'transitive prerequisites are validated before mise is called');

  const composerToml = '[tools]\n"http:composer" = { version = "2.8.12", url = "https://getcomposer.org/download/2.8.12/composer.phar" }\n';
  const { root: composerOnly, stubs: composerStubs } = checkout(t, composerToml, { '.php-version': '8.4\n' });
  writeFileSync(path.join(composerStubs.directory, 'bin/php'), '#!/bin/sh\nprintf "8.4\\n"\n', { mode: 0o755 });
  const composer = start(INSTALL_TOOLS, composerOnly, composerStubs.env, 'composer');
  assert.equal(composer.status, 0, composer.stderr);
  assert.deepEqual(composerStubs.calls(), ['mise install --locked http:composer'], 'Composer installs its declared PHP prerequisite first');

  const { root: missingPhp, stubs: missingPhpStubs } = checkout(t, composerToml);
  const rejectedComposer = start(INSTALL_TOOLS, missingPhp, missingPhpStubs.env, 'composer');
  assert.equal(rejectedComposer.status, 1);
  assert.match(rejectedComposer.stderr, /selected PHP tools need PHP/);
  assert.deepEqual(missingPhpStubs.calls(), [], 'Composer without a declared PHP pin fails before mutation');

  const { root: phpConfigOnly, stubs: phpConfigStubs } = checkout(t, composerToml, { 'config/toolchain.json': JSON.stringify({ schema: 1, php: ['8.4'] }) });
  const rejectedConfig = start(INSTALL_TOOLS, phpConfigOnly, phpConfigStubs.env, 'composer');
  assert.equal(rejectedConfig.status, 1);
  assert.match(rejectedConfig.stderr, /.php-version is missing/);
  assert.deepEqual(phpConfigStubs.calls(), [], 'a PHP minor without the installable .php-version declaration fails before mutation');
});

test('a requested tool absent from the checkout declaration is refused before mutation, and install-tools needs bootstrap mise', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n');
  const named = start(INSTALL_TOOLS, root, stubs.env, 'ruff');
  assert.equal(named.status, 1);
  assert.match(named.stderr, /\[install-tools\] ruff is not declared by this checkout/);
  assert.deepEqual(stubs.calls(), []);
  const bare = toolchainCheckout(t, { 'mise.toml': '[tools]\n' });
  const missing = start(INSTALL_TOOLS, bare, stubs.env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /\[install-tools\] var\/tools\/bin\/mise is missing; run make install-tools TOOLS=npm, the bootstrap that installs mise/);
});

test('install-tools removes each file of var/tools/bin that no installer of kit writes any more (K149)', (t) => {
  // kit 0.0.38 wrote wrappers of go, gofmt, python3 and alint, which now come from mise; left in var/tools/bin, which comes
  // first on PATH, they shadowed the shims of mise. The bootstrap writes mise, npm and npx, which are kept.
  const { root, stubs } = checkout(t, '[tools]\n');
  const bin = path.join(root, 'var/tools/bin');
  for (const name of ['npm', 'npx', 'go', 'gofmt', 'python3', 'alint']) writeFileSync(path.join(bin, name), '#!/bin/sh\n# A wrapper (scripts/kit/install-tools.mts).\n', { mode: 0o755 });
  const result = start(INSTALL_TOOLS, root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(bin).sort(), ['mise', 'npm', 'npx']);
  for (const name of ['alint', 'go', 'gofmt', 'python3']) assert.match(result.stdout, new RegExp(`^\\[install-tools\\] removed var/tools/bin/${name}$`, 'm'));
  const second = start(INSTALL_TOOLS, root, stubs.env);
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
  const first = start(INSTALL_TOOLS, root, { ...stubs.env, RUSTUP_INSTALLED: 'stable-aarch64-apple-darwin' });
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('rustup')), ['rustup toolchain list', 'rustup toolchain install nightly-2026-10-01 --profile minimal']);
  const kept = start(INSTALL_TOOLS, root, { ...stubs.env, RUSTUP_INSTALLED: 'nightly-2026-10-01-aarch64-apple-darwin' });
  assert.equal(kept.status, 0, kept.stderr);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('rustup')).slice(2), ['rustup toolchain list'], 'an installed channel is kept');
});

test('a declared Rust channel without rustup fails with the one prerequisite of the machine', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n', NIGHTLY_FILES);
  // PATH holds the stubs, the node of the stub of mise and the system commands, and no rustup.
  const result = start(INSTALL_TOOLS, root, { ...stubs.env, PATH: [path.join(stubs.directory, 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\/toolchain\.json exceptions declare the Rust channel nightly-2026-10-01, and rustup is missing; rustup is the one tool that the machine provides \(AGENTS\.md\): install it from https:\/\/rustup\.rs/);
});

// A checkout whose rust-toolchain.toml pins the Rust toolchain with a component, as a Rust repository does.
const TOOLCHAIN_FILES = { 'rust-toolchain.toml': '[toolchain]\nchannel = "1.99.0"\nprofile = "minimal"\ncomponents = ["clippy"]\n' };

test('install-tools installs the exact channel, profile and components of rust-toolchain.toml (K151)', (t) => {
  // Explicit components ensure an existing active toolchain is updated when it lacks a requested tool such as clippy.
  const { root, stubs } = checkout(t, '[tools]\n', TOOLCHAIN_FILES);
  writeFileSync(path.join(stubs.directory, 'bin', 'rustup'), RUSTUP, { mode: 0o755 });
  const result = start(INSTALL_TOOLS, root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(stubs.calls(), ['mise install --locked', 'rustup toolchain install --no-self-update --profile minimal --component clippy 1.99.0']);
  assert.match(result.stdout, /^\[install-tools\] rustup toolchain install --no-self-update --profile minimal --component clippy 1\.99\.0$/m);
});

test('a rust-toolchain.toml without rustup fails with the one prerequisite of the machine (K151)', (t) => {
  const { root, stubs } = checkout(t, '[tools]\n', TOOLCHAIN_FILES);
  const result = start(INSTALL_TOOLS, root, { ...stubs.env, PATH: [path.join(stubs.directory, 'bin'), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[install-tools\] rust-toolchain\.toml declares the Rust toolchain, and rustup is missing; rustup is the one tool that the machine provides \(AGENTS\.md\): install it from https:\/\/rustup\.rs/);
});

// K836: make toolchain-lock is mise lock with the mise of the bootstrap. mise locks a pypi: tool with the first uv on PATH, and uv
// takes a managed Python of the home before PATH (measured), so mise first locks uv and python; it installs each that it then lists,
// under any key form, and when it lists python the full lock names that Python as UV_PYTHON; var/tools/bin and the shims
// come first on PATH.
const PLATFORMS = 'linux-x64,linux-arm64,macos-arm64,macos-x64,windows-x64,windows-arm64';
const MISE_PYTHON = '/checkout/var/tools/mise/installs/python/3.14.8/bin/python3';
const listed = (declared: boolean) => JSON.stringify(declared ? [{ requested_version: '1.0.0' }] : [], null, 2);
const lockRun = (t: TestContext, uv: boolean, python: boolean) => {
  const { root, stubs } = checkout(t, '[tools]\n');
  miseStub(root, { 'which python3': MISE_PYTHON, 'ls --global --json uv': listed(uv), 'ls --global --json python': listed(python) });
  const log = path.join(stubs.directory, 'env.log');
  const make = spawnSync('make', ['--no-print-directory', '-f', path.join(KIT, 'kit.mk'), `KIT=${KIT}`, 'KIT_EXT=mts', 'toolchain-lock'], { cwd: root, env: { ...stubs.env, STUB_MISE_ENV_LOG: log }, encoding: 'utf8' });
  assert.equal(make.status, 0, `${make.stdout}${make.stderr}`);
  return { root, calls: readStubLines(log, MISE_CALL) };
};

test('toolchain-lock locks and installs the uv and the Python that mise lists, and locks with that Python (K836)', (t) => {
  const { root, calls } = lockRun(t, true, true);
  assert.deepEqual(calls.map(call => call.args.join(' ')), [`lock uv python --global --platform ${PLATFORMS}`, 'ls --global --json uv', 'ls --global --json python', 'install --locked uv python', 'which python3', `lock --global --platform ${PLATFORMS}`]);
  assert.equal(calls.at(-1)?.UV_PYTHON, MISE_PYTHON, 'uv resolves with the Python of mise.toml');
  for (const call of calls) assert.deepEqual(call.PATH.split(path.delimiter).slice(0, 2), [path.join(root, 'var/tools/bin'), path.join(root, 'var/tools/mise/shims')], 'var/tools/bin and the shims come first');
});

test('toolchain-lock without the uv and the Python in mise.toml is one mise lock (K836)', (t) => {
  assert.deepEqual(lockRun(t, false, false).calls.map(call => call.args.join(' ')), [`lock uv python --global --platform ${PLATFORMS}`, 'ls --global --json uv', 'ls --global --json python', `lock --global --platform ${PLATFORMS}`]);
  const uv = lockRun(t, true, false);
  assert.deepEqual(uv.calls.map(call => call.args.join(' ')), [`lock uv python --global --platform ${PLATFORMS}`, 'ls --global --json uv', 'ls --global --json python', 'install --locked uv', `lock --global --platform ${PLATFORMS}`]);
  assert.equal(uv.calls.at(-1)?.UV_PYTHON, undefined, 'no Python is named while mise.toml declares none');
  const python = lockRun(t, false, true);
  assert.deepEqual(python.calls.map(call => call.args.join(' ')), [`lock uv python --global --platform ${PLATFORMS}`, 'ls --global --json uv', 'ls --global --json python', 'install --locked python', 'which python3', `lock --global --platform ${PLATFORMS}`]);
  assert.equal(python.calls.at(-1)?.UV_PYTHON, MISE_PYTHON);
});

test('toolchain-lock without the mise of the bootstrap names make install-tools TOOLS=npm (K174, K836)', (t) => {
  const root = toolchainCheckout(t, { 'mise.toml': '[tools]\nruff = "0.17.0"\n' });
  const make = spawnSync('make', ['--no-print-directory', '-f', path.join(KIT, 'kit.mk'), `KIT=${KIT}`, 'KIT_EXT=mts', 'toolchain-lock'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(make.status, 0);
  assert.match(make.stderr, /var\/tools\/bin\/mise is missing; run make install-tools TOOLS=npm, the bootstrap that installs the mise of config\/toolchain\.json/);
});

test('the make target install-tools runs its tools online, and TOOLS=npm runs the bootstrap of KIT', (t) => {
  const root = toolchainCheckout(t);
  const dry = (...args: string[]) => spawnSync('make', ['-n', '--no-print-directory', '-f', path.join(KIT, 'kit.mk'), 'KIT=scripts/kit', 'KIT_EXT=mts', 'ONLINE=online-wrapper', ...args], { cwd: root, encoding: 'utf8' });
  // The tools run with the node of the checkout by its absolute path; the bootstrap, which installs it, with the node of the
  // machine (K171).
  const node = path.join(root, 'var/tools/bin/node');
  assert.equal(dry('install-tools').stdout.trim(), `online-wrapper ${node} scripts/kit/install-tools.mts`);
  // In kit, `make install-tools TOOLS=npm` is the first step of a checkout: install-tools.mts imports modules that import the
  // packages of package-lock.json, which npm ci installs only after it.
  assert.equal(dry('install-tools', 'TOOLS=npm').stdout.trim(), 'online-wrapper node scripts/kit/bootstrap/bootstrap.mts');
});

// K448-6: composer-install and npm-install install the third-party packages of the lock, so they run online as every install target
// does; a consumer that exports COMPOSER_DISABLE_NETWORK or npm_config_offline for its checks unsets them through ONLINE (K448-6).
test('the make targets composer-install and npm-install run their tools online (K448-6)', () => {
  const dry = (...args: string[]) => spawnSync('make', ['-n', '--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'ONLINE=online-wrapper', 'NODE=node', 'NPM=npm', ...args], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(dry('composer-install', 'DIR=x').stdout.trim(), 'online-wrapper node scripts/kit/composer-install.mts x');
  assert.equal(dry('npm-install', 'DIR=x').stdout.trim(), 'NPM_BIN=npm online-wrapper node scripts/kit/npm-install.mts x');
});

// K469-1: a var that is a symbolic link is the var of another checkout, so install-tools refuses it: each checkout keeps its own
// var/tools and its own mise state, and a worktree never writes the var of the main checkout.
test('install-tools refuses a var that is a symbolic link, so it never writes the var of another checkout (K469-1)', (t) => {
  const { root, stubs } = checkout(t, '[tools]\nruff = "0.17.0"\n');
  const shared = path.join(root, 'shared-var');
  renameSync(path.join(root, 'var'), shared);
  symlinkSync(shared, path.join(root, 'var'));
  const result = start(INSTALL_TOOLS, root, stubs.env);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /var is a symbolic link; each checkout keeps its own var, so make install-tools refuses to write the var of another checkout \(K469-1\)/);
  assert.deepEqual(stubs.calls(), [], 'no mise call runs through the shared var');
});
