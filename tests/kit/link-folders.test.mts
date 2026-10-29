// Tests of the package folders of scripts/kit/link-folders.mts (K541): uv deletes and writes the files of a provider checkout through a
// directory link of a Python package folder and never through per-file links, so link makes a Python package folder a real folder of
// per-file links into the provider, and every uv install of kit first removes each link of the environment, at any depth (K539). Node
// realpaths every module file, so link makes an npm package folder of another repository a real folder of per-file links without the
// provider's node_modules, which a node run with --preserve-symlinks resolves from the consumer's node_modules (K558).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { folderFindings, linkFolders, providedFolders, releaseEnvironmentLinks } from '../../scripts/kit/link-folders.mts';
import { put } from './tree.mts';

/** A provider checkout with the Python package pkg, and a consumer whose environment holds pkg as a directory link into it. */
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'prov/src/pkg');
  put(path.join(root, 'prov'), { 'src/pkg/__init__.py': 'VALUE = "checkout"\n', 'src/pkg/sub/mod.py': 'X = 1\n', 'src/pkg/__pycache__/x.pyc': 'cache' });
  const site = path.join(root, 'cons/.venv/lib/python3.14/site-packages');
  mkdirSync(site, { recursive: true });
  const folder = path.join(site, 'pkg');
  symlinkSync(target, folder);
  return { root, target, site, folder, item: { ecosystem: 'python' as const, name: 'pkg', folder, target } };
}

test('every link of the environment that resolves outside it goes before uv, at any depth, its target kept (K541, K539)', (t) => {
  const { root, target, site } = fixture(t);
  mkdirSync(path.join(site, 'polyspec'));
  symlinkSync(target, path.join(site, 'polyspec/fixturelib'));
  mkdirSync(path.join(site, 'deep/pkg'), { recursive: true });
  symlinkSync(path.join(target, '__init__.py'), path.join(site, 'deep/pkg/__init__.py'));
  const removed = releaseEnvironmentLinks(path.join(root, 'cons'), undefined).map(file => path.relative(site, file)).sort();
  assert.deepEqual(removed, ['deep/pkg/__init__.py', 'pkg', 'polyspec/fixturelib']);
  assert.equal(readFileSync(path.join(target, '__init__.py'), 'utf8'), 'VALUE = "checkout"\n', 'the provider keeps its files');
  assert.ok(lstatSync(path.join(site, 'polyspec')).isDirectory(), 'the real namespace folder stays');
});

test('an npm package of the consumer\'s own repository stays the whole-folder link of the npm workspace (K558, K530)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-own-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, { 'packages/own/package.json': JSON.stringify({ name: '@polyspec/own', version: '0.0.1' }) });
  const folder = path.join(root, 'node_modules/@polyspec/own');
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync('../../packages/own', folder);
  const own = { ecosystem: 'npm' as const, name: '@polyspec/own', folder: path.join(root, 'packages/own'), repository: root, checkout: root };
  const folders = providedFolders(root, [own]);
  assert.deepEqual(folderFindings(root, folders), []);
  assert.deepEqual(linkFolders(folders), []);
  assert.ok(lstatSync(folder).isSymbolicLink(), 'the own package stays a directory link');
});

// K576: a consumer's test builds the per-file link tree of K558 with kit's own linkFolders, through the export of the package.
test('the package exports ./link-folders with linkFolders, providedFolders and folderFindings (K576)', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('@polyspec/kit/link-folders'); console.log([m.linkFolders, m.providedFolders, m.folderFindings].map(f => typeof f).join(' '));"], { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
  assert.equal(run.stderr.trim(), '');
  assert.equal(run.stdout.trim(), 'function function function');
});

// K591: an installed polyspec package is one symlink from its install location to the package folder of its checkout, the user's rule;
// a directory link to the provider is the linked state, for Python and for npm, and a copy becomes that one link.
test('every provided package folder is one directory symlink to its checkout\'s package folder (K591)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-one-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, { 'prov/src/pkg/__init__.py': 'X = 1\n', 'prov/packages/x/package.json': JSON.stringify({ name: '@polyspec/x' }), 'cons/node_modules/@polyspec/y/package.json': '{}' });
  const site = path.join(root, 'cons/.venv/lib/python3.14/site-packages');
  mkdirSync(site, { recursive: true });
  symlinkSync('../../../../../prov/src/pkg', path.join(site, 'pkg'));
  symlinkSync('../../../prov/packages/x', path.join(root, 'cons/node_modules/@polyspec/x'));
  const folders = [
    { ecosystem: 'python' as const, name: 'pkg', folder: path.join(site, 'pkg'), target: path.join(root, 'prov/src/pkg') },
    { ecosystem: 'npm' as const, name: '@polyspec/x', folder: path.join(root, 'cons/node_modules/@polyspec/x'), target: path.join(root, 'prov/packages/x') },
    { ecosystem: 'npm' as const, name: '@polyspec/y', folder: path.join(root, 'cons/node_modules/@polyspec/y'), target: path.join(root, 'prov/packages/x') },
  ];
  assert.deepEqual(folderFindings(root, folders.slice(0, 2)), [], 'a directory link is the linked state');
  assert.equal(linkFolders(folders).length, 1, 'only the copy changes');
  for (const item of folders) assert.ok(lstatSync(item.folder).isSymbolicLink(), `${item.name} is one symlink`);
  assert.deepEqual(folderFindings(root, folders), []);
});

// K872: the mode of a bin belongs to its provider, as its tracked mode or its build; link writes the node_modules/.bin link of the
// consumer and no file of the provider checkout, which a consumer container may mount read-only. A chmod by the owner ignores the
// write bits of the file and its folder, so the fixture reads the change time and the mode of each bin instead.
test('link writes the bin links of a linked npm package and leaves the mode of each provider bin as it is (K872)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-bin-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = { 'x-run': 'bin/run.mjs', 'x-plain': 'bin/plain.mjs' };
  put(root, { 'prov/packages/x/package.json': JSON.stringify({ name: '@polyspec/x', bin }), 'prov/packages/x/bin/run.mjs': '#!/usr/bin/env node\n',
    'prov/packages/x/bin/plain.mjs': '#!/usr/bin/env node\n' });
  const target = path.join(root, 'prov/packages/x');
  chmodSync(path.join(target, 'bin/run.mjs'), 0o755);
  chmodSync(path.join(target, 'bin/plain.mjs'), 0o644);
  const before = Object.values(bin).map(file => statSync(path.join(target, file), { bigint: true }));
  const folder = path.join(root, 'cons/node_modules/@polyspec/x');
  linkFolders([{ ecosystem: 'npm', name: '@polyspec/x', folder, target }]);
  for (const [name, file] of Object.entries(bin)) assert.equal(readlinkSync(path.join(root, 'cons/node_modules/.bin', name)), path.join('..', '@polyspec/x', file));
  const after = Object.values(bin).map(file => statSync(path.join(target, file), { bigint: true }));
  assert.deepEqual(after.map(stat => [stat.mode & 0o777n, stat.ctimeNs]), before.map(stat => [stat.mode & 0o777n, stat.ctimeNs]),
    'each provider bin keeps its mode and its change time');
});
