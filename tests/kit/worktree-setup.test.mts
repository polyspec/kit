// Tests of scripts/kit/worktree-setup.mts (K348): the worktree of a row is made from main beside the main checkout, its node_modules
// linked entry by entry to the main checkout's with nothing installed (K519, K530) and checked, a second run converges, and no worktree is made under the floor of
// free disk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setupWorktree, WORKTREE_DISK_FLOOR } from '../../scripts/kit/worktree-setup.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('worktree-setup makes the worktree of a row from main, links its node_modules, installs nothing and checks it, and a second run converges (K348, K519)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // An install of the fixture would write installs.txt; the check reads the node_modules that the worktree links.
  // The link rebuild of K482 runs the link tool of the consumer from the linked node_modules, so the fixture has a no-op one.
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'install:\n\techo installed >> installs.txt\nlink-state-check:\n\ttest -f node_modules/@polyspec/kit/dist/link.mjs\n',
    '.gitignore': 'installs.txt\nnode_modules/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  assert.equal(folder, path.join(parent, 'repo-parser-T1'));
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/parser-T1');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'main'), 'the branch starts at main');
  assert.equal(existsSync(path.join(folder, 'installs.txt')), false, 'the worktree installs nothing');
  assert.ok(lstatSync(path.join(folder, 'node_modules')).isDirectory(), 'the node_modules of the worktree is a folder of its own (K530)');
  assert.equal(realpathSync(path.join(folder, 'node_modules/@polyspec/kit')), realpathSync(path.join(main, 'node_modules/@polyspec/kit')));
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the ignored node_modules leaves the worktree with no change');
  const listed = git(main, 'worktree', 'list', '--porcelain');
  assert.equal(setupWorktree(folder, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run, also from the worktree, finds the same worktree');
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'and leaves the same worktrees');
  assert.throws(() => setupWorktree(main, { name: 'lexer', id: 'T2', type: 'fix' }, { ...quiet, free: () => WORKTREE_DISK_FLOOR - 1 }), /under the floor of 30 GB for a new worktree/);
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'no worktree is made under the floor');
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
    'node_modules/@polyspec/kit/dist/link.mjs': "import { mkdirSync, writeFileSync } from 'node:fs';\nconst [, , command, target] = process.argv;\nif (command !== 'rebuild' || target !== '.') process.exit(2);\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/index.d.ts', 'built\\n');\n",
    'Makefile': 'install:\n\ttrue\nlink-state-check:\n\ttest -f dist/index.d.ts\n',
    // The build is ignored at the root only: an unrooted dist/ would also ignore the link tool under node_modules/@polyspec/kit/dist.
    '.gitignore': '/dist/\nnode_modules/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const lines: string[] = [];
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: (text: string) => lines.push(text) };
  const folder = setupWorktree(main, { name: 'builder', id: 'K482', type: 'fix' }, quiet);
  assert.equal(readFileSync(path.join(folder, 'dist/index.d.ts'), 'utf8'), 'built\n');
  assert.ok(lines.some(line => line.includes('link rebuild in')), lines.join('\n'));
});

// K519: a worktree whose node_modules is a folder of its own is refused, since a worktree installs nothing.
test('worktree-setup refuses a package installed in the node_modules of a worktree (K519, K530)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, { 'node_modules/.keep': '', 'Makefile': 'link-state-check:\n\ttrue\n', '.gitignore': 'node_modules/\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-own-K519');
  git(main, 'worktree', 'add', '--quiet', '-b', 'fix/own-K519', folder, 'main');
  // A package installed in the worktree, which the main checkout's node_modules lacks, is refused (K530: the folder itself is the
  // worktree's own, of links).
  mkdirSync(path.join(folder, 'node_modules/left-pad'), { recursive: true });
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  assert.throws(() => setupWorktree(main, { name: 'own', id: 'K519', type: 'fix' }, quiet), /node_modules\/left-pad is no entry of .*; remove it, since a worktree installs nothing \(K519\)/);
});

