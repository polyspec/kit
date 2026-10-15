// Tests of link.mts, the local links of 0.0.x development (K201, K201-1). The tools are stubs that answer from files of the
// fixture and log their arguments: npm (npm query), Composer (config vendor-dir, dump-autoload, install), uv (workspace dir,
// pip list, pip install, sync), go (mod edit -json, work init, list -m) and cargo (locate-project); no npm, Composer,
// Python, go or cargo runs. make is the make of the machine, on Makefiles of the fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildState, buildTargets, rebuild } from '../../scripts/kit/link-build.mts';
import { assertIgnored, isIgnored, providers, trackedManifests } from '../../scripts/kit/link-providers.mts';
import { cargo, link, linkFile, packages, unlink } from '../../scripts/kit/link.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

/** The checkout of kit. */
const KIT = fileURLToPath(new URL('../../', import.meta.url));

/** Runs git in `directory` and fails with its stderr. */
function git(directory: string, ...args: string[]) {
  const result = spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', ...args], { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** A repository `name` of `root` with `files`, all of them tracked and committed. */
function repository(root: string, name: string, files: Record<string, string>): string {
  const directory = path.join(root, name);
  initRepository(directory);
  put(directory, files);
  git(directory, 'add', '-A');
  git(directory, 'commit', '--quiet', '-m', 'files');
  return directory;
}

/** An executable stub `name` in `bin` that logs its arguments to `log` and runs `body` (sh). */
function stub(bin: string, log: string, name: string, body: string) {
  const file = path.join(bin, name);
  put(bin, { [name]: `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n` });
  chmodSync(file, 0o755);
}

/**
 * A polyspec root with the provider checkout `prov` (the npm package @polyspec/x, the Composer package polyspec/y, the
 * Python package polyspec-z, which requires polyspec-w by its release URL, polyspec-w, and the Go module
 * github.com/polyspec/prov/go) and `kit` (@polyspec/kit), and the consumer checkout `cons`, whose npm project, Composer
 * vendor (under var/contracts, where its composer.json puts it), environment and go.mod hold released 0.0.x copies; the
 * tools are stubs in `bin`, which env names.
 */
function workspace(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'tools.log');
  writeFileSync(log, '');
  const bin = path.join(root, 'bin');
  const provider = repository(root, 'prov', {
    'packages/ts/package.json': JSON.stringify({ name: '@polyspec/x', exports: { '.': './dist/index.js' } }),
    'packages/ts/src/index.ts': 'export const x = 1;\n',
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', autoload: { 'psr-4': { 'Y\\': 'src/' } } }),
    'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = ["polyspec-w @ https://example.invalid/w.whl"]\n',
    'packages/w/pyproject.toml': '[project]\nname = "polyspec-w"\nversion = "0.0.1"\n',
    'go/go.mod': 'module github.com/polyspec/prov/go\n',
    'config/release.json': JSON.stringify({ repositoryUrl: 'https://github.com/polyspec/prov' }),
    'rust/Cargo.toml': '[package]\nname = "polyspec-prov"\nversion = "0.0.1"\n',
    '.gitignore': 'dist/\nvar/\n',
  });
  const kit = repository(root, 'kit', { 'package.json': JSON.stringify({ name: '@polyspec/kit', version: '0.0.53' }), '.gitignore': 'var/\n' });
  const consumer = repository(root, 'cons', {
    'package.json': JSON.stringify({ name: 'cons', private: true, dependencies: { '@polyspec/x': '0.0.1', '@polyspec/own': '0.0.1' }, devDependencies: { '@polyspec/kit': '0.0.53' } }),
    'package-lock.json': '{}',
    'packages/own/package.json': JSON.stringify({ name: '@polyspec/own' }),
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' } }),
    'composer.lock': '{}',
    'tests/release-consumer/composer/composer.json': JSON.stringify({ require: { 'polyspec/y': '0.0.1' } }),
    'python/pyproject.toml': '[project]\nname = "cons"\nversion = "0"\ndependencies = []\n[dependency-groups]\nbase = ["polyspec_Z[extra]==0.0.1; python_version>=\'3\'"]\ntest = [{ include-group = "base" }]\n',
    'go.mod': 'module cons\n',
    'Cargo.toml': '[package]\nname = "cons"\nversion = "0.0.0"\n',
    'Cargo.lock': 'version = 4\n',
    '.gitignore': 'node_modules/\nvar/\n.venv/\n',
  });
  put(consumer, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }, { name: '@polyspec/kit', version: '0.0.53', location: 'node_modules/@polyspec/kit' }, { name: '@polyspec/own', version: '0.0.1', location: 'packages/own' }]),
    'node_modules/@polyspec/x/package.json': '{"name":"@polyspec/x","version":"0.0.1"}',
    'node_modules/@polyspec/kit/package.json': '{"name":"@polyspec/kit","version":"0.0.53"}',
    'composer-vendor-dir': 'var/contracts/vendor',
    'var/contracts/vendor/autoload.php': '',
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }] }),
    'var/contracts/vendor/polyspec/y/composer.json': '{"name":"polyspec/y"}',
    'python/.venv/pyvenv.cfg': 'home = /usr\n',
    'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '0.0.1' }, { name: 'polyspec-w', version: '0.0.1' }]),
    'go.mod.json': JSON.stringify({ Module: { Path: 'cons' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.3' }] }),
  });
  put(provider, { 'go/go.mod.json': JSON.stringify({ Module: { Path: 'github.com/polyspec/prov/go' } }) });
  stub(bin, log, 'npm', 'cat npm-query.json');
  stub(bin, log, 'composer', `if [ "$1 $4" = "config vendor-dir" ]; then cat composer-vendor-dir 2>/dev/null || echo vendor; fi`);
  stub(bin, log, 'uv', `case "$1 $2" in "workspace dir") pwd;; "pip list") cat ${JSON.stringify(path.join(consumer, 'pip-list.json'))};; esac`);
  stub(bin, log, 'go', `case "$1 $2" in "mod edit") cat "$4.json";; "work init") : > "$GOWORK";; "list -m") echo ${JSON.stringify(path.join(provider, 'go'))};; esac`);
  stub(bin, log, 'cargo', 'if [ "$1" = "locate-project" ]; then echo "$PWD/Cargo.toml"; fi');
  const env = { PATH: process.env.PATH, POLYSPEC_CHECKOUTS: root, NPM: path.join(bin, 'npm'), COMPOSER_BIN: path.join(bin, 'composer'), UV: path.join(bin, 'uv'), GO: path.join(bin, 'go'), CARGO: path.join(bin, 'cargo') };
  return { root, provider, kit, consumer, env, log: () => readFileSync(log, 'utf8') };
}

