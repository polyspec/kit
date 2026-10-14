// The tools of a release (scripts/kit/release-tools.mts): the install-tools names that config/release.json needs for its
// packages, consumers and Go modules, and the Rust toolchain that rust-toolchain.toml declares for a git-tag proof. The Rust
// toolchain is installed and checked by the same declaration that make install and check-toolchain read. No test reaches
// a registry: rustup and rustc are stubs on PATH.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareRust, toolsFor } from '../../scripts/kit/release-tools.mts';
import { Stop } from '../../scripts/kit/process.mts';
import { tool } from './kit-tools.mts';
import { initRepository } from './sandbox-repository.mts';
import { readStubLines, STUB_CALL } from './stub-json.mts';
import { readJsonFile } from '../../scripts/kit/schema-validate.mts';
import type { ReleaseConfig } from '../../scripts/kit/release.mts';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture/config/release.json');
const stop = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => error instanceof Stop && pattern.test(error.message), String(pattern));

// A checkout with rust-toolchain.toml (when `channel` is given) and stubs of rustup and rustc on PATH. Each rustup call is
// appended to rustup.log with its arguments and working directory; rustc prints the release of the channel.
function rustCheckout(t: TestContext, { channel = '1.99.0', rustupStatus = 0 }: { channel?: string | null; rustupStatus?: number } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'release-tools-rust-'));
  const bin = path.join(root, '.stubs');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(bin, { recursive: true });
  if (channel !== null) writeFileSync(path.join(root, 'rust-toolchain.toml'), `[toolchain]\nchannel = "${channel}"\n`);
  writeFileSync(path.join(bin, 'rustup'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.STUB_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');\nprocess.exit(${rustupStatus});\n`);
  writeFileSync(path.join(bin, 'rustc'), `#!/bin/sh\necho "rustc ${channel ?? '0.0.0'} (stub 2026-01-01)"\n`);
  for (const name of ['rustup', 'rustc']) chmodSync(path.join(bin, name), 0o755);
  const log = path.join(root, 'rustup.log');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_LOG: log };
  // check-toolchain lists the files of the checkout through Git for the floors, so the checkout is a repository.
  initRepository(root);
  const calls = () => (existsSync(log) ? readStubLines(log, STUB_CALL) : []);
  return { root, env, calls, log };
}

// The lines that prepareRust printed, the lines of the errors it wrote, and the stdout of the checks it ran.
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, print: (line: string) => out.push(line), error: (line: string) => err.push(line) };
}

test('release-tools runs install-tools for the fixture configuration and asks for the Rust toolchain of a git-tag proof', () => {
  const config = readJsonFile<ReleaseConfig>(FIXTURE, 'release.schema.json');
  assert.ok(config.proof?.gitTag, 'the fixture proves a git-tag manifest, so the proof needs its Rust toolchain');
  assert.deepEqual(toolsFor(config), { install: true, rust: true, assets: false });
});

test('release-tools installs only the tools that a configuration without Go modules or git-tag proofs needs', () => {
  const config = {
    packages: [{ kind: 'composer', directory: 'packages/php', name: 'vendor/php' }],
    manifests: { 'packages/php/composer.json': 'archive' },
    goModules: {},
    consumers: { composer: { directory: 'tests/composer', smoke: { 'vendor/php': ['php', '-v'] } } },
  };
  assert.deepEqual(toolsFor(config), { install: true, rust: false, assets: false });
});

test('release-tools runs install-tools for a wheel package, and nothing for an npm package, whose npm is the bootstrap', () => {
  const wheel = { packages: [{ kind: 'wheel', directory: 'packages/py', name: 'py' }], goModules: {} };
  assert.deepEqual(toolsFor(wheel), { install: true, rust: false, assets: false });
  const npm = { packages: [{ kind: 'npm', directory: 'packages/js', name: 'js' }], goModules: {} };
  assert.deepEqual(toolsFor(npm), { install: false, rust: false, assets: false });
});

test('prepareRust installs the channel of rust-toolchain.toml with rustup in the checkout and checks rustc against it', (t) => {
  const box = rustCheckout(t, { channel: '1.99.0' });
  const io = capture();
  prepareRust(box.root, { env: box.env, ...io });
  // rustup reports the working directory with its symbolic links resolved (/private/var on macOS).
  assert.deepEqual(box.calls(), [{ args: ['toolchain', 'install', '--no-self-update'], cwd: realpathSync(box.root) }]);
  assert.ok(io.out.some(line => line.includes('rust 1.99.0')), `the check of rustc prints the declared release: ${io.out.join('\n')}`);
});

test('prepareRust stops with the file name when a git-tag proof has no rust-toolchain.toml, and calls no rustup', (t) => {
  const box = rustCheckout(t, { channel: null });
  stop(() => prepareRust(box.root, { env: box.env, ...capture() }), /rust-toolchain\.toml is missing; the git-tag proof needs the Rust channel that it declares/);
  assert.deepEqual(box.calls(), []);
});

test('prepareRust stops with the rustup output when the toolchain cannot be installed', (t) => {
  const box = rustCheckout(t, { channel: '1.99.0', rustupStatus: 1 });
  stop(() => prepareRust(box.root, { env: box.env, ...capture() }), /rustup toolchain install --no-self-update exited with 1/);
});

test('release-tools reads config/release.json of the repository it runs in, not of the checkout of its module (K71-2)', (t) => {
  // The tools of a package run from node_modules/@polyspec/kit/dist, so the location of the module names no repository: the
  // tool of this checkout, whose own config/release.json is valid, runs in another repository (kit-tools.mts).
  const repository = mkdtempSync(path.join(tmpdir(), 'release-tools-repository-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  initRepository(repository);
  mkdirSync(path.join(repository, 'config'));
  writeFileSync(path.join(repository, 'config/release.json'), '{}');
  const ran = spawnSync(process.execPath, [tool('release-tools')], { cwd: repository, encoding: 'utf8' });
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /config\/release\.json: \/ must have required property 'repositoryUrl'/);
});

test('release-tools fetches the release archives of config/release-assets.json when the Composer consumer installs a polyspec dependency (K140)', () => {
  const config = {
    packages: [{ kind: 'composer', directory: 'packages/php', name: 'vendor/php' }],
    goModules: {},
    consumers: { composer: { directory: 'tests/composer', smoke: { 'vendor/php': ['php', '-v'] }, polyspec: ['codec-php'] } },
  };
  assert.deepEqual(toolsFor(config), { install: true, rust: false, assets: true });
});