// K521: each Composer project gets a real vendor folder of links in the worktree and an autoload of its own, so the repository's own
// classes load from the worktree: a package and bin link to the main checkout's, a path repository that resolves inside the main
// checkout links to the same path of the worktree, the installed records link to the main checkout's, and composer dump-autoload runs
// offline in the project; nothing is installed.
test('worktree-setup gives a Composer project a vendor folder of links and its own autoload (K521)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\nvendor-php/\n',
    'composer.json': JSON.stringify({ name: 'demo/app', config: { 'vendor-dir': 'vendor-php' }, autoload: { 'psr-4': { 'App\\': 'src/' } } }),
    'src/Own.php': '<?php\n',
    'packages/self/composer.json': JSON.stringify({ name: 'demo/self' }),
    'vendor-php/acme/lib/Lib.php': '<?php\n',
    'vendor-php/bin/tool': '#!/bin/sh\n',
    'vendor-php/composer/installed.json': '{"packages":[]}\n',
    'vendor-php/composer/installed.php': '<?php return [];\n',
    'vendor-php/composer/autoload_psr4.php': `<?php // ${main}/src\n`,
    'vendor-php/autoload.php': `<?php // the autoload of ${main}\n`,
  });
  mkdirSync(path.join(main, 'vendor-php/demo'), { recursive: true });
  symlinkSync('../../packages/self', path.join(main, 'vendor-php/demo/self'));
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  // The composer of the test writes the autoload of the folder it runs in and logs its arguments and network setting.
  const log = path.join(parent, 'composer.log');
  const composer = path.join(parent, 'composer');
  writeFileSync(composer, `#!/bin/sh\necho "$* [$(pwd)] network=$COMPOSER_DISABLE_NETWORK" >> "${log}"\necho "<?php // the autoload of $(pwd)" > vendor-php/autoload.php\necho "<?php // the autoload of $(pwd)" > vendor-php/composer/autoload_psr4.php\n`, { mode: 0o755 });
  const folder = setupWorktree(main, { name: 'php', id: 'T5', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR, print: () => {}, composer });
  const vendor = path.join(folder, 'vendor-php');
  assert.equal(lstatSync(vendor).isSymbolicLink(), false, 'the vendor folder is a real folder');
  assert.equal(realpathSync(path.join(vendor, 'acme/lib')), realpathSync(path.join(main, 'vendor-php/acme/lib')), 'a package links to the main checkout');
  assert.equal(realpathSync(path.join(vendor, 'bin/tool')), realpathSync(path.join(main, 'vendor-php/bin/tool')), 'a bin entry that is no proxy links (K550)');
  assert.equal(realpathSync(path.join(vendor, 'demo/self')), realpathSync(path.join(folder, 'packages/self')), 'a path repository resolves inside the worktree');
  for (const name of ['installed.json', 'installed.php']) assert.ok(lstatSync(path.join(vendor, 'composer', name)).isFile(), `${name} is a file of the worktree (K557)`);
  assert.equal(readFileSync(path.join(vendor, 'composer/autoload_psr4.php'), 'utf8'), `<?php // the autoload of ${folder}\n`, 'the autoload of vendor/composer is the one that dump-autoload wrote, never the main checkout\'s (K557)');
  assert.equal(readFileSync(log, 'utf8'), `dump-autoload --no-interaction [${folder}] network=1\n`);
  assert.equal(readFileSync(path.join(vendor, 'autoload.php'), 'utf8'), `<?php // the autoload of ${folder}\n`, 'the autoload is that of the worktree');
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the worktree has no change');
});

