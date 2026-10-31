// Tests of scripts/kit/link-check.mts (K305-1, K869): the findings beside link's check, which compares no version and no requirement:
// the manifest paths of K773, the declared packages with no installed folder (K888) and the workspace hook. Composer runs as a stub
// that answers `vendor` to `config vendor-dir`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { initRepository } from './sandbox-repository.mts';
import { linkCheck, linkFindings } from '../../scripts/kit/link-check.mts';
import { put, tree } from './tree.mts';

/** Commits every file of `root` (K453 tests: the build inputs of a provider are its tracked files). */
function commitAll(root: string, message: string) {
  for (const args of [['add', '-A'], ['commit', '--quiet', '-m', message]]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${root}: ${result.stderr}`);
  }
}


// K831: a tracked lock is the record of its package manager, so no lock entry is a finding, whatever its source.
const CARGO_PATH_LOCK = 'version = 4\n\n[[package]]\nname = "app"\nversion = "0.0.0"\ndependencies = [\n "polyspec-fixture-package",\n]\n\n[[package]]\nname = "polyspec-fixture-package"\nversion = "0.0.9"\ndependencies = [\n "serde",\n]\n';

function lockFindings(t: TestContext, files: Record<string, string>, file: string) {
  const root = tree(t, { 'Cargo.toml': '[package]\nname = "app"\nversion = "0.0.0"\n', '.gitignore': 'var/\n', ...files });
  commitAll(root, 'fixture');
  return linkFindings(root, process.env).filter(finding => finding.startsWith(`${file}:`));
}

test('a tracked lock that records a polyspec package by a path or a link is no finding (K831)', (t) => {
  const linked = JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { '': {}, 'node_modules/@polyspec/x': { version: '0.0.1', link: true, resolved: 'packages/x' }, 'node_modules/@polyspec/y': { version: '0.0.1', resolved: 'file:../y' } } });
  assert.deepEqual(lockFindings(t, { 'Cargo.lock': CARGO_PATH_LOCK }, 'Cargo.lock'), []);
  assert.deepEqual(lockFindings(t, { 'package-lock.json': linked }, 'package-lock.json'), []);
});

test('the Composer projects that kit writes are no consumer project, so a repository with only those needs no Composer (K320)', (t) => {
  const root = tree(t, { 'config/php-lint/composer.json': '{"name": "polyspec/kit-php-lint"}', 'config/phpunit/composer.json': '{"name": "polyspec/kit-phpunit"}' });
  assert.deepEqual(linkFindings(root, { ...process.env, COMPOSER_BIN: '' }), []);
});


// K594: link-check judges only that each install location is the right symbolic link (and go.work and the Claude Code hook): the trust of mise, a merged branch that is left and the build of a provider are no link,
// so a foreign trust and a provider that was never built are no finding. K583 builds a stale provider at its commit.
test('a foreign mise trust and a linked provider that was never built are no finding of link-check (K594)', (t) => {
  const provider = tree(t, {
    'package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1', main: './dist/x.mjs' }),
    'Makefile': 'build:\n\tmkdir -p dist\n\tcp src/x.mjs dist/x.mjs\n',
    '.gitignore': 'dist/\nvar/\n',
    'src/x.mjs': 'export const v = 1;\n',
  });
  commitAll(provider, 'provider');
  const consumer = tree(t, { 'package.json': '{"name": "cons"}', 'mise.toml': '[tools]\nnode = "26.11.1"\n' });
  mkdirSync(path.join(consumer, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync(provider, path.join(consumer, 'node_modules/@polyspec/x'));
  const trusted = path.join(consumer, 'var/tools/mise/state/trusted-configs');
  mkdirSync(trusted, { recursive: true });
  symlinkSync(tree(t), path.join(trusted, 'Users-maxkwon-dd34fea3d53e4d0'));
  commitAll(consumer, 'consumer');
  assert.deepEqual(linkFindings(consumer, process.env), []);
});

// K448: an installed package folder that a sibling checkout provides is a link to that checkout, never a copy: a copy in the vendor of a
// nested Composer project (hyper examples/board) is a finding whatever its version, and the folder linked to its provider passes.
test('a provided package folder that is a copy is a finding, and its link to the provider passes (K448)', (t) => {
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-folders-')));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const repository = (name: string, files: Record<string, string>) => {
    const folder = path.join(workspace, name);
    mkdirSync(folder, { recursive: true });
    initRepository(folder);
    put(folder, files);
    git(folder, 'add', '-A');
    git(folder, 'commit', '--quiet', '-m', 'base');
    git(folder, 'remote', 'add', 'origin', `https://github.com/polyspec/${name}.git`);
    return folder;
  };
  const provider = repository('zrepo', { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/z' }) });
  const consumer = repository('cons', { 'composer.json': JSON.stringify({ name: 'cons/app' }), 'examples/board/composer.json': JSON.stringify({ name: 'cons/board', require: { 'polyspec/z': '9.9.9' } }), '.gitignore': 'vendor/\n.links\n' });
  put(consumer, { 'examples/board/vendor/polyspec/z/composer.json': JSON.stringify({ name: 'polyspec/z', version: '9.9.9' }), '.links': '../zrepo\n' });
  const checked = () => {
    const lines: string[] = [];
    linkCheck(consumer, false, line => lines.push(line), { ...process.env, COMPOSER_VENDOR_DIR: '' });
    return lines.filter(line => line.includes('polyspec/z'));
  };
  const findings = checked();
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0] ?? '', /NOT linked composer polyspec\/z: examples\/board\/vendor\/polyspec\/z is a copy, not a link to /);
  rmSync(path.join(consumer, 'examples/board/vendor/polyspec/z'), { recursive: true, force: true });
  symlinkSync(path.join(provider, 'packages/php'), path.join(consumer, 'examples/board/vendor/polyspec/z'));
  assert.deepEqual(checked().filter(line => /NOT linked|a link that/.test(line)), [], 'the link to the provider passes');
});

