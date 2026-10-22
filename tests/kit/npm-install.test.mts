// K448-2: `npm install` of a consumer links the polyspec packages of a sibling checkout from the start, with no release fetched, and
// the tracked package.json and package-lock.json stay byte for byte.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { npmInstall } from '../../scripts/kit/npm-install.mts';

test('npm install of a consumer links a sibling polyspec package from its folder and changes no tracked file (K448-2)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 1;\n');
  // The tracked manifest names the released tarball; the sibling provides the same package.
  const tracked = JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz' } }, null, 2) + '\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const lines: string[] = [];
  const took = npmInstall({ directory: project, checkouts: [sibling], print: text => lines.push(text), env: process.env });
  assert.equal(took, 'linked', lines.join('\n'));
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), tracked, 'the tracked manifest is unchanged');
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n', 'the tracked lock is unchanged');
  const link = path.join(project, 'node_modules/@polyspec/ordered-json');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the package is a link');
  assert.equal(realpathSync(link), realpathSync(sibling), 'the link resolves to the sibling folder');
  assert.equal(readlinkSync(link).startsWith('/'), true, 'the link is absolute, so it survives the move out of the temporary folder');
  assert.equal(existsSync(path.join(project, 'node_modules/@polyspec/ordered-json/index.js')), true);
});

// K448-7: the checkouts that the CLI is given are linked whatever their origin, and a declared polyspec package without a checkout fails
// instead of running npm ci of the tracked lock.
test('the CLI links the checkouts that it is given, whatever their name and origin, and fails for a declared polyspec package with none (K448-7)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'deep/nested/left-x');
  mkdirSync(checkout, { recursive: true });
  writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: 'left-x', version: '0.0.1', main: 'index.js' }));
  writeFileSync(path.join(checkout, 'index.js'), 'module.exports = 2;\n');
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { 'left-x': 'https://example.invalid/left-x.tgz' } }));
  const cli = fileURLToPath(new URL('../../scripts/kit/npm-install.mts', import.meta.url));
  const linked = spawnSync(process.execPath, [cli, project, checkout], { encoding: 'utf8', env: { ...process.env, NPM_BIN: 'npm' } });
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(lstatSync(path.join(project, 'node_modules/left-x')).isSymbolicLink(), true, 'the explicit checkout is linked, not skipped');
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/missing': 'https://example.invalid/missing.tgz' } }));
  const missing = spawnSync(process.execPath, [cli, project, checkout], { encoding: 'utf8', env: { ...process.env, NPM_BIN: 'npm' } });
  assert.notEqual(missing.status, 0, 'a declared polyspec package with no checkout fails');
  assert.match(missing.stderr, /@polyspec\/missing has no checkout/);
});

// K448-9: `make npm-install` forwards the CHECKOUTS it is given to the tool, so a consumer outside the polyspec workspace links the package
// folder it names and runs no npm ci of the tracked lock, which would install the released tarballs.
test('make npm-install forwards CHECKOUTS to the tool, which links the package folder and runs no npm ci (K448-9)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-make-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'template/packages/ts');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: '@polyspec/template', version: '0.0.11', main: 'index.js' }));
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/template': 'https://example.invalid/template-0.0.11.tgz' } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  // The stub npm records its subcommand and, for install, the manifest it installs; it runs no real npm.
  const stub = path.join(root, 'npm');
  writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$NPM_LOG"\nif [ "$1" = install ]; then cat package.json >> "$NPM_LOG"; mkdir -p node_modules; fi\n', { mode: 0o755 });
  const log = path.join(root, 'npm.log');
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const made = spawnSync('make', ['--no-print-directory', '-C', kit, 'npm-install', `DIR=${project}`, `CHECKOUTS=${folder}`, `NPM=${stub}`, `NODE=${process.execPath}`], { encoding: 'utf8', env: { ...process.env, NPM_LOG: log } });
  assert.equal(made.status, 0, made.stderr);
  const recorded = readFileSync(log, 'utf8');
  assert.doesNotMatch(recorded, /^ci$/m, 'npm ci of the tracked lock does not run');
  assert.match(recorded, /^install$/m, 'npm install of the linked packages runs');
  assert.ok(recorded.includes(`"file:${folder}"`), 'the given package folder is the file: dependency of the install');
});

