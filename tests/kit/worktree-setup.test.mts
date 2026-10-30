// Tests of scripts/kit/worktree-setup.mts (K348, K858): the worktree of a row is made from main beside the main checkout, and make install
// and make link-check run in it, so it installs its own tools, packages and links; a second run converges.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { setupWorktree } from '../../scripts/kit/worktree-setup.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

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

test('worktree-setup makes the worktree of a row from main, runs make install and make link-check in it, and a second run converges (K348, K858)', (t) => {
  // make install writes its own var/tools; link-check reads it, so the check fails unless the install ran in the worktree first.
  const main = repository(t, {
    'Makefile': 'install:\n\tmkdir -p var/tools && echo "$(CURDIR)" >> var/tools/installs.txt && echo "$$PATH" > var/tools/path.txt\nlink-check:\n\ttest -f var/tools/installs.txt\n',
    '.gitignore': '/var/\n',
  });
  const quiet = { print: () => {} };
  const mainTools = path.join(main, 'var/tools/bin');
  const folder = setupWorktree(main, { name: 'parser', id: 'T1', type: 'fix' }, { ...quiet, env: { ...process.env, PATH: [mainTools, process.env.PATH].join(path.delimiter) } });
  assert.equal(readFileSync(path.join(folder, 'var/tools/path.txt'), 'utf8').split(path.delimiter).includes(mainTools), false, 'make install runs none of the tools of the main checkout');
  assert.equal(folder, path.join(path.dirname(main), 'repo-parser-T1'));
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fix/parser-T1');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'main'), 'the branch starts at main');
  assert.equal(readFileSync(path.join(folder, 'var/tools/installs.txt'), 'utf8'), `${folder}\n`, 'make install ran in the worktree');
  assert.equal(existsSync(path.join(main, 'var')), false, 'the main checkout is unchanged');
  const listed = git(main, 'worktree', 'list', '--porcelain');
  assert.equal(setupWorktree(folder, { name: 'parser', id: 'T1', type: 'fix' }, quiet), folder, 'a second run, also from the worktree, finds the same worktree');
  assert.equal(git(main, 'worktree', 'list', '--porcelain'), listed, 'and leaves the same worktrees');
});

test('worktree-setup runs npm ci of the npm that devEngines.packageManager names in a worktree without node_modules, and make without the flags of the calling make (K858)', (t) => {
  // The Makefile includes a file that only npm ci writes, as a consumer includes kit from node_modules.
  const main = repository(t, {
    'Makefile': 'include node_modules/kit.mk\n',
    'package.json': JSON.stringify({ devEngines: { packageManager: { name: 'npm', version: '12.2.0' } } }),
    'package-lock.json': '{}\n',
    '.gitignore': '/node_modules/\n/var/\n',
  });
  const bin = path.join(path.dirname(main), 'bin');
  // K938-1: the npm of the devEngines refuses to run in a folder that declares devEngines (EBADDEVENGINES of npm 11 in a consumer), so
  // npm ci runs from outside the folder with --prefix; the fake writes its calls and its installed kit to the paths that the call names.
  const calls = path.join(path.dirname(main), 'npm-calls.txt');
  put(bin, { 'npm': `#!/bin/sh
if [ -f "$PWD/package.json" ] && grep -q devEngines "$PWD/package.json"; then echo "EBADDEVENGINES" >&2; exit 1; fi
echo "$@" >> ${calls}
prefix=.
while [ $# -gt 0 ]; do if [ "$1" = --prefix ]; then prefix=$2; fi; shift; done
mkdir -p "$prefix/node_modules"
printf 'install:\\n\\techo "$$MAKEFLAGS|$$MAKELEVEL" > flags.txt\\nlink-check:\\n\\ttrue\\n' > "$prefix/node_modules/kit.mk"
` });
  chmodSync(path.join(bin, 'npm'), 0o755);
  const env = { ...process.env, PATH: [bin, process.env.PATH].join(path.delimiter), MAKEFLAGS: 's', MAKELEVEL: '1' };
  const folder = setupWorktree(main, { name: 'consumer', id: 'T4', type: 'fix' }, { print: () => {}, env });
  assert.equal(readFileSync(calls, 'utf8'), `exec --yes --package=npm@12.2.0 -- npm --prefix ${folder} ci --ignore-scripts --allow-remote=root\n`);
  const [flags = '', level] = readFileSync(path.join(folder, 'flags.txt'), 'utf8').trim().split('|');
  assert.deepEqual([flags.split(/\s+/).includes('s'), level], [false, '1'], 'make install runs as a make of its own, without the -s and the level of the calling make');
  setupWorktree(main, { name: 'consumer', id: 'T4', type: 'fix' }, { print: () => {}, env });
  assert.equal(readFileSync(calls, 'utf8').split('\n').length, 2, 'a worktree with node_modules gets no second npm ci');
});

