// Tests of scripts/kit/worktree-setup.mts (K348): the worktree of a row is made from main beside the main checkout, its node_modules
// installed by native package managers from shared offline caches and checked; a second run converges.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { prepareWorktreePython, setupWorktree as setupNativeWorktree, worktreeLinkTool } from '../../scripts/kit/worktree-setup.mts';
import { packedFiles } from '../../scripts/kit/pack-manifest.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

// The kit of a consumer is a link to the kit checkout beside it (K591), ../kit of the fixture, whose link source node runs with its
// types stripped, since it lies outside node_modules (K613).
const linkKit = (main: string) => {
  put(main, { 'package.json': '{"name":"fixture","private":true}', 'package-lock.json': '{}', '../kit/package.json': JSON.stringify({ name: '@polyspec/kit', type: 'module', exports: { './link': './scripts/kit/link.mts' } }) });
  mkdirSync(path.join(main, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync('../../../kit', path.join(main, 'node_modules/@polyspec/kit'));
};

// This small npm double models only fixture packages; native installation itself has source-test coverage.
const setupWorktree: typeof setupNativeWorktree = (root, row, options) => {
  const main = path.dirname(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')));
  const npm = path.join(path.dirname(main), 'fixture-npm');
  if (!existsSync(npm)) writeFileSync(npm, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),cwd=process.cwd();
if(args[0]==='config'){process.stdout.write(${JSON.stringify(path.join(path.dirname(main), 'npm-cache'))});process.exit(0);}
if(args[0]!=='ci')process.exit(92);
const put=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
const link=(file,target)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.symlinkSync(target,file);};
if(fs.existsSync('packages/own/package.json'))link('node_modules/@polyspec/own','../../packages/own');
if(fs.existsSync('Makefile')){
link('node_modules/@polyspec/kit',path.join(path.dirname(cwd),'kit'));
put('node_modules/left-pad/package.json','{"name":"left-pad","main":"index.js"}');
put('node_modules/left-pad/index.js','module.exports = 1;\\n');
put('node_modules/left-pad/bin.js','#!/usr/bin/env node\\n');
link('node_modules/.bin/lp','../left-pad/bin.js');
}else put('node_modules/typescript/index.js','native nested npm package\\n');
`, { mode: 0o755 });
  return setupNativeWorktree(root, row, { npm, ...options });
};

/** A uv fixture that owns environment creation and records its native install inputs, without running Python. */
function stubUv(parent: string): string {
  const script = path.join(parent, 'uv.mjs');
  writeFileSync(script, `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'workspace' && args[1] === 'dir') process.stdout.write(process.cwd());
else if (args[0] === 'venv') {
  const directory = args.at(-1);
  mkdirSync(path.join(directory, 'bin'), { recursive: true });
  writeFileSync(path.join(directory, 'pyvenv.cfg'), 'native uv environment\\n');
  writeFileSync(path.join(directory, 'bin/python'), '# native interpreter\\n', { mode: 0o755 });
} else if (args[0] === 'sync') {
  if (process.env.UV_FIXTURE_FAIL === 'install') { process.stderr.write('required cached wheel missing'); process.exit(44); }
  const directory = process.env.UV_PROJECT_ENVIRONMENT;
  writeFileSync(path.join(directory, 'native-sync.json'), JSON.stringify({ args, offline: process.env.UV_OFFLINE, cache: process.env.UV_CACHE_DIR, projectEnvironment: process.env.UV_PROJECT_ENVIRONMENT }));
} else if (args[0] === 'pip' && args[1] === 'install') {
  if (process.env.UV_FIXTURE_FAIL === 'install') { process.stderr.write('required cached wheel missing'); process.exit(44); }
  writeFileSync(path.join(process.env.UV_PROJECT_ENVIRONMENT, 'native-editables.json'), JSON.stringify(args));
} else if (args[0] === 'pip' && args[1] === 'check') process.stdout.write('');
else if (args[0] === 'pip' && args[1] === 'list') process.stdout.write('[]');
else process.exit(91);
`);
  const uv = path.join(parent, 'uv');
  writeFileSync(uv, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
  return uv;
}

test('python worktree setup retains an existing legacy environment before running uv (K657-4)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-python-worktree-legacy-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'main');
  const folder = path.join(parent, 'worktree');
  put(main, { '.venv/pyvenv.cfg': 'main environment\n', 'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.0.1"\n' });
  put(folder, { 'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.0.1"\n' });
  put(folder, { '.venv/pyvenv.cfg': 'legacy environment\n' });
  const printed: string[] = [];
  assert.throws(() => prepareWorktreePython({ main, folder, venv: '.venv', uv: stubUv(parent), print: text => printed.push(text) }), /not an environment created by native worktree setup/);
  assert.deepEqual(printed, [], 'uv does not run before the legacy environment is refused');
  assert.equal(readFileSync(path.join(folder, '.venv/pyvenv.cfg'), 'utf8'), 'legacy environment\n');
  assert.equal(readFileSync(path.join(main, '.venv/pyvenv.cfg'), 'utf8'), 'main environment\n');
});

test('python worktree installation reports an offline cache miss without modifying the main environment (K657-4)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-python-worktree-cache-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'main');
  const folder = path.join(parent, 'worktree');
  put(main, { '.venv/pyvenv.cfg': 'main environment\n', 'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.0.1"\n' });
  put(folder, { 'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.0.1"\n' });
  assert.throws(() => prepareWorktreePython({ main, folder, venv: '.venv', uv: stubUv(parent), env: { ...process.env, UV_FIXTURE_FAIL: 'install' }, print: () => {} }), /failed without network access[\s\S]*required cached wheel missing/);
  assert.equal(readFileSync(path.join(main, '.venv/pyvenv.cfg'), 'utf8'), 'main environment\n');
  assert.match(readFileSync(path.join(folder, 'var/worktree-python/.venv/native-uv'), 'utf8'), /native uv worktree environment/);
  assert.equal(lstatSync(path.join(folder, '.venv/pyvenv.cfg')).isSymbolicLink(), false, 'the failed install retains its independent native environment');
});

test('worktree-setup makes the worktree of a row from main, installs native dependencies and checks them, and a second run converges (K348, K519)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // An install of the fixture would write installs.txt; the check reads the node_modules that the worktree links.
  // The link rebuild of K482 runs the link tool of the consumer from the linked node_modules, so the fixture has a no-op one.
  put(main, {
    '../kit/scripts/kit/link.mts': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'install:\n\techo installed >> installs.txt\nlink-state-check:\n\ttest -f node_modules/@polyspec/kit/scripts/kit/link.mts\n',
    '.gitignore': 'installs.txt\nnode_modules/\n',
  });
  linkKit(main);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const quiet = { print: () => {} };
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  assert.equal(folder, path.join(parent, 'repo-parser-T1'));
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/parser-T1');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'main'), 'the branch starts at main');
  assert.equal(existsSync(path.join(folder, 'installs.txt')), false, 'setup does not run the broad Make install target');
  assert.ok(lstatSync(path.join(folder, 'node_modules')).isDirectory(), 'the node_modules of the worktree is a folder of its own (K530)');
  assert.equal(realpathSync(path.join(folder, 'node_modules/@polyspec/kit')), realpathSync(path.join(main, 'node_modules/@polyspec/kit')));
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the ignored node_modules leaves the worktree with no change');
  const listed = git(main, 'worktree', 'list', '--porcelain');
  assert.equal(setupWorktree(folder, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run, also from the worktree, finds the same worktree');
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'and leaves the same worktrees');
  assert.throws(() => setupWorktree(main, { name: 'Lexer', id: 'T2', type: 'fix' }, quiet), /is no slug/);
  assert.throws(() => setupWorktree(main, { name: 'lexer', id: 'T2', type: 'merge' }, quiet), /is none of feat, fix/);
});

// K482: a fresh worktree is built by the link rebuild of its own packages before the link-state-check, so the check never reads a build
// that the new worktree does not have yet (the stale report of a new worktree).
test('worktree-setup rebuilds the packages of the worktree before its link-state-check (K482)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // The install writes no build; the rebuild writes the build that the check reads, so the check fails unless the rebuild ran first.
  // A consumer runs the link of its installed kit: the fixture installs a link tool that writes the build the check reads.
  put(main, {
    '../kit/scripts/kit/link.mts': "import { mkdirSync, writeFileSync } from 'node:fs';\nconst [, , command, target] = process.argv;\nif (command !== 'rebuild' || target !== '.') process.exit(2);\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/index.d.ts', 'built\\n');\n",
    'Makefile': 'install:\n\ttrue\nlink-state-check:\n\ttest -f dist/index.d.ts\n',
    // The build is ignored at the root only, as a repository ignores its own dist/.
    '.gitignore': '/dist/\nnode_modules/\n',
  });
  linkKit(main);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const lines: string[] = [];
  const quiet = { print: (text: string) => lines.push(text) };
  const folder = setupWorktree(main, { name: 'builder', id: 'K482', type: 'fix' }, quiet);
  assert.equal(readFileSync(path.join(folder, 'dist/index.d.ts'), 'utf8'), 'built\n');
  assert.ok(lines.some(line => line.includes('link rebuild in')), lines.join('\n'));
});

// K619: a worktree can link its environments and run link-state-check without rebuilding product packages.
test('worktree-link-state links and checks the worktree without rebuilding product packages (K619)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    '../kit/scripts/kit/link.mts': 'process.exit(37);\n',
    'Makefile': 'link-state-check:\n\t@echo checked > link-state-checked\n',
    '.gitignore': 'node_modules/\n',
  });
  linkKit(main);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const lines: string[] = [];
  const folder = setupWorktree(main, { name: 'links', id: 'K619', type: 'fix' }, { print: text => lines.push(text), linkStateOnly: true });
  assert.equal(readFileSync(path.join(folder, 'link-state-checked'), 'utf8'), 'checked\n', 'the required link-state-check ran');
  assert.ok(lines.some(line => line.includes('link-state-check in')), lines.join('\n'));
  assert.ok(!lines.some(line => line.includes('link rebuild in')), lines.join('\n'));
});

test('K519/K521: native installation replaces worktree dependency state and owns Composer autoload', t => {
  const { main, npm, composer } = nativeManagers(t);
  const options = { npm, composer, linkStateOnly: true, print: () => {} };
  const folder = setupWorktree(main, { name: 'own', id: 'K519', type: 'fix' }, options);
  put(folder, { 'node_modules/stale/value': 'old projection' });
  assert.equal(setupWorktree(main, { name: 'own', id: 'K519', type: 'fix' }, options), folder);
  assert.equal(existsSync(path.join(folder, 'node_modules/stale')), false, 'npm ci replaces stale generated state');
  assert.equal(readFileSync(path.join(folder, 'vendor/autoload.php'), 'utf8'), folder);
  assert.equal(readFileSync(path.join(main, 'vendor/fixture/lib/value'), 'utf8'), 'main Composer installation');
});

// K530: native npm owns independent dependencies and bin entries, and resolves workspace sources inside this worktree.
test('worktree-setup installs independent npm dependencies and resolves its own workspace packages (K530)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    '../kit/scripts/kit/link.mts': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    '../kit/package.json': '{"name":"@polyspec/kit"}\n',
    'node_modules/left-pad/package.json': '{"name":"left-pad","main":"index.js"}\n',
    'node_modules/left-pad/index.js': 'module.exports = 1;\n',
    'node_modules/left-pad/bin.js': '#!/usr/bin/env node\n',
    'node_modules/.package-lock.json': '{}\n',
    'packages/own/package.json': '{"name":"@polyspec/own","main":"index.js"}\n',
    'packages/own/index.js': 'module.exports = 2;\n',
    'Makefile': 'link-state-check:\n\ttest -f node_modules/@polyspec/kit/scripts/kit/link.mts\n',
    '.gitignore': 'node_modules/\n',
  });
  linkKit(main);
  symlinkSync('../../packages/own', path.join(main, 'node_modules/@polyspec/own'));
  mkdirSync(path.join(main, 'node_modules/.bin'));
  symlinkSync('../left-pad/bin.js', path.join(main, 'node_modules/.bin/lp'));
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const quiet = { print: () => {} };
  const check = (folder: string) => {
    const modules = path.join(folder, 'node_modules');
    assert.ok(lstatSync(modules).isDirectory(), 'the node_modules of the worktree is a folder of its own');
    const resolve = createRequire(path.join(folder, 'index.js')).resolve;
    assert.equal(resolve('@polyspec/own'), realpathSync(path.join(folder, 'packages/own/index.js')), 'an own workspace package resolves under the worktree');
    assert.equal(resolve('left-pad'), realpathSync(path.join(folder, 'node_modules/left-pad/index.js')), 'a third-party package is installed inside the worktree');
    assert.equal(realpathSync(path.join(modules, '.bin/lp')), realpathSync(path.join(folder, 'node_modules/left-pad/bin.js')));
    assert.equal(realpathSync(path.join(modules, '@polyspec/kit')), realpathSync(path.join(main, 'node_modules/@polyspec/kit')));
    assert.equal(git(folder, 'status', '--porcelain'), '', 'the worktree has no change');
  };
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  check(folder);
  assert.equal(setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run converges');
  check(folder);
  rmSync(path.join(folder, 'node_modules'), { recursive: true });
  symlinkSync(path.join(main, 'node_modules'), path.join(folder, 'node_modules'));
  setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  check(folder);
});

// K533/K657-4: npm installs each project independently, while uv restores explicit native requirements.
test('worktree-setup gives each npm project and each Python environment of the main checkout its environment in the worktree (K533)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  const venv = 'py/.venv';
  const site = `${venv}/lib/python3.14/site-packages`;
  put(main, {
    '../kit/scripts/kit/link.mts': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'package-lock.json': '{}\n',
    'tools/ts/package-lock.json': '{}\n',
    'tools/ts/package.json': '{"name":"fixture-tools"}',
    'tools/ts/node_modules/typescript/index.js': 'module.exports = 3;\n',
    'tests/other/package-lock.json': '{}\n',
    'py/pyproject.toml': '[project]\nname = "own"\n',
    'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.0.1"\n',
    'py/src/own/__init__.py': '',
    [`${venv}/pyvenv.cfg`]: 'home = /usr/bin\n',
    [`${venv}/bin/tool`]: `#!${main}/${venv}/bin/python\nimport own\n`,
    [`${venv}/bin/activate`]: `VIRTUAL_ENV='${main}/${venv}'\n`,
    [`${site}/dep/__init__.py`]: '',
    [`${site}/__editable__.own.pth`]: `${main}/py/src\n`,
    [`${site}/__editable__.sibling.pth`]: `${parent}/sibling/src\n`,
    'Makefile': 'link-state-check:\n\ttest -f node_modules/@polyspec/kit/scripts/kit/link.mts\n',
    '.gitignore': 'node_modules/\n.venv/\nvar/\n',
  });
  linkKit(main);
  chmodSync(path.join(main, venv, 'bin/tool'), 0o755);
  symlinkSync(process.execPath, path.join(main, venv, 'bin/python3.14'));
  symlinkSync('python3.14', path.join(main, venv, 'bin/python'));
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const uv = stubUv(parent);
  const quiet = { print: () => {}, uv };
  const check = (folder: string) => {
    assert.ok(existsSync(path.join(folder, 'var/worktree-python/py/.venv/native-uv')), 'worktree setup records its native environment ownership');
    assert.ok(lstatSync(path.join(folder, 'tools/ts/node_modules')).isDirectory(), 'a nested npm project has a node_modules of its own');
    assert.equal(readFileSync(path.join(folder, 'tools/ts/node_modules/typescript/index.js'), 'utf8'), 'native nested npm package\n');
    assert.equal(existsSync(path.join(folder, 'tests/other/node_modules')), false, 'a project that the main checkout did not install gets none');
    const real = (file: string) => lstatSync(path.join(folder, file));
    assert.ok(real(venv).isDirectory() && !real(venv).isSymbolicLink(), 'the .venv is a folder of its own');
    assert.equal(readFileSync(path.join(folder, venv, 'pyvenv.cfg'), 'utf8'), 'native uv environment\n', 'uv creates its own environment configuration');
    assert.ok(real(`${venv}/bin/python`).isFile(), 'the fixture uv creates the native interpreter entry');
    const sync: unknown = JSON.parse(readFileSync(path.join(folder, venv, 'native-sync.json'), 'utf8'));
    assert.ok(isJsonObject(sync) && Array.isArray(sync.args), 'uv fixture records the native locked sync');
    assert.ok(sync.args.includes('--locked'));
    assert.ok(sync.args.includes('--no-install-project'));
    assert.equal(sync.offline, '1');
    assert.equal(sync.cache, process.env.UV_CACHE_DIR || path.join(main, 'var/tools/mise/cache/uv'));
    assert.equal(sync.projectEnvironment, path.relative(path.join(folder, 'py'), path.join(folder, venv)));
    assert.equal(existsSync(path.join(folder, venv, 'native-editables.json')), false, 'no editable transaction runs without a declared local provider');
    assert.equal(existsSync(path.join(folder, site, '__editable__.own.pth')), false, 'kit does not copy or rewrite editable metadata');
    assert.equal(git(folder, 'status', '--porcelain'), '', 'the worktree has no change');
  };
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  check(folder);
  assert.equal(setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run converges');
  check(folder);
});