// K494: a repository root given as a checkout is expanded inside the kit to the package folders that it holds under packages/, as the
// sibling checkouts are (K448-11), so the consumer passes the roots that it links and never walks the layout of a provider.
test('make npm-install takes a repository root in CHECKOUTS and links its package folder (K494)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-root-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'template');
  mkdirSync(path.join(repository, 'packages/ts'), { recursive: true });
  mkdirSync(path.join(repository, 'packages/go'), { recursive: true });
  writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: '@polyspec/template-workspace', version: '0.0.0', private: true }));
  writeFileSync(path.join(repository, 'packages/ts/package.json'), JSON.stringify({ name: '@polyspec/template', version: '0.0.11', main: 'index.js' }));
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/template': 'https://example.invalid/template-0.0.11.tgz' } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  // The stub npm records its subcommand and, for install, the manifest it installs; it runs no real npm.
  const stub = path.join(root, 'npm');
  writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$NPM_LOG"\nif [ "$1" = install ]; then cat package.json >> "$NPM_LOG"; mkdir -p node_modules; fi\n', { mode: 0o755 });
  const log = path.join(root, 'npm.log');
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const made = spawnSync('make', ['--no-print-directory', '-C', kit, 'npm-install', `DIR=${project}`, `CHECKOUTS=${repository}`, `NPM=${stub}`, `NODE=${process.execPath}`], { encoding: 'utf8', env: { ...process.env, NPM_LOG: log } });
  assert.equal(made.status, 0, made.stderr);
  const recorded = readFileSync(log, 'utf8');
  assert.doesNotMatch(recorded, /^ci$/m, 'npm ci of the tracked lock does not run');
  assert.ok(recorded.includes(`"file:${path.join(repository, 'packages/ts')}"`), 'the package folder of the root is the file: dependency of the install');
});

// K494-1: a checkout that provides no npm package, such as a PHP-only fork in the list that link takes too, provides none and fails
// nothing; only an entry that is no existing directory is refused, naming it.
test('make npm-install takes a checkout that provides no npm package and refuses a missing one (K494-1)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-none-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'template');
  mkdirSync(path.join(repository, 'packages/ts'), { recursive: true });
  writeFileSync(path.join(repository, 'packages/ts/package.json'), JSON.stringify({ name: '@polyspec/template', version: '0.0.11', main: 'index.js' }));
  const fork = path.join(root, 'json-schema');
  mkdirSync(fork, { recursive: true });
  writeFileSync(path.join(fork, 'composer.json'), JSON.stringify({ name: 'opis/json-schema' }));
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/template': 'https://example.invalid/template-0.0.11.tgz' } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const stub = path.join(root, 'npm');
  writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$NPM_LOG"\nif [ "$1" = install ]; then cat package.json >> "$NPM_LOG"; mkdir -p node_modules; fi\n', { mode: 0o755 });
  const log = path.join(root, 'npm.log');
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const make = (checkouts: string) => spawnSync('make', ['--no-print-directory', '-C', kit, 'npm-install', `DIR=${project}`, `CHECKOUTS=${checkouts}`, `NPM=${stub}`, `NODE=${process.execPath}`], { encoding: 'utf8', env: { ...process.env, NPM_LOG: log } });
  const made = make(`${repository} ${fork}`);
  assert.equal(made.status, 0, made.stderr);
  assert.ok(readFileSync(log, 'utf8').includes(`"file:${path.join(repository, 'packages/ts')}"`), 'the package folder of the root is linked');
  const missing = make(`${repository} ${path.join(root, 'nowhere')}`);
  assert.notEqual(missing.status, 0, 'an entry that does not exist is refused');
  assert.match(missing.stderr, /nowhere is no existing directory/);
});

// K494-2: a repository root whose own package.json carries the name of the package it holds under packages/ (ordered-json) gives its
// package folder, never itself.
test('make npm-install links the package folder of a root that shares its package name (K494-2)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-same-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'ordered-json');
  mkdirSync(path.join(repository, 'packages/js'), { recursive: true });
  writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json' }));
  writeFileSync(path.join(repository, 'packages/js/package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9', main: 'index.js' }));
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz' } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const stub = path.join(root, 'npm');
  writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$NPM_LOG"\nif [ "$1" = install ]; then cat package.json >> "$NPM_LOG"; mkdir -p node_modules; fi\n', { mode: 0o755 });
  const log = path.join(root, 'npm.log');
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const made = spawnSync('make', ['--no-print-directory', '-C', kit, 'npm-install', `DIR=${project}`, `CHECKOUTS=${repository}`, `NPM=${stub}`, `NODE=${process.execPath}`], { encoding: 'utf8', env: { ...process.env, NPM_LOG: log } });
  assert.equal(made.status, 0, made.stderr);
  const recorded = readFileSync(log, 'utf8');
  assert.ok(recorded.includes(`"file:${path.join(repository, 'packages/js')}"`), 'the package folder is linked');
  assert.ok(!recorded.includes(`"file:${repository}"`), 'the root is not linked');
});

