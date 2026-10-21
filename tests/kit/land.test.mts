// Tests of scripts/kit/land.mts (K394): make land merges a rebased branch fast-forward only after the static gates that the
// changed paths of the branch select pass, then removes its branch and worktree; a refused branch leaves main unchanged.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { land, linesOf, machineListing, runCommitGates, worktreeProcesses } from '../../scripts/kit/land.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('make land merges a rebased branch only after the gates it touches pass, and removes its branch and worktree (K394)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // lint-x fails on a file bad.txt under src; docs-check and commits-check are the other kit gates and pass.
  put(main, {
    'Makefile': 'kit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttest ! -f src/bad.txt\n',
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
  land(main, 'feat/a', quiet);
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
  assert.throws(() => land(main, 'feat/b', quiet), /lint-x/);
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'main is unchanged after the refusal');

  // A branch that is not rebased on main: it forks from the base, which main has left behind, and it is refused.
  const folderC = path.join(parent, 'repo-c');
  git(main, 'worktree', 'add', '--quiet', folderC, '-b', 'feat/c', base);
  put(folderC, { 'src/c.txt': 'c\n' });
  git(folderC, 'add', '-A');
  git(folderC, 'commit', '--quiet', '-m', 'c');
  assert.throws(() => land(main, 'feat/c', quiet), /rebased/);
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'main is unchanged after the refusal of a branch not rebased');
});

test('land refuses a gate that fails only on a finding that main does not have (K394-1)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // findings-x prints one finding line per line of findings.txt and fails while that file is not empty; main is red with src/a.txt.
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check findings-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'findings-x:', '\t@if [ -s findings.txt ]; then sed "s/^/finding: /" findings.txt; exit 1; fi'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'findings.txt'], targets: ['findings-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
    'findings.txt': 'src/a.txt\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const printed: string[] = [];
  const print = (text: string) => printed.push(text);
  // A branch of the given name, from main in its own worktree, with `files` committed on it.
  const branch = (name: string, files: Record<string, string>) => {
    const folder = path.join(parent, `repo-${name}`);
    git(main, 'worktree', 'add', '--quiet', folder, '-b', name, 'main');
    put(folder, files);
    git(folder, 'add', '-A');
    git(folder, 'commit', '--quiet', '-m', name);
  };

  // A branch that adds nothing to the findings: findings-x fails on main too with the same finding, so the branch lands.
  branch('feat-a', { 'src/b.txt': 'b\n' });
  const branchA = git(main, 'rev-parse', 'feat-a');
  land(main, 'feat-a', { print });
  assert.equal(git(main, 'rev-parse', 'main'), branchA, 'main fast-forwards to the branch');
  assert.ok(printed.includes('findings-x fails on main too, with no finding that main does not have'));

  // A branch that adds the finding src/c.txt: it is a finding that main does not have, so the branch is refused and names it.
  branch('feat-b', { 'findings.txt': 'src/a.txt\nsrc/c.txt\n' });
  const mainB = git(main, 'rev-parse', 'main');
  assert.throws(() => land(main, 'feat-b', { print }), /feat-b is refused: the gate findings-x has 1 findings that main does not have; nothing is merged/);
  assert.ok(printed.some(text => text.includes('finding: src/c.txt')), 'the output names the new finding');
  assert.equal(git(main, 'rev-parse', 'main'), mainB, 'main is unchanged after the refusal');

  // main turns green; a branch that makes findings-x red is refused as before, since main passes the gate.
  put(main, { 'findings.txt': '' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'clear findings');
  branch('feat-c', { 'findings.txt': 'src/d.txt\n' });
  const mainC = git(main, 'rev-parse', 'main');
  assert.throws(() => land(main, 'feat-c', { print }), /feat-c is refused: the gate findings-x exited 2; nothing is merged/);
  assert.equal(git(main, 'rev-parse', 'main'), mainC, 'main is unchanged after the refusal of a gate green on main');
});