/** The lines that link prints, and its result. */
function linkLines(directories: string[], env: NodeJS.ProcessEnv, check = false) {
  const lines: string[] = [];
  const ok = link({ directories, check, print: text => lines.push(text), env });
  return { ok, text: lines.join('\n') };
}

test('without POLYSPEC_CHECKOUTS, link, check, unlink, packages and cargo change nothing and call no tool but cargo as given', (t) => {
  const { consumer, env, log } = workspace(t);
  const { POLYSPEC_CHECKOUTS: _root, ...undeclared } = env;
  assert.match(linkLines([consumer], undeclared).text, /POLYSPEC_CHECKOUTS is not set; the installs stay the locked releases/);
  assert.equal(linkLines([consumer], undeclared, true).ok, true);
  assert.equal(unlink({ directories: [consumer], print: () => {}, env: undeclared }), true);
  assert.deepEqual(packages(consumer, 'python', undeclared), []);
  assert.equal(cargo({ directory: consumer, args: ['build'], env: undeclared }), 0);
  assert.equal(log(), 'cargo build\n', 'only the cargo command as given ran');
  assert.equal(existsSync(path.join(consumer, 'var/link')), false);
  assert.equal(lstatSync(path.join(consumer, 'node_modules/@polyspec/x')).isSymbolicLink(), false);
});

test('the npm copies that npm query lists, kit installed as its released package among them, become links to the providers', (t) => {
  const { provider, kit, consumer, env } = workspace(t);
  const before = linkLines([consumer], env, true);
  assert.equal(before.ok, false);
  assert.match(before.text, /NOT linked npm {6}@polyspec\/x \(.*node_modules\/@polyspec\/x\)/);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/kit')), kit);
  assert.match(text, /own {8}npm {6}@polyspec\/own \(this repository\)/);
});

