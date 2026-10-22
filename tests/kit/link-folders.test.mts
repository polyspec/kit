// Tests of the package folders of scripts/kit/link-folders.mts (K541): uv deletes and writes the files of a provider checkout through a
// directory link of a Python package folder and never through per-file links, so link makes a Python package folder a real folder of
// per-file links into the provider, and every uv install of kit first removes each link of the environment, at any depth (K539).
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { folderFindings, linkFolders, releaseEnvironmentLinks } from '../../scripts/kit/link-folders.mts';
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

test('link makes a Python package folder a real folder of per-file links into the provider, and judges it (K541)', (t) => {
  const { root, target, folder, item } = fixture(t);
  assert.deepEqual(folderFindings(root, [item]).map(line => line.replace(root, '<root>')), ['python pkg: cons/.venv/lib/python3.14/site-packages/pkg is a directory link into the provider, through which uv deletes its files; fix: make link']);
  assert.equal(linkFolders([item]).length, 1, 'the directory link is replaced');
  assert.equal(lstatSync(folder).isSymbolicLink(), false, 'the package folder is a real folder');
  for (const file of ['__init__.py', 'sub/mod.py']) {
    assert.ok(lstatSync(path.join(folder, file)).isSymbolicLink(), `${file} is a link`);
    assert.equal(realpathSync(path.join(folder, file)), realpathSync(path.join(target, file)));
    assert.equal(path.isAbsolute(readlinkSync(path.join(folder, file))), false, 'the link is relative');
  }
  assert.throws(() => lstatSync(path.join(folder, '__pycache__')), /ENOENT/, 'the cache of the provider is no file of the package');
  assert.deepEqual(folderFindings(root, [item]), [], 'the tree of links is judged linked');
  assert.deepEqual(linkFolders([item]), [], 'a second link changes nothing');
  put(target, { 'added.py': 'Y = 2\n' });
  assert.match(folderFindings(root, [item]).join('\n'), /added\.py of the provider has no link; fix: make link/);
  linkFolders([item]);
  assert.equal(readFileSync(path.join(folder, 'added.py'), 'utf8'), 'Y = 2\n');
  assert.equal(readFileSync(path.join(target, '__init__.py'), 'utf8'), 'VALUE = "checkout"\n', 'the provider keeps its files');
});

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