// K394-2: duplication-check prints the jscpd configuration that it writes into a fresh temporary folder, so a gate whose findings
// agree on the branch and on main still prints a line that differs on each run.
test('land compares the output of a gate without the temporary folders that it makes on each run (K394-2)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // fresh-x prints a path in a new temporary folder on each run, as duplication-check does, and fails with the finding of main.
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check fresh-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'fresh-x:', '\t@folder=$$(mktemp -d); echo "Using config from $$folder/jscpd.json"; rmdir "$$folder"; echo "finding: src/a.txt"; exit 1'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**'], targets: ['fresh-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const folder = path.join(parent, 'repo-feat-a');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-a', 'main');
  put(folder, { 'src/b.txt': 'b\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'feat-a');
  const head = git(main, 'rev-parse', 'feat-a');
  const printed: string[] = [];
  land(main, 'feat-a', { print: text => printed.push(text) });
  assert.equal(git(main, 'rev-parse', 'main'), head, 'main fast-forwards to the branch');
  assert.ok(printed.includes('fresh-x fails on main too, with no finding that main does not have'), printed.join('\n'));
});

// K394-3: a kit tool prints its progress on stdout as a line that starts with its [name], and its findings on stderr; a new
// progress line, such as the tools root that parity-declarations-check declares, is no finding, while a new stderr line and a new
// stdout line of another tool, such as a linter, are.
test('land counts no progress line of a kit tool as a finding of a gate that fails on main too (K394-3)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // info-x prints a progress line for each line of info.txt, a stderr finding for each line of findings.txt, and the lines of
  // lint.txt on stdout as a linter does; it fails while findings.txt is not empty.
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check info-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'info-x:', '\t@sed "s/^/[info-x] tools root /" info.txt; cat lint.txt; sed "s/^/[info-x] finding: /" findings.txt >&2; test ! -s findings.txt'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'info.txt', 'findings.txt', 'lint.txt'], targets: ['info-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
    'info.txt': 'tools\n',
    'findings.txt': 'src/a.txt\n',
    'lint.txt': 'src/a.txt:1:1: error E1\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const printed: string[] = [];
  const print = (text: string) => printed.push(text);
  const branch = (name: string, files: Record<string, string>) => {
    const folder = path.join(parent, `repo-${name}`);
    git(main, 'worktree', 'add', '--quiet', folder, '-b', name, 'main');
    put(folder, files);
    git(folder, 'add', '-A');
    git(folder, 'commit', '--quiet', '-m', name);
  };
  branch('feat-a', { 'info.txt': 'tools\nbenchmarks\n' });
  const branchA = git(main, 'rev-parse', 'feat-a');
  land(main, 'feat-a', { print });
  assert.equal(git(main, 'rev-parse', 'main'), branchA, 'a new progress line of the kit tool is no finding');
  branch('feat-b', { 'findings.txt': 'src/a.txt\nsrc/b.txt\n' });
  assert.throws(() => land(main, 'feat-b', { print }), /feat-b is refused: the gate info-x has 1 findings that main does not have/);
  branch('feat-c', { 'lint.txt': 'src/a.txt:1:1: error E1\nsrc/c.txt:2:1: error E2\n' });
  assert.throws(() => land(main, 'feat-c', { print }), /feat-c is refused: the gate info-x has 1 findings that main does not have/);
});

test('land selects no gate that runs tests (K394-1)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // parity-check and test-x fail when run; the owner map selects both for src, so land must run neither.
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check parity-check test-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'parity-check:', '\tfalse', 'test-x:', '\tfalse'].join('\n') + '\n',
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
  land(main, 'feat-a', { print: text => printed.push(text) });
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