test('worktree-setup refuses a devEngines.packageManager of npm without a version, naming the field, before it runs any npm (K938)', (t) => {
  const main = repository(t, {
    'Makefile': 'include node_modules/kit.mk\n',
    'package.json': JSON.stringify({ devEngines: { packageManager: { name: 'npm' } } }),
    'package-lock.json': '{}\n',
    '.gitignore': '/node_modules/\n/var/\n',
  });
  assert.throws(() => setupWorktree(main, { name: 'consumer', id: 'T6', type: 'fix' }, { print: () => {} }), /devEngines\.packageManager of package\.json names npm without a version; declare the npm version there/);
});

// K938-1: a consumer that adopted no npm:npm declares only packageManager (orm); its worktree has no node_modules, so make install
// could only fail at the include of kit. The refusal comes before any npm or make runs, and names what to declare.
// K938-1: the outer npm of npm ci writes into its working directory, so it runs in a folder of its own under the temporary root and
// nothing it writes stays in that root (a stray node_modules there broke every mkdtemp user of Node resolution).
test('worktree-setup runs the outer npm in a temporary folder of its own and leaves nothing in the temporary root (K938-1)', (t) => {
  const main = repository(t, {
    'Makefile': 'include node_modules/kit.mk\n',
    'package.json': JSON.stringify({ devEngines: { packageManager: { name: 'npm', version: '12.2.0' } } }),
    'package-lock.json': '{}\n',
    '.gitignore': '/node_modules/\n/var/\n',
  });
  const bin = path.join(path.dirname(main), 'bin');
  const box = path.join(path.dirname(main), 'tmp-root');
  mkdirSync(box);
  const savedTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = box;
  t.after(() => { if (savedTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmpdir; });
  // The fake npm writes into its working directory, as npm does, and installs the kit file into the prefix that the call names.
  put(bin, { 'npm': '#!/bin/sh\nmkdir -p "$PWD/node_modules"\ntouch "$PWD/node_modules/leak.txt"\nprefix=.\nwhile [ $# -gt 0 ]; do if [ "$1" = --prefix ]; then prefix=$2; fi; shift; done\nmkdir -p "$prefix/node_modules"\nprintf \'install:\\n\\ttrue\\nlink-check:\\n\\ttrue\\n\' > "$prefix/node_modules/kit.mk"\n' });
  chmodSync(path.join(bin, 'npm'), 0o755);
  const env = { ...process.env, TMPDIR: box, PATH: [bin, process.env.PATH].join(path.delimiter) };
  setupWorktree(main, { name: 'tmpfolder', id: 'T8', type: 'fix' }, { print: () => {}, env });
  assert.deepEqual(readdirSync(box), [], 'the temporary root holds nothing after the run');
});

test('worktree-setup refuses a package.json with no devEngines.packageManager of npm, before it runs npm or make, and names what to declare (K938-1)', (t) => {
  const main = repository(t, {
    'Makefile': 'include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\n',
    'package.json': JSON.stringify({ packageManager: 'npm@12.2.0+sha512.00' }),
    'package-lock.json': '{}\n',
    '.gitignore': '/node_modules/\n/var/\n',
  });
  const bin = path.join(path.dirname(main), 'bin');
  put(bin, { 'npm': `#!/bin/sh\necho "$@" >> ${path.join(path.dirname(main), 'npm-calls.txt')}\n` });
  chmodSync(path.join(bin, 'npm'), 0o755);
  const env = { ...process.env, PATH: [bin, process.env.PATH].join(path.delimiter) };
  const printed: string[] = [];
  assert.throws(
    () => setupWorktree(main, { name: 'adopt', id: 'T7', type: 'fix' }, { print: text => printed.push(text), env }),
    /package\.json declares no devEngines\.packageManager of npm.*"devEngines".*"npm:npm" = "12\.2\.0" in mise\.toml/,
  );
  assert.equal(printed.some(text => text.includes('make --no-print-directory') || text.includes('make install')), false, 'no make runs');
  assert.equal(existsSync(path.join(path.dirname(main), 'npm-calls.txt')), false, 'no npm runs');
});

test('worktree-setup links the installed kit to the kit checkout that the link declaration of the main checkout names before make install, as install-link does, and leaves a release copy with none (K858, K869)', (t) => {
  // npm ci installs the release copy of the lock, whose make install refuses; the live kit checkout beside the consumer passes.
  const consumer = (name: string) => repository(t, {
    'Makefile': 'include node_modules/@polyspec/kit/kit.mk\n',
    'package.json': JSON.stringify({ name: 'consumer', devEngines: { packageManager: { name: 'npm', version: '12.2.0' } } }),
    'package-lock.json': '{}\n',
    '.gitignore': '/node_modules/\n/var/\n/.links\n',
  }, name);
  const npm = (parent: string) => {
    // K938-1: npm ci runs with --prefix from outside the folder, so the fake installs into the prefix the call names.
    put(path.join(parent, 'bin'), { 'npm': '#!/bin/sh\nprefix=.\nwhile [ $# -gt 0 ]; do if [ "$1" = --prefix ]; then prefix=$2; fi; shift; done\nmkdir -p "$prefix/node_modules/@polyspec/kit"\nprintf \'{"name":"@polyspec/kit"}\' > "$prefix/node_modules/@polyspec/kit/package.json"\nprintf \'install:\\n\\texit 7\\nlink-check:\\n\\ttrue\\n\' > "$prefix/node_modules/@polyspec/kit/kit.mk"\n' });
    chmodSync(path.join(parent, 'bin', 'npm'), 0o755);
    return { ...process.env, PATH: [path.join(parent, 'bin'), process.env.PATH].join(path.delimiter) };
  };
  const linked = consumer('linked');
  const parent = path.dirname(linked);
  const kit = path.join(parent, 'kit');
  initRepository(kit, '--initial-branch=main');
  put(kit, { 'package.json': JSON.stringify({ name: '@polyspec/kit' }), 'kit.mk': 'install:\n\ttrue\nlink-check:\n\ttrue\n' });
  git(kit, 'add', '-A');
  git(kit, 'commit', '--quiet', '-m', 'base');
  put(linked, { '.links': '../kit\n' });
  const folder = setupWorktree(linked, { name: 'live', id: 'T5', type: 'fix' }, { print: () => {}, env: npm(parent) });
  assert.equal(realpathSync(path.join(folder, 'node_modules/@polyspec/kit')), realpathSync(kit), 'make install ran the kit checkout');
  assert.equal(path.isAbsolute(readlinkSync(path.join(folder, 'node_modules/@polyspec/kit'))), false, 'a relative link, as install-link makes');
  const alone = consumer('alone');
  assert.throws(() => setupWorktree(alone, { name: 'release', id: 'T6', type: 'fix' }, { print: () => {}, env: npm(path.dirname(alone)) }), /make --no-print-directory install ended with exit status 2/, 'with no link declaration the release copy runs');
});

test('worktree-setup fails with the target whose make fails, and refuses a folder that is no worktree of the branch (K858)', (t) => {
  const main = repository(t, { 'Makefile': 'install:\n\texit 3\nlink-check:\n\ttrue\n' });
  assert.throws(() => setupWorktree(main, { name: 'broken', id: 'T2', type: 'fix' }, { print: () => {} }), /make --no-print-directory install ended with exit status 2 in /);
  put(path.dirname(main), { 'repo-taken-T3/file': 'x' });
  assert.throws(() => setupWorktree(main, { name: 'taken', id: 'T3', type: 'fix' }, { print: () => {} }), /exists and is no worktree of fix\/taken-T3/);
});

// K865: kit downloads no package and links nothing of var/ between checkouts; a worktree installs its own, as any checkout does.
test('worktree-setup links nothing of the var/ of the main checkout into the worktree (K865)', (t) => {
  // The config/release-assets.json of an earlier kit declared archives that worktree-setup linked from the main checkout.
  const asset = (name: string, directory: string) => ({ name, version: '0.0.1', url: `https://example.invalid/v{version}/${name}-{version}.zip`, sha256: '0'.repeat(64), directory });
  const main = repository(t, { 'config/release-assets.json': JSON.stringify({ schema: 1, assets: [asset('ext', 'var/products'), asset('orm', 'var/composer-artifacts')] }), 'Makefile': 'install:\n\ttrue\nlink-check:\n\ttrue\n', '.gitignore': '/var/\n' });
  put(main, { 'var/products/ext-0.0.1.zip': 'ext zip\n', 'var/composer-artifacts/orm-0.0.1.zip': 'orm zip\n' });
  const folder = setupWorktree(main, { name: 'artifacts', id: 'K865', type: 'fix' }, { print: () => {} });
  assert.equal(existsSync(path.join(folder, 'var/products')), false);
  assert.equal(existsSync(path.join(folder, 'var/composer-artifacts')), false);
});
