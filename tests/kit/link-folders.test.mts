// Tests of the package folders of scripts/kit/link-folders.mts (K541): uv deletes and writes the files of a provider checkout through a
// directory link of a Python package folder and never through per-file links, so link makes a Python package folder a real folder of
// per-file links into the provider, and every uv install of kit first removes each link of the environment, at any depth (K539). Node
// realpaths every module file, so link makes an npm package folder of another repository a real folder of per-file links without the
// provider's node_modules, which a node run with --preserve-symlinks resolves from the consumer's node_modules (K558).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
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

/**
 * A provider repository `prov` whose npm package @polyspec/x (packages/x) publishes dist and imports dep, with its own node_modules that
 * holds dep and a source outside files, and a consumer `cons` whose npm installed dep and holds @polyspec/x as a directory link (K558).
 */
function npmFixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-npm-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'prov/packages/x');
  put(target, {
    'package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1', type: 'module', main: 'dist/index.js', files: ['dist'] }),
    'README.md': '# x\n',
    'dist/index.js': 'import dep from "dep";\nexport default dep;\n',
    'dist/sub/part.js': 'export const part = 1;\n',
    'src/index.ts': 'export {};\n',
    'node_modules/dep/package.json': JSON.stringify({ name: 'dep', version: '1.0.0', type: 'module', main: 'index.js' }),
    'node_modules/dep/index.js': 'export default "checkout";\n',
  });
  const consumer = path.join(root, 'cons');
  put(consumer, {
    'main.mjs': 'import x from "@polyspec/x";\nprocess.stdout.write(x);\n',
    'node_modules/dep/package.json': JSON.stringify({ name: 'dep', version: '1.0.0', type: 'module', main: 'index.js' }),
    'node_modules/dep/index.js': 'export default "consumer";\n',
  });
  const folder = path.join(consumer, 'node_modules/@polyspec/x');
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(target, folder);
  const resolved = () => spawnSync(process.execPath, ['--preserve-symlinks', path.join(consumer, 'main.mjs')], { cwd: consumer, encoding: 'utf8' });
  return { root, target, consumer, folder, resolved, item: { ecosystem: 'npm' as const, name: '@polyspec/x', folder, target } };
}

test('link makes an npm package folder of another repository a folder of per-file links without the provider node_modules, so a --preserve-symlinks node resolves from the consumer (K558)', (t) => {
  const { root, target, folder, resolved, item } = npmFixture(t);
  assert.equal(resolved().stdout, 'checkout', 'the directory link resolves dep from the checkout node_modules');
  assert.deepEqual(folderFindings(root, [item]).map(line => line.replace(root, '<root>')), ['npm @polyspec/x: cons/node_modules/@polyspec/x is a directory link into the provider, through which node resolves the provider\'s node_modules; fix: make link']);
  assert.equal(linkFolders([item]).length, 1, 'the directory link is replaced');
  assert.equal(lstatSync(folder).isSymbolicLink(), false, 'the package folder is a real folder');
  for (const file of ['package.json', 'README.md', 'dist/index.js', 'dist/sub/part.js']) {
    assert.ok(lstatSync(path.join(folder, file)).isSymbolicLink(), `${file} is a link`);
    assert.equal(realpathSync(path.join(folder, file)), realpathSync(path.join(target, file)));
    assert.equal(path.isAbsolute(readlinkSync(path.join(folder, file))), false, 'the link is relative');
  }
  for (const left of ['node_modules', 'src']) assert.throws(() => lstatSync(path.join(folder, left)), /ENOENT/, `${left} is no file that the package publishes`);
  const run = resolved();
  assert.equal(run.stdout, 'consumer', `a --preserve-symlinks node resolves dep from the consumer node_modules: ${run.stderr}`);
  assert.deepEqual(folderFindings(root, [item]), [], 'the tree of links is judged linked');
  assert.deepEqual(linkFolders([item]), [], 'a second link changes nothing');
});

test('the npm tree keeps the node_modules that the consumer installed in it and names a file that a provider build adds or removes (K558)', (t) => {
  const { root, target, folder, item } = npmFixture(t);
  linkFolders([item]);
  put(folder, { 'node_modules/nested/package.json': JSON.stringify({ name: 'nested', version: '1.0.0' }) });
  assert.deepEqual(folderFindings(root, [item]), [], 'the node_modules of the consumer install is no finding');
  put(target, { 'dist/added.js': 'export const added = 1;\n', 'dist/sub/part.js': null });
  assert.deepEqual(folderFindings(root, [item]).map(line => line.replace(root, '<root>')).sort(), [
    'npm @polyspec/x: cons/node_modules/@polyspec/x/dist/sub/part.js is no file of the provider; fix: make link',
    'npm @polyspec/x: dist/added.js of the provider has no link; fix: make link',
  ]);
  linkFolders([item]);
  assert.deepEqual(folderFindings(root, [item]), [], 'make link relinks the tree');
  assert.equal(readFileSync(path.join(folder, 'dist/added.js'), 'utf8'), 'export const added = 1;\n');
  assert.ok(lstatSync(path.join(folder, 'node_modules/nested/package.json')).isFile(), 'the consumer install stays');
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder);
  put(folder, { 'package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }) });
  assert.match(folderFindings(root, [item]).join('\n'), /cons\/node_modules\/@polyspec\/x\/package\.json is a copy, not a link to /, 'a copy is a finding');
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

// K578: a package that the consumer declares itself as a file: dependency is the link that npm writes to the declared path, which the
// consumer may require as a link (limepie SK-B-7); it stays that one link, as an own workspace package does, and a tree there goes back.
test('an npm package that the consumer declares as a file: dependency stays the link to its declared path (K578)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-file-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, {
    'app/package.json': JSON.stringify({ name: '@limepie/app', version: '0.0.1' }),
    'app/index.js': 'export const app = 1;\n',
    'checks/package.json': JSON.stringify({ name: 'checks', dependencies: { '@limepie/app': 'file:var/platforms/app' } }),
  });
  mkdirSync(path.join(root, 'checks/var/platforms'), { recursive: true });
  symlinkSync(path.join(root, 'app'), path.join(root, 'checks/var/platforms/app'));
  const folder = path.join(root, 'checks/node_modules/@limepie/app');
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync('../../var/platforms/app', folder);
  const provider = { ecosystem: 'npm' as const, name: '@limepie/app', folder: path.join(root, 'app'), repository: path.join(root, 'app'), checkout: path.join(root, 'app') };
  const folders = providedFolders(path.join(root, 'checks'), [provider]);
  assert.deepEqual(folderFindings(root, folders), [], 'the declared link is no finding');
  assert.deepEqual(linkFolders(folders), [], 'link leaves it');
  assert.equal(readlinkSync(folder), '../../var/platforms/app', 'it stays the link that npm wrote');
  rmSync(folder);
  mkdirSync(folder);
  symlinkSync('../../../../app/package.json', path.join(folder, 'package.json'));
  assert.equal(linkFolders(providedFolders(path.join(root, 'checks'), [provider])).length, 1, 'a tree there is replaced');
  assert.equal(readlinkSync(folder), '../../var/platforms/app', 'by the link to the declared path');
});