// K530: the node_modules of a worktree is a folder of its own: each third-party package and each .bin entry links to the main
// checkout's, and a package of the repository's own workspace, which the main checkout links to its own packages, links into the
// worktree, so the worktree resolves its own code. A link of the whole folder, which K519 made, is replaced.
test('worktree-setup links the node_modules of a worktree entry by entry, its own workspace packages into the worktree (K530)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'node_modules/@polyspec/kit/package.json': '{"name":"@polyspec/kit"}\n',
    'node_modules/left-pad/package.json': '{"name":"left-pad","main":"index.js"}\n',
    'node_modules/left-pad/index.js': 'module.exports = 1;\n',
    'node_modules/left-pad/bin.js': '#!/usr/bin/env node\n',
    'node_modules/.package-lock.json': '{}\n',
    'packages/own/package.json': '{"name":"@polyspec/own","main":"index.js"}\n',
    'packages/own/index.js': 'module.exports = 2;\n',
    'Makefile': 'link-state-check:\n\ttest -f node_modules/@polyspec/kit/dist/link.mjs\n',
    '.gitignore': 'node_modules/\n',
  });
  symlinkSync('../../packages/own', path.join(main, 'node_modules/@polyspec/own'));
  mkdirSync(path.join(main, 'node_modules/.bin'));
  symlinkSync('../left-pad/bin.js', path.join(main, 'node_modules/.bin/lp'));
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  const check = (folder: string) => {
    const modules = path.join(folder, 'node_modules');
    assert.ok(lstatSync(modules).isDirectory(), 'the node_modules of the worktree is a folder of its own');
    const resolve = createRequire(path.join(folder, 'index.js')).resolve;
    assert.equal(resolve('@polyspec/own'), realpathSync(path.join(folder, 'packages/own/index.js')), 'an own workspace package resolves under the worktree');
    assert.equal(resolve('left-pad'), realpathSync(path.join(main, 'node_modules/left-pad/index.js')), 'a third-party package resolves to the main checkout');
    assert.equal(realpathSync(path.join(modules, '.bin/lp')), realpathSync(path.join(main, 'node_modules/left-pad/bin.js')));
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

// K533: every tracked npm lock project and Python project whose environment the main checkout holds gets it in the worktree under the
// rule of K530: links to the main checkout's entries, while the files that the installer wrote with paths of the main checkout (the
// bin scripts, the activate scripts, an editable .pth that names a source of the main checkout) are written with the worktree's paths.
test('worktree-setup gives each npm project and each Python environment of the main checkout its environment in the worktree (K533)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  const venv = 'py/.venv';
  const site = `${venv}/lib/python3.14/site-packages`;
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'package-lock.json': '{}\n',
    'tools/ts/package-lock.json': '{}\n',
    'tools/ts/node_modules/typescript/index.js': 'module.exports = 3;\n',
    'tests/other/package-lock.json': '{}\n',
    'py/pyproject.toml': '[project]\nname = "own"\n',
    'py/src/own/__init__.py': '',
    [`${venv}/pyvenv.cfg`]: 'home = /usr/bin\n',
    [`${venv}/bin/tool`]: `#!${main}/${venv}/bin/python\nimport own\n`,
    [`${venv}/bin/activate`]: `VIRTUAL_ENV='${main}/${venv}'\n`,
    [`${site}/dep/__init__.py`]: '',
    [`${site}/__editable__.own.pth`]: `${main}/py/src\n`,
    [`${site}/__editable__.sibling.pth`]: `${parent}/sibling/src\n`,
    'Makefile': 'link-state-check:\n\ttest -f node_modules/@polyspec/kit/dist/link.mjs\n',
    '.gitignore': 'node_modules/\n.venv/\n',
  });
  chmodSync(path.join(main, venv, 'bin/tool'), 0o755);
  symlinkSync(process.execPath, path.join(main, venv, 'bin/python3.14'));
  symlinkSync('python3.14', path.join(main, venv, 'bin/python'));
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  const check = (folder: string) => {
    assert.ok(lstatSync(path.join(folder, 'tools/ts/node_modules')).isDirectory(), 'a nested npm project has a node_modules of its own');
    assert.equal(realpathSync(path.join(folder, 'tools/ts/node_modules/typescript')), realpathSync(path.join(main, 'tools/ts/node_modules/typescript')));
    assert.equal(existsSync(path.join(folder, 'tests/other/node_modules')), false, 'a project that the main checkout did not install gets none');
    const real = (file: string) => lstatSync(path.join(folder, file));
    assert.ok(real(venv).isDirectory() && !real(venv).isSymbolicLink(), 'the .venv is a folder of its own');
    assert.equal(realpathSync(path.join(folder, venv, 'pyvenv.cfg')), realpathSync(path.join(main, venv, 'pyvenv.cfg')));
    assert.equal(readlinkSync(path.join(folder, venv, 'bin/python3.14')), process.execPath, 'an interpreter link keeps its target');
    assert.equal(readlinkSync(path.join(folder, venv, 'bin/python')), 'python3.14');
    assert.equal(readFileSync(path.join(folder, venv, 'bin/tool'), 'utf8'), `#!${folder}/${venv}/bin/python\nimport own\n`, 'a script runs the worktree environment');
    assert.ok(real(`${venv}/bin/tool`).isFile() && (real(`${venv}/bin/tool`).mode & 0o111) !== 0, 'the script is a file that runs');
    assert.equal(readFileSync(path.join(folder, venv, 'bin/activate'), 'utf8'), `VIRTUAL_ENV='${folder}/${venv}'\n`);
    assert.equal(realpathSync(path.join(folder, site, 'dep')), realpathSync(path.join(main, site, 'dep')), 'a dependency links to the main checkout');
    assert.equal(readFileSync(path.join(folder, site, '__editable__.own.pth'), 'utf8'), `${folder}/py/src\n`, 'the own source is the worktree');
    assert.ok(real(`${site}/__editable__.sibling.pth`).isSymbolicLink(), 'a .pth that names no path of the main checkout links to it');
    assert.equal(git(folder, 'status', '--porcelain'), '', 'the worktree has no change');
  };
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet);
  check(folder);
  assert.equal(setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run converges');
  check(folder);
});