// K502: the project's .npmrc is copied into the temporary install folder, so npm installs with the configuration of the project.
test('make npm-install installs with the .npmrc of the project (K502)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-rc-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'template/packages/ts');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: '@polyspec/template', version: '0.0.11', main: 'index.js' }));
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/template': 'https://example.invalid/template-0.0.11.tgz' } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  writeFileSync(path.join(project, '.npmrc'), 'legacy-peer-deps=true\n');
  // The stub npm records the .npmrc of the folder that it installs in.
  const stub = path.join(root, 'npm');
  writeFileSync(stub, '#!/bin/sh\nif [ "$1" = install ]; then if [ -f .npmrc ]; then cat .npmrc >> "$NPM_LOG"; else echo "no .npmrc" >> "$NPM_LOG"; fi; mkdir -p node_modules; fi\n', { mode: 0o755 });
  const log = path.join(root, 'npm.log');
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const made = spawnSync('make', ['--no-print-directory', '-C', kit, 'npm-install', `DIR=${project}`, `CHECKOUTS=${folder}`, `NPM=${stub}`, `NODE=${process.execPath}`], { encoding: 'utf8', env: { ...process.env, NPM_LOG: log } });
  assert.equal(made.status, 0, made.stderr);
  assert.match(readFileSync(log, 'utf8'), /^legacy-peer-deps=true$/m, 'the npm of the install reads the .npmrc of the project');
  assert.equal(readFileSync(path.join(project, '.npmrc'), 'utf8'), 'legacy-peer-deps=true\n', 'the tracked .npmrc is not written');
});

// K448-10: an overrides entry of the manifest that names a provided package takes the checkout folder of its direct dependency, so npm
// accepts the temporary manifest; an override of a direct dependency must have the same spec (npm docs, package.json, overrides).
test('npm install links a provided package whose manifest overrides entry names the same asset (K448-10)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-override-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 3;\n');
  // The tracked manifest names the asset in its dependencies and in its overrides, as limepie node/contracts does.
  const asset = 'file:var/assets/polyspec-ordered-json-npm-0.0.9.tgz';
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': asset }, overrides: { '@polyspec/ordered-json': asset } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const took = npmInstall({ directory: project, checkouts: [sibling], print: () => undefined, env: process.env });
  assert.equal(took, 'linked');
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/ordered-json')), realpathSync(sibling), 'the link resolves to the sibling folder');
});

// K448-10: the temporary manifest that npm installs keeps no asset spec of a provided package, at any depth, and keeps the other overrides.
test('the temporary manifest rewrites each overrides entry of a provided package and keeps the other overrides (K448-10)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-manifest-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9' }));
  const asset = 'file:var/assets/polyspec-ordered-json-npm-0.0.9.tgz';
  const overrides = { '@polyspec/ordered-json': asset, '@npm/bar': { '@polyspec/ordered-json@0.0.9': asset, '.': '1.0.0' }, 'left-pad': '1.3.0' };
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': asset }, overrides }, null, 2) + '\n');
  // The stub npm records the temporary manifest that the install reads; it runs no real npm.
  const stub = path.join(root, 'npm');
  const recorded = path.join(root, 'manifest.json');
  writeFileSync(stub, `#!/bin/sh\nif [ "$1" = install ]; then cp package.json "${recorded}"; mkdir -p node_modules; fi\n`, { mode: 0o755 });
  npmInstall({ directory: project, checkouts: [sibling], npm: stub, print: () => undefined, env: process.env });
  const temporary = readJsonObject(root, 'manifest.json');
  const folder = `file:${realpathSync(sibling)}`;
  assert.deepEqual(temporary.dependencies, { '@polyspec/ordered-json': folder });
  assert.deepEqual(temporary.overrides, { '@polyspec/ordered-json': folder, '@npm/bar': { '@polyspec/ordered-json@0.0.9': folder, '.': '1.0.0' }, 'left-pad': '1.3.0' }, 'the provided package takes the checkout folder at each depth, and the other overrides are kept');
  assert.doesNotMatch(readFileSync(recorded, 'utf8'), /var\/assets/, 'no asset spec of a provided package remains');
});

