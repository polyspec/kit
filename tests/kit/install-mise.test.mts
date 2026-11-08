// The mise of the bootstrap (scripts/kit/bootstrap/install-mise.mts, K127): first, the bootstrap installs the mise release
// that config/toolchain.json mise declares into var/tools/mise-release, and with it the node of mise.toml, which the wrapper
// var/tools/bin/node runs (K171). The archive of the platform
// is downloaded with its sha256 checked and unpacked, and the wrapper var/tools/bin/mise keeps every directory of mise under
// var/tools/mise and trusts the config of the checkout; its environment is the caller's, by default the directories of mise
// (K1092). A second run installs nothing; another digest is refused with both digests. curl is a PATH stub that copies the archive of the test, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { KIT } from './kit-tools.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseEnvironment } from '../../scripts/kit/bootstrap/install-mise.mts';
import { archiveTar, toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { lintCommands } from '../../scripts/kit/lint-steps.mts';
import { toolchainStubs } from './toolchain-stubs.mts';
import { tree } from './tree.mts';
import { initRepository } from './sandbox-repository.mts';

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
 * `mise lock` writes that text into mise.lock, and `mise install node` fails while mise.lock pins no node, as mise does with locked set.
 */
function miseRelease(t: TestContext, lock?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-mise-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'mise/bin'), { recursive: true });
  const calls = path.join(directory, 'calls.log');
  const locked = lock === undefined ? '' : ` && grep -q '^\\[\\[tools.node\\]\\]$' mise.lock`;
  const locks = lock === undefined ? '' : `  lock) echo "$*" >> '${calls}'; cat > mise.lock <<'LOCK'\n${lock}LOCK\n ;;\n`;
  writeFileSync(path.join(directory, 'mise/bin/mise'), `#!/bin/sh\ncase "$1" in\n  where) echo '${NODE_INSTALL}' ;;\n  trust) mkdir -p "$MISE_STATE_DIR/trusted-configs" && ln -sfn "$(dirname "$2")" "$MISE_STATE_DIR/trusted-configs/checkout" ;;\n  install) echo "$*" >> '${calls}'; test -z "$MISE_STUB_FAIL"${locked} ;;\n${locks}  *) echo "${VERSION} ${ASSET[KEY]} (2026-10-11)" ;;\nesac\n`);
  chmodSync(path.join(directory, 'mise/bin/mise'), 0o755);
  const archive = path.join(directory, 'mise.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', directory, 'mise']).status, 0);
  const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const url = `https://github.com/jdx/mise/releases/download/v${VERSION}/mise-v${VERSION}-${ASSET[KEY]}.tar.gz`;
  return { archive, sha256, url, installs: () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []) };
}

/** A checkout that declares npm with devEngines, without a digest, and mise with `sha256` for this platform. */
function checkout(t: TestContext, sha256: string) {
  const root = toolchainCheckout(t, {
    'package.json': '{ "devEngines": { "packageManager": { "name": "npm", "version": "12.2.0", "onFail": "error" } } }\n',
    'config/toolchain.json': JSON.stringify({ schema: 1, mise: { version: VERSION, sha256: { [KEY]: sha256 } } }),
  });
  return root;
}

// The bootstrap of kit runs in the checkout, as the install-tools recipe of a repository runs it.
const BOOTSTRAP = path.join(KIT, 'bootstrap/bootstrap.mts');
// The caller of the bootstrap exports the environment of mise of the checkout, as a recipe does (K1092); the MISE_* of the run
// of the test are not the sandbox's, so they go first.
const sandboxEnvironment = (root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('MISE_'))), ...miseEnvironment(root) });
const bootstrap = (root: string, env: NodeJS.ProcessEnv, mise: Record<string, string> = {}) => spawnSync(process.execPath, [BOOTSTRAP], { cwd: root, env: { ...sandboxEnvironment(root, env), ...mise }, encoding: 'utf8' });

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
    MISE_GLOBAL_CONFIG_FILE: path.join(root, 'mise.toml'),
    MISE_GLOBAL_CONFIG_ROOT: root,
  };
  for (const [name, value] of Object.entries(expected)) assert.match(text, new RegExp(`^${name}=${escape(`'${value}'`)}$`, 'm'), name);
  // mise links its shims to the mise that PATH names, so the directory of the binary comes first, before this wrapper.
  assert.match(text, new RegExp(`^PATH=${escape(`'${path.join(tools, 'mise-release/mise/bin')}'`)}:"\\$PATH"$`, 'm'));
  assert.match(text, new RegExp(`^export ${Object.keys(expected).join(' ')} PATH$`, 'm'));
  assert.match(text, new RegExp(`^exec ${escape(`'${path.join(tools, 'mise-release/mise/bin/mise')}'`)} "\\$@"$`, 'm'));
  assert.equal(text.includes(homedir()), false, 'the wrapper names no directory of the home');
  // With mise, the bootstrap installs the node of mise.toml and writes its wrapper, which npm runs (K171).
  assert.deepEqual(release.installs(), ['install node npm:npm']);
  assert.equal(readFileSync(path.join(root, 'var/tools/bin/node'), 'utf8').split('\n').at(-2), `exec '${NODE_INSTALL}/bin/node' "$@"`);
  assert.match(readFileSync(path.join(root, 'var/tools/bin/npm'), 'utf8'), new RegExp(`^exec ${escape(`'${NODE_INSTALL}/bin/node'`)} ${escape(`'${NODE_INSTALL}/node_modules/npm/bin/npm-cli.js'`)} `, 'm'));
  const second = bootstrap(root, stubs.env);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(`mise: ${escape(VERSION)} with the declared digest is installed in var/tools/mise-release`));
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'a second run downloads nothing');
});