// K550: a Composer bin proxy computes the autoload from its own folder, which PHP resolves through links, so a vendor bin that links to
// the main checkout's would load the main checkout's autoload and sources; the bin of a worktree is a folder of its own, each proxy
// written there as the main checkout's generated it, and each link of it keeps its relative target into the packages.
test('worktree-setup writes the Composer bin proxies into the worktree, so a vendor binary autoloads the worktree (K550)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  const proxy = "#!/usr/bin/env php\n<?php\n/**\n * Proxy PHP file generated by Composer\n */\n$GLOBALS['_composer_autoload_path'] = __DIR__ . '/..'.'/autoload.php';\ninclude __DIR__ . '/..'.'/acme/lib/bin/tool';\n";
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'composer.json': JSON.stringify({ name: 'acme/app', config: { 'vendor-dir': 'vendor-php' } }),
    'vendor-php/acme/lib/bin/tool': '<?php echo "tool";\n',
    'vendor-php/acme/lib/bin/shell': '#!/bin/sh\n',
    'vendor-php/bin/tool': proxy,
    'vendor-php/composer/installed.json': '{"packages":[]}',
    'vendor-php/composer/installed.php': '<?php return [];\n',
    'vendor-php/autoload.php': '<?php // the autoload of the main checkout\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\nvendor-php/\n',
  });
  chmodSync(path.join(main, 'vendor-php/bin/tool'), 0o755);
  symlinkSync('../acme/lib/bin/shell', path.join(main, 'vendor-php/bin/shell'));
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const composer = path.join(parent, 'composer');
  writeFileSync(composer, '#!/bin/sh\necho "<?php // the autoload of $(pwd)" > vendor-php/autoload.php\n', { mode: 0o755 });
  const folder = setupWorktree(main, { name: 'bin', id: 'T6', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR, print: () => {}, composer });
  const bin = path.join(folder, 'vendor-php/bin');
  assert.equal(lstatSync(bin).isSymbolicLink(), false, 'the bin of the worktree is a folder of its own');
  assert.ok(lstatSync(path.join(bin, 'tool')).isFile(), 'a proxy is a file of the worktree, whose __DIR__ is the worktree');
  assert.equal(readFileSync(path.join(bin, 'tool'), 'utf8'), proxy);
  assert.ok((lstatSync(path.join(bin, 'tool')).mode & 0o111) !== 0, 'and it runs');
  assert.equal(readlinkSync(path.join(bin, 'shell')), '../acme/lib/bin/shell', 'a link of the bin keeps its relative target');
  assert.equal(setupWorktree(main, { name: 'bin', id: 'T6', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR, print: () => {}, composer }), folder, 'a second run converges');
});