// K465: the workspaces that the root declares are part of the project, so the temporary install includes them and their links resolve to
// the project folders; a provided package is linked beside them, and no link of the project dangles after the install.
test('npm install keeps the workspaces of the root and links them to the project folders, with no dangling link (K465)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-workspaces-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(path.join(project, 'packages/ws1'), { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 4;\n');
  writeFileSync(path.join(project, 'packages/ws1/package.json'), JSON.stringify({ name: '@app/ws1', version: '1.0.0', main: 'index.js' }));
  writeFileSync(path.join(project, 'packages/ws1/index.js'), 'module.exports = 5;\n');
  const tracked = JSON.stringify({ name: 'app', version: '1.0.0', private: true, workspaces: ['packages/*'], dependencies: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz' } }, null, 2) + '\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  const took = npmInstall({ directory: project, checkouts: [sibling], print: () => undefined, env: process.env });
  assert.equal(took, 'linked');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), tracked, 'the tracked manifest is unchanged');
  const workspace = path.join(project, 'node_modules/@app/ws1');
  assert.equal(lstatSync(workspace).isSymbolicLink(), true, 'the workspace of the root is linked, not dropped');
  assert.equal(realpathSync(workspace), realpathSync(path.join(project, 'packages/ws1')), 'the workspace link resolves to the project folder');
  assert.equal(readlinkSync(workspace).startsWith('/'), true, 'the workspace link is absolute, so it survives the move out of the temporary folder');
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/ordered-json')), realpathSync(sibling), 'the provided package is linked beside the workspace');
});

// K448-11: the sibling checkouts are repository roots, whose npm packages sit under packages/, so a provided package is found in the
// package folders of a sibling root too, not only at the root (K448-11).
test('npm install finds a provided package in the package folders of a sibling repository root (K448-11)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'template');
  const folder = path.join(sibling, 'packages', 'ts');
  const project = path.join(root, 'app');
  mkdirSync(folder, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/template-repository', private: true }));
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: '@polyspec/template', version: '0.0.11', main: 'index.js' }));
  writeFileSync(path.join(folder, 'index.js'), 'module.exports = 1;\n');
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/template': 'https://example.invalid/template-0.0.11.tgz' } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const lines: string[] = [];
  const took = npmInstall({ directory: project, checkouts: [sibling], print: text => lines.push(text), env: process.env });
  assert.equal(took, 'linked', lines.join('\n'));
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/template')), realpathSync(folder), 'the link resolves to the package folder');
});

// K448-12: npm-install installs from a temporary copy of the manifest in another folder, so a relative file: dependency of the
// project is given to npm as an absolute path from the project folder, and its link resolves after the move (K448-12).
test('npm install keeps a relative file: dependency of the project resolving next to a linked sibling (K448-12)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const lib = path.join(root, 'app', 'packages', 'lib');
  const project = path.join(root, 'app', 'tests', 'install');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(lib, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 1;\n');
  writeFileSync(path.join(lib, 'package.json'), JSON.stringify({ name: 'app-lib', version: '1.0.0', main: 'index.js' }));
  writeFileSync(path.join(lib, 'index.js'), 'module.exports = 2;\n');
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app-install', version: '1.0.0', private: true, dependencies: { 'app-lib': 'file:../../packages/lib', '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz' } }, null, 2) + '\n');
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app-install","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const lines: string[] = [];
  const took = npmInstall({ directory: project, checkouts: [sibling], print: text => lines.push(text), env: process.env });
  assert.equal(took, 'linked', lines.join('\n'));
  assert.equal(realpathSync(path.join(project, 'node_modules/app-lib')), realpathSync(lib), 'the relative file: dependency resolves to its folder');
  assert.equal(realpathSync(path.join(project, 'node_modules/@polyspec/ordered-json')), realpathSync(sibling), 'the sibling is linked');
});

// K448-13: a sibling repository keeps its npm packages under packages/ at any depth (hyper: packages/server/ts), so a repository root
// provides them and the project links them, never a release fetch.
test('npm install links a sibling package that sits two folders down under packages/, and fetches no release (K448-13)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-deep-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'hyper');
  const server = path.join(sibling, 'packages/server/ts');
  const project = path.join(root, 'gui');
  mkdirSync(server, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(server, 'package.json'), JSON.stringify({ name: '@polyspec/hyper-server', version: '0.0.17', main: 'index.js' }));
  writeFileSync(path.join(server, 'index.js'), 'module.exports = 1;\n');
  const tracked = JSON.stringify({ name: 'gui', version: '1.0.0', private: true, dependencies: { '@polyspec/hyper-server': 'https://example.invalid/polyspec-hyper-server-npm-0.0.17.tgz' } }, null, 2) + '\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"gui","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const lines: string[] = [];
  const took = npmInstall({ directory: project, checkouts: [sibling], print: text => lines.push(text), env: process.env });
  assert.equal(took, 'linked', lines.join('\n'));
  const link = path.join(project, 'node_modules/@polyspec/hyper-server');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the package is a link');
  assert.equal(realpathSync(link), realpathSync(server), 'the link resolves to the package folder under packages/server/ts');
});

