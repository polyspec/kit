// The mise of the bootstrap (scripts/kit/bootstrap/install-mise.mts, K127): first, the bootstrap installs the mise release
// that config/toolchain.json mise declares into var/tools/mise-release, and with it the node of mise.toml, which the wrapper
// var/tools/bin/node runs (K171). The archive of the platform
// is downloaded with its sha256 checked and unpacked, and the wrapper var/tools/bin/mise keeps every directory of mise, and the
// Go and uv caches of its installs, under var/tools/mise, trusts the config of the checkout, installs only what mise.lock pins
// and never on its own, keeps uv from downloading a Python, and has Go check every module against the checksum database. A
// second run installs nothing; another digest is refused with both digests. curl is a PATH stub that copies the archive of the test, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { KIT } from './kit-tools.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { TOOLS_GO_MOD, trustConfig } from '../../scripts/kit/bootstrap/install-mise.mts';
import { toolchainStubs } from './toolchain-stubs.mts';
import { tree } from './tree.mts';

const VERSION = '2026.10.8';
const KEY = `${process.platform}-${process.arch}`;
// The asset name of mise for each platform key.
const ASSET: Record<string, string> = { 'darwin-arm64': 'macos-arm64', 'darwin-x64': 'macos-x64', 'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64' };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// The directory that the stub mise prints for `mise where node`, the install of the node of mise.toml.
const NODE_INSTALL = '/stub/mise/installs/node/26.11.1';

/**
 * The release archive of a stub mise, and its URL and sha256; removed with `t.after`. The stub prints its version, prints
 * NODE_INSTALL for `where node`, and appends each `install` to `calls`, failing it while MISE_STUB_FAIL is set. With `lock`,
 * `mise lock` writes that text into mise.lock, and `mise install --locked node` fails, as mise does, while mise.lock pins no node.
 */
function miseRelease(t: TestContext, lock?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-mise-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'mise/bin'), { recursive: true });
  const calls = path.join(directory, 'calls.log');
  const locked = lock === undefined ? '' : ` && grep -q '^\\[\\[tools.node\\]\\]$' mise.lock`;
  const locks = lock === undefined ? '' : `  lock) echo "$*" >> '${calls}'; cat > mise.lock <<'LOCK'\n${lock}LOCK\n ;;\n`;
  writeFileSync(path.join(directory, 'mise/bin/mise'), `#!/bin/sh\ncase "$1" in\n  where) echo '${NODE_INSTALL}' ;;\n  install) echo "$*" >> '${calls}'; test -z "$MISE_STUB_FAIL"${locked} ;;\n${locks}  *) echo "${VERSION} ${ASSET[KEY]} (2026-10-11)" ;;\nesac\n`);
  chmodSync(path.join(directory, 'mise/bin/mise'), 0o755);
  const archive = path.join(directory, 'mise.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', directory, 'mise']).status, 0);
  const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const url = `https://github.com/jdx/mise/releases/download/v${VERSION}/mise-v${VERSION}-${ASSET[KEY]}.tar.gz`;
  return { archive, sha256, url, installs: () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []) };
}

/** A checkout whose npm of packageManager is installed, declaring mise with `sha256` for this platform. */
function checkout(t: TestContext, sha256: string) {
  const root = toolchainCheckout(t, {
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
  // mise installs Go, with the test sources of its distribution, under var/tools; the go.mod of var/tools makes it a module
  // of its own, which the ./... of a repository whose root is a Go module does not walk (K135).
  assert.equal(readFileSync(path.join(root, 'var/tools/go.mod'), 'utf8'), TOOLS_GO_MOD);
  const text = readFileSync(wrapper, 'utf8');
  const tools = path.join(root, 'var/tools');
  const expected = {
    MISE_DATA_DIR: path.join(tools, 'mise'),
    MISE_CACHE_DIR: path.join(tools, 'mise/cache'),
    MISE_STATE_DIR: path.join(tools, 'mise/state'),
    MISE_CONFIG_DIR: path.join(tools, 'mise/config'),
    MISE_GLOBAL_CONFIG_FILE: path.join(root, 'mise.toml'),
    MISE_LOCKED: '1',
    MISE_AUTO_INSTALL: '0',
    UV_PYTHON_DOWNLOADS: 'never',
    UV_NO_CONFIG: '1',
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
  // mise links its shims to the mise that PATH names, so the directory of the binary comes first, before this wrapper.
  assert.match(text, new RegExp(`^PATH=${escape(`'${path.join(tools, 'mise-release/mise/bin')}'`)}:"\\$PATH"$`, 'm'));
  assert.match(text, new RegExp(`^export ${Object.keys(expected).join(' ')} PATH$`, 'm'));
  assert.match(text, new RegExp(`^exec ${escape(`'${path.join(tools, 'mise-release/mise/bin/mise')}'`)} "\\$@"$`, 'm'));
  assert.equal(text.includes(homedir()), false, 'the wrapper names no directory of the home');
  // With mise, the bootstrap installs the node of mise.toml and writes its wrapper, which npm runs (K171).
  assert.deepEqual(release.installs(), ['install --locked node']);
  assert.equal(readFileSync(path.join(root, 'var/tools/bin/node'), 'utf8').split('\n').at(-2), `exec '${NODE_INSTALL}/bin/node' "$@"`);
  assert.match(readFileSync(path.join(root, 'var/tools/bin/npm'), 'utf8'), new RegExp(`^exec ${escape(`'${path.join(tools, 'bin/node')}'`)} `, 'm'));
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

test('a node that mise cannot install, as one that mise.toml or mise.lock does not declare, stops the bootstrap with the declaration to add', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, release.sha256);
  const stubs = toolchainStubs(t, { downloads: { [release.url]: release.archive } });
  const result = bootstrap(root, { ...stubs.env, MISE_STUB_FAIL: '1' });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /install --locked node ended with exit status 1; mise\.toml must declare node, the Node\.js release of the checkout, and mise\.lock must pin it \(make toolchain-lock\)/);
  assert.equal(existsSync(path.join(root, 'var/tools/bin/node')), false);
  assert.equal(existsSync(path.join(root, 'var/tools/bin/npm')), false, 'npm is installed only with the node of the checkout');
});

test('the bootstrap requires the declaration of mise', (t) => {
  const root = checkout(t, '0'.repeat(64));
  writeFileSync(path.join(root, 'config/toolchain.json'), JSON.stringify({ schema: 1 }));
  const result = bootstrap(root, process.env);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /config\/toolchain\.json declares no mise; declare its version and the sha256 of its archive of each platform/);
});

