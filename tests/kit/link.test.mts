// Tests of link.mts, the local links of 0.0.x development (K201): without POLYSPEC_CHECKOUTS nothing changes; with it, the
// installed copies that npm's hidden lockfile and Composer's installed.json record become links to the provider folders of
// the main checkouts under the root, a package of the consumer's own repository is never linked, also from a worktree of
// it, a worktree is never a provider, the uv install takes the providers editable with an --overrides file, and a linked
// npm provider whose inputs changed since its recorded build is stale. uv is a stub that logs its arguments; no go, npm,
// Composer or Python runs. make is the make of the machine, on Makefiles of the fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { buildState, buildTargets } from '../../scripts/kit/link-build.mts';
import { link, packages } from '../../scripts/kit/link.mts';
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

/**
 * A polyspec root with the provider checkout `prov` (the npm package @polyspec/x in packages/ts, the Composer package
 * polyspec/y in packages/php and the Python package polyspec-z in packages/python) and the consumer checkout `cons`, whose
 * npm project and Composer vendor (under var/contracts, as COMPOSER_VENDOR_DIR places it) hold released copies.
 */
function workspace(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = repository(root, 'prov', {
    'packages/ts/package.json': JSON.stringify({ name: '@polyspec/x', exports: { '.': './dist/index.js' } }),
    'packages/ts/src/index.ts': 'export const x = 1;\n',
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', autoload: { 'psr-4': { 'Y\\': 'src/' } } }),
    'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\n',
    '.gitignore': 'dist/\nvar/\n',
  });
  const consumer = repository(root, 'cons', {
    'package.json': JSON.stringify({ name: 'cons', private: true, dependencies: { '@polyspec/x': '0.0.1', '@polyspec/own': '0.0.1' } }),
    'packages/own/package.json': JSON.stringify({ name: '@polyspec/own' }),
    'python/pyproject.toml': '[project]\nname = "cons"\nversion = "0"\ndependencies = []\n[dependency-groups]\ntest = ["polyspec-z==0.0.1"]\n',
    '.gitignore': 'node_modules/\nvar/\n.venv/\n',
  });
  put(consumer, {
    'node_modules/.package-lock.json': JSON.stringify({ packages: { 'node_modules/@polyspec/x': { version: '0.0.1' }, 'node_modules/@polyspec/own': { resolved: 'packages/own', link: true } } }),
    'node_modules/@polyspec/x/package.json': '{"name":"@polyspec/x","version":"0.0.1"}',
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', 'install-path': '../polyspec/y', autoload: { 'psr-4': { 'Y\\': 'src/' } } }] }),
    'var/contracts/vendor/polyspec/y/composer.json': '{"name":"polyspec/y"}',
    'python/.venv/pyvenv.cfg': 'home = /usr\n',
  });
  return { root, provider, consumer };
}

/** The lines that link prints, and its result. */
function linkLines(directories: string[], env: NodeJS.ProcessEnv, check = false) {
  const lines: string[] = [];
  const ok = link({ directories, check, print: text => lines.push(text), env });
  return { ok, text: lines.join('\n') };
}

/** A uv stub that logs its arguments and prints the workspace dir of a pyproject folder. */
function uvStub(root: string): { uv: string; log: string } {
  const log = path.join(root, 'uv.log');
  const uv = path.join(root, 'uv');
  writeFileSync(uv, `#!/bin/sh\necho "uv $*" >> ${JSON.stringify(log)}\nif [ "$1 $2" = "workspace dir" ]; then pwd; fi\n`);
  chmodSync(uv, 0o755);
  return { uv, log };
}

