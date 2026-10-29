// Tests of scripts/kit/link-state-check.mts (K305-1): the link counts as the installed released version, so the check compares no
// version and no requirement; while a link exists, an installed polyspec package pinned at 0.0.x is a link that resolves, and
// a plain copy among links is a finding. Composer runs as a stub that answers `vendor` to `config vendor-dir`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { initRepository } from './sandbox-repository.mts';
import { linkFindings } from '../../scripts/kit/link-state-check.mts';
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

// K399-2: a go.work that link wrote below a tracked go.work lacks the modules of that workspace, which link uses too.
test('a git-ignored go.work below a tracked go.work that lacks the workspace modules is a finding, and passes once it uses them (K399-2)', (t) => {
  const root = tree(t, {
    '.gitignore': 'c/go.work\n',
    'go.work': 'go 1.22\n\nuse (\n\t./a\n\t./b\n)\n',
    'a/go.mod': 'module a\n',
    'b/go.mod': 'module b\n',
    'c/go.mod': 'module c\n',
    'c/go.work': 'go 1.22\n\nuse (\n\t.\n)\n',
  });
  assert.equal(spawnSync('git', ['-C', root, 'add', 'go.work']).status, 0, 'the go.work of the repository is tracked');
  const env = { ...process.env, GO: 'go' };
  assert.deepEqual(linkFindings(root, env), ['go c/go.work: does not use the modules a, b of the tracked go.work above it; Fix: make link']);
  put(root, { 'c/go.work': 'go 1.22\n\nuse (\n\t.\n\t../a\n\t../b\n)\n' });
  assert.deepEqual(linkFindings(root, env), []);
});

test('the Composer projects that kit writes are no consumer project, so a repository with only those needs no Composer (K320)', (t) => {
  const root = tree(t, { 'config/php-lint/composer.json': '{"name": "polyspec/kit-php-lint"}', 'config/phpunit/composer.json': '{"name": "polyspec/kit-phpunit"}' });
  assert.deepEqual(linkFindings(root, { ...process.env, COMPOSER_BIN: '' }), []);
});


// K594: link-state-check judges only that each install location is the right symbolic link (and go.work and the Claude Code hook): the trust of mise, a merged branch that is left and the build of a provider are no link,
// so a foreign trust and a provider that was never built are no finding. K583 builds a stale provider at its commit.
test('a foreign mise trust and a linked provider that was never built are no finding of link-state-check (K594)', (t) => {
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
  const consumer = repository('cons', { 'composer.json': JSON.stringify({ name: 'cons/app' }), 'examples/board/composer.json': JSON.stringify({ name: 'cons/board', require: { 'polyspec/z': '9.9.9' } }), '.gitignore': 'vendor/\n' });
  put(consumer, { 'examples/board/vendor/polyspec/z/composer.json': JSON.stringify({ name: 'polyspec/z', version: '9.9.9' }) });
  const findings = linkFindings(consumer).filter(line => line.includes('polyspec/z'));
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0] ?? '', /^composer polyspec\/z: examples\/board\/vendor\/polyspec\/z is a copy, not a link to /);
  rmSync(path.join(consumer, 'examples/board/vendor/polyspec/z'), { recursive: true, force: true });
  symlinkSync(path.join(provider, 'packages/php'), path.join(consumer, 'examples/board/vendor/polyspec/z'));
  assert.deepEqual(linkFindings(consumer).filter(line => line.includes('polyspec/z')), [], 'the link to the provider passes');
});

// K888: link leaves out a Python project without its environment, so the declared provider that no installed folder links is a finding.
test('a declared provider that no installed folder links is a finding in npm and Python, and its link passes (K888)', (t) => {
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
    'packages/python/pyproject.toml': '[project]\nname = "cons"\nversion = "0.0.0"\ndependencies = ["polyspec-p"]\n',
    'packages/db/package.json': JSON.stringify({ name: 'cons-db', dependencies: { '@polyspec/n': '0.0.1' } }),
    '.gitignore': '.venv/\nnode_modules/\n',
  });
  assert.deepEqual(linkFindings(consumer).filter(line => / (polyspec-p|@polyspec\/n): /.test(line)), [
    'npm @polyspec/n: no installed folder of packages/db links it; Fix: make install',
    'python polyspec-p: no installed folder of packages/python links it; Fix: make install',
  ], 'projects that were never installed end red');
  const python = (line: string) => line.startsWith('python polyspec-p');
  const site = path.join(consumer, 'packages/python/.venv/lib/python3.14/site-packages');
  mkdirSync(site, { recursive: true });
  symlinkSync(path.join(provider, 'packages/python/src/polyspec_p'), path.join(site, 'polyspec_p'));
  assert.deepEqual(linkFindings(consumer).filter(python), [], 'the link to the provider passes');
});

// K773: a tracked manifest that links a polyspec package by a path outside the repository links it a second way besides the folder link.
test('a tracked manifest path outside the repository is a finding in Composer, npm and uv, and an in-repo path, an archive and a package outside the scope pass (K773)', (t) => {
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
    `sub/pyproject.toml: polyspec-a is linked by the path ${below}`,
  ]);
});

test('a manifest path inside the repository that resolves through a link out of it is a finding, and one to a package outside the scope passes (K773)', (t) => {
  const outer = tree(t, { 'a/composer.json': '{"name":"polyspec/a"}\n', 'b/composer.json': '{"name":"other/b"}\n' });
  const root = tree(t, { '.gitignore': 'var/\n', 'composer.json': JSON.stringify({ repositories: [{ type: 'path', url: 'var/link/a' }, { type: 'path', url: 'var/link/b' }] }) });
  mkdirSync(path.join(root, 'var'), { recursive: true });
  symlinkSync(outer, path.join(root, 'var/link'));
  commitAll(root, 'fixture');
  const found = linkFindings(root, process.env).filter(item => / is linked by the path /.test(item)).map(item => item.replace(/ outside.*$/, ''));
  assert.deepEqual(found, ['composer.json: a path repository is linked by the path var/link/a']);
});