// K483-1: a declared polyspec package with no checkout fails in every mode, naming the package, and no npm ci or npm install runs.
test('npm install refuses a declared polyspec package with no checkout in every mode, naming it, and runs no npm (K483-1)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-k483-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9' }));
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz', '@polyspec/missing': 'https://example.invalid/missing-0.0.1.tgz' } }, null, 2) + '\n');
  // The stub npm records each subcommand it is run with; it runs no real npm.
  const log = path.join(root, 'npm.log');
  const stub = path.join(root, 'npm');
  writeFileSync(stub, `#!/bin/sh\nprintf "%s\\n" "$1" >> "${log}"\nmkdir -p node_modules\n`, { mode: 0o755 });
  const modes: [string, string[], boolean][] = [
    ['no checkout is given or found', [], false],
    ['a checkout is found that provides another package', [sibling], false],
    ['the checkouts are named explicitly', [sibling], true],
  ];
  for (const [mode, checkouts, explicit] of modes) {
    assert.throws(() => npmInstall({ directory: project, checkouts, npm: stub, explicit, print: () => undefined, env: process.env }), /@polyspec\/missing/, `${mode}: the refusal names the package`);
  }
  assert.equal(existsSync(log), false, 'no npm subcommand runs in any mode');
});

// K486: npm-install replaces the contents of an existing node_modules and keeps the directory itself. A node_modules that the process
// cannot remove as a directory, such as a mount point of a container, is therefore not a failure: here the project folder is read-only,
// so its node_modules cannot be removed or renamed, while its contents are writable as they are inside a mount.
test('npm install replaces the contents of a node_modules that it cannot remove and keeps the directory (K486)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-k486-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 1;\n');
  const tracked = JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz' } }, null, 2) + '\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const nodeModules = path.join(project, 'node_modules');
  mkdirSync(path.join(nodeModules, 'stale'), { recursive: true });
  writeFileSync(path.join(nodeModules, 'stale/index.js'), 'module.exports = 0;\n');
  const kept = statSync(nodeModules).ino;
  chmodSync(project, 0o555);
  try {
    const lines: string[] = [];
    const took = npmInstall({ directory: project, checkouts: [sibling], print: text => lines.push(text), env: process.env });
    assert.equal(took, 'linked', lines.join('\n'));
  } finally {
    chmodSync(project, 0o755);
  }
  assert.equal(statSync(nodeModules).ino, kept, 'the node_modules directory is the same directory');
  assert.equal(existsSync(path.join(nodeModules, 'stale')), false, 'the entries of the earlier install are replaced');
  const link = path.join(nodeModules, '@polyspec/ordered-json');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the package is a link');
  assert.equal(realpathSync(link), realpathSync(sibling), 'the link resolves to the sibling folder');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), tracked, 'the tracked manifest is unchanged');
});