test('K550: native Composer creates executable worktree bin proxies and converges', t => {
  const { main, npm, composer } = nativeManagers(t);
  const options = { npm, composer, linkStateOnly: true, print: () => {} };
  const folder = setupWorktree(main, { name: 'bin', id: 'K550', type: 'fix' }, options);
  const bin = path.join(folder, 'vendor/bin/tool');
  assert.ok(lstatSync(bin).isFile());
  assert.ok((lstatSync(bin).mode & 0o111) !== 0);
  assert.equal(readFileSync(bin, 'utf8'), '#!/bin/sh\n# native Composer proxy\n');
  assert.equal(setupWorktree(main, { name: 'bin', id: 'K550', type: 'fix' }, options), folder);
  assert.equal(readFileSync(path.join(folder, 'vendor/autoload.php'), 'utf8'), folder);
});

// K555: a repository keeps its Python environment where its Makefile makes it, as crudui's var/python, the UV_PROJECT_ENVIRONMENT of its
// uv workspace; each folder with a pyvenv.cfg among the ignored folders of the main checkout, outside node_modules and the tools, is an
// environment of the worktree under the rule of K533, so its editable install names the worktree's sources.
test('worktree-setup gives a worktree a Python environment of the main checkout wherever it lives (K555)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  const site = 'var/python/lib/python3.14/site-packages';
  put(main, {
    '../kit/scripts/kit/link.mts': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'pyproject.toml': '[tool.uv.workspace]\nmembers = ["packages/validator"]\n',
    'packages/validator/pyproject.toml': '[project]\nname = "validator"\n',
    'packages/validator/src/validator/__init__.py': '',
    'var/python/pyvenv.cfg': 'home = /usr/bin\n',
    [`${site}/__editable__.validator.pth`]: `${main}/packages/validator/src\n`,
    'var/tools/mise/installs/python/venv/pyvenv.cfg': 'home = /usr/bin\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\nvar/\n',
  });
  linkKit(main);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const uv = stubUv(parent);
  const folder = setupWorktree(main, { name: 'venv', id: 'T9', type: 'fix' }, { print: () => {}, uv });
  assert.ok(lstatSync(path.join(folder, 'var/python')).isDirectory(), 'the environment at var/python is a folder of the worktree');
  assert.ok(existsSync(path.join(folder, 'var/python/native-sync.json')), 'uv fixture records the native locked sync');
  assert.equal(existsSync(path.join(folder, 'var/python/native-editables.json')), false, 'no editable transaction runs without a declared local provider');
  assert.equal(existsSync(path.join(folder, site, '__editable__.validator.pth')), false, 'kit does not rewrite .pth files');
  assert.equal(existsSync(path.join(folder, 'var/tools')), false, 'the tools of the main checkout are no environment of the worktree');
});

