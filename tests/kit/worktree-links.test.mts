// Tests of scripts/kit/worktree-links.mts (K1226): a worktree gets a node_modules that is a directory of links to the entries of its
// main checkout, and each package that its own workspace manifests declare links into the worktree, so that the worktree runs its own
// source and installs nothing.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { linkNodeModules } from '../../scripts/kit/worktree-links.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

/** A main checkout with a workspace package `@scope/app` committed on main; removed with `t.after`. */
function repository(t: TestContext, name = 'repo'): string {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-links-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, name);
  initRepository(main, '--initial-branch=main');
  put(main, {
    'package.json': '{"name":"fixture-root","workspaces":["packages/*"]}\n',
    '.gitignore': '/node_modules/\n',
    'packages/app/package.json': '{"name":"@scope/app"}\n',
    'packages/app/index.js': 'export {};\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  return main;
}

/** The node_modules that the install of main left: two packages, a scope with two packages, the workspace link and the bin folder. */
function installMain(main: string) {
  put(main, {
    'node_modules/left-pad/package.json': '{}\n',
    'node_modules/@scope/other/package.json': '{}\n',
    'node_modules/.bin/tool': 'tool\n',
  });
  symlinkSync('../../packages/app', path.join(main, 'node_modules/@scope/app'));
}

/** A fresh worktree of main on its own branch, beside it. */
function worktreeOf(main: string, folder: string): string {
  git(main, 'worktree', 'add', '--quiet', '-b', 'feat/links', folder, 'main');
  return folder;
}

test('K1226: the worktree node_modules links every entry of main and its own workspace package', (t) => {
  const main = repository(t);
  installMain(main);
  const worktree = worktreeOf(main, path.join(path.dirname(main), 'repo-links-T1'));
  linkNodeModules(worktree);
  const nodeModules = path.join(worktree, 'node_modules');
  assert.ok(lstatSync(nodeModules).isDirectory() && !lstatSync(nodeModules).isSymbolicLink(), 'node_modules is a real directory');
  assert.equal(readlinkSync(path.join(nodeModules, 'left-pad')), path.join(main, 'node_modules/left-pad'), 'a top-level package links to main');
  assert.equal(realpathSync(path.join(nodeModules, '.bin/tool')), path.join(main, 'node_modules/.bin/tool'), 'an external bin links to main');
  assert.ok(lstatSync(path.join(nodeModules, '@scope')).isDirectory() && !lstatSync(path.join(nodeModules, '@scope')).isSymbolicLink(), 'a scope is a real directory');
  assert.equal(readlinkSync(path.join(nodeModules, '@scope/other')), path.join(main, 'node_modules/@scope/other'), 'a scoped package links to main');
  assert.equal(readlinkSync(path.join(nodeModules, '@scope/app')), path.join(worktree, 'packages/app'), 'an own workspace package links into the worktree');
  assert.equal(lstatSync(path.join(main, 'node_modules/left-pad')).isDirectory(), true, 'main keeps its own packages');
  assert.equal(readlinkSync(path.join(main, 'node_modules/@scope/app')), '../../packages/app', 'main keeps its own workspace link');
});

test('K1226: a second run leaves the same links', (t) => {
  const main = repository(t);
  installMain(main);
  const worktree = worktreeOf(main, path.join(path.dirname(main), 'repo-links-T2'));
  linkNodeModules(worktree);
  const first = readdirSync(path.join(worktree, 'node_modules')).sort();
  linkNodeModules(worktree);
  assert.deepEqual(readdirSync(path.join(worktree, 'node_modules')).sort(), first, 'the same entries');
  assert.equal(readlinkSync(path.join(worktree, 'node_modules/@scope/app')), path.join(worktree, 'packages/app'), 'the own link stays');
});

test('K1226: a main checkout without node_modules is refused, and no link is written', (t) => {
  const main = repository(t);
  const worktree = worktreeOf(main, path.join(path.dirname(main), 'repo-links-T3'));
  assert.throws(() => linkNodeModules(worktree), /node_modules is missing: the main checkout holds no node_modules/);
  assert.throws(() => lstatSync(path.join(worktree, 'node_modules')), /ENOENT/, 'the worktree has no node_modules');
});

test('K1226: a worktree node_modules that holds a real package is refused', (t) => {
  const main = repository(t);
  installMain(main);
  const worktree = worktreeOf(main, path.join(path.dirname(main), 'repo-links-T4'));
  mkdirSync(path.join(worktree, 'node_modules/real'), { recursive: true });
  writeFileSync(path.join(worktree, 'node_modules/real/index.js'), 'x\n');
  assert.throws(() => linkNodeModules(worktree), /node_modules\/real holds an installed package, not a link/);
});


test('K1237: workspace bins execute worktree source and retain external bins', (t) => {
  const main = repository(t);
  put(main, { 'packages/app/cli.mjs': "console.log('main');\n" });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'cli');
  installMain(main);
  symlinkSync('../../packages/app/cli.mjs', path.join(main, 'node_modules/.bin/app'));
  const original = readlinkSync(path.join(main, 'node_modules/.bin/app'));
  const worktree = worktreeOf(main, path.join(path.dirname(main), 'repo-bin-T1'));
  put(worktree, { 'packages/app/cli.mjs': "console.log('worktree');\n" });
  for (let run = 0; run < 2; run++) {
    linkNodeModules(worktree);
    const bins = path.join(worktree, 'node_modules/.bin');
    assert.equal(realpathSync(path.join(bins, 'app')), path.join(worktree, 'packages/app/cli.mjs'));
    const result = spawnSync(process.execPath, [path.join(bins, 'app')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'worktree\n');
    assert.equal(realpathSync(path.join(bins, 'tool')), path.join(main, 'node_modules/.bin/tool'));
    assert.equal(readlinkSync(path.join(main, 'node_modules/.bin/app')), original);
  }
});