/**
 * A consumer `cons` whose packages/python declares the Python package polyspec-p of `prepo` and whose packages/db declares the npm
 * package @polyspec/n of `nrepo`, both in its link declaration and neither installed; uv is a stub that answers uv workspace dir.
 */
function unlinkedConsumer(t: TestContext, python = '') {
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-python-')));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const repository = (name: string, files: Record<string, string>) => {
    const folder = path.join(workspace, name);
    mkdirSync(folder, { recursive: true });
    initRepository(folder);
    put(folder, files);
    commitAll(folder, 'base');
    assert.equal(spawnSync('git', ['-C', folder, 'remote', 'add', 'origin', `https://github.com/polyspec/${name}.git`]).status, 0);
    return folder;
  };
  const provider = repository('prepo', { 'packages/python/pyproject.toml': '[project]\nname = "polyspec-p"\nversion = "0.0.1"\n', 'packages/python/src/polyspec_p/__init__.py': '' });
  repository('nrepo', { 'packages/js/package.json': JSON.stringify({ name: '@polyspec/n', version: '0.0.1' }) });
  const consumer = repository('cons', {
    'packages/python/pyproject.toml': `[project]\nname = "cons"\nversion = "0.0.0"\ndependencies = ["polyspec-p"]\n${python}`,
    'packages/db/package.json': JSON.stringify({ name: 'cons-db', dependencies: { '@polyspec/n': '0.0.1' } }),
    '.gitignore': '.venv/\nnode_modules/\n.links\n',
  });
  put(consumer, { '.links': '../prepo\n../nrepo\n' });
  // The fixture uv answers uv workspace dir with the project, as uv does for a project of no workspace.
  put(workspace, { 'uv': '#!/bin/sh\nif [ "$1 $2" = "workspace dir" ]; then pwd; fi\n' });
  chmodSync(path.join(workspace, 'uv'), 0o755);
  return { provider, consumer, env: { ...process.env, UV: path.join(workspace, 'uv') } };
}