test('K557: native Composer owns installed records independently of main', t => {
  const { main, npm, composer } = nativeManagers(t);
  const options = { npm, composer, linkStateOnly: true, print: () => {} };
  const folder = setupWorktree(main, { name: 'records', id: 'K557', type: 'fix' }, options);
  const record = path.join(folder, 'vendor/composer/installed.json');
  assert.ok(lstatSync(record).isFile());
  assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')), { origin: folder });
  assert.equal(readFileSync(path.join(main, 'vendor/composer/installed.json'), 'utf8'), '{"origin":"main"}');
  assert.equal(setupWorktree(main, { name: 'records', id: 'K557', type: 'fix' }, options), folder);
  assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')), { origin: folder });
});

// K596: the user removed the disk floor on 2026-10-25: worktree-setup refuses no worktree for the free disk and trims no cache.
test('worktree-setup has no disk floor (K596)', async () => {
  const setup: Record<string, unknown> = await import('../../scripts/kit/worktree-setup.mts');
  assert.equal(setup.WORKTREE_DISK_FLOOR, undefined);
  assert.equal(setup.freeBytes, undefined);
});

test('K598: source providers are delegated to native npm link after offline ci', t => {
  const { main, npm, composer, log } = nativeManagers(t);
  initRepository(path.join(path.dirname(main), 'prov'), '--initial-branch=main');
  put(path.join(path.dirname(main), 'prov'), { 'package.json': '{"name":"@polyspec/x"}' });
  git(path.join(path.dirname(main), 'prov'), 'remote', 'add', 'origin', 'https://github.com/polyspec/prov.git');
  git(path.join(path.dirname(main), 'prov'), 'add', 'package.json');
  git(path.join(path.dirname(main), 'prov'), 'commit', '--quiet', '-m', 'provider');
  put(main, { 'package.json': '{"name":"fixture","dependencies":{"@polyspec/x":"1.0.0"}}' });
  git(main, 'add', 'package.json');
  git(main, 'commit', '--quiet', '-m', 'declare provider');
  const options = { npm, composer, linkStateOnly: true, print: () => {} };
  const folder = setupWorktree(main, { name: 'provider', id: 'K598', type: 'fix' }, options);
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line): unknown => JSON.parse(line));
  assert.ok(calls.some(call => isJsonObject(call) && call.tool === 'npm' && call.cwd === path.join(path.dirname(main), 'prov') && Array.isArray(call.args) && call.args[0] === 'link'));
  assert.ok(calls.some(call => isJsonObject(call) && call.tool === 'npm' && call.cwd === folder && Array.isArray(call.args) && call.args.includes('@polyspec/x')));
  assert.equal(readFileSync(path.join(main, 'package.json'), 'utf8'), '{"name":"fixture","dependencies":{"@polyspec/x":"1.0.0"}}');
});

