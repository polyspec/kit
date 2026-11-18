// Tests of the PHP of install-tools (K283, K862): the php of PATH is written as it is as exec wrappers of var/tools/bin (php,
// and php-config and phpize when they exist beside it), with no release compared and no other place searched. The machine is a
// sandbox PATH of fake commands: shell scripts that print the release they stand for, so no real PHP, Homebrew or apt is
// involved, and the commands never start a process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

test('a wrapper of an earlier run is never wrapped, as install-php strips var/tools/bin from PATH (K283)', (t) => {
  const { root, machine, bin } = sandbox(t, '8.4');
  const text = readFileSync(fake(path.join(bin, 'php-only'), '8.4.1'), 'utf8');
  const result = start(root, machine(bin));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /php is not on PATH/);
  // K1271: an existing wrapper is kept as it is, never wrapped again.
  writeFileSync(path.join(bin, 'php'), text, { mode: 0o755 });
  const kept = start(root, machine(bin));
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(wrapper(bin, 'php'), text);
});

test('no php on PATH fails with php is not on PATH, and nothing else is judged (K862)', (t) => {
  const { root, directory, machine } = sandbox(t, '8.4');
  mkdirSync(path.join(directory, 'empty'));
  const result = start(root, machine(path.join(directory, 'empty')));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /php is not on PATH/);
});

// K1117: kit knows no extension folder, so missing companions get no wrapper in any repository; the build of an extension, which
// runs phpize, fails on its own when they are missing.
test('K1117 missing companions are left out, also in a repository with an extension under packages/php-ext (K283)', (t) => {
  const withExt = sandbox(t, '8.4', { 'packages/php-ext/src/x.c': '' });
  const dir = path.join(withExt.directory, 'bare');
  fake(path.join(dir, 'php'), '8.4.12');
  const extension = start(withExt.root, withExt.machine(dir));
  assert.equal(extension.status, 0, extension.stderr);
  assert.deepEqual(readdirSync(withExt.bin).sort(), ['mise', 'php', 'phpcs', 'phpstan']);
  const without = sandbox(t, '8.4');
  const ok = start(without.root, without.machine(dir));
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(readdirSync(without.bin).sort(), ['mise', 'php', 'phpcs', 'phpstan']);
});