// K888: link leaves out a Python project without its environment, so the declared provider that no installed folder links is a finding.
test('a declared provider that no installed folder links is a finding in npm and Python, and its link passes (K888)', (t) => {
  const { provider, consumer, env } = unlinkedConsumer(t);
  assert.deepEqual(linkFindings(consumer, env).filter(line => / (polyspec-p|@polyspec\/n): /.test(line)), [
    'npm @polyspec/n: no installed folder of packages/db links it; Fix: make install',
    'python polyspec-p: no installed folder of packages/python links it; Fix: make install',
  ], 'projects that were never installed end red');
  const python = (line: string) => line.startsWith('python polyspec-p');
  const site = path.join(consumer, 'packages/python/.venv/lib/python3.14/site-packages');
  mkdirSync(site, { recursive: true });
  symlinkSync(path.join(provider, 'packages/python/src/polyspec_p'), path.join(site, 'polyspec_p'));
  assert.deepEqual(linkFindings(consumer, env).filter(python), [], 'the link to the provider passes');
});

// K975: link-check --project judges the project as link does, by its own manifests, not every project of the repository.
test('link-check --project judges only the manifests of that project (K975)', (t) => {
  const { consumer, env } = unlinkedConsumer(t, '[tool.uv.sources]\nother = { path = "../../../other" }\n');
  const findings = (project: string) => linkFindings(consumer, env, path.join(consumer, project), true).filter(line => /polyspec-p|@polyspec\/n|other is linked/.test(line)).map(line => line.replace(/ outside.*$/, ''));
  assert.deepEqual(findings('packages/db'), ['npm @polyspec/n: no installed folder of packages/db links it; Fix: make install']);
  assert.deepEqual(findings('packages/python'), [
    'packages/python/pyproject.toml: other is linked by the path ../../../other',
    'python polyspec-p: no installed folder of packages/python links it; Fix: make install',
  ]);
});

// K890: the environment of a uv workspace member is that of its workspace root, which uv installs and link links.
test('a uv workspace member whose provider is linked in the environment of the workspace root is no finding (K890)', (t) => {
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-workspace-')));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const repository = (name: string, files: Record<string, string>) => {
    const folder = path.join(workspace, name);
    mkdirSync(folder, { recursive: true });
    initRepository(folder);
    put(folder, files);
    commitAll(folder, 'base');
    assert.equal(spawnSync('git', ['-C', folder, 'remote', 'add', 'origin', `https://github.com/polyspec/${name}.git`]).status, 0);
    return folder;
  };
  const provider = repository('prepo', { 'packages/python/pyproject.toml': '[project]\nname = "polyspec-p"\nversion = "0.0.1"\n', 'packages/python/src/polyspec_p/__init__.py': '' });
  const consumer = repository('cons', {
    'pyproject.toml': '[project]\nname = "cons"\nversion = "0.0.0"\n\n[tool.uv.workspace]\nmembers = ["member"]\n',
    'member/pyproject.toml': '[project]\nname = "cons-member"\nversion = "0.0.0"\ndependencies = ["polyspec-p"]\n',
    '.gitignore': '.venv/\nuv\n.links\n',
  });
  put(consumer, { '.links': '../prepo\n' });
  // The fixture uv answers uv workspace dir with the workspace root, as uv does for a member.
  put(consumer, { 'uv': `#!/bin/sh\nif [ "$1 $2" = "workspace dir" ]; then echo '${consumer}'; fi\n`, '.venv/pyvenv.cfg': 'fixture\n' });
  chmodSync(path.join(consumer, 'uv'), 0o755);
  const site = path.join(consumer, '.venv/lib/python3.14/site-packages');
  mkdirSync(site, { recursive: true });
  symlinkSync(path.join(provider, 'packages/python/src/polyspec_p'), path.join(site, 'polyspec_p'));
  const env = { ...process.env, UV: path.join(consumer, 'uv') };
  assert.deepEqual(linkFindings(consumer, env).filter(line => line.includes('polyspec-p')), []);
  // An environment of the member's own folder, which uv does not use for a member, changes nothing.
  put(consumer, { 'member/.venv/pyvenv.cfg': 'stray\n' });
  assert.deepEqual(linkFindings(consumer, env).filter(line => line.includes('polyspec-p')), [], 'the member is judged in the environment of the root');
  rmSync(path.join(site, 'polyspec_p'));
  assert.deepEqual(linkFindings(consumer, env).filter(line => line.includes('polyspec-p')), ['python polyspec-p: no installed folder of member links it; Fix: make install'], 'the unlinked member stays a finding');
});