// K615: link writes a git-ignored go.work beside each go.mod of the main checkout, whose relative uses reach the sibling checkouts;
// a worktree is a sibling of the main checkout, so the same file at the same place reaches the same checkouts. Without it the
// worktree's Go build reads a release of the sibling module from the module cache. A tracked go.work is the worktree's own.
test('worktree-setup gives the worktree the git-ignored go.work and go.work.sum of the main checkout (K615)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    '../kit/scripts/kit/link.mts': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\ngo.work\ngo.work.sum\n!/tools/go.work\n',
    'packages/go/go.mod': 'module example.com/repo\n\ngo 1.27\n',
    'tools/go.mod': 'module example.com/tools\n\ngo 1.27\n',
    'tools/go.work': 'go 1.27\n\nuse .\n',
  });
  linkKit(main);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const work = 'go 1.27\n\nuse (\n\t.\n\t../../../dep/packages/go\n)\n';
  put(main, { 'packages/go/go.work': work, 'packages/go/go.work.sum': 'sum\n', 'tools/go.work': 'go 1.27\n\nuse (\n\t.\n\t../changed\n)\n' });
  const go = path.join(parent, 'go');
  writeFileSync(go, `#!/bin/sh\nprintf '%s\\n' '{"Use":[{"DiskPath":"."},{"DiskPath":"../../../dep/packages/go"}]}'\n`, { mode: 0o755 });
  const folder = setupWorktree(main, { name: 'gowork', id: 'K615', type: 'fix' }, { go, print: () => {} });
  assert.equal(readFileSync(path.join(folder, 'packages/go/go.work'), 'utf8'), work, 'the go.work that link wrote reaches the same siblings');
  assert.equal(readFileSync(path.join(folder, 'packages/go/go.work.sum'), 'utf8'), 'sum\n');
  writeFileSync(path.join(folder, 'packages/go/go.work.sum'), 'worktree checksum state\n');
  setupWorktree(main, { name: 'gowork', id: 'K615', type: 'fix' }, { go, print: () => {} });
  assert.equal(readFileSync(path.join(folder, 'packages/go/go.work.sum'), 'utf8'), 'worktree checksum state\n', 'repeat setup retains worktree checksum state');
  assert.equal(readFileSync(path.join(folder, 'tools/go.work'), 'utf8'), 'go 1.27\n\nuse .\n', 'a tracked go.work stays the committed one');
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the ignored go.work leaves the worktree with no change');
});