test('a package pinned at anything but 0.0.x is not linked, in each ecosystem', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '1.2.0', location: 'node_modules/@polyspec/x' }]),
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: 'v1.0.0', 'install-path': '../polyspec/y' }] }),
    'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '1.0' }, { name: 'polyspec-w', version: '0.0.1' }]),
    'go.mod.json': JSON.stringify({ Module: { Path: 'cons' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v1.0.0' }] }),
  });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked npm {6}@polyspec\/x \(pinned 1\.2\.0, not 0\.0\.x/);
  assert.match(text, /NOT linked composer polyspec\/y \(pinned v1\.0\.0, not 0\.0\.x/);
  assert.match(text, /NOT linked python {3}polyspec-z \(pinned 1\.0, not 0\.0\.x/);
  assert.match(text, /NOT linked go {7}github\.com\/polyspec\/prov\/go \(pinned v1\.0\.0, not 0\.0\.x\)/);
  assert.equal(lstatSync(path.join(consumer, 'node_modules/@polyspec/x')).isSymbolicLink(), false);
});

test('Composer links the copies of the vendor that composer config vendor-dir names, then dumps the autoloader; a release-consumer project is never linked', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'tests/release-consumer/composer/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }] }), 'tests/release-consumer/composer/vendor/polyspec/y/composer.json': '{}' });
  linkLines([consumer], env);
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')), path.join(provider, 'packages/php'));
  assert.equal(lstatSync(path.join(consumer, 'tests/release-consumer/composer/vendor/polyspec/y')).isSymbolicLink(), false);
  assert.match(log(), new RegExp(`composer dump-autoload --working-dir ${consumer}\\n`));
});

test('Composer dumps the autoloader once per project on every link run, even when nothing new is linked', (t) => {
  const { consumer, env, log } = workspace(t);
  linkLines([consumer], env);
  const dumps = () => log().split('\n').filter(item => item.startsWith('composer dump-autoload')).length;
  assert.equal(dumps(), 1);
  linkLines([consumer], env);
  assert.equal(dumps(), 2, 'the second run links nothing new, and still dumps once');
});

test('a polyspec folder that the tool does not record is a plain copy, NOT linked with its path', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'node_modules/@polyspec/x/node_modules/@polyspec/x/package.json': '{}', 'var/contracts/vendor/polyspec/copied/composer.json': '{}' });
  const { ok, text } = linkLines([consumer], env, true);
  assert.equal(ok, false);
  assert.match(text, /NOT linked npm {6}@polyspec\/x \(not recorded by npm query: .*node_modules\/@polyspec\/x\/node_modules\/@polyspec\/x\)/);
  assert.match(text, /polyspec\/copied \(a plain copy that Composer does not record: .*vendor\/polyspec\/copied\)/);
});

test('an npm copy that npm query does not record is linked only when it already is the provider; it is never linked at a guessed version', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'npm-query.json': JSON.stringify([]) });
  const other = path.join(consumer, 'elsewhere');
  put(consumer, { 'elsewhere/package.json': '{"name":"@polyspec/x"}' });
  rmSync(path.join(consumer, 'node_modules/@polyspec/x'), { recursive: true, force: true });
  symlinkSync(other, path.join(consumer, 'node_modules/@polyspec/x'));
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked npm {6}@polyspec\/x \(not recorded by npm query: .*node_modules\/@polyspec\/x\)/);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), realpathSync(other), 'the foreign link is kept');
  rmSync(path.join(consumer, 'node_modules/@polyspec/x'));
  symlinkSync(path.join(provider, 'packages/ts'), path.join(consumer, 'node_modules/@polyspec/x'));
  put(consumer, { 'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }, { name: '@polyspec/kit', version: '0.0.53', location: 'node_modules/@polyspec/kit' }]) });
  const linked = linkLines([consumer], env);
  assert.equal(linked.ok, true, linked.text);
  assert.match(linked.text, /npm {6}@polyspec\/x -> /);
  assert.doesNotMatch(linked.text, /npm {6}@polyspec\/x -> .*\(now\)/, 'the provider already is the copy: nothing is linked anew');
});

test('Python reads PEP 508 requirements and PEP 735 groups, and installs the providers editable with their dependencies and overrides', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  assert.deepEqual(packages(consumer, 'python', env), ['polyspec-z']);
  linkLines([consumer], env);
  const install = log().split('\n').find(item => item.startsWith('uv pip install')) ?? '';
  assert.ok(!install.includes('--no-deps'), install);
  assert.match(install, /--reinstall-package polyspec-w --reinstall-package polyspec-z -e \.\.\/prov\/packages\/w -e \.\.\/prov\/packages\/python$/);
  const overrides = path.join(consumer, /--overrides (\S+)/.exec(install)?.[1] ?? '');
  assert.equal(readFileSync(overrides, 'utf8'), '-e ../prov/packages/python\n-e ../prov/packages/w\n');
  assert.ok(provider);
});