// K773, K902: a tracked manifest that links a package by a path outside the repository names a dependency that a clean clone cannot reproduce.
test('a tracked manifest path outside the repository is a finding in Composer, npm and uv, and an in-repo path and an archive pass (K773, K902)', (t) => {
  const outer = tree(t, { 'composer.json': '{"name":"polyspec/a"}\n' });
  const root = tree(t, { '.gitignore': 'var/\n', 'inner/composer.json': '{"name":"polyspec/b"}\n' });
  const away = path.relative(root, outer);
  const below = path.relative(path.join(root, 'sub'), outer);
  put(root, { 'composer.json': JSON.stringify({ repositories: [{ type: 'path', url: away }, { type: 'path', url: 'inner' }] }) });
  put(root, { 'package.json': JSON.stringify({ dependencies: { '@polyspec/a': `file:${away}`, '@polyspec/b': 'file:inner', '@polyspec/c': `file:${away}/c.tgz`, d: `file:${away}` }, devDependencies: { '@polyspec/e': `link:${away}` } }) });
  put(root, { 'sub/pyproject.toml': `[project]\nname = "s"\nversion = "0.0.0"\n\n[tool.uv.sources]\npolyspec-a = { path = "${below}", editable = true }\n` });
  commitAll(root, 'fixture');
  const found = linkFindings(root, process.env).filter(item => / is linked by the path /.test(item)).map(item => item.replace(/ outside.*$/, ''));
  assert.deepEqual(found, [
    `composer.json: a path repository is linked by the path ${away}`,
    `package.json: @polyspec/a is linked by the path file:${away}`,
    `package.json: @polyspec/e is linked by the path link:${away}`,
    `package.json: d is linked by the path file:${away}`,
    `sub/pyproject.toml: polyspec-a is linked by the path ${below}`,
  ]);
});

// K976: a path is judged by its text; a folder inside the repository is the repository's own, however it fills it (a link to a sibling
// checkout in development, a copy in CI), and a path that leaves the repository after normalizing is still a finding.
test('a manifest path inside the repository passes though it resolves through a link out of it, and a path that leaves it by its text fails (K976)', (t) => {
  const outer = tree(t, { 'app/package.json': '{"name":"@limepie/app"}\n', 'a/composer.json': '{"name":"polyspec/a"}\n' });
  const root = tree(t, { '.gitignore': 'var/\n', 'inner/composer.json': '{"name":"polyspec/b"}\n' });
  const away = path.relative(path.join(root, 'inner'), outer);
  put(root, {
    'composer.json': JSON.stringify({ repositories: [{ type: 'path', url: 'var/platforms/a' }, { type: 'path', url: `inner/${away}/a` }] }),
    'package.json': JSON.stringify({ dependencies: { '@limepie/app': 'file:var/platforms/app' } }),
  });
  mkdirSync(path.join(root, 'var'), { recursive: true });
  symlinkSync(outer, path.join(root, 'var/platforms'));
  commitAll(root, 'fixture');
  const found = linkFindings(root, process.env).filter(item => / is linked by the path /.test(item)).map(item => item.replace(/ outside.*$/, ''));
  assert.deepEqual(found, [`composer.json: a path repository is linked by the path inner/${away}/a`]);
});