test('an installed mise whose marker holds the declared digest is kept, whatever version its binary prints (K933)', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, release.sha256);
  const stubs = toolchainStubs(t, { downloads: { [release.url]: release.archive } });
  assert.equal(bootstrap(root, stubs.env).status, 0);
  assert.equal(readFileSync(path.join(root, 'var/tools/mise-release/.sha256'), 'utf8'), `${release.sha256}\n`);
  const binary = path.join(root, 'var/tools/mise-release/mise/bin/mise');
  writeFileSync(binary, readFileSync(binary, 'utf8').replaceAll(VERSION, '2026.1.1'));
  const second = bootstrap(root, stubs.env);
  assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'the marker alone keeps the install');
});

test('an installed mise whose marker holds another digest is installed again (K933)', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, release.sha256);
  const stubs = toolchainStubs(t, { downloads: { [release.url]: release.archive } });
  assert.equal(bootstrap(root, stubs.env).status, 0);
  writeFileSync(path.join(root, 'var/tools/mise-release/.sha256'), `${'0'.repeat(64)}\n`);
  const second = bootstrap(root, stubs.env);
  assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 2);
  assert.equal(readFileSync(path.join(root, 'var/tools/mise-release/.sha256'), 'utf8'), `${release.sha256}\n`);
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
  assert.match(result.stderr, /install node npm:npm ended with exit status 1; mise\.toml must declare node and npm:npm, the Node\.js and npm releases of the checkout$/m);
  assert.equal(existsSync(path.join(root, 'var/tools/bin/node')), false);
  assert.equal(existsSync(path.join(root, 'var/tools/bin/npm')), false, 'npm is installed only with the node of the checkout');
});

test('a devEngines npm without a digest bootstraps with the npm of mise.toml, and no npm of packageManager is installed (K938)', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, release.sha256);
  const stubs = toolchainStubs(t, { downloads: { [release.url]: release.archive } });
  const result = bootstrap(root, stubs.env);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(existsSync(path.join(root, 'var/tools/npm')), false, 'kit installed an npm of its own');
  assert.ok(existsSync(path.join(root, 'var/tools/bin/npm')), 'the npm wrapper of mise is written');
});

test('the bootstrap requires the declaration of mise', (t) => {
  const root = checkout(t, '0'.repeat(64));
  writeFileSync(path.join(root, 'config/toolchain.json'), JSON.stringify({ schema: 1 }));
  const result = bootstrap(root, process.env);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /config\/toolchain\.json declares no mise; declare its version and the sha256 of its archive of each platform/);
});

// K397-1: with MISE_GLOBAL_CONFIG_FILE set, mise install records the trust of the root of the global config, the home directory
// unless MISE_GLOBAL_CONFIG_ROOT names another; the checkout is that root, so the trust that mise records is its own.
test('the mise of a checkout takes the checkout as the root of its global config (K397-1)', () => {
  const root = '/work/checkout';
  assert.equal(miseEnvironment(root).MISE_GLOBAL_CONFIG_ROOT, root);
  const make = readFileSync(new URL('../../scripts/kit/kit.mk', import.meta.url), 'utf8');
  assert.match(make, /^export MISE_GLOBAL_CONFIG_ROOT := \$\(CURDIR\)$/m);
  assert.match(make, /^MISE_ENVIRONMENT := .*\bMISE_GLOBAL_CONFIG_ROOT\b/m);
});