// K429: make land refuses while a process runs in the worktree of the branch: a working directory inside it, an open file or an
// executable there (K441-1). The unit case feeds fixed ps and lsof outputs; the real case starts a process in the worktree.
test('land lists the processes of the worktree and refuses while one runs (K429)', (t) => {
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
    'Makefile': 'kit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttest ! -f src/bad.txt\n',
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
  assert.throws(() => land(main, 'feat-x', { print: () => {} }), (error: Error) => error.message.includes(`${child.pid} `) && error.message.includes(`${folderX}/marker`));
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'main is unchanged while a process runs in the worktree');
  assert.equal(existsSync(folderX), true, 'the worktree is kept');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-x'], { cwd: main }).status, 0, 'the branch is kept');
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

// K446-1: make commit on main refuses only the findings that HEAD lacks, as land does (K394-1): a finding that HEAD already has does
// not block an unrelated change.
test('a commit on main passes when the gate fails only on findings that HEAD already has (K446-1)', (t) => {
  const main = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-commit-')));
  t.after(() => rmSync(main, { recursive: true, force: true }));
  initRepository(main, '--initial-branch=main');
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check findings-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'findings-x:', '\t@if [ -s findings.txt ]; then sed "s/^/finding: /" findings.txt; exit 1; fi'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'findings.txt'], targets: ['findings-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
    'findings.txt': 'src/a.txt\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  put(main, { 'src/b.txt': 'b\n' });
  git(main, 'add', 'src/b.txt');
  assert.doesNotThrow(() => runCommitGates(main, ['src/b.txt'], () => {}), 'an unrelated change passes when HEAD fails with the same finding');
  put(main, { 'findings.txt': 'src/a.txt\nsrc/c.txt\n' });
  git(main, 'add', 'findings.txt');
  assert.throws(() => runCommitGates(main, ['findings.txt'], () => {}), /findings that HEAD lacks.*src\/c\.txt/s, 'a new finding refuses the commit');
});

// K446-2: a finding that a checkout prints under its real path (/private/var) and under its logical path (/var) is one finding, so a
// gate that fails the same way on main and on the branch is not refused for the path it names (K446-2).
test('the findings of a gate read one key under the real and the logical path of one checkout (K446-2)', (t) => {
  // A folder outside the temporary folder, reached through a symbolic link: the temporary folder is read as <tmp> in any case.
  const target = realpathSync(mkdtempSync(path.join(process.cwd(), 'var', 'k446-2-')));
  const logicalFolder = `${target}-link`;
  symlinkSync(target, logicalFolder);
  t.after(() => { rmSync(logicalFolder, { force: true }); rmSync(target, { recursive: true, force: true }); });
  const logical = linesOf(`finding: ${logicalFolder}/src/a.txt`, logicalFolder, logicalFolder);
  const real = linesOf(`finding: ${target}/src/a.txt`, logicalFolder, logicalFolder);
  assert.equal(real[0]?.key, logical[0]?.key, 'the real and the logical path of one file give one key');
});

// K446-3: make echoes each recipe it runs, so a recipe whose text differs between HEAD and the staged tree prints a line on one side
// only; the comparison runs the gate silently (make -s), so only the output of the gate is compared, not the recipes make echoes.
test('a commit on main is not refused for a recipe line that make echoes on one side only (K446-3)', (t) => {
  const main = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-commit-')));
  t.after(() => rmSync(main, { recursive: true, force: true }));
  initRepository(main, '--initial-branch=main');
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check findings-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'findings-x:', '\ttrue $(shell cat src/count.txt)', '\t@if [ -s findings.txt ]; then sed "s/^/finding: /" findings.txt; exit 1; fi'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'findings.txt'], targets: ['findings-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/count.txt': 'one\n',
    'findings.txt': 'src/a.txt\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  put(main, { 'src/count.txt': 'two\n' });
  git(main, 'add', 'src/count.txt');
  assert.doesNotThrow(() => runCommitGates(main, ['src/count.txt'], () => {}), 'an echoed recipe line that differs from HEAD is not a finding');
  put(main, { 'findings.txt': 'src/a.txt\nsrc/c.txt\n' });
  git(main, 'add', 'findings.txt');
  assert.throws(() => runCommitGates(main, ['findings.txt'], () => {}), /findings that HEAD lacks.*src\/c\.txt/s, 'a new finding still refuses the commit');
});

// K446-4: make commit on main reads the findings of a gate as land does, without the progress lines that a kit tool prints on stdout
// with its name in brackets, so a progress line that differs between HEAD and the staged tree is not a finding (K446-4).
test('a commit on main is not refused for a progress line that differs from HEAD (K446-4)', (t) => {
  const main = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-commit-')));
  t.after(() => rmSync(main, { recursive: true, force: true }));
  initRepository(main, '--initial-branch=main');
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check findings-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'findings-x:', '\t@echo "[build-x] inputs $$(cat src/count.txt)"', '\t@if [ -s findings.txt ]; then sed "s/^/finding: /" findings.txt; exit 1; fi'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'findings.txt'], targets: ['findings-x'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/count.txt': 'one\n',
    'findings.txt': 'src/a.txt\n',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  put(main, { 'src/count.txt': 'two\n' });
  git(main, 'add', 'src/count.txt');
  assert.doesNotThrow(() => runCommitGates(main, ['src/count.txt'], () => {}), 'a progress line that differs from HEAD is not a finding');
  put(main, { 'findings.txt': 'src/a.txt\nsrc/c.txt\n' });
  git(main, 'add', 'findings.txt');
  assert.throws(() => runCommitGates(main, ['findings.txt'], () => {}), /findings that HEAD lacks.*src\/c\.txt/s, 'a new finding still refuses the commit');
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
    'Makefile': 'WORKTREE_STOP := stop-servers\nkit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttrue\nstop-servers:\n\tkill "$$(cat server.pid)"\n',
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
  land(main, 'feat-srv', { print: () => {} });
  await exited;
  assert.equal(child.signalCode, 'SIGTERM', 'stop-servers kills the server before the removal');
  assert.equal(git(main, 'rev-parse', 'main'), head, 'main fast-forwards to the branch');
  assert.equal(existsSync(folder), false, 'the worktree is removed');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-srv'], { cwd: main }).status, 1, 'the branch is deleted');
});

// K441: a stop target that fails refuses the removal of the worktree and names the target and its output.
test('make land keeps the worktree and names the stop target when it fails (K441)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    'Makefile': 'WORKTREE_STOP := stop-broken\nkit-gates: docs-check commits-check lint-x\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nlint-x:\n\ttrue\nstop-broken:\n\t@echo "the servers do not stop" >&2; exit 3\n',
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
  assert.throws(() => land(main, 'feat-broken', { print: () => {} }), (error: Error) => error.message.includes('stop-broken') && error.message.includes('the servers do not stop'));
  assert.equal(existsSync(folder), true, 'the worktree is kept');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat-broken'], { cwd: main }).status, 0, 'the branch is kept');
});