// K902: a path out of the repository is a dependency that a clean clone and CI cannot reproduce, whatever the package name.
test('a tracked manifest path outside the repository is a finding whatever the package name (K902)', (t) => {
  const outer = tree(t, { 'composer.json': '{"name":"other/b"}\n' });
  const root = tree(t, { '.gitignore': 'var/\n' });
  const away = path.relative(root, outer);
  const below = path.relative(path.join(root, 'sub'), outer);
  put(root, {
    'composer.json': JSON.stringify({ repositories: [{ type: 'path', url: away }] }),
    'package.json': JSON.stringify({ dependencies: { other: `file:${away}` } }),
    'sub/pyproject.toml': `[project]\nname = "s"\nversion = "0.0.0"\n\n[tool.uv.sources]\nother = { path = "${below}" }\n`,
  });
  commitAll(root, 'fixture');
  const found = linkFindings(root, process.env).filter(item => / is linked by the path /.test(item)).map(item => item.replace(/ outside.*$/, ''));
  assert.deepEqual(found, [
    `composer.json: a path repository is linked by the path ${away}`,
    `package.json: other is linked by the path file:${away}`,
    `sub/pyproject.toml: other is linked by the path ${below}`,
  ]);
});

// K869: the link declaration is a setting of the checkout, which Git ignores.
test('a link declaration that Git does not ignore is a finding (K869)', (t) => {
  const root = tree(t, { '.gitignore': 'var/\n' });
  commitAll(root, 'fixture');
  put(root, { '.links': '' });
  assert.deepEqual(linkFindings(root, process.env), [`${path.join(realpathSync(root), '.links')}: Git does not ignore the link declaration; fix: add the line /.links to the .gitignore of the repository`]);
  put(root, { '.gitignore': 'var/\n.links\n' });
  assert.deepEqual(linkFindings(root, process.env), []);
});

// K935: with no link declaration, make link links nothing (K869), so the checkout is in its release state: the own Python package
// of a project is installed editable by uv, and no folder of its environment is a link. link-check compares that state with no
// declaration and expects no own folder link.
test('with no link declaration, an own Python package installed editable is no finding of link-check (K935)', (t) => {
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-own-python-')));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const own = path.join(workspace, 'own');
  mkdirSync(own, { recursive: true });
  initRepository(own);
  put(own, {
    'packages/python/pyproject.toml': '[project]\nname = "polyspec-own"\nversion = "0.0.1"\n',
    'packages/python/src/polyspec/own/__init__.py': '',
    '.gitignore': '.venv/\n.links\nuv\n',
  });
  commitAll(own, 'base');
  assert.equal(spawnSync('git', ['-C', own, 'remote', 'add', 'origin', 'https://github.com/polyspec/own.git']).status, 0);
  // uv sync installs the project editable: its .dist-info and a .pth file in site-packages, no folder of the package.
  put(own, {
    'packages/python/.venv/pyvenv.cfg': 'fixture\n',
    'packages/python/.venv/lib/python3.14/site-packages/__editable__.polyspec_own-0.0.1.pth': `${path.join(own, 'packages/python/src')}\n`,
    'packages/python/.venv/lib/python3.14/site-packages/polyspec_own-0.0.1.dist-info/METADATA': 'Name: polyspec-own\nVersion: 0.0.1\n',
    'uv': '#!/bin/sh\nif [ "$1 $2" = "workspace dir" ]; then pwd; fi\n',
  });
  chmodSync(path.join(own, 'uv'), 0o755);
  const env = { ...process.env, UV: path.join(own, 'uv') };
  const lines: string[] = [];
  assert.equal(linkCheck(own, false, text => lines.push(text), env), true, lines.join('\n'));
  assert.deepEqual(lines.filter(line => line.includes('polyspec-own')), [], 'the own package is not demanded as a link');
  // With a declaration, link links the own package into the environment, and link-check demands that link.
  put(own, { '.links': '' });
  const declared: string[] = [];
  assert.equal(linkCheck(own, false, text => declared.push(text), env), false, declared.join('\n'));
  assert.ok(declared.some(line => line.includes('polyspec-own') && line.includes('is missing; fix: make link')), declared.join('\n'));
});