// K484: a package that only the lock names, transitively, with a release URL as its resolved entry, is linked from its sibling
// checkout; npm ci never runs while the lock names a sibling-provided package (hyper tests/package-install). The tool is a local
// folder, so no registry is queried.
test('a transitive package named only by the lock, with a release URL, is linked from its sibling and npm ci never runs (K484)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-transitive-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'template');
  const tool = path.join(root, 'acme-tool');
  const project = path.join(root, 'package-install');
  for (const folder of [sibling, tool, project]) mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/template', version: '0.0.11', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 3;\n');
  writeFileSync(path.join(tool, 'package.json'), JSON.stringify({ name: '@acme/tool', version: '1.0.0', main: 'index.js' }));
  writeFileSync(path.join(tool, 'index.js'), 'module.exports = 4;\n');
  const tracked = JSON.stringify({ name: 'pkg-install', version: '0.0.8', private: true, dependencies: { '@acme/tool': 'file:../acme-tool' } }, null, 2) + '\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  // The tool depends on @polyspec/template; the lock records template only as a transitive entry with a release URL.
  const lock = {
    name: 'pkg-install', version: '0.0.8', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'pkg-install', version: '0.0.8', dependencies: { '@acme/tool': 'file:../acme-tool' } },
      '../acme-tool': { name: '@acme/tool', version: '1.0.0', dependencies: { '@polyspec/template': '0.0.11' } },
      'node_modules/@acme/tool': { resolved: '../acme-tool', link: true },
      'node_modules/@polyspec/template': { version: '0.0.11', resolved: 'https://github.com/polyspec/template/releases/download/v0.0.11/polyspec-template-npm-0.0.11.tgz' },
    },
  };
  writeFileSync(path.join(project, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  const trackedLock = readFileSync(path.join(project, 'package-lock.json'), 'utf8');
  const lines: string[] = [];
  const took = npmInstall({ directory: project, checkouts: [sibling], print: text => lines.push(text), env: process.env });
  assert.equal(took, 'linked', lines.join('\n'));
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), tracked, 'the tracked manifest is unchanged');
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), trackedLock, 'the tracked lock is unchanged');
  const link = path.join(project, 'node_modules/@polyspec/template');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the transitive package is a link to its sibling');
  assert.equal(realpathSync(link), realpathSync(sibling));
  assert.equal(lines.some(line => /npm ci of the tracked lock/.test(line)), false, 'npm ci never runs');
});

// K484: a package the project declares keeps its own spec: the lock-only declaration adds no second entry for it.
test('a package the project declares keeps its own dependency entry, with no second declaration from the lock (K484)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-declared-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'template');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/template', version: '0.0.11', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 3;\n');
  const tracked = JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/template': 'https://example.invalid/template.tgz' } }, null, 2) + '\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const took = npmInstall({ directory: project, checkouts: [sibling], print: () => {}, env: process.env });
  assert.equal(took, 'linked');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), tracked, 'the tracked manifest is unchanged');
  assert.equal(lstatSync(path.join(project, 'node_modules/@polyspec/template')).isSymbolicLink(), true, 'the declared package is linked once');

});

// K485: ADD links a checkout whose package the project does not declare from the start: the temporary manifest names it as a file:
// dependency of its checkout, the tracked manifest and lock stay unchanged, and no npm ci runs.
test('npm install with ADD links an undeclared checkout from the start, with the tracked files unchanged and no npm ci (K485)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-add-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'core');
  mkdirSync(checkout, { recursive: true });
  writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: '@limepie/core', version: '0.0.1', main: 'index.js' }));
  writeFileSync(path.join(checkout, 'index.js'), 'module.exports = 1;\n');
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  const tracked = JSON.stringify({ name: 'app', version: '1.0.0', private: true }, null, 2) + '\n';
  const lock = '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  writeFileSync(path.join(project, 'package-lock.json'), lock);
  // The stub npm records each subcommand, and for install the manifest it installs; it runs no real npm.
  const log = path.join(root, 'npm.log');
  const recorded = path.join(root, 'manifest.json');
  const stub = path.join(root, 'npm');
  writeFileSync(stub, `#!/bin/sh\nprintf "%s\\n" "$1" >> "${log}"\nif [ "$1" = install ]; then cp package.json "${recorded}"; mkdir -p node_modules; fi\n`, { mode: 0o755 });
  const lines: string[] = [];
  const took = npmInstall({ directory: project, checkouts: [], added: [checkout], npm: stub, print: text => lines.push(text), env: process.env });
  assert.equal(took, 'linked', lines.join('\n'));
  assert.equal(readFileSync(log, 'utf8'), 'install\n', 'only npm install runs, no npm ci');
  assert.deepEqual(readJsonObject(root, 'manifest.json').dependencies, { '@limepie/core': `file:${realpathSync(checkout)}` }, 'the temporary manifest names the checkout');
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), tracked, 'the tracked manifest is unchanged');
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), lock, 'the tracked lock is unchanged');
});

test('make npm-install ADD=<checkout> passes each checkout to the tool with --add, and none without ADD (K485)', () => {
  const kitRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const dry = (...extra: string[]) => spawnSync('make', ['-n', 'npm-install', 'DIR=examples/app', ...extra], { cwd: kitRoot, encoding: 'utf8' });
  const plain = dry();
  assert.equal(plain.status, 0, plain.stderr);
  assert.doesNotMatch(plain.stdout, /--add/, plain.stdout);
  const added = dry('ADD=/work/core /work/template');
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /npm-install\.(mts|mjs|js) examples\/app\s+--add \/work\/core --add \/work\/template\s*$/m, added.stdout);
});