// K404-1: a commit on main and make land judge a failing gate with the same function, so one new finding refuses both, named by the
// same line. The gate fails on the staged tree of main (the commit) and on the branch (land), and only its c.txt line is new.
test('a commit on main and make land refuse the same new finding of a gate (K404-1)', (t) => {
  const findingsMakefile = ['kit-gates: docs-check commits-check findings-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'findings-x:', '\t@if [ -s findings.txt ]; then sed "s/^/finding: /" findings.txt; exit 1; fi'].join('\n') + '\n';
  const sandbox = () => {
    const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-same-')));
    t.after(() => rmSync(parent, { recursive: true, force: true }));
    const main = path.join(parent, 'repo');
    initRepository(main, '--initial-branch=main');
    put(main, {
      'Makefile': findingsMakefile,
      'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'findings.txt'], targets: ['findings-x'] }] }, null, 2) + '\n',
      '.gitignore': 'var/\n',
      'src/.keep': '',
      'findings.txt': 'src/a.txt\n',
    });
    git(main, 'add', '-A');
    git(main, 'commit', '--quiet', '-m', 'base');
    return { parent, main };
  };

  const onMain = sandbox();
  put(onMain.main, { 'findings.txt': 'src/a.txt\nsrc/c.txt\n' });
  git(onMain.main, 'add', 'findings.txt');
  let commitRefusal = '';
  try {
    runCommitGates(onMain.main, ['findings.txt'], () => {});
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    commitRefusal = error.message;
  }

  const onLand = sandbox();
  git(onLand.main, 'worktree', 'add', '--quiet', path.join(onLand.parent, 'repo-x'), '-b', 'feat-x', 'main');
  put(path.join(onLand.parent, 'repo-x'), { 'findings.txt': 'src/a.txt\nsrc/c.txt\n' });
  git(path.join(onLand.parent, 'repo-x'), 'add', '-A');
  git(path.join(onLand.parent, 'repo-x'), 'commit', '--quiet', '-m', 'x');
  const printed: string[] = [];
  let landRefusal = '';
  try {
    land(onLand.main, 'feat-x', { print: text => printed.push(text) });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    landRefusal = error.message;
  }
  const landed = `${printed.join('\n')}\n${landRefusal}`;

  assert.match(commitRefusal, /findings that HEAD lacks.*finding: src\/c\.txt/s, 'the commit on main refuses the new finding and names it');
  assert.match(landed, /findings that main does not have:\n.*finding: src\/c\.txt/s, 'make land refuses the same new finding and names it');
  assert.match(landRefusal, /findings that main does not have; nothing is merged/, 'make land refuses the branch');
  assert.doesNotMatch(commitRefusal, /src\/a\.txt/, 'a finding that HEAD already has is not named');
  assert.doesNotMatch(landed, /finding: src\/a\.txt/, 'a finding that main already has is not named');
});
