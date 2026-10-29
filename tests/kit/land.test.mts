// Tests of scripts/kit/land.mts (K394): make land merges a rebased branch fast-forward only after the static gates that the
// changed paths of the branch select pass, then removes its branch and worktree; a refused branch leaves main unchanged.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, watch, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { land, machineListing, removeLanded, removeMerged, runGate, worktreeProcesses } from '../../scripts/kit/land.mts';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { initRepository } from './sandbox-repository.mts';
import { put, tree } from './tree.mts';
import { errorCode } from '../../scripts/kit/process.mts';

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

test('make land merges a rebased branch only after the gates it touches pass, and removes its branch and worktree (K394)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
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

  // A branch that changes src/a.txt: its gate lint-x runs in its own worktree and the branch lands.
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

  // A branch that adds src/bad.txt: lint-x fails in its worktree, so it is refused and main stays where it is.
  const folderB = path.join(parent, 'repo-b');
  git(main, 'worktree', 'add', '--quiet', folderB, '-b', 'feat/b', 'main');
  put(folderB, { 'src/bad.txt': 'bad\n' });
  git(folderB, 'add', '-A');
  git(folderB, 'commit', '--quiet', '-m', 'b');
  const mainBefore = git(main, 'rev-parse', 'main');
  await assert.rejects(() => land(main, 'feat/b', quiet), /lint-x/);
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'main is unchanged after the refusal');

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

