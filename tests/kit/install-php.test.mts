// Tests of the discovery of PHP by install-tools (K283): the PHP of .php-version is found on the machine and written as exec
// wrappers of var/tools/bin (php, and php-config and phpize when they exist beside it), in the order of PATH php, PATH php<minor>
// and the opt/ path of Homebrew's keg php@<minor>. The machine is a sandbox PATH of fake commands: shell scripts that print
// the release they stand for, so no real PHP, Homebrew or apt is involved, and the commands never start a process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { miseStub, toolchainStubs } from './toolchain-stubs.mts';
import { tool } from './kit-tools.mts';

const INSTALL_TOOLS = import.meta.resolve('../../scripts/kit/install-tools.mts');
const start = (root: string, env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [tool(INSTALL_TOOLS)], { cwd: root, env, encoding: 'utf8' });

/** Writes the fake command `file`: `php` prints the minor for -r, `php-config` the release for --version, both their own path for --id. */
function fake(file: string, release: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const body = `case "$1" in\n  -r) printf %s '${release.split('.').slice(0, 2).join('.')}' ;;\n  --version) echo '${release}' ;;\n  --id) echo "$0" ;;\nesac\n`;
  writeFileSync(file, `#!/bin/sh\n${body}`, { mode: 0o755 });
  return file;
}

/** A checkout with .php-version `minor` and the mise stub, and a sandbox: the directories `dirs` first on a PATH with only the node of this run after them. */
function sandbox(t: TestContext, minor: string | undefined, files: Record<string, string> = {}) {
  const root = toolchainCheckout(t, { 'mise.toml': '[tools]\n', ...(minor === undefined ? {} : { '.php-version': `${minor}\n` }), ...files });
  miseStub(root);
  // PHP lint is declared by PHP itself (K614). This test stubs its Composer install so that discovery remains offline.
  const composer = path.join(root, 'var/tools/mise/shims/composer');
  mkdirSync(path.dirname(composer), { recursive: true });
  writeFileSync(composer, `#!${process.execPath}\nimport { mkdirSync, writeFileSync } from 'node:fs';\nif (process.argv[2] === 'install') {\n  mkdirSync('vendor/bin', { recursive: true });\n  for (const name of ['phpcs', 'phpstan']) writeFileSync('vendor/bin/' + name, '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });\n}\n`, { mode: 0o755 });
  const stubs = toolchainStubs(t);
  // The tools need git to find the root of the checkout; a wrapper of the git of this machine stands in the sandbox, so the
  // directory of that git, which may hold a php, is not on the PATH.
  const git = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const tools = path.join(stubs.directory, 'git-bin');
  mkdirSync(tools);
  writeFileSync(path.join(tools, 'git'), `#!/bin/sh\nexec '${git}' "$@"\n`, { mode: 0o755 });
  const machine = (...dirs: string[]) => ({ ...stubs.env, PATH: [...dirs, tools, path.dirname(process.execPath)].join(path.delimiter) });
  return { root, stubs, machine, directory: stubs.directory, bin: path.join(root, 'var/tools/bin') };
}

const quoted = (file: string) => `exec '${file}' "$@"`;
const wrapper = (bin: string, name: string) => readFileSync(path.join(bin, name), 'utf8');

test('a php on PATH of the release of .php-version is wrapped with its companions, by its absolute path and never a link (K283)', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const dir = path.join(directory, 'ci');
  for (const [name, release] of [['php', '8.4.12'], ['php-config', '8.4.12'], ['phpize', '8.4.12']] as const) fake(path.join(dir, name), release);
  const result = start(root, machine(dir));
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['php', 'php-config', 'phpize']) {
    assert.equal(lstatSync(path.join(bin, name)).isFile(), true, `${name} is a file, not a link`);
    assert.match(wrapper(bin, name), new RegExp(`^#!/bin/sh\\n# .*\\n${quoted(path.join(dir, name)).replace(/[$"*.]/g, '\\$&')}\\n$`));
  }
  assert.equal(spawnSync(path.join(bin, 'php'), ['--id'], { encoding: 'utf8' }).stdout.trim(), path.join(dir, 'php'), 'the wrapper runs the matched php');
  const second = start(root, machine(dir));
  assert.doesNotMatch(second.stdout, /wrote var\/tools\/bin\/php/, 'a second run writes nothing');
});

test('a php on PATH of another release is passed over, and the keg php@<minor> of Homebrew is wrapped by its stable opt path (K283)', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const other = path.join(directory, 'default');
  fake(path.join(other, 'php'), '8.5.1');
  const prefix = path.join(directory, 'homebrew');
  const brew = path.join(directory, 'brewbin/brew');
  mkdirSync(path.dirname(brew), { recursive: true });
  writeFileSync(brew, `#!/bin/sh\n[ "$1" = "--prefix" ] && echo '${prefix}'\n`, { mode: 0o755 });
  const keg = path.join(prefix, 'opt/php@8.4/bin');
  for (const name of ['php', 'php-config', 'phpize']) fake(path.join(keg, name), '8.4.9');
  const result = start(root, machine(other, path.dirname(brew)));
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['php', 'php-config', 'phpize']) assert.ok(wrapper(bin, name).includes(quoted(path.join(keg, name))), `${name} holds the opt path of the keg`);
  assert.doesNotMatch(wrapper(bin, 'php'), /Cellar/);
});