test('the state of the environment comes from uv pip list: an editable install of the provider is linked', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '0.0.1', editable_project_location: path.join(provider, 'packages/python') }, { name: 'polyspec-w', version: '0.0.1', editable_project_location: path.join(provider, 'packages/w') }]) });
  const { text } = linkLines([consumer], env, true);
  assert.match(text, /linked {5}python {3}polyspec-z -> /);
  assert.match(text, /linked {5}python {3}polyspec-w -> /);
  assert.ok(!log().includes('uv pip install'));
});

test('a Python provider that uv pip list does not show is NOT linked, not installed, and nothing is installed for it', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'pip-list.json': '[]' });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked python {3}polyspec-z \(not installed in .*python\/\.venv\)/);
  assert.match(text, /NOT linked python {3}polyspec-w \(not installed in .*python\/\.venv\)/);
  assert.ok(!log().includes('uv pip install'), 'no install of a provider that is not installed');
});

test('a Composer record without install-path is NOT linked, and no folder is guessed from its name', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }] }) });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked composer polyspec\/y \(no install-path in .*var\/contracts\/vendor\/composer\/installed\.json\)/);
  assert.doesNotMatch(text, /composer polyspec\/y -> /);
  assert.equal(lstatSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')).isSymbolicLink(), false);
});

test('a composer.json whose vendor holds no installed.json is reported NOT linked, not skipped', (t) => {
  const { consumer, env } = workspace(t);
  rmSync(path.join(consumer, 'var/contracts/vendor/composer/installed.json'));
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked composer polyspec\/y \(not installed in .*var\/contracts\/vendor\)/);
});

test('a polyspec name of require-dev of a composer.json without a linked record is reported NOT linked', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' }, 'require-dev': { 'polyspec/q': '0.0.1' } }) });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked composer polyspec\/q \(no provider\)/);
});

test('a missing tool of the consumer fails with its cause', (t) => {
  const { consumer, env } = workspace(t);
  const { UV: _uv, ...noUv } = env;
  assert.throws(() => linkLines([consumer], noUv), /the links of .*cons need .*var\/tools\/mise\/shims\/uv; run make install-tools there, or give UV/);
});

test('a malformed installed.json and a failed uv workspace dir throw with their cause', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'var/contracts/vendor/composer/installed.json': '{' });
  assert.throws(() => linkLines([consumer], env), /var\/contracts\/vendor\/composer\/installed\.json holds no valid JSON/);
  put(consumer, { 'var/contracts/vendor/composer/installed.json': '{"packages":[]}' });
  stub(path.dirname(env.UV), path.join(path.dirname(path.dirname(env.UV)), 'tools.log'), 'uv', 'echo "no workspace" >&2; exit 2');
  assert.throws(() => linkLines([consumer], env), /uv workspace dir exited with 2/);
});

test('two package folders that provide one name fail with both; a repository root next to a package folder does not', (t) => {
  const { root, provider } = workspace(t);
  put(provider, { 'other/package.json': JSON.stringify({ name: '@polyspec/x' }), 'package.json': JSON.stringify({ name: '@polyspec/x' }) });
  git(provider, 'add', '-A');
  git(provider, 'commit', '--quiet', '-m', 'twice');
  assert.throws(() => providers(root, undefined, root), /npm package @polyspec\/x has two providers: .*other and .*packages\/ts|npm package @polyspec\/x has two providers: .*packages\/ts and .*other/);
});

test('two root-level providers of one name from different checkouts throw with both', (t) => {
  const { root } = workspace(t);
  const first = repository(root, 'other', { 'package.json': JSON.stringify({ name: '@polyspec/r' }) });
  const second = repository(root, 'third', { 'package.json': JSON.stringify({ name: '@polyspec/r' }) });
  assert.throws(() => providers(root, undefined, root), (error: unknown) => error instanceof Error && error.message.includes(first) && error.message.includes(second));
});