// K603: land runs its selected gates, then fast-forwards and removes the branch and worktree; it does not run the full build before or after the merge.
test('make land fast-forwards and cleans up without invoking either build (K603)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  const buildCalls = path.join(parent, 'build-calls');
  initRepository(main, '--initial-branch=main');
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

// K807: a gate that fails in the worktree refuses the branch, whether or not it fails on main too; main is not run as a baseline.
test('land refuses a branch whose gate fails, also while the gate fails on main (K807)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // findings-x fails while findings.txt is not empty; main is red with src/a.txt.
  put(main, {
    'Makefile': ['kit-gates: docs-check findings-x', 'docs-check:', '\ttrue', 'findings-x:', '\t@test ! -s findings.txt', 'build:', '\ttrue'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'findings.txt'], targets: ['findings-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
    'findings.txt': 'src/a.txt\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-feat-a');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-a', 'main');
  put(folder, { 'src/b.txt': 'b\n', 'unowned.bin': 'x' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'feat-a');
  const before = git(main, 'rev-parse', 'main');
  await assert.rejects(() => land(main, 'feat-a', { print: () => {} }), /feat-a is refused: the gate findings-x exited 2; nothing is merged/);
  assert.equal(git(main, 'rev-parse', 'main'), before, 'main is unchanged');
});

test('land selects no gate that runs tests (K394-1)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // parity-check and test-x fail when run; the owner map selects both for src, so land must run neither.
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check parity-check test-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'parity-check:', '\tfalse', 'test-x:', '\tfalse', 'build:', '\ttrue'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['parity-check', 'test-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-a');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-a', 'main');
  put(folder, { 'src/a.txt': 'a\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'a');
  const branchA = git(main, 'rev-parse', 'feat-a');
  const printed: string[] = [];
  await land(main, 'feat-a', { print: text => printed.push(text) });
  assert.equal(git(main, 'rev-parse', 'main'), branchA, 'main fast-forwards to the branch');
  assert.ok(printed.includes('parity-check runs tests, which the Verification of the rows runs; land does not run it'));
  assert.ok(printed.includes('test-x runs tests, which the Verification of the rows runs; land does not run it'));
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

// K463: the command line of land refuses a gate that exits 2 with that exit status. The entry point runs land when the module loads, so
// the constants of the module must be initialized before it runs; the function test cannot see that order.
test('the land command refuses a gate that exits 2 with its exit status, not an error of the module (K463)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-cli-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // findings-x fails while findings.txt names a finding; main is green, so the branch that adds one is refused by its exit status.
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check findings-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'findings-x:', '\t@if [ -s findings.txt ]; then sed "s/^/finding: /" findings.txt; exit 1; fi', 'build:', '\ttrue'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'findings.txt'], targets: ['findings-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
    'findings.txt': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-feat-c');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-c', 'main');
  put(folder, { 'findings.txt': 'src/d.txt\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'feat-c');
  const before = git(main, 'rev-parse', 'main');
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, '../../scripts/kit/land.mts'), 'feat-c'], { cwd: main, encoding: 'utf8' });
  assert.notEqual(run.status, 0, 'the branch is refused');
  assert.match(run.stderr, /feat-c is refused: the gate findings-x exited 2; nothing is merged/, run.stderr);
  assert.doesNotMatch(run.stderr, /before initialization/, 'the refusal is not an error of the module');
  assert.equal(git(main, 'rev-parse', 'main'), before, 'main is unchanged after the refusal');
});

// K495: land is the only writer of main besides a commit that passed its pre-commit hook. It holds a lock in the common git folder
// for its whole run: a land that finds the lock of a running land waits for it, and the lock of a land that no longer runs is
// removed. Before its merge it refuses when main moved while its gates ran, naming the commits that moved it.
function lockFixture(t: { after: (fn: () => void) => void }, lint: (main: string) => string = () => 'true') {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
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

test('land refuses when main moves while its gates run and names the commit that moved it (K495)', async (t) => {
  // The gate of the branch commits on main, as another writer would while the gates run; the commit adds a file under src, the input
  // of the gate, so each rerun of the gate (K580) moves main again.
  const { main, lock } = lockFixture(t, root => `echo x > ${root}/src/moved-$$$$ && git -C ${root} add src && git -C ${root} -c user.name=t -c user.email=t@t commit --quiet -m moved-while-the-gates-ran`);
  await assert.rejects(() => land(main, 'feat/x', { print: () => {} }), (error: Error) => {
    assert.match(error.message, /moved-while-the-gates-ran/, 'the refusal names the commit that moved main');
    assert.match(error.message, /nothing is merged/);
    return true;
  });
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'moved-while-the-gates-ran', 'main keeps the commit of the other writer');
  assert.equal(existsSync(lock), false, 'the lock is released after a refusal');
});

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

// K531's inherited-output regression remains; its former whole-Make deadline is superseded by K685.
test('runGate drains inherited output and cleans processes left by Make without an operation deadline (K531, K685)', async (t) => {
  let pid: number | undefined;
  t.after(() => {
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch (error) { if (errorCode(error) !== 'ESRCH') throw error; }
  });
  const folder = tree(t, { Makefile: `left:\n\t@${process.execPath} -e 'setInterval(() => {}, 1000)' & echo $$! > child; echo checked\n` });
  const run = await runGate(folder, 'left');
  pid = Number(readFileSync(path.join(folder, 'child'), 'utf8'));
  assert.equal(run.result.status, 0);
  assert.equal(run.result.stdout, 'checked\n');
  const child = readFileSync(path.join(folder, 'child'), 'utf8').trim();
  const state = spawnSync('ps', ['-o', 'stat=', '-p', child], { encoding: 'utf8' });
  assert.ok(state.status !== 0 || state.stdout.trim().startsWith('Z'), `leftover process ${child} is active`);
});

// K571: the gates run without the land lock; the lock covers only checking that main is still the commit they ran on and fast-forwarding.
// A gate here fails in the worktree while the lock exists, and passes on main, so no comparison with main passes it.
test('the gates of a land run without the land lock, which covers only the merge (K571)', async (t) => {
  const { main, branch, lock } = lockFixture(t, () => 'if [ "$$(git rev-parse --abbrev-ref HEAD)" != main ]; then test ! -e $$(git rev-parse --git-common-dir)/kit-land.lock; fi');
  await land(main, 'feat/x', { print: () => {} });
  assert.equal(git(main, 'rev-parse', 'main'), branch, 'the branch lands');
  assert.equal(existsSync(lock), false, 'the lock is released after the merge');
});

// K571: a land whose main moved while its gates ran rebases and runs them again, up to LAND_ATTEMPTS times, instead of refusing.
test('a land whose main moved while its gates ran rebases and lands on the new main (K571)', async (t) => {
  const marker = (main: string) => path.join(path.dirname(main), 'moved');
  const { main } = lockFixture(t, root => `test -e ${marker(root)} || { touch ${marker(root)} && git -C ${root} -c user.name=t -c user.email=t@t commit --quiet --allow-empty -m moved-once; }`);
  const printed: string[] = [];
  await land(main, 'feat/x', { print: text => printed.push(text) });
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'x', 'the branch lands on the new main');
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main^'), 'moved-once', 'on top of the commit that moved main');
  assert.ok(printed.some(text => text.includes('moved-once') && text.includes('runs the gates again')), printed.join('\n'));
});

// K580: when main moves during the gates of a land, the land reruns only the gates that the paths of the moved commits select, and
// commits-check, since the rebased commits are new; a gate whose inputs no moved commit touched keeps its result. Here lint-x runs
// for src/**, and main moves once by a commit that touches no path of src.
test('a land whose main moved reruns only the gates that the moved commits select (K580)', async (t) => {
  const count = (main: string) => path.join(path.dirname(main), 'lint-runs');
  const marker = (main: string) => path.join(path.dirname(main), 'moved');
  const { main } = lockFixture(t, root => `echo run >> ${count(root)}; test -e ${marker(root)} || { touch ${marker(root)} && git -C ${root} -c user.name=t -c user.email=t@t commit --quiet --allow-empty -m moved-once; }`);
  const printed: string[] = [];
  await land(main, 'feat/x', { print: text => printed.push(text) });
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main^'), 'moved-once', 'the branch lands on the moved main');
  assert.equal(readFileSync(count(main), 'utf8'), 'run\n', 'lint-x ran once: the moved commit touches nothing that it checks');
  assert.ok(printed.some(text => text.includes('lint-x keeps its result')), printed.join('\n'));
});

// K646: consumers run the sources of kit (K613) and npm's prepack builds dist at release, so a land into kit builds nothing. The Makefile
// here marks each kit-build.
test('a land into kit that changes one of its sources builds no dist (K646)', async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
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
  // documents-stamp writes the sha256 of README.md into the marker of README.ko.md, as the stamp of kit does.
  const stamp = 'documents-stamp:\n\t@sum=$$(shasum -a 256 README.md | cut -d" " -f1); sed -i.bak "s/source-sha256: [0-9a-f]*/source-sha256: $$sum/" README.ko.md && rm -f README.ko.md.bak';
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', stamp, ''].join('\n'),
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['README.md', 'README.ko.md', 'Makefile'], targets: ['docs-check'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'README.md': 'one\n\ntwo\n\nthree\n',
    'README.ko.md': '<!-- source-sha256: 0 -->\n하나\n\n둘\n\n셋\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const stamped = (folder: string) => spawnSync('make', ['--no-print-directory', 'documents-stamp'], { cwd: folder, encoding: 'utf8' }).status;
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


test('gate output reaches the caller before the operation finishes (K685)', { timeout: 5000 }, async (t) => {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-progress-')));
  let driver: ReturnType<typeof spawn> | undefined;
  t.after(() => {
    if (driver?.pid) signalGroup(driver.pid, 'SIGKILL');
    const file = path.join(folder, 'group');
    if (existsSync(file)) signalGroup(Number(readFileSync(file, 'utf8')), 'SIGKILL');
    rmSync(folder, { recursive: true, force: true });
  });
  put(folder, {
    Makefile: `check:\n\t@${process.execPath} step.mjs\n`,
    'step.mjs': "import { watch, existsSync, writeFileSync } from 'node:fs';\nwriteFileSync('group', String(process.ppid));\nconst watcher = watch('.', () => { if (existsSync('release')) watcher.close(); });\nprocess.stdout.write('gate-progress-ready\\n');\n",
  });
  const module = new URL('../../scripts/kit/land.mts', import.meta.url).href;
  driver = spawn(process.execPath, ['--input-type=module', '-e', `import { runGate } from ${JSON.stringify(module)}; const run = await runGate(${JSON.stringify(folder)}, 'check'); console.log('gate-result=' + run.result.status);`], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  driver.stdout?.setEncoding('utf8').on('data', (text: string) => {
    stdout += text;
    if (stdout.includes('gate-progress-ready')) writeFileSync(path.join(folder, 'release'), '');
  });
  driver.stderr?.setEncoding('utf8').on('data', (text: string) => { stderr += text; });
  const active = driver;
  const status = await new Promise<number | null>(resolve => active.once('close', code => resolve(code)));
  assert.equal(status, 0, stderr);
  assert.match(stdout, /gate-result=0/);
  assert.ok(stdout.indexOf('gate-progress-ready') < stdout.indexOf('gate-result=0'), stdout);
});


test('a gate remains active across arbitrary clock advances and logs its command and outcome (K685)', async (t) => {
  const folder = tree(t, {
    Makefile: `check:\n\t@${process.execPath} step.mjs\n`,
    'step.mjs': "import { watch, existsSync, writeFileSync } from 'node:fs';\nconst listener = watch('.', () => { if (existsSync('clock-advanced')) listener.close(); });\nwriteFileSync('active', '');\nconsole.log('compiling step');\n",
  });
  const ready = new Promise<void>(resolve => {
    const listener = watch(folder, () => { if (existsSync(path.join(folder, 'active'))) { listener.close(); resolve(); } });
    t.after(() => listener.close());
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lines: string[] = [];
  const pending = runGate(folder, 'check', [], line => lines.push(line));
  await ready;
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  writeFileSync(path.join(folder, 'clock-advanced'), '');
  const gate = await pending;
  assert.equal(gate.result.status, 0, gate.result.stderr);
  assert.equal(gate.result.stdout, 'compiling step\n');
  assert.match(lines[0] ?? '', /make --no-print-directory -s check .*: started/);
  assert.ok(lines.some(line => line === 'stdout: compiling step'));
  assert.match(lines.at(-1) ?? '', /: passed \([^)]+\)/);
});


test('a land gate stops its command group when the calling parent disappears (K685)', { timeout: 10000 }, async (t) => {
  const folder = tree(t);
  let holder: ReturnType<typeof spawn> | undefined;
  let makeGroup: number | undefined;
  t.after(() => {
    if (holder?.pid) signalGroup(holder.pid, 'SIGKILL');
    if (makeGroup) signalGroup(makeGroup, 'SIGKILL');
  });
  const module = new URL('../../scripts/kit/land.mts', import.meta.url).href;
  put(folder, {
    Makefile: `check:\n\t@${process.execPath} gate.mjs\n`,
    'gate.mjs': "import { writeFileSync } from 'node:fs';\nwriteFileSync('make-group', String(process.ppid));\nconsole.log('gate-active');\nsetInterval(() => {}, 1000);\n",
    'driver.mjs': `import { runGate } from ${JSON.stringify(module)}; await runGate(${JSON.stringify(folder)}, 'check');`,
    'holder.mjs': "import { spawn } from 'node:child_process';\nspawn(process.execPath, ['driver.mjs'], { stdio: 'inherit' });\nsetInterval(() => {}, 1000);\n",
  });
  holder = spawn(process.execPath, ['holder.mjs'], { cwd: folder, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const parent = holder;
  parent.stdout?.setEncoding('utf8').on('data', (text: string) => { output += text; if (output.includes('gate-active')) { makeGroup = Number(readFileSync(path.join(folder, 'make-group'), 'utf8')); parent.kill('SIGKILL'); } });
  await new Promise<void>(resolve => parent.once('close', () => resolve()));
  assert.match(output, /gate-active/);
  const group = readFileSync(path.join(folder, 'make-group'), 'utf8').trim();
  const state = spawnSync('ps', ['-o', 'stat=', '-p', group], { encoding: 'utf8' });
  assert.ok(state.status !== 0 || state.stdout.trim().startsWith('Z'), `gate group ${group} remains active`);
});