// K858: a linked worktree runs its own tools: the data dir, the installs, the state, the shims and the global configuration are its own.
test('the mise of a worktree is its own (K858)', (t) => {
  const main = realpathSync(tree(t, { 'mise.toml': '[tools]\n', 'var/tools/mise/installs/node/26.12.0/bin/node': '' }));
  initRepository(main, '--initial-branch=main');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'base'], { cwd: main });
  const worktree = `${main}-row`;
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['worktree', 'add', '--quiet', '-b', 'fix/row-K1', worktree], { cwd: main }).status, 0);
  const environment = miseEnvironment(worktree);
  for (const [name, value] of Object.entries(environment)) assert.ok(!value.startsWith(`${main}/`), `${name} names the main checkout: ${value}`);
  assert.equal(environment.MISE_DATA_DIR, path.join(worktree, 'var/tools/mise'));
  assert.equal(environment.MISE_GLOBAL_CONFIG_FILE, path.join(worktree, 'mise.toml'));
  assert.equal(environment.MISE_GLOBAL_CONFIG_ROOT, worktree);
  assert.equal('MISE_SHARED_INSTALL_DIRS' in environment, false, 'no second store');
});

// A lint finds its tools in an absolute folder of var/tools as well as in a folder of the checkout.
test('toolsPath joins var/tools of the checkout, and lintCommands takes an absolute tool folder', (t) => {
  const outside = realpathSync(tree(t, { 'var/tools/bin/phpcs': '' }));
  assert.equal(toolsPath('/no/such/checkout', 'bin'), '/no/such/checkout/var/tools/bin');
  assert.deepEqual(lintCommands(outside, toolsPath(outside, 'bin'), ['phpcs'], 'install it'), { phpcs: path.join(outside, 'var/tools/bin/phpcs') });
  assert.deepEqual(lintCommands(outside, 'var/tools/bin', ['phpcs'], 'install it'), { phpcs: path.join(outside, 'var/tools/bin/phpcs') });
  assert.throws(() => lintCommands(outside, toolsPath(outside, 'bin'), ['phpstan'], 'install it'), /^Error: var\/tools\/bin\/phpstan is missing; install it$/);
});

test('K1092 install-mise writes only the environment of mise into its wrapper, writes no var/tools/go.mod, keeps the trusts of other checkouts, and passes no install flag', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, release.sha256);
  const trusted = path.join(root, 'var/tools/mise/state/trusted-configs');
  mkdirSync(trusted, { recursive: true });
  // A trust that mise recorded for another checkout.
  symlinkSync('/stub/other-checkout', path.join(trusted, 'other-checkout'));
  const result = bootstrap(root, toolchainStubs(t, { downloads: { [release.url]: release.archive } }).env);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const text = readFileSync(path.join(root, 'var/tools/bin/mise'), 'utf8');
  assert.match(text, new RegExp(`^export ${Object.keys(miseEnvironment(root)).join(' ')} PATH$`, 'm'));
  assert.doesNotMatch(text, /^GO/m);
  assert.equal(existsSync(path.join(root, 'var/tools/go.mod')), false);
  assert.equal(readlinkSync(path.join(trusted, 'other-checkout')), '/stub/other-checkout');
  assert.deepEqual(release.installs(), ['install node npm:npm']);
});

test('K1092 the bootstrap gives install-mise, its trust and the install of node the MISE_* environment of its caller', (t) => {
  const release = miseRelease(t);
  const root = checkout(t, release.sha256);
  const state = path.join(root, 'elsewhere/state');
  const result = bootstrap(root, toolchainStubs(t, { downloads: { [release.url]: release.archive } }).env, { MISE_STATE_DIR: state });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(readlinkSync(path.join(state, 'trusted-configs/checkout')), root, 'mise trust records the trust in the MISE_STATE_DIR of the caller');
  assert.equal(existsSync(path.join(root, 'var/tools/mise/state/trusted-configs/checkout')), false);
  assert.match(readFileSync(path.join(root, 'var/tools/bin/mise'), 'utf8'), new RegExp(`^MISE_STATE_DIR=${escape(`'${state}'`)}$`, 'm'));
});

test('the Windows bootstrap extracts with the bsdtar of Windows, which reads drive paths and zip files, not the GNU tar of Git Bash (K759)', () => {
  assert.equal(archiveTar('win32', { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(archiveTar('win32', {}), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(archiveTar('darwin', { SystemRoot: 'C:\\Windows' }), 'tar');
  assert.equal(archiveTar('linux', {}), 'tar');
});

test('miseEnvironment and kit.mk set no setting of mise or uv; the mise.toml and uv configuration of the repository decide them (K1048)', () => {
  const settings = ['MISE_LOCKED', 'MISE_AUTO_INSTALL', 'UV_PYTHON_DOWNLOADS', 'UV_NO_CONFIG', 'UV_CACHE_DIR'];
  assert.deepEqual(Object.keys(miseEnvironment('/checkout')).filter(name => settings.includes(name)), []);
  const make = readFileSync(new URL('../../scripts/kit/kit.mk', import.meta.url), 'utf8');
  assert.deepEqual(settings.filter(name => new RegExp(`\\b${name}\\b`).test(make)), []);
});