test('a root-level provider of another checkout yields to a package folder of one name', (t) => {
  const { root, provider } = workspace(t);
  repository(root, 'other', { 'package.json': JSON.stringify({ name: '@polyspec/x' }) });
  assert.equal(providers(root, undefined, root).get('npm:@polyspec/x')?.folder, path.join(provider, 'packages/ts'));
});

test('isIgnored is false outside a work tree, decided by the work tree and not by git stderr; a broken repository refuses the write', (t) => {
  const { root, consumer } = workspace(t);
  assert.equal(isIgnored(path.join(root, 'outside/var/link/go.work')), false);
  const broken = path.join(root, 'broken');
  mkdirSync(broken);
  writeFileSync(path.join(broken, '.git'), 'gitdir: /nonexistent/git-dir\n');
  assert.throws(() => assertIgnored(path.join(broken, 'var/x')), /is not ignored by Git/, 'a broken repository refuses the write');
  assert.equal(isIgnored(path.join(consumer, 'node_modules/x')), true);
});

test('link writes nothing that Git does not ignore, and names the path', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { '.gitignore': 'node_modules/\n.venv/\n' });
  assert.throws(() => linkLines([consumer], env), /cons\/var\/.* is not ignored by Git in its repository; the links write only ignored files/);
});

test('two consumers whose paths differ only by an underscore and a separator get different shared folders', (t) => {
  const { root } = workspace(t);
  const first = path.join(root, 'a_b', 'c');
  const second = path.join(root, 'a', 'b_c');
  const shared = (top: string) => path.join(root, 'kit/var/link/consumers', ...top.split(path.sep).filter(Boolean), 'go.work');
  assert.equal(linkFile(root, first, 'go.work'), shared(first));
  assert.equal(linkFile(root, second, 'go.work'), shared(second));
  assert.notEqual(linkFile(root, first, 'go.work'), linkFile(root, second, 'go.work'));
});

test('link --project handles only the manifests directly in the folder; without it a nested uninstalled project is NOT linked (not installed)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(provider, { 'packages/extra/package.json': JSON.stringify({ name: '@polyspec/extra' }) });
  git(provider, 'add', '-A');
  git(provider, 'commit', '--quiet', '-m', 'extra');
  put(consumer, { 'node/package.json': JSON.stringify({ name: 'node-app', private: true, dependencies: { '@polyspec/extra': '0.0.1' } }) });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'node');
  const whole = linkLines([consumer], env);
  assert.equal(whole.ok, false);
  assert.match(whole.text, /NOT linked npm {6}@polyspec\/extra \(not installed\)/);
  const lines: string[] = [];
  const ok = link({ directories: [consumer], project: true, check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, true, text);
  assert.doesNotMatch(text, /extra/, 'the nested project is not handled');
  assert.match(text, /npm {6}@polyspec\/x -> /);
});

test('a worktree of the consumer never links a package of its own repository, and a worktree is no provider', (t) => {
  const { root, provider, consumer, env } = workspace(t);
  git(consumer, 'worktree', 'add', '--quiet', path.join(root, 'cons-wt'));
  git(provider, 'worktree', 'add', '--quiet', path.join(root, 'prov-wt'));
  const tree = path.join(root, 'cons-wt');
  put(tree, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/own', version: '0.0.1', location: 'node_modules/@polyspec/own' }, { name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }]),
    'node_modules/@polyspec/own/package.json': '{}', 'node_modules/@polyspec/x/package.json': '{}',
    'go.mod.json': readFileSync(path.join(consumer, 'go.mod.json'), 'utf8'),
  });
  const { text } = linkLines([tree], env);
  assert.match(text, /own {8}npm {6}@polyspec\/own \(this repository\)/);
  assert.equal(lstatSync(path.join(tree, 'node_modules/@polyspec/own')).isSymbolicLink(), false);
  assert.equal(realpathSync(path.join(tree, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'), 'the main checkout provides, not prov-wt');
});

test('rebuild runs the build of a provider with POLYSPEC_CHECKOUTS unset in the child environment', (t) => {
  const { provider, env } = workspace(t);
  put(provider, { Makefile: 'release-assets: build-ts\nbuild-ts:\n\tmkdir -p var && echo "$${POLYSPEC_CHECKOUTS-unset}" > var/declared.txt\n' });
  rebuild(provider, () => {}, env);
  assert.equal(readFileSync(path.join(provider, 'var/declared.txt'), 'utf8'), 'unset\n');
});

test('a failing git ls-files throws with its cause, in the manifests and in the build inputs', (t) => {
  const { root } = workspace(t);
  const outside = path.join(root, 'not-a-repository');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }));
  assert.throws(() => trackedManifests(outside, ['package.json']), /git ls-files failed in .*not-a-repository: /);
  assert.throws(() => buildState(outside, outside), /git ls-files failed in .*not-a-repository: /);
});

