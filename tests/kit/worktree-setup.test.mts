// Tests of scripts/kit/worktree-setup.mts (K348, K858, K1107): the worktree that the caller declares is made from its base, and the
// preparation and the make targets of the caller run in it, so it installs its own tools, packages and links; a second run converges.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { declarationOf, setupWorktree, type WorktreeDeclaration } from '../../scripts/kit/worktree-setup.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';
import { tool } from './kit-tools.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

/** A main checkout under a fresh folder with `files` committed on main; removed with `t.after`. */
function repository(t: TestContext, files: Record<string, string>, name = 'repo'): string {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-worktree-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, name);
  initRepository(main, '--initial-branch=main');
  put(main, files);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  return main;
}

/** The declaration of kit's own recipe for the row `name`-`id` of `main`: beside it, on fix/<name>-<id> from main (K1107). */
const row = (main: string, name: string, id: string, extra: Partial<WorktreeDeclaration> = {}): WorktreeDeclaration =>
  ({ folder: `${main}-${name}-${id}`, branch: `fix/${name}-${id}`, base: 'main', targets: ['install', 'link-check'], ...extra });

test('worktree-setup makes the worktree of a row from main, runs make install and make link-check in it, and a second run converges (K348, K858)', (t) => {
  // make install writes its own var/tools; link-check reads it, so the check fails unless the install ran in the worktree first.
  const main = repository(t, {
    'Makefile': 'install:\n\tmkdir -p var/tools && echo "$(CURDIR)" >> var/tools/installs.txt\nlink-check:\n\ttest -f var/tools/installs.txt\n',
    '.gitignore': '/var/\n',
  });
  const quiet = { print: () => {} };
  const folder = setupWorktree(main, row(main, 'parser', 'T1'), quiet);
  assert.equal(folder, path.join(path.dirname(main), 'repo-parser-T1'));
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/parser-T1');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'main'), 'the branch starts at main');
  assert.equal(readFileSync(path.join(folder, 'var/tools/installs.txt'), 'utf8'), `${folder}\n`, 'make install ran in the worktree');
  assert.equal(existsSync(path.join(main, 'var')), false, 'the main checkout is unchanged');
  const listed = git(main, 'worktree', 'list', '--porcelain');
  assert.equal(setupWorktree(folder, row(main, 'parser', 'T1'), quiet), folder, 'a second run, also from the worktree, finds the same worktree');
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'and leaves the same worktrees');
});

// K1107: the folder, the branch, its base and every command are the caller's, and they run with the caller's environment as it is.
// The preparation runs in the worktree before the make targets; a declaration without targets runs no make, an incomplete one
// creates nothing, and a bare call of the command is a usage error (exit 2).
test('worktree-setup runs the preparation and the make targets that its caller declares, and none without them (K1107)', (t) => {
  const main = repository(t, {
    'Makefile': 'include node_modules/kit.mk\n',
    '.gitignore': '/node_modules/\n/var/\n',
  });
  const prepare = 'mkdir -p node_modules && printf \'install:\\n\\techo "$$KIT_K1107" > flags.txt\\n\' > node_modules/kit.mk && pwd >> ../prepared.txt';
  const env = { ...process.env, KIT_K1107: 'kept' };
  const declared = declarationOf(['--folder', '../repo-own', '--branch', 'feature/own', '--base', 'main', '--prepare', prepare, '--make', 'install']);
  const folder = setupWorktree(main, declared, { print: () => {}, env });
  assert.equal(folder, path.join(path.dirname(main), 'repo-own'), 'the folder is the caller\'s, against the checkout it runs in');
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/own');
  assert.equal(readFileSync(path.join(path.dirname(main), 'prepared.txt'), 'utf8'), `${folder}\n`, 'the preparation runs in the worktree');
  assert.equal(readFileSync(path.join(folder, 'flags.txt'), 'utf8'), 'kept\n', 'make runs with the environment of the caller as it is');
  const bare = setupWorktree(main, { folder: '../repo-bare', branch: 'bare', base: 'main', targets: [] }, { print: () => {} });
  assert.equal(existsSync(path.join(bare, 'node_modules')), false, 'no preparation and no make run without a declaration');
  assert.throws(() => setupWorktree(main, declarationOf(['--branch', 'none']), { print: () => {} }), /needs --folder, --branch and --base/);
  assert.throws(() => declarationOf(['--folder', 'a', '--folder', 'b']), /unexpected argument "--folder"/);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/none'], { cwd: main }).status, 1, 'the refused declaration creates no branch');
  const call = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/worktree-setup.mts'))], { cwd: main, encoding: 'utf8' });
  assert.equal(call.status, 2, 'a bare call is a usage error');
});

