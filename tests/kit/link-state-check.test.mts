// Tests of scripts/kit/link-state-check.mts (K305-1): the link counts as the installed released version, so the check compares no
// version and no requirement; while a link exists, an installed polyspec package pinned at 0.0.x is a link that resolves, and
// a plain copy among links is a finding. Composer runs as a stub that answers `vendor` to `config vendor-dir`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { rebuild } from '../../scripts/kit/link-build.mts';
import { linkFindings, lockSourceFindings, recipeFindings } from '../../scripts/kit/link-state-check.mts';
import { put, tree } from './tree.mts';

/** Commits every file of `root` (K453 tests: the build inputs of a provider are its tracked files). */
function commitAll(root: string, message: string) {
  for (const args of [['add', '-A'], ['commit', '--quiet', '-m', message]]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${root}: ${result.stderr}`);
  }
}

/** A consumer whose Composer vendor records polyspec/y and polyspec/z at 0.0.1; `link` says which of them are links. */
function consumer(t: TestContext, link: Record<string, boolean>) {
  const root = tree(t, {
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1', 'polyspec/z': '0.0.1' } }),
    'vendor/composer/installed.json': JSON.stringify({ packages: ['y', 'z'].map(name => ({ name: `polyspec/${name}`, version: '0.0.1', 'install-path': `../polyspec/${name}`, require: { php: '>=8.5' }, dist: { type: link[name] ? 'path' : 'zip' } })) }),
    'provider/y/composer.json': JSON.stringify({ name: 'polyspec/y', require: { php: '>=8.4' } }),
    'provider/z/composer.json': JSON.stringify({ name: 'polyspec/z' }),
  });
  mkdirSync(path.join(root, 'vendor/polyspec'), { recursive: true });
  for (const name of ['y', 'z'] as const) {
    if (link[name]) symlinkSync(path.join(root, 'provider', name), path.join(root, 'vendor/polyspec', name));
    else put(root, { [`vendor/polyspec/${name}/composer.json`]: JSON.stringify({ name: `polyspec/${name}` }) });
  }
  const stub = path.join(root, 'composer-stub');
  writeFileSync(stub, '#!/bin/sh\necho vendor\n');
  chmodSync(stub, 0o755);
  return { root, env: { ...process.env, COMPOSER_BIN: stub } };
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

test('linked packages pass whatever version and requirement their record holds, since the link counts as the released version (K305-1)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  assert.deepEqual(linkFindings(root, env), []);
});

test('a link over the install of a release archive is a finding: Composer installed the package from a zip, not from its path repository (K318)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  put(root, { 'vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y', dist: { type: 'zip' } }, { name: 'polyspec/z', version: '0.0.1', 'install-path': '../polyspec/z', dist: { type: 'path' } }] }) });
  assert.deepEqual(linkFindings(root, env), ["composer polyspec/y: vendor/polyspec/y is a link over an install from zip, not Composer's own path install; run kit link"]);
});

test('a plain copy among links is a finding that names the package, and a checkout without a link passes (K305-1)', (t) => {
  const mixed = consumer(t, { y: true, z: false });
  assert.deepEqual(linkFindings(mixed.root, mixed.env), ['composer polyspec/z: vendor/polyspec/z is a copy at 0.0.1, not a link, while other packages are linked']);
  const none = consumer(t, { y: false, z: false });
  assert.deepEqual(linkFindings(none.root, none.env), [], 'CI installs the released copies: nothing is linked');
});

test('a link that resolves to no package of that name, an npm copy among links and a go.work use folder without a go.mod are findings (K305-1)', (t) => {
  const root = tree(t, { 'package.json': '{"name": "cons"}', 'go.mod': 'module cons\n', 'go.work': 'go 1.26\n\nuse (\n\t.\n\t../gone\n)\n' });
  mkdirSync(path.join(root, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync(path.join(root, 'missing'), path.join(root, 'node_modules/@polyspec/x'));
  put(root, { 'node_modules/@polyspec/w/package.json': JSON.stringify({ name: '@polyspec/w', version: '0.0.3' }) });
  assert.deepEqual(linkFindings(root, process.env), [
    'go ../gone: the use folder of go.work holds no go.mod',
    'npm @polyspec/w: node_modules/@polyspec/w is a copy at 0.0.3, not a link, while other packages are linked',
    'npm @polyspec/x: the link node_modules/@polyspec/x resolves to no package folder',
  ]);
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

// K349: a vendor installed from the tracked lock demands the platform of that lock, which a polyspec package of another PHP cannot meet.
test('a linked vendor whose platform check demands another PHP than .php-version is a finding (K349)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  put(root, { '.php-version': '8.4\n', 'vendor/composer/platform_check.php': '<?php\nif (!(PHP_VERSION_ID >= 80500)) {\n}\n' });
  assert.deepEqual(linkFindings(root, env), ['composer vendor/composer/platform_check.php: demands PHP id 80500 while .php-version names 80401; the vendor was installed from the tracked lock, run kit link']);
  put(root, { 'vendor/composer/platform_check.php': '<?php\nif (!(PHP_VERSION_ID >= 80401)) {\n}\n' });
  assert.deepEqual(linkFindings(root, env), []);
});

// K384: Composer demands the highest floor of the installed packages, so a vendor of packages that require >=8.4 demands 80400.
test('a vendor whose platform check demands an older floor than .php-version is no finding, and a newer one is (K384)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  put(root, { '.php-version': '8.4.1\n', 'vendor/composer/platform_check.php': '<?php\nif (!(PHP_VERSION_ID >= 80400)) {\n}\n' });
  assert.deepEqual(linkFindings(root, env), []);
  put(root, { 'vendor/composer/platform_check.php': '<?php\nif (!(PHP_VERSION_ID >= 80500)) {\n}\n' });
  assert.deepEqual(linkFindings(root, env), ['composer vendor/composer/platform_check.php: demands PHP id 80500 while .php-version names 80401; the vendor was installed from the tracked lock, run kit link']);
});

// The manifests of a repository that declares a polyspec dependency in each ecosystem, which the recipe rule needs (K349-2).
const POLYSPEC_MANIFESTS: Record<string, string> = {
  'package.json': JSON.stringify({ devDependencies: { '@polyspec/kit': '0.0.54' } }),
  'composer.json': JSON.stringify({ require: { 'polyspec/x': '0.0.1' } }),
  'pyproject.toml': '[project]\nname = "c"\nversion = "0"\ndependencies = ["polyspec-x==0.0.1"]\n',
};

test('a recipe that installs from a lock without the kit link step after it is a finding, and unlink and the link step pass (K349)', () => {
  const makefile = [
    'a-install:', '	composer install', '	$(MAKE) link', '',
    'b-install:', '	npm ci', '	@echo done', '',
    'c-install:', '	uv sync --frozen', '	node kit link --siblings', '',
    'unlink:', '	npm ci', '',
    'd-install:', '	$(MAKE) link', '	composer install', '',
  ].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', 'scripts/kit/kit.mk', ...Object.keys(POLYSPEC_MANIFESTS)], file => (file === 'Makefile' ? makefile : POLYSPEC_MANIFESTS[file] ?? 'x:\n\tnpm ci\n')), [
    'Makefile:2: the recipe a-install installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)',
    'Makefile:6: the recipe b-install installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line',
    'Makefile:18: the recipe d-install installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)',
  ]);
});

test('a recipe that installs through a make variable without the link step after it is a finding (K349-1)', () => {
  const makefile = [
    'a-install:', '\t$(COMPOSER) install', '',
    'b-install:', '\t$(NPM) ci', '',
    'c-install:', '\t${UV} sync --frozen', '',
    'd-install:', '\t$(COMPOSER) install', '\t$(MAKE) link', '',
    'e-install:', '\t$(NPM) ci', '\tnode kit link --siblings', '',
    'f-install:', '\t${UV} sync --frozen', '\tnode kit link --siblings', '',
  ].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', ...Object.keys(POLYSPEC_MANIFESTS)], file => (file === 'Makefile' ? makefile : POLYSPEC_MANIFESTS[file])), [
    'Makefile:2: the recipe a-install installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)',
    'Makefile:5: the recipe b-install installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line',
    'Makefile:8: the recipe c-install installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line',
    'Makefile:11: the recipe d-install installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)',
  ]);
});

// K375: a worktree that links its install directories to the main checkout runs the sources of the main checkout.
test('an install directory that is a symbolic link, and a workspace package that resolves outside the checkout, are findings (K375)', (t) => {
  const other = tree(t, {});
  const linked = tree(t, {});
  symlinkSync(other, path.join(linked, 'node_modules'));
  assert.deepEqual(linkFindings(linked, process.env), ['install directory node_modules is a symbolic link: remove the link and install the worktree from its own sources']);

  const workspace = JSON.stringify({ name: 'root', workspaces: ['packages/a'] });
  const outside = tree(t, { 'packages/a/package.json': JSON.stringify({ name: '@x/a' }) });
  const foreign = tree(t, { 'package.json': workspace, 'packages/a/package.json': JSON.stringify({ name: '@x/a' }) });
  mkdirSync(path.join(foreign, 'node_modules/@x'), { recursive: true });
  symlinkSync(path.join(outside, 'packages/a'), path.join(foreign, 'node_modules/@x/a'));
  const found = linkFindings(foreign, process.env);
  assert.equal(found.length, 1);
  assert.match(found[0] ?? '', /node_modules\/@x\/a/);

  const own = tree(t, { 'package.json': workspace, 'packages/a/package.json': JSON.stringify({ name: '@x/a' }) });
  mkdirSync(path.join(own, 'node_modules/@x'), { recursive: true });
  symlinkSync(path.join(own, 'packages/a'), path.join(own, 'node_modules/@x/a'));
  assert.deepEqual(linkFindings(own, process.env), []);
});

// K349-2: the recipe rule holds where a link can link, outside the chain of make install, which links last.
test('the recipe rule holds only for an ecosystem with a polyspec dependency, and not for a recipe that make install reaches (K349-2)', () => {
  const kitLike = ['install-packages:', '\t$(NPM) ci', ''].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', 'package.json'], file => (file === 'Makefile' ? kitLike : JSON.stringify({ devDependencies: { typescript: '6.0.0' } }))), [], 'a repository without a polyspec dependency has nothing to link');
  const consumer = ['install: install-kit repo-install', 'install-kit:', '\t$(MAKE) --no-print-directory install-packages', 'install-packages:', '\t$(NPM) ci', 'repo-install:', '\tcomposer install', 'gen:', '\tcomposer install', ''].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', ...Object.keys(POLYSPEC_MANIFESTS)], file => (file === 'Makefile' ? consumer : POLYSPEC_MANIFESTS[file])), [
    'Makefile:9: the recipe gen installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)',
  ], 'install reaches install-packages by a make call and repo-install by a prerequisite, and links last; gen is outside it');
});

// K403: fsm reaches its npm install through variables: install: fsm-install, fsm-install: install-kit $(PACKAGE_DEPS), and the rule of
// $(NPM_DEP), one of PACKAGE_DEPS, makes fsm-js-install.
test('the recipes that make install reaches through the variables of the Makefiles are reached (K403)', () => {
  const makefile = [
    'NPM_DEP := packages/js/node_modules/.package-lock.json',
    'PHP_DEP = var/deps/php',
    'PACKAGE_DEPS := $(NPM_DEP)',
    'PACKAGE_DEPS += ${PHP_DEP}',
    'export JS_INSTALL ?= fsm-js-install',
    'install: fsm-install',
    'fsm-install: install-kit $(PACKAGE_DEPS)',
    '$(NPM_DEP): packages/js/package-lock.json',
    '\t$(ONLINE) $(MAKE) $(JS_INSTALL)',
    '$(PHP_DEP) var/deps/other: composer.lock',
    '\tcomposer install',
    'fsm-js-install:',
    '\tcd packages/js && $(NPM) ci --allow-remote=root --no-audit --no-fund',
    'gen:',
    '\tcd packages/js && $(NPM) ci',
    '',
  ].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', ...Object.keys(POLYSPEC_MANIFESTS)], file => (file === 'Makefile' ? makefile : POLYSPEC_MANIFESTS[file])), [
    'Makefile:15: the recipe gen installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line',
  ], 'install reaches fsm-js-install through PACKAGE_DEPS, NPM_DEP and JS_INSTALL, and var/deps/php through PHP_DEP; gen is outside it');
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

// K428: a tools project of a repository outside its workspaces installs from its own lock in a target that install-packages runs
// through INSTALL_PACKAGES_EXTRA; make install links after it through install-link, so the target needs no link step of its own.
test('a target that installs a lock with no link after it is a finding, unless INSTALL_PACKAGES_EXTRA names it (K428)', (t) => {
  const manifest = JSON.stringify({ devDependencies: { '@polyspec/kit': '0.0.54' } });
  const plain = tree(t, { 'package.json': manifest, Makefile: 'svelte-tools-install:\n\tnpm ci --prefix tools\n' });
  assert.deepEqual(linkFindings(plain, process.env), ['Makefile:2: the recipe svelte-tools-install installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line']);
  const named = tree(t, { 'package.json': manifest, Makefile: 'INSTALL_PACKAGES_EXTRA := svelte-tools-install\nsvelte-tools-install:\n\tnpm ci --prefix tools\n' });
  assert.deepEqual(linkFindings(named, process.env), []);
});

test('a recipe that runs make composer-install installs through the link, so no link step is asked after it (K432)', () => {
  const makefile = [
    'app-install:', '\t$(MAKE) composer-install DIR=app', '',
    'pkg-install:', '\tmake composer-install DIR=packages/php', '\t@echo done', '',
    'lock-install:', '\tcomposer install', '',
  ].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', ...Object.keys(POLYSPEC_MANIFESTS)], file => (file === 'Makefile' ? makefile : POLYSPEC_MANIFESTS[file])), [
    'Makefile:9: the recipe lock-install installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)',
  ]);
});

// K448-1: a tracked Composer project below the root (hyper examples/board) with a copy of a polyspec package in its vendor is a
// finding of the gate, whichever install made the copy, so a consumer's own composer install is caught too.
test('a copy of a polyspec package in the vendor of a nested Composer project is a finding of the gate (K448-1)', (t) => {
  const { root, env } = consumer(t, { y: true, z: true });
  put(root, { 'examples/board/composer.json': JSON.stringify({ name: 'cons/board', require: { 'polyspec/z': '0.0.1' } }), 'examples/board/composer.lock': '{}', 'examples/board/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/z', version: '0.0.1', 'install-path': '../polyspec/z', dist: { type: 'zip' } }] }), 'examples/board/vendor/polyspec/z/composer.json': JSON.stringify({ name: 'polyspec/z' }) });
  assert.deepEqual(linkFindings(root, env), ['composer polyspec/z: examples/board/vendor/polyspec/z is a copy at 0.0.1, not a link, while other packages are linked']);
});

// K448-1: a recipe that runs composer install of a tracked lock is refused even with the link step after it, since the release is
// installed first; the recipe must run make composer-install, which links from the start (K448-1).
test('a recipe that runs composer install of a lock is refused even with the link step after it, and names make composer-install (K448-1)', () => {
  const makefile = ['a-install:', '\tcomposer install --working-dir=examples/board', '\t$(MAKE) link', ''].join('\n');
  assert.deepEqual(recipeFindings('.', ['Makefile', 'scripts/kit/kit.mk', ...Object.keys(POLYSPEC_MANIFESTS)], file => (file === 'Makefile' ? makefile : POLYSPEC_MANIFESTS[file] ?? 'x:\n\tnpm ci\n')), ['Makefile:2: the recipe a-install installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)']);
});

// K448-5: a recipe that fetches the crates of a lock naming a polyspec crate of a sibling checkout fetches the git tag of the crate,
// so it must run make cargo-fetch, which links the sibling crates through a [patch] path (cargo's own link).
test('a recipe that fetches the crates of a lock naming a polyspec crate is a finding (K448-5)', () => {
  const makefile = ['ci-setup:', '\tcargo fetch --locked', '', 'good-setup:', '\t$(MAKE) cargo-fetch DIR=.', ''].join('\n');
  const cargoToml = '[dependencies]\npolyspec-ordered-json = { git = "https://github.com/polyspec/ordered-json", tag = "v0.0.9" }\n';
  assert.deepEqual(recipeFindings('.', ['Makefile', 'Cargo.toml'], file => (file === 'Makefile' ? makefile : cargoToml)), [
    'Makefile:2: the recipe ci-setup fetches the crates of a lock that names a polyspec crate; run $(MAKE) cargo-fetch DIR=<project> instead, which links the sibling crates through a [patch] path (K448-5)',
  ]);
  assert.deepEqual(recipeFindings('.', ['Makefile', 'Cargo.toml'], file => (file === 'Makefile' ? 'ci-setup:\n\tcargo fetch --locked\n' : '[dependencies]\nserde = "1"\n')), [], 'a lock without a polyspec crate is not a finding');
});

// K448-5: the crate that a Cargo.toml names itself is no dependency of the lock, so its own build is no finding.
test('a recipe that builds the crate named by its own Cargo.toml is no finding (K448-5)', () => {
  const makefile = 'build-own:\n\tcargo build --locked\n';
  assert.deepEqual(recipeFindings('.', ['Makefile', 'Cargo.toml'], file => (file === 'Makefile' ? makefile : '[package]\nname = "polyspec-ordered-json"\nversion = "0.0.1"\n')), []);
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
