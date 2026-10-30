// scripts/kit/kit.mk runs every tool as `$(NODE) $(KIT)/<tool>.$(KIT_EXT)`, the node of the checkout by its absolute path (K171): kit's Makefile sets the sources (scripts/kit, mts),
// a repository's kit-bootstrap.mk sets the built package (node_modules/@polyspec/kit/dist, mjs). kit.mk stops while either
// is unset, and kit-test is kit's own target, since a repository holds no tests/kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { miseEnvironment } from '../../scripts/kit/bootstrap/install-mise.mts';
import { put, tree } from './tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT_MK = path.join(ROOT, 'scripts/kit/kit.mk');
const recipes = readFileSync(KIT_MK, 'utf8').split('\n').filter(line => line.startsWith('\t')).map(line => line.replaceAll('$$(', '$('));

test('every recipe of kit.mk runs its tool through KIT and KIT_EXT, and none names scripts/kit', () => {
  const tools = recipes.filter(line => /\$\((?:BOOTSTRAP_)?NODE\) /.test(line));
  assert.ok(tools.length > 0, 'kit.mk has no recipe that runs $(NODE)');
  assert.deepEqual(recipes.filter(line => line.includes('scripts/kit')), [], 'these recipes name scripts/kit');
  assert.deepEqual(tools.filter(line => !/\$\((?:BOOTSTRAP_)?NODE\) \$\(KIT\)\/(?:bootstrap\/)?[a-z-]+\.\$\(KIT_EXT\)/.test(line)), [], 'these recipes run $(NODE) without $(KIT)/<tool>.$(KIT_EXT) or $(KIT)/bootstrap/<tool>.$(KIT_EXT)');
});

test('kit.mk runs the tools of the directory and extension that KIT and KIT_EXT name', () => {
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', KIT_MK, 'docs-check', 'KIT=node_modules/@polyspec/kit/dist', 'KIT_EXT=mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `${path.join(ROOT, 'var/tools/bin/node')} node_modules/@polyspec/kit/dist/check-documents.mjs`);
});