// K858, K869: the order is the caller's: the preparation first, then each --make target in the order given, so a consumer that links
// its packages before the first install declares --make link --make install --make link-check.
test('worktree-setup runs the --make targets in the order given, after the preparation (K858, K869, K1107)', (t) => {
  const main = repository(t, {
    'Makefile': ['link:', '\techo link >> ../order.txt', 'install:', '\techo install >> ../order.txt', 'link-check:', '\techo link-check >> ../order.txt', ''].join('\n'),
  });
  const declared = declarationOf(['--folder', '../repo-order', '--branch', 'order', '--base', 'main', '--prepare', 'echo prepare >> ../order.txt', '--make', 'link', '--make', 'install', '--make', 'link-check']);
  setupWorktree(main, declared, { print: () => {} });
  assert.equal(readFileSync(path.join(path.dirname(main), 'order.txt'), 'utf8'), 'prepare\nlink\ninstall\nlink-check\n');
});

// K858: kit's own recipe runs worktree-setup in WORKTREE_ENVIRONMENT, so make install in the worktree runs none of the tools of the
// main checkout and none of the flags of the calling make. The definition is read from kit.mk and run in a make that, as kit.mk does,
// puts its var/tools first on PATH.
test('make install runs none of the tools of the main checkout: kit\'s recipe drops its var/tools and the flags of make (K858)', (t) => {
  const kitMk = readFileSync(new URL('../../scripts/kit/kit.mk', import.meta.url), 'utf8');
  const definition = /^WORKTREE_ENVIRONMENT = .*$/m.exec(kitMk)?.[0];
  assert.ok(definition, 'kit.mk defines WORKTREE_ENVIRONMENT');
  const main = repository(t, {
    'Makefile': ['KIT_TOOLS := $(CURDIR)/var/tools', 'export PATH := $(KIT_TOOLS)/bin:$(KIT_TOOLS)/mise/shims:$(PATH)', definition, 'probe:', '\t@$(WORKTREE_ENVIRONMENT) sh -c \'printf "%s|%s|%s" "$$PATH" "$$MAKEFLAGS" "$$MAKELEVEL"\' > probe.txt', ''].join('\n'),
  });
  const probe = spawnSync('make', ['-s', 'probe', 'NAME=x'], { cwd: main, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const [entries = '', flags, level] = readFileSync(path.join(main, 'probe.txt'), 'utf8').split('|');
  const tools = path.join(main, 'var/tools');
  assert.deepEqual(entries.split(':').filter(entry => entry.startsWith(tools)), [], 'no var/tools of the main checkout on PATH');
  assert.ok(entries.split(':').length > 0 && entries !== '', 'the rest of PATH stays');
  assert.deepEqual([flags, level], ['', ''], 'no flag and no level of the calling make');
});

test('worktree-setup fails with the target whose make fails, and refuses a folder that is no worktree of the branch (K858)', (t) => {
  const main = repository(t, { 'Makefile': 'install:\n\texit 3\nlink-check:\n\ttrue\n' });
  assert.throws(() => setupWorktree(main, row(main, 'broken', 'T2'), { print: () => {} }), /make --no-print-directory install ended with exit status 2 in /);
  put(path.dirname(main), { 'repo-taken-T3/file': 'x' });
  assert.throws(() => setupWorktree(main, row(main, 'taken', 'T3'), { print: () => {} }), /exists and is no worktree of fix\/taken-T3/);
});

// K865: kit downloads no package and links nothing of var/ between checkouts; a worktree installs its own, as any checkout does.
test('worktree-setup links nothing of the var/ of the main checkout into the worktree (K865)', (t) => {
  // The config/release-assets.json of an earlier kit declared archives that worktree-setup linked from the main checkout.
  const asset = (name: string, directory: string) => ({ name, version: '0.0.1', url: `https://example.invalid/v{version}/${name}-{version}.zip`, sha256: '0'.repeat(64), directory });
  const main = repository(t, { 'config/release-assets.json': JSON.stringify({ schema: 1, assets: [asset('ext', 'var/products'), asset('orm', 'var/composer-artifacts')] }), 'Makefile': 'install:\n\ttrue\nlink-check:\n\ttrue\n', '.gitignore': '/var/\n' });
  put(main, { 'var/products/ext-0.0.1.zip': 'ext zip\n', 'var/composer-artifacts/orm-0.0.1.zip': 'orm zip\n' });
  const folder = setupWorktree(main, row(main, 'artifacts', 'K865'), { print: () => {} });
  assert.equal(existsSync(path.join(folder, 'var/products')), false);
  assert.equal(existsSync(path.join(folder, 'var/composer-artifacts')), false);
});
