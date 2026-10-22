// Tests of scripts/kit/worktree-setup.mts (K348): the worktree of a row is made from main beside the main checkout, linked to the main
// checkout's node_modules with nothing installed (K519) and checked, a second run converges, and no worktree is made under the floor of
// free disk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.ok(lstatSync(path.join(folder, 'node_modules')).isSymbolicLink());
  assert.equal(readlinkSync(path.join(folder, 'node_modules')), path.join(main, 'node_modules'));
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the link is excluded, so the worktree has no change');
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
test('worktree-setup refuses a worktree that holds node_modules of its own (K519)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, { 'node_modules/.keep': '', 'Makefile': 'link-state-check:\n\ttrue\n', '.gitignore': 'node_modules/\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-own-K519');
  git(main, 'worktree', 'add', '--quiet', '-b', 'fix/own-K519', folder, 'main');
  mkdirSync(path.join(folder, 'node_modules'));
  const quiet = { free: () => WORKTREE_DISK_FLOOR, print: () => {} };
  assert.throws(() => setupWorktree(main, { name: 'own', id: 'K519', type: 'fix' }, quiet), /node_modules exists and is not the link to .*; remove it, since a worktree installs nothing \(K519\)/);
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
  writeFileSync(composer, `#!/bin/sh\necho "$* [$(pwd)] network=$COMPOSER_DISABLE_NETWORK" >> "${log}"\necho "<?php // the autoload of $(pwd)" > vendor-php/autoload.php\n`, { mode: 0o755 });
  const folder = setupWorktree(main, { name: 'php', id: 'T5', type: 'fix' }, { free: () => WORKTREE_DISK_FLOOR, print: () => {}, composer });
  const vendor = path.join(folder, 'vendor-php');
  assert.equal(lstatSync(vendor).isSymbolicLink(), false, 'the vendor folder is a real folder');
  assert.equal(realpathSync(path.join(vendor, 'acme/lib')), realpathSync(path.join(main, 'vendor-php/acme/lib')), 'a package links to the main checkout');
  assert.equal(realpathSync(path.join(vendor, 'bin')), realpathSync(path.join(main, 'vendor-php/bin')));
  assert.equal(realpathSync(path.join(vendor, 'demo/self')), realpathSync(path.join(folder, 'packages/self')), 'a path repository resolves inside the worktree');
  assert.equal(realpathSync(path.join(vendor, 'composer/installed.json')), realpathSync(path.join(main, 'vendor-php/composer/installed.json')));
  assert.equal(realpathSync(path.join(vendor, 'composer/installed.php')), realpathSync(path.join(main, 'vendor-php/composer/installed.php')));
  assert.equal(existsSync(path.join(vendor, 'composer/autoload_psr4.php')), false, 'no autoload of the main checkout is linked');
  assert.equal(readFileSync(log, 'utf8'), `dump-autoload --no-interaction [${folder}] network=1\n`);
  assert.equal(readFileSync(path.join(vendor, 'autoload.php'), 'utf8'), `<?php // the autoload of ${folder}\n`, 'the autoload is that of the worktree');
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the worktree has no change');
});