// K622: Composer archive inputs are copied independently; installed dependency state stays native-manager-owned.
test('worktree-setup links the var/composer-artifacts of the main checkout as independent immutable archive inputs (K622)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    '../kit/scripts/kit/link.mts': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\n/var/\n',
  });
  linkKit(main);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  put(main, { 'var/composer-artifacts/polyspec-orm-0.0.1.zip': 'zip\n' });
  const folder = setupWorktree(main, { name: 'artifacts', id: 'K622', type: 'fix' }, { print: () => {} });
  const link = path.join(folder, 'var/composer-artifacts');
  assert.ok(lstatSync(link).isDirectory() && !lstatSync(link).isSymbolicLink(), 'archive inputs are copied without a directory link');
  assert.notEqual(realpathSync(link), realpathSync(path.join(main, 'var/composer-artifacts')));
  assert.equal(readFileSync(path.join(link, 'polyspec-orm-0.0.1.zip'), 'utf8'), 'zip\n');
  assert.equal(setupWorktree(main, { name: 'artifacts', id: 'K622', type: 'fix' }, { print: () => {} }), folder, 'a second run converges');
  assert.ok(!lstatSync(link).isSymbolicLink());
});


test('K661-9: worktree tools resolve the installed public export for source and packed kits', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-tool-export-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  for (const file of ['scripts/kit/link.mts', 'dist/link.mjs']) {
    const folder = path.join(parent, file.endsWith('.mts') ? 'source' : 'packed');
    put(folder, {
      'node_modules/@polyspec/kit/package.json': file.endsWith('.mts') ? readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8') : packedFiles(path.resolve(import.meta.dirname, '../..'))['package.json'] ?? '',
      [`node_modules/@polyspec/kit/${file}`]: 'export {};\n',
    });
    assert.equal(worktreeLinkTool(folder), path.join(folder, 'node_modules/@polyspec/kit', file));
  }
});

