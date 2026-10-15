// Tests of link.mts, the local links of 0.0.x development (K201, K201-1). The tools are stubs that answer from files of the
// fixture and log their arguments: npm (npm query), Composer (config vendor-dir, dump-autoload, install), uv (workspace dir,
// pip list, pip install, sync), go (mod edit -json, work init, list -m) and cargo (locate-project); no npm, Composer,
// Python, go or cargo runs. make is the make of the machine, on Makefiles of the fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { buildState, buildTargets, rebuild } from '../../scripts/kit/link-build.mts';
import { providers } from '../../scripts/kit/link-providers.mts';
import { cargo, link, packages, unlink } from '../../scripts/kit/link.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

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
    'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '0.0.1' }]),
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

test('a polyspec folder that the tool does not record is a plain copy, NOT linked with its path', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'node_modules/@polyspec/x/node_modules/@polyspec/x/package.json': '{}', 'var/contracts/vendor/polyspec/copied/composer.json': '{}' });
  const { ok, text } = linkLines([consumer], env, true);
  assert.equal(ok, false);
  assert.match(text, /@polyspec\/x \(a plain copy that npm does not record: .*node_modules\/@polyspec\/x\/node_modules\/@polyspec\/x\)/);
  assert.match(text, /polyspec\/copied \(a plain copy that Composer does not record: .*vendor\/polyspec\/copied\)/);
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

test('link writes nothing that Git does not ignore, and names the path', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { '.gitignore': 'node_modules/\n.venv/\n' });
  assert.throws(() => linkLines([consumer], env), /cons\/var\/.* is not ignored by Git in its repository; the links write only ignored files/);
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