// K579: a file: dependency on a tarball is no declared folder: npm unpacks the tarball into a real folder, so the package is one of another
// repository and link makes it the tree of K558, never a link to the tarball file.
test('an npm package that the consumer declares by a tarball file: dependency becomes the per-file tree of its provider (K579)', (t) => {
  const { root, target, consumer, folder } = npmFixture(t);
  put(consumer, {
    'package.json': JSON.stringify({ name: 'cons', dependencies: { '@polyspec/x': 'file:var/assets/polyspec-x-npm-0.0.1.tgz' } }),
    'var/assets/polyspec-x-npm-0.0.1.tgz': 'tarball',
  });
  rmSync(folder);
  put(folder, { 'package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }), 'dist/index.js': 'export default "copy";\n' });
  const provider = { ecosystem: 'npm' as const, name: '@polyspec/x', folder: target, repository: path.join(root, 'prov'), checkout: path.join(root, 'prov') };
  const folders = () => providedFolders(consumer, [provider]);
  assert.match(folderFindings(root, folders()).join('\n'), /cons\/node_modules\/@polyspec\/x\/package\.json is a copy, not a link to /, 'the unpacked copy is a finding of the tree');
  linkFolders(folders());
  assert.equal(lstatSync(folder).isSymbolicLink(), false, 'the package folder is a real folder, no link to the tarball');
  assert.equal(realpathSync(path.join(folder, 'dist/index.js')), realpathSync(path.join(target, 'dist/index.js')), 'its files link into the provider');
  assert.deepEqual(folderFindings(root, folders()), [], 'the tree is judged linked');
});

// K576: a consumer's test builds the per-file link tree of K558 with kit's own linkFolders, through the export of the package.
test('the package exports ./link-folders with linkFolders, providedFolders and folderFindings (K576)', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('@polyspec/kit/link-folders'); console.log([m.linkFolders, m.providedFolders, m.folderFindings].map(f => typeof f).join(' '));"], { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
  assert.equal(run.stderr.trim(), '');
  assert.equal(run.stdout.trim(), 'function function function');
});

// K574: a linked package of another repository resolves its imports from the consumer (K558), whose lock records the dependencies of
// the release; a dependency that the checkout added, and its own, are linked to the folders that the provider checkout installed.
test('link links the dependencies that a linked npm package declares and the consumer lacks, to the provider\'s installs (K574)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-deps-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, {
    'prov/.git/HEAD': 'ref: refs/heads/main\n',
    'prov/packages/x/package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1', dependencies: { 'dep-a': '1.0.0', 'dep-c': '1.0.0' } }),
    'prov/packages/x/index.js': 'export {};\n',
    'prov/node_modules/dep-a/package.json': JSON.stringify({ name: 'dep-a', version: '1.0.0', dependencies: { 'dep-b': '1.0.0' } }),
    'prov/node_modules/dep-b/package.json': JSON.stringify({ name: 'dep-b', version: '1.0.0' }),
    'prov/node_modules/dep-c/package.json': JSON.stringify({ name: 'dep-c', version: '1.0.0' }),
    'cons/package.json': JSON.stringify({ name: 'cons', dependencies: { '@polyspec/x': '0.0.1' } }),
    'cons/node_modules/@polyspec/x/package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }),
    'cons/node_modules/dep-c/package.json': JSON.stringify({ name: 'dep-c', version: '0.9.0' }),
  });
  const provider = { ecosystem: 'npm' as const, name: '@polyspec/x', folder: path.join(root, 'prov/packages/x'), repository: path.join(root, 'prov'), checkout: path.join(root, 'prov') };
  const project = path.join(root, 'cons');
  assert.match(folderFindings(root, providedFolders(project, [provider])).join('\n'), /npm dep-a: cons\/node_modules\/dep-a is missing/);
  linkFolders(providedFolders(project, [provider]));
  for (const name of ['dep-a', 'dep-b']) assert.equal(realpathSync(path.join(project, 'node_modules', name)), path.join(root, 'prov/node_modules', name), `${name} is the provider's install`);
  assert.equal(lstatSync(path.join(project, 'node_modules/dep-c')).isSymbolicLink(), false, 'a dependency that the consumer has stays');
  assert.deepEqual(folderFindings(root, providedFolders(project, [provider])), []);
});