test('the php<minor> of apt is wrapped with its phpize<minor> and php-config<minor> under the names php, phpize and php-config (K283)', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const dir = path.join(directory, 'apt');
  for (const name of ['php8.4', 'php-config8.4', 'phpize8.4']) fake(path.join(dir, name), '8.4.7');
  const result = start(root, machine(dir));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(wrapper(bin, 'php').includes(quoted(path.join(dir, 'php8.4'))));
  assert.ok(wrapper(bin, 'php-config').includes(quoted(path.join(dir, 'php-config8.4'))));
  assert.ok(wrapper(bin, 'phpize').includes(quoted(path.join(dir, 'phpize8.4'))));
});

test('a wrapper of an earlier run is never found by discovery, which strips var/tools/bin from PATH (K283)', (t) => {
  const { root, machine, bin } = sandbox(t, '8.4');
  fake(path.join(bin, 'php'), '8.4.1');
  const result = start(root, machine(bin));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PHP 8\.4 of \.php-version was not found/);
});

test('no match fails with the attempts in order, .php-version and the install commands (K283)', (t) => {
  const { root, directory, machine } = sandbox(t, '8.4');
  fake(path.join(directory, 'default/php'), '8.5.1');
  const result = start(root, machine(path.join(directory, 'default')));
  assert.equal(result.status, 1);
  const lines = result.stderr.split('\n');
  const at = (pattern: RegExp) => lines.findIndex(line => pattern.test(line));
  assert.ok(at(/1\. php on PATH: .*php is 8\.5, not 8\.4/) >= 0, result.stderr);
  assert.ok(at(/2\. php8\.4 on PATH: not found/) > at(/1\. php on PATH/), result.stderr);
  assert.ok(at(/3\. .*opt\/php@8\.4\/bin\/php: brew is not installed/) > at(/2\. php8\.4 on PATH/), result.stderr);
  assert.match(result.stderr, /\.php-version/);
  assert.match(result.stderr, /brew install php@8\.4 or apt install php8\.4-cli/);
});

test('a companion of another release fails the install, naming php-config (K283)', (t) => {
  const { root, directory, machine } = sandbox(t, '8.4');
  const dir = path.join(directory, 'mixed');
  fake(path.join(dir, 'php'), '8.4.12');
  fake(path.join(dir, 'php-config'), '8.5.1');
  const result = start(root, machine(dir));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /php-config is 8\.5, not 8\.4/);
});

test('missing companions fail a repository with packages/php-ext, and are left out for one without (K283)', (t) => {
  const withExt = sandbox(t, '8.4', { 'packages/php-ext/src/x.c': '' });
  const dir = path.join(withExt.directory, 'bare');
  fake(path.join(dir, 'php'), '8.4.12');
  const failed = start(withExt.root, withExt.machine(dir));
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /php-ext/);
  assert.match(failed.stderr, /php8\.4-dev or brew reinstall php@8\.4/);
  const without = sandbox(t, '8.4');
  const ok = start(without.root, without.machine(dir));
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(readdirSync(without.bin).sort(), ['mise', 'php', 'phpcs', 'phpstan']);
});

test('PHP declared only by config/toolchain.json fails and requires .php-version (K283)', (t) => {
  const { root, directory, machine } = sandbox(t, undefined, { 'config/toolchain.json': JSON.stringify({ schema: 1, php: ['8.4', '8.5'] }) });
  const dir = path.join(directory, 'ci');
  fake(path.join(dir, 'php'), '8.4.12');
  const result = start(root, machine(dir));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.php-version/);
  assert.deepEqual(readdirSync(path.join(root, 'var/tools/bin')).sort(), ['mise']);
});

test('the PHP wrappers are removed when PHP is no longer declared (K283)', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const dir = path.join(directory, 'ci');
  for (const name of ['php', 'php-config', 'phpize']) fake(path.join(dir, name), '8.4.12');
  assert.equal(start(root, machine(dir)).status, 0);
  assert.deepEqual(readdirSync(bin).sort(), ['mise', 'php', 'php-config', 'phpcs', 'phpize', 'phpstan']);
  rmSync(path.join(root, '.php-version'));
  const result = start(root, machine(dir));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(bin), ['mise']);
});

test('toolchain-check refuses php-fpm and php-cgi from PATH, and install-php wraps php-fpm of the same prefix (K341)', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const prefix = path.join(directory, 'prefix');
  fake(path.join(prefix, 'bin/php'), '8.4.12');
  const fpm = fake(path.join(prefix, 'sbin/php-fpm'), '8.4.12');
  const result = start(root, machine(path.join(prefix, 'bin')));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(wrapper(bin, 'php-fpm').includes(quoted(fpm)), 'php-fpm holds the sbin of the prefix of php');
  rmSync(fpm);
  const without = start(root, machine(path.join(prefix, 'bin')));
  assert.equal(without.status, 0, without.stderr);
  assert.deepEqual(readdirSync(bin).sort(), ['mise', 'php', 'phpcs', 'phpstan'], 'no php-fpm wrapper without sbin/php-fpm, and the earlier one is removed');
});
