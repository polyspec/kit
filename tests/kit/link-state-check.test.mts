// Tests of scripts/kit/link-state-check.mts (K305-1): the link counts as the installed released version, so the check compares no
// version and no requirement; while a link exists, an installed polyspec package pinned at 0.0.x is a link that resolves, and
// a plain copy among links is a finding. Composer runs as a stub that answers `vendor` to `config vendor-dir`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { rebuild } from '../../scripts/kit/link-build.mts';
import { linkFindings, lockSourceFindings } from '../../scripts/kit/link-state-check.mts';
import { put, tree } from './tree.mts';

/** Commits every file of `root` (K453 tests: the build inputs of a provider are its tracked files). */
function commitAll(root: string, message: string) {
  for (const args of [['add', '-A'], ['commit', '--quiet', '-m', message]]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${root}: ${result.stderr}`);
  }
}


// K507: a tracked lock records each polyspec package at its release source; a path or link source is a finding, the local link is state only.
const CARGO_PATH_LOCK = 'version = 4\n\n[[package]]\nname = "app"\nversion = "0.0.0"\ndependencies = [\n "polyspec-ordered-json",\n]\n\n[[package]]\nname = "polyspec-ordered-json"\nversion = "0.0.9"\ndependencies = [\n "serde",\n]\n';
const CARGO_RELEASE_LOCK = CARGO_PATH_LOCK.replace('version = "0.0.9"\n', 'version = "0.0.9"\nsource = "git+https://github.com/polyspec/ordered-json?tag=v0.0.9#1f822e564e575d3958df8025cf911279c1f2a83b"\n');

function lockFindings(t: TestContext, files: Record<string, string>, file: string) {
  const root = tree(t, { 'Cargo.toml': '[package]\nname = "app"\nversion = "0.0.0"\n', '.gitignore': 'var/\n', ...files });
  commitAll(root, 'fixture');
  return linkFindings(root, process.env).filter(finding => finding.startsWith(`${file}:`));
}

test('a tracked Cargo.lock that records a polyspec package with no source is a finding naming the file, the package and its release source (K507)', (t) => {
  const found = lockFindings(t, { 'Cargo.lock': CARGO_PATH_LOCK }, 'Cargo.lock');
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', /polyspec-ordered-json.*release source.*git\+https:\/\/github\.com\/polyspec\/ordered-json\?tag=v0\.0\.9/);
});

test('a tracked Cargo.lock with the release source of its polyspec package passes (K507)', (t) => {
  assert.deepEqual(lockFindings(t, { 'Cargo.lock': CARGO_RELEASE_LOCK }, 'Cargo.lock'), []);
});

test('a tracked package-lock.json that links a polyspec package is a finding, and one that names its release passes (K507)', (t) => {
  const linked = JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { '': {}, 'node_modules/@polyspec/x': { version: '0.0.1', link: true, resolved: 'packages/x' } } });
  const released = JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { '': {}, 'node_modules/@polyspec/x': { version: '0.0.1', resolved: 'https://github.com/polyspec/x/releases/download/v0.0.1/x.tgz' } } });
  assert.equal(lockFindings(t, { 'package-lock.json': linked }, 'package-lock.json').length, 1);
  assert.deepEqual(lockFindings(t, { 'package-lock.json': released }, 'package-lock.json'), []);
});

test('a tracked composer.lock that installs a polyspec package from a path is a finding, and one from its release passes (K507)', (t) => {
  const path_ = JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', dist: { type: 'path', url: '../y' } }] });
  const release = JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', dist: { type: 'zip', url: 'https://github.com/polyspec/y/releases/download/v0.0.1/y.zip' } }] });
  assert.equal(lockFindings(t, { 'composer.lock': path_ }, 'composer.lock').length, 1);
  assert.deepEqual(lockFindings(t, { 'composer.lock': release }, 'composer.lock'), []);
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


test('a trusted-configs entry other than the checkout own mise.toml is a finding (K397)', (t) => {
  const root = tree(t, { 'mise.toml': '[tools]\nnode = "26.11.1"\n' });
  const trusted = path.join(root, 'var/tools/mise/state/trusted-configs');
  mkdirSync(trusted, { recursive: true });
  // The trust of the checkout own mise.toml is a link to the folder of the checkout, and it is no finding.
  symlinkSync(root, path.join(trusted, 'own'));
  assert.deepEqual(linkFindings(root, process.env), []);
  // A link to a folder outside the checkout trusts the mise.toml under it, here the home directory of mise.
  const home = tree(t);
  symlinkSync(home, path.join(trusted, 'Users-maxkwon-dd34fea3d53e4d0'));
  assert.deepEqual(linkFindings(root, process.env), [`mise trusted-configs Users-maxkwon-dd34fea3d53e4d0: trusts ${home}, not the mise.toml of the checkout; run make install-tools`]);
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
    git(folder, 'init', '--quiet', '--initial-branch=main');
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

test('a linked npm provider whose build is stale is a finding that names the rebuild, and a rebuilt provider passes (K453)', (t) => {
  const provider = tree(t, {
    'package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1', main: './dist/x.mjs' }),
    'Makefile': 'build:\n\tmkdir -p dist\n\tcp src/x.mjs dist/x.mjs\n',
    '.gitignore': 'dist/\nvar/\n',
    'src/x.mjs': 'export const v = 1;\n',
  });
  commitAll(provider, 'provider');
  const consumer = tree(t, { 'package.json': '{"name": "cons"}' });
  mkdirSync(path.join(consumer, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync(provider, path.join(consumer, 'node_modules/@polyspec/x'));
  commitAll(consumer, 'consumer');
  const finding = (state: RegExp) => linkFindings(consumer, process.env).filter(text => state.test(text));

  // The provider has never been built: its output dist/x.mjs is missing.
  assert.deepEqual(finding(/^npm @polyspec\/x: the build of .* is stale \(missing dist\/x\.mjs\); fix: run link\.mjs rebuild /), [
    `npm @polyspec/x: the build of ${realpathSync(provider)} is stale (missing dist/x.mjs); fix: run link.mjs rebuild ${realpathSync(provider)}`,
  ]);
  rebuild(provider, () => {});
  assert.deepEqual(linkFindings(consumer, process.env), [], 'a rebuilt provider passes');

  // A source that is newer than the output and differs from the recorded build makes the build stale, until it is rebuilt.
  const source = path.join(provider, 'src/x.mjs');
  writeFileSync(source, 'export const v = 2;\n');
  const future = new Date(Date.now() + 60_000);
  utimesSync(source, future, future);
  assert.deepEqual(finding(/is stale \(src\/x\.mjs is newer than dist\/x\.mjs\)/).length, 1, 'a changed source leaves the build stale');
  rebuild(provider, () => {});
  assert.deepEqual(linkFindings(consumer, process.env), [], 'the rebuilt provider passes again');
});

// K448 (K507): a tracked lock keeps the release record of each polyspec package that a sibling checkout provides; a file: entry that
// names the release tarball is that record, and the repository's own packages (its workspace members, its in-repo path
// repositories) are never findings, whatever their version.
test('a release tarball entry and the repository own packages are no lock-source finding (K448)', () => {
  const npmLock = (entries: Record<string, unknown>) => JSON.stringify({ name: 'c', lockfileVersion: 3, packages: { '': {}, ...entries } });
  assert.deepEqual(lockSourceFindings('tests/release-consumer/npm/package-lock.json', npmLock({ 'node_modules/@polyspec/kit': { version: '0.0.54', resolved: 'file:polyspec-kit-npm-0.0.54.tgz' } })), [], 'the release tarball is the release record');
  assert.equal(lockSourceFindings('package-lock.json', npmLock({ 'node_modules/@polyspec/kit': { version: '0.0.54', resolved: 'file:../kit' } })).length, 1, 'a file: folder of a provided package is a finding');
  const own = new Set(['@polyspec/hyper-build', 'polyspec/hyper-server']);
  assert.deepEqual(lockSourceFindings('package-lock.json', npmLock({ 'node_modules/@polyspec/hyper-build': { link: true, resolved: 'packages/build' } }), own), [], 'an own workspace member is no finding');
  const composerLock = JSON.stringify({ packages: [{ name: 'polyspec/hyper-server', version: '0.0.18', dist: { type: 'path', url: 'packages/server/php' } }] });
  assert.deepEqual(lockSourceFindings('composer.lock', composerLock, own), [], 'an own in-repo path repository is no finding');
});

test('a linked npm provider whose package folder is a tree of per-file links is judged by its build state (K558)', (t) => {
  const provider = tree(t, {
    'package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1', main: './dist/x.mjs' }),
    'Makefile': 'build:\n\tmkdir -p dist\n\tcp src/x.mjs dist/x.mjs\n',
    '.gitignore': 'dist/\nvar/\n',
    'src/x.mjs': 'export const v = 1;\n',
  });
  commitAll(provider, 'provider');
  const consumer = tree(t, { 'package.json': '{"name": "cons"}' });
  const folder = path.join(consumer, 'node_modules/@polyspec/x');
  mkdirSync(folder, { recursive: true });
  for (const file of ['package.json', 'src/x.mjs']) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    symlinkSync(path.join(provider, file), path.join(folder, file));
  }
  commitAll(consumer, 'consumer');
  assert.deepEqual(linkFindings(consumer, process.env).filter(text => /is stale/.test(text)), [
    `npm @polyspec/x: the build of ${realpathSync(provider)} is stale (missing dist/x.mjs); fix: run link.mjs rebuild ${realpathSync(provider)}`,
  ]);
});