// K538: the free disk under the floor is mostly the Go build cache of parallel worktree builds, which Go rebuilds on demand; the user
// allowed on 2026-10-23 that worktree-setup trims it, the entries of GOCACHE unused for two hours, reports the bytes it freed, and refuses
// only when the disk is still under the floor. Nothing else outside the repository is touched.
test('worktree-setup trims the Go build cache by age under the disk floor, and refuses only when still under it (K538)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const cache = path.join(parent, 'go-build');
  put(cache, { 'ab/old-a': 'x'.repeat(1000), 'cd/new-a': 'y'.repeat(10), 'README': 'the cache\n' });
  const hours = (count: number) => new Date(Date.now() - count * 3600 * 1000);
  utimesSync(path.join(cache, 'ab/old-a'), hours(3), hours(3));
  const lines: string[] = [];
  const free = () => (existsSync(path.join(cache, 'ab/old-a')) ? WORKTREE_DISK_FLOOR - 1 : WORKTREE_DISK_FLOOR);
  const folder = setupWorktree(main, { name: 'trim', id: 'T7', type: 'fix' }, { free, print: text => lines.push(text), goCache: () => cache });
  assert.ok(existsSync(folder), 'the worktree is made once the trim freed enough');
  assert.equal(existsSync(path.join(cache, 'ab/old-a')), false, 'an entry unused for two hours goes');
  assert.ok(existsSync(path.join(cache, 'cd/new-a')), 'a recent entry stays');
  assert.match(lines.join('\n'), /trimmed 1 entries of the Go build cache .*go-build, unused for 2 hours: 1000 bytes freed/);
  utimesSync(path.join(cache, 'cd/new-a'), hours(3), hours(3));
  assert.throws(() => setupWorktree(main, { name: 'still', id: 'T8', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR - 1, print: () => {}, goCache: () => cache }), /after the trim of the Go build cache freed 10 bytes, the free disk is .* under the floor/);
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
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'pyproject.toml': '[tool.uv.workspace]\nmembers = ["packages/validator"]\n',
    'packages/validator/pyproject.toml': '[project]\nname = "validator"\n',
    'packages/validator/src/validator/__init__.py': '',
    'var/python/pyvenv.cfg': 'home = /usr/bin\n',
    [`${site}/__editable__.validator.pth`]: `${main}/packages/validator/src\n`,
    'var/tools/mise/installs/python/venv/pyvenv.cfg': 'home = /usr/bin\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\nvar/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = setupWorktree(main, { name: 'venv', id: 'T9', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR, print: () => {} });
  assert.ok(lstatSync(path.join(folder, 'var/python')).isDirectory(), 'the environment at var/python is a folder of the worktree');
  assert.equal(readFileSync(path.join(folder, site, '__editable__.validator.pth'), 'utf8'), `${folder}/packages/validator/src\n`, 'its editable install names the sources of the worktree');
  assert.equal(existsSync(path.join(folder, 'var/tools')), false, 'the tools of the main checkout are no environment of the worktree');
});

