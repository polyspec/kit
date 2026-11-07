// Tests of scripts/kit/land.mts (K394): make land rebases a branch that main left behind, merges it fast-forward, then removes its
// branch and worktree; it runs no gate and judges no commit (K1053).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { land, machineListing, removeLanded, removeMerged, worktreeProcesses } from '../../scripts/kit/land.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

// The checklist declaration of every kit repository, which the commit rules of land read (K892).
const CHECKLIST = { 'config/checklist.json': JSON.stringify({ schema: 1, hooks: [], idPattern: '[A-Z][0-9]+' }) };

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
test('both land cleanup paths retain a declared backup branch and its worktree', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-retained-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  const folder = path.join(parent, 'repo-backup');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  put(main, { 'tracked.txt': 'base\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'backup/cancelled-T1', 'main');
  put(folder, { 'tracked.txt': 'backup\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'cancelled work');
  const pinned = git(main, 'rev-parse', 'refs/heads/backup/cancelled-T1');
  git(main, 'merge', '--quiet', '--ff-only', 'backup/cancelled-T1');
  put(main, { 'config/retained-branches.json': JSON.stringify({ schema: 1, branches: [{ branch: 'backup/cancelled-T1', commit: pinned, reason: 'The user cancelled this development and asked to retain its local backup.', removalCondition: 'The user authorizes removal of the backup branch.' }] }) + '\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'declare retained backup');

  const printed: string[] = [];
  removeMerged(main, 'another-branch', line => printed.push(line));
  await removeLanded(main, 'backup/cancelled-T1', folder, undefined, line => printed.push(line));
  assert.equal(git(main, 'rev-parse', 'refs/heads/backup/cancelled-T1'), pinned);
  assert.equal(existsSync(folder), true);
  assert.equal(printed.filter(line => line.includes('kept backup/cancelled-T1 at')).length, 2, printed.join('\n'));
});

test('make land merges a rebased branch fast-forward and removes its branch and worktree (K394)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  // lint-x fails on a file bad.txt under src; docs-check and commits-check are the other kit gates and pass.
  put(main, {
    'Makefile': 'kit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttest ! -f src/bad.txt\nbuild:\n\ttrue\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['lint-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const base = git(main, 'rev-parse', 'main');
  const quiet = { print: () => {} };

  // A branch that changes src/a.txt lands.
  const folderA = path.join(parent, 'repo-a');
  git(main, 'worktree', 'add', '--quiet', folderA, '-b', 'feat/a', 'main');
  put(folderA, { 'src/a.txt': 'a\n', 'var/install.txt': 'installed\n' });
  git(folderA, 'add', '-A');
  git(folderA, 'commit', '--quiet', '-m', 'a');
  const branchA = git(main, 'rev-parse', 'feat/a');
  await land(main, 'feat/a', quiet);
  assert.equal(git(main, 'rev-parse', 'main'), branchA, 'main fast-forwards to the branch');
  assert.equal(existsSync(folderA), false, 'the worktree is removed');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/a'], { cwd: main }).status, 1, 'the branch is deleted');

  const mainBefore = git(main, 'rev-parse', 'main');

  // A branch that is not rebased on main: it forks from the base, which main has left behind; land rebases it in its worktree
  // and merges it on top of main (K495-1).
  const folderC = path.join(parent, 'repo-c');
  git(main, 'worktree', 'add', '--quiet', folderC, '-b', 'feat/c', base);
  put(folderC, { 'src/c.txt': 'c\n' });
  git(folderC, 'add', '-A');
  git(folderC, 'commit', '--quiet', '-m', 'c');
  await land(main, 'feat/c', quiet);
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'c', 'the rebased branch lands');
  assert.equal(git(main, 'rev-parse', 'main^'), mainBefore, 'on top of main');
});

// K603: land fast-forwards and removes the branch and worktree; it does not run the full build before or after the merge.
test('make land fast-forwards and cleans up without invoking either build (K603)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  const buildCalls = path.join(parent, 'build-calls');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  put(main, {
    'Makefile': `kit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttest ! -f src/bad.txt\nbuild:\n\techo "$$(pwd)" >> '${buildCalls}'; exit 7\n`,
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['lint-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-k603');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat/k603', 'main');
  put(folder, { 'src/landed.txt': 'landed\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'landed');
  const branch = git(main, 'rev-parse', 'feat/k603');

  await land(main, 'feat/k603', { print: () => {} });

  assert.equal(git(main, 'rev-parse', 'main'), branch, 'main fast-forwards to the branch');
  assert.equal(existsSync(folder), false, 'the worktree is removed');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/k603'], { cwd: main }).status, 1, 'the branch is deleted');
  assert.equal(existsSync(buildCalls), false, 'land does not invoke make build in the branch or main checkout');
});

// K429-1: the shell that runs make land, and every ancestor of land, may name the worktree in its command line or stand in it;
// they run make land and are no process of the worktree.
test('land leaves its own ancestors out of the processes of the worktree (K429-1)', () => {
  const ps = [
    '  300     1 zsh -c cd /work/kit/repo-x && git log; cd ../repo && make land BRANCH=x',
    '  301   300 make land BRANCH=x',
    '  302   301 node scripts/kit/land.mts x',
    '  303     1 mysqld --datadir=/work/kit/repo-x/.runtime/db',
  ].join('\n');
  const lsof = ['p300', 'n/work/kit/repo-x', 'p303', 'n/work/kit/repo-x/.runtime'].join('\n');
  assert.deepEqual(worktreeProcesses('/work/kit/repo-x', { ps, lsof }, 302).map(live => live.pid), [303]);
});

// K626: land reads the branch, not its worktree, so a process that runs in the worktree (a working directory inside it, an open file or
// an executable there, K441-1) blocks no merge; the worktree and its branch are kept, and the next land removes them once no process
// runs there. The unit case feeds fixed ps and lsof outputs; the real case starts a process in the worktree.
test('land merges while a process runs in the worktree, keeps it, and the next land removes it (K626)', async (t) => {
  const folder = '/work/kit/repo-x';
  const ps = [
    '  101     1 node server.mjs --datadir=/work/kit/repo-x/.runtime/db',
    '  102     1 node server.mjs --datadir=/work/kit/repo-x-other/.runtime/db',
    '  103     1 sleep 60',
    '  104     1 sleep 5',
    `  ${process.pid}     1 node --test /work/kit/repo-x/tests`,
  ].join('\n');
  const lsof = ['p103', 'n/work/kit/repo-x/sub', 'p104', 'n/work/kit/repo-x-other', 'p105', 'n/home', `p${process.pid}`, 'n/work/kit/repo-x'].join('\n');
  assert.deepEqual(worktreeProcesses(folder, { ps, lsof }).map(live => live.pid), [103], 'the process 101 only names the worktree in its arguments, so it is no use of it (K441-1)');

  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  put(main, {
    'Makefile': 'kit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttest ! -f src/bad.txt\nbuild:\n\ttrue\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['lint-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folderX = path.join(parent, 'repo-x');
  git(main, 'worktree', 'add', '--quiet', folderX, '-b', 'feat-x', 'main');
  put(folderX, { 'src/x.txt': 'x\n' });
  git(folderX, 'add', '-A');
  git(folderX, 'commit', '--quiet', '-m', 'x');
  const mainBefore = git(main, 'rev-parse', 'main');
  // A process started in the worktree, with a path of it in its arguments, as make orm-test-servers starts mysqld in its --datadir.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `${folderX}/marker`], { cwd: folderX, detached: false });
  t.after(() => child.kill());
  assert.equal(typeof child.pid, 'number', 'the child process starts');
  const lines: string[] = [];
  await land(main, 'feat-x', { print: line => lines.push(line) });
  assert.notEqual(git(main, 'rev-parse', 'main'), mainBefore, 'the branch is merged while a process runs in its worktree');
  assert.ok(lines.some(line => line.includes(`${child.pid} `) && line.includes('kept the worktree')), lines.join('\n'));
  assert.equal(existsSync(folderX), true, 'the worktree is kept while its process runs');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-x'], { cwd: main }).status, 0, 'the branch is kept');
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
  const folderY = path.join(parent, 'repo-y');
  git(main, 'worktree', 'add', '--quiet', folderY, '-b', 'feat-y', 'main');
  put(folderY, { 'src/y.txt': 'y\n' });
  git(folderY, 'add', '-A');
  git(folderY, 'commit', '--quiet', '-m', 'y');
  // K628: a fresh branch, made from main with no commit of its own, is a row about to start; main contains it, but it is not merged.
  const folderZ = path.join(parent, 'repo-z');
  git(main, 'worktree', 'add', '--quiet', folderZ, '-b', 'feat-z', 'main');
  await land(main, 'feat-y', { print: () => {} });
  assert.equal(existsSync(folderZ), true, 'a fresh worktree is kept (K628)');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-z'], { cwd: main }).status, 0, 'and its branch (K628)');
  assert.equal(existsSync(folderX), false, 'the next land removes the kept worktree once no process runs in it');
  assert.notEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-x'], { cwd: main }).status, 0, 'and deletes its branch');
});

// K441-1: a process uses a worktree when its working directory, one of its open files or its executable lies in it (lsof). A path that
// only its command line names, as the argument of du -sh, is no use of it, so it blocks no land.
test('a process uses a worktree by its cwd, an open file or its executable, not by a path in its arguments (K441-1)', { timeout: 60000 }, async (t) => {
  const folder = '/work/kit/repo-x';
  const ps = [
    '  201     1 node server.mjs --datadir=/work/kit/repo-x/.runtime/db',
    '  202     1 /work/kit/repo-x/bin/tool',
    '  203     1 sleep 60',
    '  204     1 sleep 5',
    '  205     1 du -sh /work/kit/repo-x/a /work/kit/repo-x/b',
    '  206     1 sleep 7',
  ].join('\n');
  const lsof = ['p202', 'n/work/kit/repo-x/bin/tool', 'p203', 'n/work/kit/repo-x/sub', 'p204', 'n/work/kit/repo-x/.runtime/db.lock', 'p205', 'n/home', 'p206', 'n/home', 'n/work/kit/repo-x-other'].join('\n');
  assert.deepEqual(worktreeProcesses(folder, { ps, lsof }).map(live => live.pid), [202, 203, 204], 'the executable, the cwd and the open file count; the arguments of 201 and 205 do not');

  // The real machine: a process whose argument names the worktree, started elsewhere, is no use of it.
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-usage-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const named = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `${parent}/repo-named/marker`], { cwd: parent });
  t.after(() => named.kill());
  await once(named, 'spawn');
  assert.equal(worktreeProcesses(path.join(parent, 'repo-named'), machineListing()).some(live => live.pid === named.pid), false, 'a process named by its arguments only is no use of the worktree');
});

// K441: a repository declares WORKTREE_STOP, the make target that stops the servers of its worktree. make land runs it in the
// worktree after the merge and before the removal, so the server that the test started is gone when the worktree is removed.
test('make land stops the servers of the worktree before it removes the worktree (K441)', { timeout: 60000 }, async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  // stop-servers kills the pid that server.pid of the worktree names, as the server-stop target of orm stops its servers.
  put(main, {
    'Makefile': 'WORKTREE_STOP := stop-servers\nkit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttrue\nstop-servers:\n\tkill "$$(cat server.pid)"\nbuild:\n\ttrue\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['lint-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\nserver.pid\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-srv');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-srv', 'main');
  put(folder, { 'src/a.txt': 'a\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'srv');
  // A server started with a path in the worktree, as make orm-test-servers starts mysqld with its --datadir.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `${folder}/data`]);
  t.after(() => child.kill());
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  put(folder, { 'server.pid': `${child.pid}\n` });
  const head = git(main, 'rev-parse', 'feat-srv');
  await land(main, 'feat-srv', { print: () => {} });
  await exited;
  assert.equal(child.signalCode, 'SIGTERM', 'stop-servers kills the server before the removal');
  assert.equal(git(main, 'rev-parse', 'main'), head, 'main fast-forwards to the branch');
  assert.equal(existsSync(folder), false, 'the worktree is removed');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-srv'], { cwd: main }).status, 1, 'the branch is deleted');
});

// K441: a stop target that fails refuses the removal of the worktree and names the target and its output.
test('make land keeps the worktree and names the stop target when it fails (K441)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  put(main, {
    'Makefile': 'WORKTREE_STOP := stop-broken\nkit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttrue\nstop-broken:\n\t@echo "the servers do not stop" >&2; exit 3\nbuild:\n\ttrue\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['lint-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-broken');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-broken', 'main');
  put(folder, { 'src/a.txt': 'a\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'broken');
  await assert.rejects(() => land(main, 'feat-broken', { print: () => {} }), (error: Error) => error.message.includes('stop-broken') && error.message.includes('the servers do not stop'));
  assert.equal(existsSync(folder), true, 'the worktree is kept');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-broken'], { cwd: main }).status, 0, 'the branch is kept');
});

// K495: land holds a lock in the common git folder for its rebase and merge: a land that finds the lock of a running land waits for
// it, and the lock of a land that no longer runs is removed.
function lockFixture(t: { after: (fn: () => void) => void }, lint: (main: string) => string = () => 'true') {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  put(main, {
    'Makefile': `kit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\t${lint(main)}\nbuild:\n\ttrue\n`,
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['lint-x'] }] }, null, 2) + '\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-x');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat/x', 'main');
  put(folder, { 'src/x.txt': 'x\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'x');
  return { main, branch: git(main, 'rev-parse', 'feat/x'), lock: path.join(main, '.git/kit-land.lock') };
}

test('a land waits for the land that holds the lock and lands after it (K495)', async (t) => {
  const { main, branch, lock } = lockFixture(t);
  const holder = spawn('sleep', ['60']);
  t.after(() => holder.kill());
  writeFileSync(lock, JSON.stringify({ pid: holder.pid, branch: 'feat/other' }));
  const printed: string[] = [];
  let waits = 0;
  // The first land finishes while the second waits: its lock goes away.
  const options = { print: (text: string) => printed.push(text), sleep: () => { waits += 1; rmSync(lock); } };
  await land(main, 'feat/x', options);
  assert.ok(printed.some(text => text.includes(`waits for the land of feat/other (pid ${holder.pid})`)), printed.join('\n'));
  assert.ok(waits >= 1, 'the land waited');
  assert.equal(git(main, 'rev-parse', 'main'), branch, 'the waiting land lands after the first');
  assert.equal(existsSync(lock), false, 'the lock is released after the land');
});

test('a land removes the lock of a land that no longer runs (K495)', async (t) => {
  const { main, branch, lock } = lockFixture(t);
  const gone = spawnSync('true').pid;
  writeFileSync(lock, JSON.stringify({ pid: gone, branch: 'feat/gone' }));
  const printed: string[] = [];
  await land(main, 'feat/x', { print: text => printed.push(text) });
  assert.ok(printed.some(text => text.includes(`removed the lock of the land of feat/gone (pid ${gone})`)), printed.join('\n'));
  assert.equal(git(main, 'rev-parse', 'main'), branch);
  assert.equal(existsSync(lock), false);
});

// K495-1: land rebases a branch that main has left behind onto main in its own clean worktree, under its lock, and runs its gates on
// the rebased commits; a rebase that conflicts is aborted, leaves the branch as it was and refuses naming the file.
test('land rebases a branch behind main in its worktree and lands it, and refuses a conflicting rebase naming the file (K495-1)', async (t) => {
  const { main } = lockFixture(t);
  // main moves after the branch forked: another land put src/other.txt on it.
  put(main, { 'src/other.txt': 'other\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'other');
  const printed: string[] = [];
  await land(main, 'feat/x', { print: text => printed.push(text) });
  assert.ok(printed.some(text => /rebased feat\/x on main/.test(text)), printed.join('\n'));
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'x', 'main holds the rebased branch');
  assert.equal(git(main, 'log', '-2', '--format=%s', 'main').split('\n')[1], 'other', 'on top of the commit that moved main');

  // A branch that changes src/x.txt while main changes it too: the rebase conflicts, and nothing changes.
  const folder = path.join(path.dirname(main), 'repo-y');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat/y', 'main');
  put(folder, { 'src/x.txt': 'y\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'y');
  const branchY = git(main, 'rev-parse', 'feat/y');
  put(main, { 'src/x.txt': 'main\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'main changes x');
  const mainBefore = git(main, 'rev-parse', 'main');
  await assert.rejects(() => land(main, 'feat/y', { print: () => {} }), /src\/x\.txt/);
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'nothing is merged');
  assert.equal(git(main, 'rev-parse', 'feat/y'), branchY, 'the branch is as it was');
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the aborted rebase leaves the worktree clean');
});

test('K516: land called from a detached worktree lands into the main checkout (K516)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  put(main, {
    'Makefile': 'kit-gates: docs-check commits-check\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nbuild:\n\ttrue\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['docs-check'] }] }, null, 2) + '\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const detached = path.join(parent, 'repo-detached');
  git(main, 'worktree', 'add', '--quiet', '--detach', detached, 'main');
  const folder = path.join(parent, 'repo-k516');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat/k516', 'main');
  put(folder, { 'src/x.txt': 'x\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'x');
  const tip = git(main, 'rev-parse', 'feat/k516');
  await land(detached, 'feat/k516', { print: () => {} });
  assert.equal(git(main, 'rev-parse', 'main'), tip, 'main of the main checkout moves to the branch');
  git(main, 'checkout', '--quiet', '--detach');
  await assert.rejects(() => land(detached, 'feat/none', { print: () => {} }), /no checkout has main checked out/);
});

// K646: consumers run the sources of kit (K613) and npm's prepack builds dist at release, so a land into kit builds nothing. The Makefile
// here marks each kit-build.
test('a land into kit that changes one of its sources builds no dist (K646)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  const marker = path.join(parent, 'built');
  put(main, {
    'package.json': JSON.stringify({ name: '@polyspec/kit', version: '0.0.0' }),
    'Makefile': `kit-gates: docs-check commits-check\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nkit-build:\n\ttouch ${marker}\n`,
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['scripts/**'], targets: ['docs-check'] }] }) + '\n',
    'scripts/kit/a.mts': 'export const a = 1;\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-k609');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat/k609', 'main');
  put(folder, { 'scripts/kit/a.mts': 'export const a = 2;\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'a');
  await land(main, 'feat/k609', { print: () => {} });
  assert.equal(existsSync(marker), false, 'no make kit-build runs after the merge');
});

// K634: the source-sha256 line of a Korean twin is the hash of its English file, so two rows that change the English file conflict on it in
// every rebase. land keeps one line, stamps it again with make documents-stamp and continues; a conflict in any other line still refuses.
test('land resolves a rebase conflict that is only the source-sha256 line of a Korean twin (K634)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, CHECKLIST);
  // documents-stamp writes the sha256 of README.md into the marker of README.ko.md, as the stamp of kit does.
  // It stamps only the twins of PATHS (K877), so the land must name the conflicted twin.
  const stamp = 'documents-stamp:\n\t@test "$(PATHS)" = README.ko.md\n\t@sum=$$(shasum -a 256 README.md | cut -d" " -f1); sed -i.bak "s/source-sha256: [0-9a-f]*/source-sha256: $$sum/" $(PATHS) && rm -f $(PATHS).bak';
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', stamp, ''].join('\n'),
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['README.md', 'README.ko.md', 'Makefile'], targets: ['docs-check'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'README.md': 'one\n\ntwo\n\nthree\n',
    'README.ko.md': '<!-- source-sha256: 0 -->\n하나\n\n둘\n\n셋\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const stamped = (folder: string) => spawnSync('make', ['--no-print-directory', 'documents-stamp', 'PATHS=README.ko.md'], { cwd: folder, encoding: 'utf8' }).status;
  const folder = path.join(parent, 'repo-x');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-x', 'main');
  put(folder, { 'README.md': 'one\n\ntwo\n\nthree, changed by the branch\n' });
  assert.equal(stamped(folder), 0);
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'x');
  put(main, { 'README.md': 'one, changed by main\n\ntwo\n\nthree\n' });
  assert.equal(stamped(main), 0);
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'main moves');
  await land(main, 'feat-x', { print: () => {} });
  const readme = readFileSync(path.join(main, 'README.md'), 'utf8');
  assert.equal(readme, 'one, changed by main\n\ntwo\n\nthree, changed by the branch\n', 'both changes of the English file land');
  const sum = spawnSync('shasum', ['-a', '256', 'README.md'], { cwd: main, encoding: 'utf8' }).stdout.split(' ')[0];
  assert.equal(readFileSync(path.join(main, 'README.ko.md'), 'utf8').split('\n')[0], `<!-- source-sha256: ${sum} -->`, 'the marker is stamped for the merged English file');
});


// K1053: land runs no gate and judges no commit message; it rebases, merges fast-forward and cleans up, so a branch whose Makefile
// declares a failing gate and whose commit breaks a commit rule of kit lands as it is.
test('land merges a branch without running its gates or judging its commits (K1053)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, { 'Makefile': 'kit-gates: docs-check\ndocs-check:\n\tfalse\n', '.gitignore': 'var/\n', 'src/.keep': '' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-any');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'any', 'main');
  put(folder, { 'src/a.txt': 'a\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'fix(core): Keep the state (#S1)');
  const tip = git(main, 'rev-parse', 'any');
  const lines: string[] = [];
  await land(main, 'any', { print: text => lines.push(text) });
  assert.equal(git(main, 'rev-parse', 'main'), tip, 'the branch lands as it is');
  assert.doesNotMatch(lines.join('\n'), /docs-check in /, 'no gate runs');
  assert.equal(existsSync(folder), false, 'the worktree is removed');
});