// A mise.lock that pins node for every platform of LOCK_PLATFORMS, as mise lock writes it.
const NODE_LOCK = `[[tools.node]]\nversion = "26.11.1"\nbackend = "core:node"\n\n${['linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64'].map(platform => `[tools.node."platforms.${platform}"]\nchecksum = "sha256:${'1'.repeat(64)}"\n`).join('\n')}`;

test('a checkout whose mise.lock pins no node bootstraps in the documented order: make toolchain-lock, then make install-tools TOOLS=npm (K174)', (t) => {
  const release = miseRelease(t, NODE_LOCK);
  const root = checkout(t, release.sha256);
  // A repository that takes kit 0.0.48 declares node in mise.toml; its mise.lock does not pin it yet, and var/tools holds no
  // node of the checkout. Its Makefile includes the kit.mk of the installed package.
  writeFileSync(path.join(root, 'mise.toml'), '[tools]\nnode = "26.11.1"\n');
  writeFileSync(path.join(root, 'mise.lock'), '');
  writeFileSync(path.join(root, 'Makefile'), `KIT := ${KIT}\nKIT_EXT := mts\ninclude $(KIT)/kit.mk\n`);
  const stubs = toolchainStubs(t, { downloads: { [release.url]: release.archive } });
  const make = (...goals: string[]) => spawnSync('make', ['--no-print-directory', ...goals], { cwd: root, env: stubs.env, encoding: 'utf8' });
  const lock = make('toolchain-lock');
  assert.equal(lock.status, 0, `${lock.stdout}${lock.stderr}`);
  assert.equal(readFileSync(path.join(root, 'mise.lock'), 'utf8'), NODE_LOCK);
  const install = make('install-tools', 'TOOLS=npm');
  assert.equal(install.status, 0, `${install.stdout}${install.stderr}`);
  assert.deepEqual(release.installs(), ['lock --global --platform linux-x64,linux-arm64,macos-arm64,macos-x64', 'install --locked node']);
  assert.equal(readFileSync(path.join(root, 'var/tools/bin/node'), 'utf8').split('\n').at(-2), `exec '${NODE_INSTALL}/bin/node' "$@"`);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'the bootstrap downloaded mise again');
});

test('trustConfig leaves exactly the trust of the checkout mise.toml (K397)', (t) => {
  const root = tree(t, { 'mise.toml': '[tools]\nnode = "26.11.1"\n' });
  const trusted = path.join(root, 'var/tools/mise/state/trusted-configs');
  mkdirSync(trusted, { recursive: true });
  // The records of an earlier install: the trust of the home directory, and the trust of a worktree that was removed.
  symlinkSync('/stub/home', path.join(trusted, 'Users-maxkwon-dd34fea3d53e4d0'));
  symlinkSync(path.join(root, 'gone'), path.join(trusted, 'polyspec-gone-worktree'));
  // A stub mise that records a trust as mise does: the folder of the file, or the home directory while MISE_GLOBAL_CONFIG_FILE is set.
  const binary = path.join(root, 'mise-stub');
  writeFileSync(binary, '#!/bin/sh\ndir="$MISE_STATE_DIR/trusted-configs"\nmkdir -p "$dir"\nif [ -n "${MISE_GLOBAL_CONFIG_FILE:-}" ]; then target=/stub/home; else target=$(dirname "$2"); fi\nln -sfn "$target" "$dir/$(basename "$target")-trust"\n');
  chmodSync(binary, 0o755);
  // make exports MISE_GLOBAL_CONFIG_FILE to every recipe (kit.mk), so the install of mise runs with it set.
  const saved = process.env.MISE_GLOBAL_CONFIG_FILE;
  process.env.MISE_GLOBAL_CONFIG_FILE = path.join(root, 'mise.toml');
  t.after(() => { if (saved === undefined) delete process.env.MISE_GLOBAL_CONFIG_FILE; else process.env.MISE_GLOBAL_CONFIG_FILE = saved; });
  trustConfig({ root, binary });
  const entries = readdirSync(trusted);
  assert.deepEqual(entries, [`${path.basename(root)}-trust`]);
  assert.equal(readlinkSync(path.join(trusted, entries[0] ?? '')), root, 'the one trust is the folder of the checkout mise.toml');
});