test('a symbolic link loop of a polyspec folder fails the link with the system error, not as a missing folder', (t) => {
  const { consumer, env } = workspace(t);
  const folder = path.join(consumer, 'node_modules/@polyspec/x');
  rmSync(folder, { recursive: true, force: true });
  symlinkSync(folder, folder);
  assert.throws(() => linkLines([consumer], env), /ELOOP/);
});

test('link never builds; check reports a provider whose output is behind its sources as STALE and fails; rebuild records it', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(provider, { Makefile: 'release-assets: build-ts\nbuild-ts:\n\tmkdir -p packages/ts/dist && cp packages/ts/src/index.ts packages/ts/dist/index.js\n' });
  git(provider, 'add', 'Makefile');
  git(provider, 'commit', '--quiet', '-m', 'make');
  assert.deepEqual(buildTargets(provider), ['build-ts']);
  linkLines([consumer], env);
  const folder = path.join(provider, 'packages/ts');
  assert.equal(existsSync(path.join(folder, 'dist')), false, 'link built nothing');
  const stale = linkLines([consumer], env, true);
  assert.equal(stale.ok, false);
  assert.match(stale.text, /STALE {6}npm {6}@polyspec\/x -> .*: stale \(missing dist\/index\.js\); run link\.mjs rebuild /);
  rebuild(provider, () => {}, env);
  assert.equal(buildState(provider, folder), 'fresh');
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(folder, 'src/index.ts'), later, later);
  assert.equal(buildState(provider, folder), 'fresh', 'a touch is no change');
  writeFileSync(path.join(folder, 'src/index.ts'), 'export const x = 2;\n');
  utimesSync(path.join(folder, 'src/index.ts'), later, later);
  assert.match(buildState(provider, folder), /^stale \(src\/index\.ts is newer than dist\/index\.js\)$/);
});

test('a make status 2 other than a missing rule fails the build targets with its error', (t) => {
  const { provider } = workspace(t);
  put(provider, { Makefile: 'ifeq (a,a)\nbuild:\n\ttrue\n' });
  assert.throws(() => buildTargets(provider), /make -pq release-assets failed in .*endif/);
});

test('a missing prerequisite of release-assets fails with make\'s error, not as a missing target', (t) => {
  const { provider } = workspace(t);
  put(provider, { Makefile: 'release-assets: missing-dep\n\ttrue\n' });
  assert.throws(() => buildTargets(provider), /No rule to make target `missing-dep', needed by `release-assets'\./);
});

test('cargo copies the tracked lock afresh on every run and patches the URL that the provider declares', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  assert.equal(cargo({ directory: consumer, args: ['check'], env }), 0);
  const copy = path.join(consumer, 'var/link/cargo/root/Cargo.lock');
  writeFileSync(copy, 'changed\n');
  cargo({ directory: consumer, args: ['check'], env });
  assert.equal(readFileSync(copy, 'utf8'), 'version = 4\n');
  assert.match(log(), new RegExp(`patch\\."https://github\\.com/polyspec/prov"\\.polyspec-prov\\.path=${JSON.stringify(path.join(provider, 'rust')).replaceAll('.', '\\.')}`));
  rmSync(path.join(provider, 'config/release.json'));
  assert.throws(() => cargo({ directory: consumer, args: ['check'], env }), /config\/release\.json declares no repositoryUrl/);
});

test('unlink restores with each tool and reports each restore that it skips', (t) => {
  const { consumer, env, log } = workspace(t);
  rmSync(path.join(consumer, 'composer.lock'));
  const lines: string[] = [];
  assert.equal(unlink({ directories: [consumer], print: text => lines.push(text), env }), false);
  assert.match(log(), /npm ci\n/);
  assert.match(lines.join('\n'), /skipped {4}composer .*: no composer\.lock/);
  assert.match(lines.join('\n'), /skipped {4}python .*: no environment or no uv\.lock/);
});

