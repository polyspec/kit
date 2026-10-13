// The mise of the bootstrap (scripts/kit/bootstrap/install-mise.mts, K127): after the npm of packageManager, the bootstrap
// installs the mise release that config/toolchain.json mise declares into var/tools/mise-release. The archive of the platform
// is downloaded with its sha256 checked and unpacked, and the wrapper var/tools/bin/mise keeps every directory of mise, and the
// Go and uv caches of its installs, under var/tools/mise, trusts the config of the checkout, installs only what mise.lock pins
// and never on its own, keeps uv from downloading a Python, and has Go check every module against the checksum database. A
// second run installs nothing; another digest is refused with both digests. curl is a PATH stub that copies the archive of the test, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { KIT } from './kit-tools.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { toolchainStubs } from './toolchain-stubs.mts';

const VERSION = '2026.10.8';
const KEY = `${process.platform}-${process.arch}`;
// The asset name of mise for each platform key.
const ASSET: Record<string, string> = { 'darwin-arm64': 'macos-arm64', 'darwin-x64': 'macos-x64', 'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64' };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The release archive of a stub mise that prints its version, and its URL and sha256; removed with `t.after`. */
function miseRelease(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-mise-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'mise/bin'), { recursive: true });
  writeFileSync(path.join(directory, 'mise/bin/mise'), `#!/bin/sh\necho "${VERSION} ${ASSET[KEY]} (2026-10-11)"\n`);
  chmodSync(path.join(directory, 'mise/bin/mise'), 0o755);
  const archive = path.join(directory, 'mise.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', directory, 'mise']).status, 0);
  const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const url = `https://github.com/jdx/mise/releases/download/v${VERSION}/mise-v${VERSION}-${ASSET[KEY]}.tar.gz`;
  return { archive, sha256, url };
}

/** A checkout whose npm of packageManager is installed, declaring mise with `sha256` for this platform. */
function checkout(t: TestContext, sha256: string) {
  const root = toolchainCheckout(t, {
    '.node-version': `${process.versions.node}\n`,
    'package.json': '{ "packageManager": "npm@12.2.0" }\n',
    'config/toolchain.json': JSON.stringify({ schema: 1, mise: { version: VERSION, sha256: { [KEY]: sha256 } } }),
    'var/tools/npm/node_modules/npm/package.json': '{ "version": "12.2.0" }\n',
  });
  return root;
}

// The bootstrap of kit runs in the checkout, as kit-bootstrap.mk runs the copy of a repository.
const BOOTSTRAP = path.join(KIT, 'bootstrap/bootstrap.mts');
const bootstrap = (root: string, env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [BOOTSTRAP], { cwd: root, env, encoding: 'utf8' });

test('the bootstrap installs the declared mise with its sha256 checked, wraps it, and keeps it on a second run', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, release.sha256);
  const stubs = toolchainStubs(t, { downloads: { [release.url]: release.archive } });
  const first = bootstrap(root, stubs.env);
  assert.equal(first.status, 0, `${first.stdout}${first.stderr}`);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('curl')).map(line => line.split(' ').at(-1)), [release.url]);
  const wrapper = path.join(root, 'var/tools/bin/mise');
  assert.equal(spawnSync(wrapper, ['--version'], { encoding: 'utf8' }).stdout.trim(), `${VERSION} ${ASSET[KEY]} (2026-10-11)`);
  const text = readFileSync(wrapper, 'utf8');
  const tools = path.join(root, 'var/tools');
  const expected = {
    MISE_DATA_DIR: path.join(tools, 'mise'),
    MISE_CACHE_DIR: path.join(tools, 'mise/cache'),
    MISE_STATE_DIR: path.join(tools, 'mise/state'),
    MISE_CONFIG_DIR: path.join(tools, 'mise/config'),
    MISE_TRUSTED_CONFIG_PATHS: root,
    MISE_LOCKED: '1',
    MISE_AUTO_INSTALL: '0',
    UV_PYTHON_DOWNLOADS: 'never',
    UV_CACHE_DIR: path.join(tools, 'mise/cache/uv'),
    GOPATH: path.join(tools, 'mise/go'),
    GOCACHE: path.join(tools, 'mise/cache/go-build'),
    GOFLAGS: '-mod=readonly -modcacherw',
    GOSUMDB: 'sum.golang.org',
    GONOSUMDB: '',
    GOPRIVATE: '',
    GOINSECURE: '',
  };
  for (const [name, value] of Object.entries(expected)) assert.match(text, new RegExp(`^${name}=${escape(`'${value}'`)}$`, 'm'), name);
  assert.match(text, new RegExp(`^export ${Object.keys(expected).join(' ')}$`, 'm'));
  assert.match(text, new RegExp(`^exec ${escape(`'${path.join(tools, 'mise-release/mise/bin/mise')}'`)} "\\$@"$`, 'm'));
  assert.equal(text.includes(homedir()), false, 'the wrapper names no directory of the home');
  const second = bootstrap(root, stubs.env);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(`mise: ${escape(VERSION)} is installed in var/tools/mise-release`));
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'a second run downloads nothing');
});

test('a mise archive with another digest is refused, nothing is installed, and the error names both digests', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, '0'.repeat(64));
  const result = bootstrap(root, toolchainStubs(t, { downloads: { [release.url]: release.archive } }).env);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, new RegExp(`${escape(release.url)} has the sha256 ${release.sha256}; config/toolchain\\.json mise declares ${'0'.repeat(64)} for ${KEY}`));
  assert.equal(existsSync(path.join(root, 'var/tools/mise-release')), false);
  assert.equal(existsSync(path.join(root, 'var/tools/bin/mise')), false);
});

test('the bootstrap requires the declaration of mise', (t) => {
  const root = checkout(t, '0'.repeat(64));
  writeFileSync(path.join(root, 'config/toolchain.json'), JSON.stringify({ schema: 1 }));
  const result = bootstrap(root, process.env);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /config\/toolchain\.json declares no mise; declare its version and the sha256 of its archive of each platform/);
});