/** Tiny native-manager doubles own their output; main installed files serve only as unchanged legacy-state sentinels. */
function nativeManagers(t: TestContext) {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-native-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    '../kit/scripts/kit/link.mts': '',
    'package.json': '{"name":"fixture-workspace","private":true}',
    'package-lock.json': '{"lockfileVersion":3,"packages":{}}',
    'composer.json': '{"name":"fixture/project"}',
    'composer.lock': '{"packages":[]}',
    '.gitignore': 'node_modules/\nvendor/\nvar/\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    'node_modules/fixture-lib/value': 'main npm installation',
    'vendor/fixture/lib/value': 'main Composer installation',
    'vendor/composer/installed.json': '{"origin":"main"}',
    'vendor/composer/installed.php': '<?php return [];',
  });
  linkKit(main);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const npm = path.join(parent, 'npm');
  const composer = path.join(parent, 'composer');
  const log = path.join(parent, 'calls.jsonl');
  writeFileSync(npm, `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({tool:'npm',args,cwd:process.cwd(),allowRemote:process.env.npm_config_allow_remote})+'\\n');if(args[0]==='config')process.stdout.write(${JSON.stringify(path.join(parent, 'npm-cache'))});else if(args[0]==='ci'){if(fs.existsSync(${JSON.stringify(path.join(parent, 'cache-missing'))})){console.error('required package absent from offline cache');process.exit(41);}fs.mkdirSync('node_modules/fixture-lib',{recursive:true});fs.writeFileSync('node_modules/fixture-lib/value','native npm installation');}\n`, { mode: 0o755 });
  writeFileSync(composer, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({tool:'composer',args,cwd:process.cwd(),offline:process.env.COMPOSER_DISABLE_NETWORK,cache:process.env.COMPOSER_CACHE_DIR})+'\\n');if(args[0]==='config')process.stdout.write(process.env.COMPOSER_VENDOR_DIR||'vendor');else{fs.mkdirSync('vendor/composer',{recursive:true});fs.mkdirSync('vendor/fixture/lib',{recursive:true});fs.writeFileSync('vendor/fixture/lib/value','native Composer installation');fs.writeFileSync('vendor/composer/installed.json',JSON.stringify({origin:process.cwd()}));fs.writeFileSync('vendor/autoload.php',process.cwd());fs.mkdirSync('vendor/bin',{recursive:true});fs.writeFileSync('vendor/bin/tool','#!/bin/sh\\n# native Composer proxy\\n',{mode:0o755});}\n`, { mode: 0o755 });
  return { parent, main, npm, composer, log };
}

test('K690 native managers replace dependency projections using shared caches and leave main unchanged', t => {
  const { parent, main, npm, composer, log } = nativeManagers(t);
  const before = ['package.json', 'package-lock.json', 'composer.json', 'composer.lock', 'node_modules/fixture-lib/value', 'vendor/fixture/lib/value'].map(file => readFileSync(path.join(main, file), 'utf8'));
  const folder = setupWorktree(main, { name: 'native', id: 'K690', type: 'fix' }, { npm, composer, linkStateOnly: true, print: () => {} });
  assert.equal(readFileSync(path.join(folder, 'node_modules/fixture-lib/value'), 'utf8'), 'native npm installation');
  assert.equal(readFileSync(path.join(folder, 'vendor/fixture/lib/value'), 'utf8'), 'native Composer installation');
  const record: unknown = JSON.parse(readFileSync(path.join(folder, 'vendor/composer/installed.json'), 'utf8'));
  assert.ok(isJsonObject(record));
  assert.equal(record.origin, folder);
  const calls = readFileSync(log, 'utf8');
  assert.ok(calls.includes('"ci","--offline","--cache",'+JSON.stringify(path.join(parent, 'npm-cache'))), calls);
  assert.ok(calls.includes('"install","--no-interaction","--no-progress","--prefer-dist"'), calls);
  assert.ok(calls.includes('"offline":"1"'), calls);
  assert.ok(calls.includes('"allowRemote":"root"'), 'offline ci retains npm root-only remote policy');
  assert.deepEqual(['package.json', 'package-lock.json', 'composer.json', 'composer.lock', 'node_modules/fixture-lib/value', 'vendor/fixture/lib/value'].map(file => readFileSync(path.join(main, file), 'utf8')), before);
});

test('K690 a missing offline npm cache fails normally without changing main dependencies', t => {
  const { parent, main, npm, composer } = nativeManagers(t);
  writeFileSync(path.join(parent, 'cache-missing'), '');
  assert.throws(() => setupWorktree(main, { name: 'missing', id: 'K690', type: 'fix' }, { npm, composer, linkStateOnly: true, print: () => {} }), /exit status 41/);
  assert.equal(readFileSync(path.join(main, 'node_modules/fixture-lib/value'), 'utf8'), 'main npm installation');
});