// K557: composer dump-autoload writes the autoload of vendor/composer, not the files that composer install wrote there, such as
// InstalledVersions.php, which require installed.php through __DIR__, which PHP resolves through links; so each file of the main
// checkout's vendor/composer that the worktree lacks after dump-autoload is written as a file of the worktree, and the two sets match.
test('worktree-setup writes the files of vendor/composer that dump-autoload does not, so the worktree holds the main checkout\'s set (K557)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  const versions = "<?php\nclass InstalledVersions { public static function all() { return require __DIR__ . '/installed.php'; } }\n";
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'composer.json': JSON.stringify({ name: 'acme/app' }),
    'vendor/composer/installed.json': '{"packages":[]}',
    'vendor/composer/installed.php': "<?php return ['root' => ['install_path' => __DIR__ . '/../../']];\n",
    'vendor/composer/InstalledVersions.php': versions,
    'vendor/composer/LICENSE': 'MIT\n',
    'vendor/composer/autoload_psr4.php': '<?php // the main checkout\n',
    'vendor/autoload.php': '<?php // the main checkout\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\nvendor/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const composer = path.join(parent, 'composer');
  writeFileSync(composer, '#!/bin/sh\necho "<?php // the worktree" > vendor/autoload.php\necho "<?php // the worktree" > vendor/composer/autoload_psr4.php\n', { mode: 0o755 });
  const folder = setupWorktree(main, { name: 'files', id: 'T10', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR, print: () => {}, composer });
  const own = path.join(folder, 'vendor/composer');
  for (const name of ['installed.json', 'installed.php', 'InstalledVersions.php', 'LICENSE']) {
    assert.ok(lstatSync(path.join(own, name)).isFile(), `${name} is a file of the worktree, whose __DIR__ is the worktree`);
    assert.equal(readFileSync(path.join(own, name), 'utf8'), readFileSync(path.join(main, 'vendor/composer', name), 'utf8'));
  }
  assert.equal(readFileSync(path.join(own, 'autoload_psr4.php'), 'utf8'), '<?php // the worktree\n', 'the autoload is the one that dump-autoload wrote');
  assert.deepEqual(readdirSync(own).sort(), readdirSync(path.join(main, 'vendor/composer')).sort(), 'the worktree holds the set of the main checkout');
  assert.equal(setupWorktree(main, { name: 'files', id: 'T10', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR, print: () => {}, composer }), folder, 'a second run converges');
});

// K538-1: parallel builds keep the Go build cache young, so an age of two hours freed nothing while it held 5.1 GB (crudui,
// 2026-10-25); under the floor the cache is trimmed oldest first until the floor is met, sparing what was used in the last 10 minutes.
test('worktree-setup trims a young Go build cache oldest first until the disk floor is met, sparing the last 10 minutes (K538-1)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    'node_modules/@polyspec/kit/dist/link.mjs': 'const [, , command] = process.argv;\nif (command !== "rebuild") process.exit(2);\n',
    'Makefile': 'link-state-check:\n\ttrue\n',
    '.gitignore': 'node_modules/\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const cache = path.join(parent, 'go-build');
  put(cache, { 'ab/older': 'x'.repeat(600), 'cd/old': 'y'.repeat(600), 'ef/now': 'z'.repeat(600) });
  const minutes = (count: number) => new Date(Date.now() - count * 60 * 1000);
  utimesSync(path.join(cache, 'ab/older'), minutes(50), minutes(50));
  utimesSync(path.join(cache, 'cd/old'), minutes(30), minutes(30));
  utimesSync(path.join(cache, 'ef/now'), minutes(1), minutes(1));
  // 500 bytes are missing: the oldest entry frees them, and the next one stays.
  const free = () => WORKTREE_DISK_FLOOR - (existsSync(path.join(cache, 'ab/older')) ? 500 : 0);
  const lines: string[] = [];
  const folder = setupWorktree(main, { name: 'young', id: 'T9', type: 'fix' }, { free, print: text => lines.push(text), goCache: () => cache });
  assert.ok(existsSync(folder), 'the worktree is made once the trim met the floor');
  assert.equal(existsSync(path.join(cache, 'ab/older')), false, 'the oldest entry goes first');
  assert.ok(existsSync(path.join(cache, 'cd/old')), 'the trim stops once the floor is met');
  assert.match(lines.join('\n'), /trimmed 1 entries of the Go build cache .*go-build, oldest first, sparing the last 10 minutes: 600 bytes freed/);
  // Still under the floor after every entry older than 10 minutes went: the entry of the last minute stays, and setup refuses.
  assert.throws(() => setupWorktree(main, { name: 'short', id: 'T11', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR - 10_000, print: () => {}, goCache: () => cache }), /after the trim of the Go build cache freed 600 bytes, the free disk is .* under the floor/);
  assert.ok(existsSync(path.join(cache, 'ef/now')), 'an entry used in the last 10 minutes stays');
});