test('without POLYSPEC_CHECKOUTS, link changes nothing and says that the installs stay locked', (t) => {
  const { consumer } = workspace(t);
  const { ok, text } = linkLines([consumer], {});
  assert.equal(ok, true);
  assert.match(text, /POLYSPEC_CHECKOUTS is not set; the installs stay the locked releases/);
  assert.equal(lstatSync(path.join(consumer, 'node_modules/@polyspec/x')).isSymbolicLink(), false);
  assert.equal(lstatSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')).isSymbolicLink(), false);
});

test('with the root declared, the recorded npm and Composer copies become links to the provider folders', (t) => {
  const { root, provider, consumer } = workspace(t);
  const { uv } = uvStub(root);
  const env = { POLYSPEC_CHECKOUTS: root, UV: uv, PATH: process.env.PATH };
  const before = linkLines([consumer], env, true);
  assert.equal(before.ok, false);
  assert.match(before.text, /NOT linked npm {6}@polyspec\/x/);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')), path.join(provider, 'packages/php'));
  assert.match(text, /own {8}npm {6}@polyspec\/own \(this repository\)/);
  assert.match(text, /no build target; its packages ship their sources/);
});

test('a worktree of the consumer never links a package of its own repository, and a worktree is no provider', (t) => {
  const { root, provider, consumer } = workspace(t);
  git(consumer, 'worktree', 'add', '--quiet', path.join(root, 'cons-wt'));
  git(provider, 'worktree', 'add', '--quiet', path.join(root, 'prov-wt'));
  const tree = path.join(root, 'cons-wt');
  put(tree, { 'node_modules/.package-lock.json': JSON.stringify({ packages: { 'node_modules/@polyspec/own': { version: '0.0.1' }, 'node_modules/@polyspec/x': { version: '0.0.1' } } }), 'node_modules/@polyspec/own/package.json': '{}', 'node_modules/@polyspec/x/package.json': '{}' });
  // The main checkout of the consumer provides @polyspec/own, and the worktree of the provider is under the root too.
  put(consumer, { 'packages/own/package.json': JSON.stringify({ name: '@polyspec/own' }) });
  const { text } = linkLines([tree], { POLYSPEC_CHECKOUTS: root, PATH: process.env.PATH });
  assert.match(text, /own {8}npm {6}@polyspec\/own \(this repository\)/);
  assert.equal(lstatSync(path.join(tree, 'node_modules/@polyspec/own')).isSymbolicLink(), false);
  assert.equal(realpathSync(path.join(tree, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'), 'the main checkout provides, not prov-wt');
});

test('the uv install takes every linked Python provider editable, with dependencies and an --overrides file', (t) => {
  const { root, provider, consumer } = workspace(t);
  const { uv, log } = uvStub(root);
  assert.deepEqual(packages(consumer, 'python'), ['polyspec-z']);
  linkLines([consumer], { POLYSPEC_CHECKOUTS: root, UV: uv, PATH: process.env.PATH });
  const install = readFileSync(log, 'utf8').split('\n').find(item => item.startsWith('uv pip install')) ?? '';
  assert.ok(!install.includes('--no-deps'), install);
  assert.match(install, new RegExp(`--reinstall-package polyspec-z -e ${path.join(provider, 'packages/python')}`));
  const overrides = /--overrides (\S+)/.exec(install)?.[1] ?? '';
  assert.equal(readFileSync(overrides, 'utf8'), `-e ${path.join(provider, 'packages/python')}\n`);
  assert.ok(overrides.startsWith(path.join(consumer, 'var/link/')), overrides);
});

test('a provider is built with the prerequisites of its release-assets, and its output is stale only after a change of content', (t) => {
  const { provider } = workspace(t);
  writeFileSync(path.join(provider, 'Makefile'), 'release-assets: build-ts\nbuild-ts:\n\tmkdir -p packages/ts/dist && cp packages/ts/src/index.ts packages/ts/dist/index.js\n');
  git(provider, 'add', 'Makefile');
  git(provider, 'commit', '--quiet', '-m', 'make');
  assert.deepEqual(buildTargets(provider), ['build-ts']);
  const folder = path.join(provider, 'packages/ts');
  assert.match(buildState(provider, folder), /^stale \(missing dist\/index\.js\)$/);
  const { root, consumer } = { root: path.dirname(provider), consumer: path.join(path.dirname(provider), 'cons') };
  linkLines([consumer], { POLYSPEC_CHECKOUTS: root, PATH: process.env.PATH });
  assert.ok(existsSync(path.join(folder, 'dist/index.js')));
  assert.equal(buildState(provider, folder), 'fresh');
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(folder, 'src/index.ts'), later, later);
  assert.equal(buildState(provider, folder), 'fresh', 'a touch is no change');
  writeFileSync(path.join(folder, 'src/index.ts'), 'export const x = 2;\n');
  utimesSync(path.join(folder, 'src/index.ts'), later, later);
  assert.match(buildState(provider, folder), /^stale \(src\/index\.ts is newer than dist\/index\.js\)$/);
});