test('Windows Make recipes use the Node.js selected by mise and its npm CLI, which run the kit tools', (t) => {
  const tools = mkdtempSync(path.join(tmpdir(), 'kit-make-windows-sdk-'));
  t.after(() => rmSync(tools, { recursive: true, force: true }));
  const mise = path.join(tools, 'mise-release/mise/bin/mise.exe');
  mkdirSync(path.dirname(mise), { recursive: true });
  if (process.platform === 'win32') copyFileSync(process.execPath, mise);
  else writeFileSync(mise, '#!/bin/sh\nprintf \'%s\\n\' "$MISE_DATA_DIR|$MISE_CACHE_DIR|$MISE_STATE_DIR|$MISE_CONFIG_DIR|$MISE_GLOBAL_CONFIG_FILE|$MISE_GLOBAL_CONFIG_ROOT|$MISE_LOCKED|$MISE_AUTO_INSTALL|$UV_PYTHON_DOWNLOADS|$UV_NO_CONFIG|$UV_CACHE_DIR" >&2\nprintf \'%s\\n\' "$KIT_MISE_NODE_DIR"\n', { mode: 0o755 });
  const nodeDirectory = process.platform === 'win32' ? path.join(tools, 'fake-node') : 'D:\\kit-sdk\\node\\26.12.0';
  const node = process.platform === 'win32' ? path.join(nodeDirectory, 'node.exe') : path.join(ROOT, 'D:/kit-sdk/node/26.12.0/node.exe');
  mkdirSync(path.dirname(node), { recursive: true });
  if (process.platform === 'win32') copyFileSync(process.execPath, node);
  else {
    writeFileSync(node, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    t.after(() => rmSync(path.join(ROOT, 'D:'), { recursive: true, force: true }));
  }
  const where = path.join(ROOT, 'where');
  assert.equal(existsSync(where), false, 'the fixture has an uncontested name for mise where');
  t.after(() => rmSync(where, { force: true }));
  if (process.platform === 'win32') writeFileSync(where, `console.error(['MISE_DATA_DIR', 'MISE_CACHE_DIR', 'MISE_STATE_DIR', 'MISE_CONFIG_DIR', 'MISE_GLOBAL_CONFIG_FILE', 'MISE_GLOBAL_CONFIG_ROOT', 'MISE_LOCKED', 'MISE_AUTO_INSTALL', 'UV_PYTHON_DOWNLOADS', 'UV_NO_CONFIG', 'UV_CACHE_DIR'].map(name => process.env[name] ?? '').join('|'));\nconsole.log(process.env.KIT_MISE_NODE_DIR);\n`);
  const makeTools = tools.replaceAll('\\', '/');
  const makefile = readFileSync(KIT_MK, 'utf8');
  assert.match(makefile, /KIT_MISE_BINARY := .*mise\.exe/);
  assert.match(makefile, /KIT_NODE_DIRECTORY := \$\(shell \$\(KIT_MISE_ENVIRONMENT_ARGS\) "\$\(KIT_MISE_BINARY\)" where node\)/);

  const env = { ...process.env, KIT_MISE_NODE_DIR: nodeDirectory };
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', KIT_MK, 'unlink', 'KIT=scripts/kit', 'KIT_EXT=mts', 'OS=Windows_NT', `KIT_TOOLS=${makeTools}`], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /node\.exe scripts\/kit\/link\.mts unlink/, dry.stderr);
  const normalized = (value: string) => path.normalize(value.replaceAll('\\', '/'));
  const environmentLine = dry.stderr.split('\n').find(line => line.includes('|'));
  assert.ok(environmentLine, dry.stderr);
  assert.deepEqual(environmentLine.split('|'), [
    normalized(path.join(tools, 'mise')),
    normalized(path.join(tools, 'mise/cache')),
    normalized(path.join(tools, 'mise/state')),
    normalized(path.join(tools, 'mise/config')),
    normalized(path.join(ROOT, 'mise.toml')),
    normalized(ROOT),
    '1',
    '0',
    'never',
    '1',
    normalized(path.join(tools, 'mise/cache/uv')),
  ]);

  const runner = spawnSync('make', ['-n', '--no-print-directory', '-f', path.join(ROOT, 'Makefile'), 'install-packages', 'OS=Windows_NT', `KIT_TOOLS=${makeTools}`], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(runner.status, 0, runner.stdout + runner.stderr);
  assert.match(runner.stdout, /^.*node\.exe .*\/npm\/node_modules\/npm\/bin\/npm-cli\.js ci$/m);
});

test('consumer kit.mk exposes the shared PHP arginfo and selective symbol installers', () => {
  const dry = (target: string, ...args: string[]) => spawnSync('make', [
    '-n', '--no-print-directory', '-f', KIT_MK, target, 'KIT=node_modules/@polyspec/kit/dist', 'KIT_EXT=mjs', ...args,
  ], { cwd: ROOT, encoding: 'utf8' });
  const arginfo = dry('kit-install-php-arginfo');
  assert.equal(arginfo.status, 0, arginfo.stderr);
  assert.equal(arginfo.stdout.trim(), `${path.join(ROOT, 'var/tools/bin/node')} node_modules/@polyspec/kit/dist/install-php-arginfo.mjs`);
  const symbols = dry('kit-install-symbols', 'EXTRACTORS=go');
  assert.equal(symbols.status, 0, symbols.stderr);
  assert.equal(symbols.stdout.trim(), `${path.join(ROOT, 'var/tools/bin/node')} node_modules/@polyspec/kit/dist/install-symbols.mjs go`);
});

// K861: the parity tools are kit's, so install-kit installs them from the declarations of the repository, and no repository
// copies the calls into its own make install.
test('K861: install-kit installs the declared symbol extractors and, with packages/php-ext, the arginfo generator; without declarations neither', (t) => {
  const bootstrap = path.join(ROOT, 'scripts/kit/kit-bootstrap.mk');
  const makefile = `include ${bootstrap}\n`;
  const dry = (root: string) => spawnSync('make', ['-n', '--no-print-directory', 'install-kit', `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8' });
  const declared = tree(t, { Makefile: makefile, 'config/toolchain.json': JSON.stringify({ schema: 1, symbolExtractors: ['go', 'php'] }), 'packages/php-ext/src/config.m4': '' });
  const both = dry(declared);
  assert.equal(both.status, 0, both.stderr);
  assert.match(both.stdout, /install-symbols\.mts --declared$/m, 'install-symbols installs the declared extractors');
  assert.match(both.stdout, /install-php-arginfo\.mts$/m, 'the arginfo generator is installed for packages/php-ext');
  const bare = tree(t, { Makefile: makefile, 'config/toolchain.json': JSON.stringify({ schema: 1 }) });
  const none = dry(bare);
  assert.equal(none.status, 0, none.stderr);
  assert.doesNotMatch(none.stdout, /install-php-arginfo\.mts$/m, 'no arginfo generator without packages/php-ext');
});

test('kit.mk accepts a parity declaration with no implementation targets and still rejects unreadable names', (t) => {
  const root = tree(t, { 'config/parity.json': JSON.stringify({ implementations: [] }) });
  const args = ['--no-print-directory', '-n', '-f', KIT_MK, 'parity-api-check', `KIT=${path.join(ROOT, 'scripts/kit')}`, 'KIT_EXT=mts', `NODE=${process.execPath}`];
  const empty = spawnSync('make', args, { cwd: root, encoding: 'utf8' });
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
  assert.match(empty.stdout, /parity\.mts --phase api/);

  writeFileSync(path.join(root, 'config/parity.json'), '{ invalid json');
  const unreadable = spawnSync('make', args, { cwd: root, encoding: 'utf8' });
  assert.notEqual(unreadable.status, 0, unreadable.stdout + unreadable.stderr);
  assert.match(unreadable.stderr, /implementation names could not be read safely/);
});

test('link and link-check take the providers from the link declaration, not from arguments (K383, K869)', () => {
  const dryRun = (goal: string, ...args: string[]) => spawnSync('make', ['-n', '--no-print-directory', '-f', KIT_MK, goal, 'KIT=node_modules/@polyspec/kit/dist', 'KIT_EXT=mjs', ...args], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert.match(dryRun('link-check'), /link-check\.mjs$/);
  assert.match(dryRun('link'), /link\.mjs link$/);
  assert.match(dryRun('link', 'RUNTIME=ts'), /link\.mjs link --runtime ts$/);
});

test('kit.mk stops while KIT or KIT_EXT is unset', () => {
  for (const args of [[], ['KIT=scripts/kit'], ['KIT_EXT=mts']]) {
    const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', KIT_MK, 'docs-check', ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(dry.status, 2, `${args.join(' ')}: ${dry.stdout}`);
    assert.match(dry.stderr, /kit\.mk needs KIT and KIT_EXT; include it through kit-bootstrap\.mk, or set both as the Makefile of kit does/, args.join(' '));
  }
});

test('every recipe runs with the environment of mise of the checkout, and with var/tools/bin and the shims first on PATH (K127)', (t) => {
  // make names the directory by its real path.
  const root = realpathSync(tree(t, { 'Makefile': `KIT := scripts/kit\nKIT_EXT := mts\ninclude ${KIT_MK}\nshow:\n\t@env\n` }));
  const shown = spawnSync('make', ['--no-print-directory', 'show'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
  assert.equal(shown.status, 0, shown.stderr);
  const env = Object.fromEntries(shown.stdout.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  for (const [name, value] of Object.entries(miseEnvironment(root))) assert.equal(env[name], value, name);
  assert.equal(env.PATH, [path.join(root, 'var/tools/bin'), path.join(root, 'var/tools/mise/shims'), '/usr/bin', '/bin'].join(path.delimiter));
});

test('on Windows the directory of the binary of mise is on PATH beside var/tools/bin, so a shim starts mise.exe (K820)', (t) => {
  const root = realpathSync(tree(t, { 'Makefile': `KIT := scripts/kit\nKIT_EXT := mts\ninclude ${KIT_MK}\nshow:\n\t@env\n` }));
  const shown = spawnSync('make', ['--no-print-directory', 'show', 'OS=Windows_NT'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
  assert.equal(shown.status, 0, shown.stderr);
  const env = Object.fromEntries(shown.stdout.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(env.PATH, [path.join(root, 'var/tools/bin'), path.join(root, 'var/tools/mise-release/mise/bin'), path.join(root, 'var/tools/mise/shims'), '/usr/bin', '/bin'].join(path.delimiter));
});

// K858: a linked worktree runs and installs its own var/tools; its make install leaves the tools and locks of the main checkout alone.
test('a worktree runs and installs the var/tools of its own checkout, not the main one (K858)', (t) => {
  const main = realpathSync(tree(t, { 'Makefile': `KIT := scripts/kit\nKIT_EXT := mts\ninclude ${KIT_MK}\nshow:\n\t@env\n`, 'mise.toml': '[tools]\n' }));
  const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(git(main, 'add', '.').status, 0);
  assert.equal(git(main, 'commit', '--quiet', '-m', 'base').status, 0);
  const worktree = `${main}-row`;
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  assert.equal(git(main, 'worktree', 'add', '--quiet', '-b', 'fix/row-K1', worktree).status, 0);
  const shown = spawnSync('make', ['--no-print-directory', 'show'], { cwd: worktree, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
  assert.equal(shown.status, 0, shown.stderr);
  const env = Object.fromEntries(shown.stdout.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  for (const [name, value] of Object.entries(miseEnvironment(worktree))) assert.equal(env[name], value, name);
  assert.equal(env.MISE_DATA_DIR, path.join(worktree, 'var/tools/mise'));
  assert.equal(env.PATH, [path.join(worktree, 'var/tools/bin'), path.join(worktree, 'var/tools/mise/shims'), '/usr/bin', '/bin'].join(path.delimiter));
  for (const goal of [[], ['TOOLS=npm']]) {
    const install = spawnSync('make', ['-n', '--no-print-directory', 'install-tools', ...goal], { cwd: worktree, encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    assert.doesNotMatch(install.stdout, new RegExp(`${main}/`), 'the install names no file of the main checkout');
  }
});

// K887: a worktree is a checkout of its own (K858), so release-assets-fetch runs there as in any checkout and fetches what var/
// lacks.
test('a worktree runs release-assets-fetch as any checkout does (K780, K887)', (t) => {
  const main = realpathSync(tree(t, { 'Makefile': `KIT := scripts/kit\nKIT_EXT := mts\ninclude ${KIT_MK}\n`, 'mise.toml': '[tools]\n' }));
  const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(git(main, 'add', '.').status, 0);
  assert.equal(git(main, 'commit', '--quiet', '-m', 'base').status, 0);
  const worktree = `${main}-row`;
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  assert.equal(git(main, 'worktree', 'add', '--quiet', '-b', 'fix/row-K887', worktree).status, 0);
  const fetch = spawnSync('make', ['-n', '--no-print-directory', 'release-assets-fetch', 'ONLINE=online-wrapper'], { cwd: worktree, encoding: 'utf8' });
  assert.equal(fetch.status, 0, fetch.stderr);
  assert.match(fetch.stdout, /^online-wrapper \S+ scripts\/kit\/release-assets\.mts fetch$/m);
});

test('kit-test is a target of the Makefile of kit, not of kit.mk', () => {
  assert.equal(recipes.some(line => line.includes('tests/kit')), false, 'kit.mk runs tests/kit');
  const dry = spawnSync('make', ['-n', '--no-print-directory', 'kit-test'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(dry.stdout.split('\n').includes(`${path.join(ROOT, 'var/tools/bin/node')} scripts/kit/run-tests.mts node -- tests/kit`), dry.stdout);
});

/**
 * A kit checkout in a sandbox with the Makefile, run with the node of this test as NODE, since it has no var/tools, the tools and the packages of kit (the tools read JSON through ajv) and
 * `tests` as its tests/kit; a Git repository with everything committed.
 */
function kitCheckout(t: TestContext, tests: Record<string, string>) {
  const root = tree(t, {});
  cpSync(path.join(ROOT, 'Makefile'), path.join(root, 'Makefile'));
  cpSync(path.join(ROOT, 'scripts/kit'), path.join(root, 'scripts/kit'), { recursive: true });
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
  writeFileSync(path.join(root, '.gitignore'), 'var/\n/node_modules\n');
  put(root, tests);
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'kit'], { cwd: root });
  return root;
}

test('kit-test fails when its run changes the checkout, and names the path', (t) => {
  const writes = "import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('writes', () => { writeFileSync('stray.txt', 'x'); });\n";
  const root = kitCheckout(t, { 'tests/kit/writes.test.mts': writes });
  // kit-test runs the whole of tests/kit, which a CI run does (ci-only.mts).
  const run = spawnSync('make', ['--no-print-directory', 'kit-test', `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.notEqual(run.status, 0, run.stdout);
  assert.match(run.stderr, /> \?\? stray\.txt/);
  assert.match(run.stderr, /kit-test: the run changed the checkout/);
});

test('kit-test passes when its run leaves the checkout as it was', (t) => {
  const root = kitCheckout(t, { 'tests/kit/clean.test.mts': "import test from 'node:test';\ntest('clean', () => {});\n" });
  // kit-test runs the whole of tests/kit, which a CI run does (ci-only.mts).
  const run = spawnSync('make', ['--no-print-directory', 'kit-test', `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

// The vendored release workflow runs make release-prepare before release-tools (K132): kit.mk declares it as a double-colon
// target with no recipe, and a repository adds its own preparation, such as the checkout of a sibling release, with a
// release-prepare:: rule of its Makefile.
test('release-prepare does nothing by default and runs the preparation that a repository declares (K132)', (t) => {
  const root = tree(t, {});
  const bare = spawnSync('make', ['--no-print-directory', '-f', KIT_MK, 'release-prepare', 'KIT=scripts/kit', 'KIT_EXT=mts'], { cwd: root, encoding: 'utf8' });
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(bare.stdout, '');
  put(root, { Makefile: `include ${KIT_MK}\nrelease-prepare::\n\t@echo prepared $(TAG)\n` });
  const declared = spawnSync('make', ['--no-print-directory', 'release-prepare', 'KIT=scripts/kit', 'KIT_EXT=mts', 'TAG=v0.0.1'], { cwd: root, encoding: 'utf8' });
  assert.equal(declared.status, 0, declared.stderr);
  assert.equal(declared.stdout, 'prepared v0.0.1\n');
});

// K419: a repository adds its document checks after that of kit, and each runs whatever the status of the others.
test('docs-check runs the checks of DOCS_CHECKS after check-documents, each of them, and fails naming those that failed (K419)', (t) => {
  const root = tree(t, {});
  const makefile = (extra: string) => put(root, { Makefile: `include ${KIT_MK}\nDOCS_CHECKS += first-check second-check\nfirst-check:\n\t@echo first ran; ${extra}\nsecond-check:\n\t@echo second ran\n` });
  const run = () => spawnSync('make', ['--no-print-directory', 'docs-check', 'KIT=scripts/kit', 'KIT_EXT=mts', `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8' });
  makefile('exit 1');
  const failed = run();
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
  assert.match(failed.stdout + failed.stderr, /check-documents/, 'check-documents ran first');
  assert.match(failed.stdout, /first ran\n/);
  assert.match(failed.stdout, /second ran\n/, 'the second check runs although the first failed');
  assert.match(failed.stderr, /\[docs-check\] failed:.* first-check/);
  assert.doesNotMatch(failed.stderr, /failed:.*second-check/);
});

// K593: kit.mk wraps no compiler and sets no build parallelism; a checkout that declares sccache compiles as cargo does (K581 removed).
test('kit.mk sets no Rust wrapper and no cargo jobs, also for a checkout that declares sccache (K593)', (t) => {
  const root = realpathSync(tree(t, { 'Makefile': `KIT := scripts/kit\nKIT_EXT := mts\ninclude ${KIT_MK}\nshow:\n\t@env\n`, 'mise.toml': '[tools]\nsccache = "0.10.0"\n' }));
  const shown = spawnSync('make', ['--no-print-directory', 'show'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin', CARGO_BUILD_JOBS: '' } });
  assert.equal(shown.status, 0, shown.stderr);
  const env = Object.fromEntries(shown.stdout.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(env.RUSTC_WRAPPER, undefined);
  assert.equal(env.SCCACHE_DIR, undefined);
  assert.equal(env.CARGO_BUILD_JOBS ?? '', '');
});

test('K676 kit recipes do not inherit another checkout Cargo target directory', (t) => {
  const root = realpathSync(tree(t, { Makefile: `KIT := scripts/kit\nKIT_EXT := mts\ninclude ${KIT_MK}\nshow:\n\t@env\n` }));
  const home = path.join(root, 'cargo-home');
  const shown = spawnSync('make', ['--no-print-directory', 'show'], { cwd: root, encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: path.join(root, '../other/target'), CARGO_HOME: home } });
  assert.equal(shown.status, 0, shown.stderr);
  assert.doesNotMatch(shown.stdout, /^CARGO_TARGET_DIR=/m);
  assert.ok(shown.stdout.split('\n').includes(`CARGO_HOME=${home}`), shown.stdout);
});

test('a linked consumer runs the sibling kit for the whole make even after npm ci replaces node_modules/@polyspec/kit (K762)', (t) => {
  // npm ci of make install puts the packed release copy where the link was; the recursive makes after it must still include and
  // run the kit that the link named (hyper, template).
  const root = tree(t, {
    'kit/scripts/kit/kit.mk': 'show:\n\t@echo "$(KIT)|$(KIT_EXT)"\n',
    'copy/scripts/kit/kit-bootstrap.mk': 'KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))\nKIT := $(KIT_BOOTSTRAP)\nKIT_EXT := mjs\ninclude $(KIT)/kit.mk\n',
    'copy/scripts/kit/kit.mk': 'show:\n\t@echo copy\n',
    'app/Makefile': 'include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\nswap:\n\trm node_modules/@polyspec/kit && cp -R ../copy node_modules/@polyspec/kit\n\t@$(MAKE) --no-print-directory show\n',
  });
  copyFileSync(path.join(ROOT, 'scripts/kit/kit-bootstrap.mk'), path.join(root, 'kit/scripts/kit/kit-bootstrap.mk'));
  mkdirSync(path.join(root, 'app/node_modules/@polyspec'), { recursive: true });
  symlinkSync('../../../kit', path.join(root, 'app/node_modules/@polyspec/kit'));
  const result = spawnSync('make', ['--no-print-directory', 'swap'], { cwd: path.join(root, 'app'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim().split('\n').at(-1), `${realpathSync(path.join(root, 'kit/scripts/kit'))}|mts`);
});