test('PHP declared only by config/toolchain.json wraps the php of PATH, with no .php-version required (K862)', (t) => {
  const { root, directory, machine, bin } = sandbox(t, undefined, { 'config/toolchain.json': JSON.stringify({ schema: 1, php: ['8.4', '8.5'] }) });
  const dir = path.join(directory, 'ci');
  fake(path.join(dir, 'php'), '8.4.12');
  const result = start(root, machine(dir));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(wrapper(bin, 'php').includes(quoted(path.join(dir, 'php'))));
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

test('install-php wraps php-fpm of the same prefix as php (K341)', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const prefix = path.join(directory, 'prefix');
  fake(path.join(prefix, 'bin/php'), '8.4.12');
  const fpm = fake(path.join(prefix, 'sbin/php-fpm'), '8.4.12');
  const result = start(root, machine(path.join(prefix, 'bin')));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(wrapper(bin, 'php-fpm').includes(quoted(fpm)), 'php-fpm holds the sbin of the prefix of php');
  rmSync(fpm);
  // K1271: an existing wrapper is kept, so the checkout chooses again by removing it.
  rmSync(path.join(bin, 'php'));
  const without = start(root, machine(path.join(prefix, 'bin')));
  assert.equal(without.status, 0, without.stderr);
  assert.deepEqual(readdirSync(bin).sort(), ['mise', 'php', 'phpcs', 'phpstan'], 'no php-fpm wrapper without sbin/php-fpm, and the earlier one is removed');
});

// K1293: the selected php is run before anything is written; a minor that no declared release names fails and writes nothing,
// a wrapper of another php is replaced, and a rerun with the same php writes nothing.
const escaped = (text: string) => new RegExp(text.replace(/[$"*.()[\]]/g, '\\$&'));

test('K1293: a php of another minor than .php-version fails, names its minor, path and the pin, and writes no wrapper', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const dir = path.join(directory, 'php85');
  for (const name of ['php', 'php-config', 'phpize']) fake(path.join(dir, name), '8.5.10');
  const result = start(root, machine(dir));
  assert.notEqual(result.status, 0, 'install-tools fails');
  assert.match(result.stderr, escaped(`php 8.5 (${path.join(dir, 'php')})`), 'the message names the found minor and its path');
  assert.match(result.stderr, /\.php-version declares \(8\.4\)/, 'the message names the pin');
  for (const name of ['php', 'php-config', 'phpize']) assert.equal(readdirSync(bin).includes(name), false, `no ${name} wrapper is written`);
});

test('K1293: an existing 8.5 wrapper is replaced by a rerun with an 8.4 php, with no removal by hand', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const wrong = path.join(directory, 'php85');
  const right = path.join(directory, 'php84');
  for (const name of ['php', 'php-config', 'phpize']) { fake(path.join(wrong, name), '8.5.10'); fake(path.join(right, name), '8.4.12'); }
  mkdirSync(bin, { recursive: true });
  for (const name of ['php', 'php-config', 'phpize']) writeFileSync(path.join(bin, name), `#!/bin/sh\n${quoted(path.join(wrong, name))}\n`, { mode: 0o755 });
  const result = start(root, machine(right));
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['php', 'php-config', 'phpize']) assert.match(wrapper(bin, name), escaped(quoted(path.join(right, name))), `${name} names the 8.4 ${name}`);
  assert.equal(spawnSync(path.join(bin, 'php'), ['-r', ''], { encoding: 'utf8' }).stdout, '8.4');
});

test('K1293: a rerun with the same php changes nothing', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const dir = path.join(directory, 'php84');
  for (const name of ['php', 'php-config', 'phpize']) fake(path.join(dir, name), '8.4.12');
  assert.equal(start(root, machine(dir)).status, 0);
  const before = Object.fromEntries(['php', 'php-config', 'phpize'].map(name => [name, [wrapper(bin, name), statSync(path.join(bin, name)).mtimeMs]]));
  const again = start(root, machine(dir));
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /wrote|removed/, 'the rerun writes and removes nothing');
  for (const name of ['php', 'php-config', 'phpize']) assert.deepEqual([wrapper(bin, name), statSync(path.join(bin, name)).mtimeMs], before[name]);
  assert.deepEqual(readdirSync(bin).filter(name => name.includes('.next-')), [], 'no staging file is left');
});

test('K1293: --php=<path> selects that php over the php of PATH, and its minor is checked too', (t) => {
  const { root, directory, machine, bin } = sandbox(t, '8.4');
  const onPath = path.join(directory, 'php85');
  const chosen = path.join(directory, 'opt/php@8.4/bin');
  for (const name of ['php', 'php-config', 'phpize']) { fake(path.join(onPath, name), '8.5.10'); fake(path.join(chosen, name), '8.4.12'); }
  const result = spawnSync(process.execPath, [tool(INSTALL_TOOLS), `--php=${path.join(chosen, 'php')}`], { cwd: root, env: machine(onPath), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['php', 'php-config', 'phpize']) assert.match(wrapper(bin, name), escaped(quoted(path.join(chosen, name))));
  const refused = spawnSync(process.execPath, [tool(INSTALL_TOOLS), `--php=${path.join(onPath, 'php')}`], { cwd: root, env: machine(chosen), encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, escaped(`php 8.5 (${path.join(onPath, 'php')})`));
  assert.match(wrapper(bin, 'php'), escaped(quoted(path.join(chosen, 'php'))), 'a refused php leaves the wrapper as it was');
});