test('a consumer that ignores no var/, as one without kit, gets its go.work under the kit checkout of the root, and link prints the GOWORK to export (K203)', (t) => {
  const { root, provider, env, log } = workspace(t);
  const flow = repository(root, 'flow', { 'go.mod': 'module flow\n' });
  put(flow, { 'go.mod.json': JSON.stringify({ Module: { Path: 'flow' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.18' }] }) });
  const { ok, text } = linkLines([flow], env);
  assert.equal(ok, true, text);
  const file = path.join(root, 'kit/var/link/consumers', ...flow.split(path.sep).filter(Boolean), 'go.work');
  assert.ok(text.includes(`export GOWORK='${file}'`), text);
  assert.ok(existsSync(file), 'go work init wrote the go.work there');
  assert.equal(existsSync(path.join(flow, 'var')), false, 'nothing is written into the consumer');
  assert.ok(log().includes(`go work init ${path.relative(path.dirname(file), flow)} ${path.relative(path.dirname(file), path.join(provider, 'go'))}\n`), log());
});

/** A copy of the Makefile of kit and of its kit.mk, with the empty folders that the build of the Makefile copies. */
function kitSandbox(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-make-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(path.join(KIT, 'Makefile'), path.join(dir, 'Makefile'));
  mkdirSync(path.join(dir, 'scripts/kit/schema'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts/kit/symbols'), { recursive: true });
  copyFileSync(path.join(KIT, 'scripts/kit/kit.mk'), path.join(dir, 'scripts/kit/kit.mk'));
  return dir;
}

test('make build restores dist when the rename of dist.next fails, and exits 1', (t) => {
  const dir = kitSandbox(t);
  put(dir, { 'node_modules/.bin/tsc': '#!/bin/sh\nmkdir -p dist.next\n', 'dist/old.js': 'old\n', 'bin/mv': '#!/bin/sh\nif [ "$1" = dist.next ] && [ "$2" = dist ]; then echo "mv: injected failure" >&2; exit 1; fi\nexec /bin/mv "$@"\n' });
  chmodSync(path.join(dir, 'node_modules/.bin/tsc'), 0o755);
  chmodSync(path.join(dir, 'bin/mv'), 0o755);
  const result = spawnSync('make', ['-C', dir, 'build'], { encoding: 'utf8', env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` } });
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /\*\*\* \[build\] Error 1/);
  assert.equal(readFileSync(path.join(dir, 'dist/old.js'), 'utf8'), 'old\n', 'the previous dist is back');
  assert.equal(existsSync(path.join(dir, 'dist.old')), false);
});

test('a release target runs with GOWORK off while the links are declared, and a Go target keeps the go.work of the links', (t) => {
  const dir = kitSandbox(t);
  const log = path.join(dir, 'node.log');
  put(dir, { 'var/link/go.work': 'go 1.22\n', 'bin/node': `#!/bin/sh\necho "$* GOWORK=$GOWORK" >> ${JSON.stringify(log)}\n` });
  chmodSync(path.join(dir, 'bin/node'), 0o755);
  const make = (...goals: string[]) => spawnSync('make', ['-C', dir, `NODE=${path.join(dir, 'bin/node')}`, ...goals], { encoding: 'utf8', env: { ...process.env, POLYSPEC_CHECKOUTS: dir, TAG: 'v0.0.1' } });
  assert.equal(make('release-assets').status, 0);
  assert.equal(make('kit-fixture-record').status, 0);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.match(lines[0] ?? '', /assets v0\.0\.1 GOWORK=off$/);
  assert.match(lines[1] ?? '', new RegExp(`record-fixture\\.mts GOWORK=${RegExp.escape(path.join(dir, 'var/link/go.work'))}$`));
});

test('the GOWORK that link prints is shell-quoted, so a path with a space exports as one value', (t) => {
  const { root, env } = workspace(t);
  const flow = repository(root, 'my flow', { 'go.mod': 'module flow\n' });
  put(flow, { 'go.mod.json': JSON.stringify({ Module: { Path: 'flow' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.18' }] }) });
  const { ok, text } = linkLines([flow], env);
  assert.equal(ok, true, text);
  const file = path.join(root, 'kit/var/link/consumers', ...flow.split(path.sep).filter(Boolean), 'go.work');
  const printed = /^ {2}export GOWORK=(.*)$/m.exec(text)?.[1] ?? '';
  assert.equal(printed, `'${file}'`);
  const shell = spawnSync('sh', ['-c', `printf %s ${printed}`], { encoding: 'utf8' });
  assert.equal(shell.stdout, file);
});
