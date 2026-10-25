// Tests of scripts/kit/land.mts (K394): make land merges a rebased branch fast-forward only after the static gates that the
// changed paths of the branch select pass, then removes its branch and worktree; a refused branch leaves main unchanged.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { land, linesOf, machineListing, newFindings, runGate, worktreeProcesses } from '../../scripts/kit/land.mts';
import type { GateRun } from '../../scripts/kit/land.mts';
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

  // A branch that is not rebased on main: it forks from the base, which main has left behind; land rebases it in its worktree
  // and merges it on top of main (K495-1).
  const folderC = path.join(parent, 'repo-c');
  git(main, 'worktree', 'add', '--quiet', folderC, '-b', 'feat/c', base);
  put(folderC, { 'src/c.txt': 'c\n' });
  git(folderC, 'add', '-A');
  git(folderC, 'commit', '--quiet', '-m', 'c');
  land(main, 'feat/c', quiet);
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'c', 'the rebased branch lands');
  assert.equal(git(main, 'rev-parse', 'main^'), mainBefore, 'on top of main');
});

// K603: land runs its selected gates, then fast-forwards and removes the branch and worktree; it does not run the full build before or after the merge.
test('make land fast-forwards and cleans up without invoking either build (K603)', (t) => {
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

  land(main, 'feat/k603', { print: () => {} });

  assert.equal(git(main, 'rev-parse', 'main'), branch, 'main fast-forwards to the branch');
  assert.equal(existsSync(folder), false, 'the worktree is removed');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/k603'], { cwd: main }).status, 1, 'the branch is deleted');
  assert.equal(existsSync(buildCalls), false, 'land does not invoke make build in the branch or main checkout');
});

test('land refuses a gate that fails only on a finding that main does not have (K394-1)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  // findings-x prints one finding line per line of findings.txt and fails while that file is not empty; main is red with src/a.txt.
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check findings-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'findings-x:', '\t@if [ -s findings.txt ]; then sed "s/^/finding: /" findings.txt; exit 1; fi', 'build:', '\ttrue'].join('\n') + '\n',
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
    'Makefile': ['kit-gates: docs-check commits-check fresh-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'fresh-x:', '\t@folder=$$(mktemp -d); echo "Using config from $$folder/jscpd.json"; rmdir "$$folder"; echo "finding: src/a.txt"; exit 1', 'build:', '\ttrue'].join('\n') + '\n',
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
    'Makefile': ['kit-gates: docs-check commits-check info-x', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'info-x:', '\t@sed "s/^/[info-x] tools root /" info.txt; cat lint.txt; sed "s/^/[info-x] finding: /" findings.txt >&2; test ! -s findings.txt', 'build:', '\ttrue'].join('\n') + '\n',
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
  land(main, 'feat-a', { print: text => printed.push(text) });
  assert.equal(git(main, 'rev-parse', 'main'), branchA, 'main fast-forwards to the branch');
  assert.ok(printed.includes('parity-check runs tests, which the Verification of the rows runs; land does not run it'));
  assert.ok(printed.includes('test-x runs tests, which the Verification of the rows runs; land does not run it'));
});

// K459: a change to a dependency manifest or lock selects dependency-policy-check, whatever the owner declaration of the repository
// says: the declaration here owns the manifests and locks with docs-check alone, as a repository whose rules do not name the gate.
// The gate fails while a dependency file of the checkout exists, so a refusal names the gate; a branch that changes no dependency
// file runs it not.
test('land runs dependency-policy-check for a change to any dependency manifest or lock (K459)', { timeout: 120000 }, (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, {
    'Makefile': ['kit-gates: docs-check commits-check dependency-policy-check', 'docs-check:', '\ttrue', 'commits-check:', '\ttrue', 'dependency-policy-check:', '\t@for f in package.json package-lock.json composer.json composer.lock pyproject.toml uv.lock Cargo.toml Cargo.lock go.mod go.sum requirements-dev.txt; do test ! -f "$$f" || { echo "$$f has no review entry" >&2; exit 1; }; done', 'build:', '\ttrue'].join('\n') + '\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', '**/*.json', '**/*.toml', '**/*.lock', '**/go.*', '**/requirements*.txt'], targets: ['docs-check'] }] }, null, 2) + '\n',
    '.gitignore': 'var/\n',
    'src/.keep': '',
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const manifests = ['package.json', 'package-lock.json', 'composer.json', 'composer.lock', 'pyproject.toml', 'uv.lock', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'requirements-dev.txt'];
  for (const [index, file] of manifests.entries()) {
    const folder = path.join(parent, `repo-${index}`);
    const branch = `feat-dep-${index}`;
    git(main, 'worktree', 'add', '--quiet', folder, '-b', branch, 'main');
    put(folder, { [file]: '{}\n' });
    git(folder, 'add', '-A');
    git(folder, 'commit', '--quiet', '-m', `change ${file}`);
    const mainBefore = git(main, 'rev-parse', 'main');
    assert.throws(() => land(main, branch, { print: () => {} }), /dependency-policy-check/, `${file} selects dependency-policy-check`);
    assert.equal(git(main, 'rev-parse', 'main'), mainBefore, `${file}: main is unchanged after the refusal`);
  }
  const folder = path.join(parent, 'repo-src');
  git(main, 'worktree', 'add', '--quiet', folder, '-b', 'feat-src', 'main');
  put(folder, { 'src/a.txt': 'a\n' });
  git(folder, 'add', '-A');
  git(folder, 'commit', '--quiet', '-m', 'a');
  const printed: string[] = [];
  land(main, 'feat-src', { print: text => printed.push(text) });
  assert.equal(printed.some(text => text.startsWith('dependency-policy-check in ')), false, 'a change to no dependency file runs no dependency gate');
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
  assert.throws(() => land(main, 'feat-broken', { print: () => {} }), (error: Error) => error.message.includes('stop-broken') && error.message.includes('the servers do not stop'));
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

// K474: a gate whose run fails for an environment reason is refused with that error; it never passes as failing on the baseline too.
const gateRun = (status: number, output: string): GateRun => ({
  folder: process.cwd(),
  result: { pid: 0, output: [null, output, output], stdout: output, stderr: output, status, signal: null },
});

test('land compares jscpd clone findings without its changing summary rows (K394-4)', () => {
  const clone = [
    '\u001b[1mClone found (go)\u001b[22m',
    ' - packages/go/a.go [10:1 - 16:2] (7 lines, 40 tokens)',
    '   packages/go/b.go [20:1 - 26:2]',
  ].join('\n');
  const beforeStats = '│ go       │ 32  │ 7000  │ 52000  │ 2 │ 18 (0.04%) │ 163 (0.03%) │';
  const changedStats = '│ go          │ 326            │ 73986       │ 534691       │ 6            │ 56 (0.08%)       │ 348 (0.07%)       │';
  const asDuplication = (output: string): GateRun => ({
    folder: process.cwd(),
    gate: 'duplication-check',
    result: { pid: 0, output: [null, output, ''], stdout: output, stderr: '', status: 1, signal: null },
  });

  assert.equal(newFindings(process.cwd(), asDuplication(`${clone}\n${changedStats}`), asDuplication(`${clone}\n${beforeStats}`)), undefined,
    'only changed jscpd summary counts and padding do not add a finding');

  const addedClone = `${clone}\n\u001b[1mClone found (php)\u001b[22m\n - packages/php/a.php [1:1 - 7:2] (7 lines, 40 tokens)\n   packages/php/b.php [1:1 - 7:2]`;
  const added = newFindings(process.cwd(), asDuplication(`${clone}\n${changedStats}\n${addedClone}`), asDuplication(`${clone}\n${beforeStats}`));
  assert.ok(added?.some(line => line.includes('Clone found (php)')), 'a real added clone remains a finding');
});

test('land ignores changed ANSI-colored jscpd Total summary padding but keeps clone findings (K570)', () => {
  const clone = [
    '\u001b[1mClone found (go)\u001b[22m',
    ' - packages/go/a.go [10:1 - 16:2] (7 lines, 40 tokens)',
    '   packages/go/b.go [20:1 - 26:2]',
  ].join('\n');
  const beforeTotal = '\u001b[90m│\u001b[39m \u001b[1mTotal:\u001b[22m \u001b[90m│\u001b[39m 999            \u001b[90m│\u001b[39m 99999       \u001b[90m│\u001b[39m 999999       \u001b[90m│\u001b[39m 9            \u001b[90m│\u001b[39m 99 (0.01%)       \u001b[90m│\u001b[39m 999 (0.01%)       \u001b[90m│\u001b[39m';
  const changedTotal = '\u001b[90m│\u001b[39m \u001b[1mTotal:\u001b[22m \u001b[90m│\u001b[39m 1000           \u001b[90m│\u001b[39m 100000      \u001b[90m│\u001b[39m 1000000      \u001b[90m│\u001b[39m 10           \u001b[90m│\u001b[39m 100 (0.01%)      \u001b[90m│\u001b[39m 1000 (0.01%)      \u001b[90m│\u001b[39m';
  const asDuplication = (output: string): GateRun => ({
    folder: process.cwd(),
    gate: 'duplication-check',
    result: { pid: 0, output: [null, output, ''], stdout: output, stderr: '', status: 1, signal: null },
  });

  assert.equal(newFindings(process.cwd(), asDuplication(`${clone}\n${changedTotal}`), asDuplication(`${clone}\n${beforeTotal}`)), undefined,
    'changed aggregate statistics and column padding do not add a finding');

  const addedClone = '\u001b[1mClone found (php)\u001b[22m\n - packages/php/a.php [1:1 - 7:2] (7 lines, 40 tokens)\n   packages/php/b.php [1:1 - 7:2]';
  const added = newFindings(process.cwd(), asDuplication(`${clone}\n${changedTotal}\n${addedClone}`), asDuplication(`${clone}\n${beforeTotal}`));
  assert.ok(added?.some(line => line.includes('Clone found (php)')), 'a real added clone remains a finding');
});

test('land counts only the clone blocks of duplication-check as its findings (K599)', () => {
  const clone = [
    '\u001b[1mClone found (php)\u001b[22m',
    ' - packages/php/src/Dbspec/Dbspec.php [781:5 - 787:6] (7 lines, 52 tokens)',
    '   packages/php/src/Dbspec/Dbspec.php [802:5 - 808:6]',
  ].join('\n');
  const asDuplication = (output: string): GateRun => ({
    folder: process.cwd(),
    gate: 'duplication-check',
    result: { pid: 0, output: [null, output, ''], stdout: output, stderr: '', status: 1, signal: null },
  });
  const main = asDuplication(`${clone}\nFound 6 clones.\n\u001b[90mDetection time:\u001b[39m: 951.207ms`);
  const branch = asDuplication(`${clone}\nFound 6 clones.\n\u001b[90mDetection time:\u001b[39m: 1.024s\nsome other summary`);

  assert.equal(newFindings(process.cwd(), branch, main), undefined, 'lines outside the clone blocks are no finding');

  const addedClone = '\u001b[1mClone found (php)\u001b[22m\n - packages/php/a.php [1:1 - 7:2] (7 lines, 40 tokens)\n   packages/php/b.php [1:1 - 7:2]';
  const added = newFindings(process.cwd(), asDuplication(`${clone}\n${addedClone}\nDetection time:: 1.024s`), main);
  assert.ok(added?.some(line => line.includes('Clone found (php)')), 'an added clone remains a finding');
});

test('land recognizes the ANSI-colored jscpd summary rows captured by duplication-check (K394-5)', () => {
  const clone = [
    '\u001b[1mClone found (php)\u001b[22m',
    ' - packages/php-ext/tests/Example.php [10:1 - 16:2] (7 lines, 40 tokens)',
    '   packages/php-ext/tests/Other.php [20:1 - 26:2]',
  ].join('\n');
  const beforeStats = [
    '\u001b[90m│\u001b[39m c          \u001b[90m│\u001b[39m 45             \u001b[90m│\u001b[39m 50670       \u001b[90m│\u001b[39m 546618       \u001b[90m│\u001b[39m 63           \u001b[90m│\u001b[39m 679 (1.34%)      \u001b[90m│\u001b[39m 4841 (0.89%)      \u001b[90m│\u001b[39m',
    '\u001b[90m│\u001b[39m go         \u001b[90m│\u001b[39m 319            \u001b[90m│\u001b[39m 72557       \u001b[90m│\u001b[39m 523572       \u001b[90m│\u001b[39m 4            \u001b[90m│\u001b[39m 37 (0.05%)       \u001b[90m│\u001b[39m 222 (0.04%)       \u001b[90m│\u001b[39m',
  ].join('\n');
  const changedStats = [
    '\u001b[90m│\u001b[39m c          \u001b[90m│\u001b[39m 45             \u001b[90m│\u001b[39m 51063       \u001b[90m│\u001b[39m 550320       \u001b[90m│\u001b[39m 2            \u001b[90m│\u001b[39m 18 (0.04%)       \u001b[90m│\u001b[39m 163 (0.03%)       \u001b[90m│\u001b[39m',
    '\u001b[90m│\u001b[39m go         \u001b[90m│\u001b[39m 326            \u001b[90m│\u001b[39m 73986       \u001b[90m│\u001b[39m 534691       \u001b[90m│\u001b[39m 6            \u001b[90m│\u001b[39m 56 (0.08%)       \u001b[90m│\u001b[39m 348 (0.07%)       \u001b[90m│\u001b[39m',
  ].join('\n');
  const asDuplication = (output: string): GateRun => ({
    folder: process.cwd(),
    gate: 'duplication-check',
    result: { pid: 0, output: [null, output, ''], stdout: output, stderr: '', status: 1, signal: null },
  });

  assert.equal(newFindings(process.cwd(), asDuplication(`${clone}\n${changedStats}`), asDuplication(`${clone}\n${beforeStats}`)), undefined,
    'the captured ANSI formatting and changed counts do not create findings');

  const added = newFindings(process.cwd(), asDuplication(`${clone}\n${changedStats}\n${clone.replace('Clone found (php)', 'Clone found (go)')}`), asDuplication(`${clone}\n${beforeStats}`));
  assert.ok(added?.some(line => line.includes('Clone found (go)')), 'a new clone remains a finding');
});

test('a gate whose recipe command is missing on HEAD fails naming the error, not as failing on HEAD too (K474)', () => {
  const error = 'make: *** [lint-ts] Error 127\n';
  assert.throws(() => newFindings(process.cwd(), gateRun(2, error), gateRun(2, error)), /Error 127/);
});

test('a gate that fails with no output on the candidate and on HEAD fails naming its exit status (K474)', () => {
  assert.throws(() => newFindings(process.cwd(), gateRun(2, ''), gateRun(2, '')), /exited 2/);
});

test('a gate that fails with the same findings on HEAD still passes as failing on HEAD too (K474)', () => {
  const finding = 'src/a.ts:1: bad\n';
  assert.equal(newFindings(process.cwd(), gateRun(1, finding), gateRun(1, finding)), undefined);
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

test('land refuses when main moves while its gates run and names the commit that moved it (K495)', (t) => {
  // The gate of the branch commits on main, as another writer would while the gates run; the commit adds a file under src, the input
  // of the gate, so each rerun of the gate (K580) moves main again.
  const { main, lock } = lockFixture(t, root => `echo x > ${root}/src/moved-$$$$ && git -C ${root} add src && git -C ${root} -c user.name=t -c user.email=t@t commit --quiet -m moved-while-the-gates-ran`);
  assert.throws(() => land(main, 'feat/x', { print: () => {} }), (error: Error) => {
    assert.match(error.message, /moved-while-the-gates-ran/, 'the refusal names the commit that moved main');
    assert.match(error.message, /nothing is merged/);
    return true;
  });
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'moved-while-the-gates-ran', 'main keeps the commit of the other writer');
  assert.equal(existsSync(lock), false, 'the lock is released after a refusal');
});

test('a land waits for the land that holds the lock and lands after it (K495)', (t) => {
  const { main, branch, lock } = lockFixture(t);
  const holder = spawn('sleep', ['60']);
  t.after(() => holder.kill());
  writeFileSync(lock, JSON.stringify({ pid: holder.pid, branch: 'feat/other' }));
  const printed: string[] = [];
  let waits = 0;
  // The first land finishes while the second waits: its lock goes away.
  const options = { print: (text: string) => printed.push(text), sleep: () => { waits += 1; rmSync(lock); } };
  land(main, 'feat/x', options);
  assert.ok(printed.some(text => text.includes(`waits for the land of feat/other (pid ${holder.pid})`)), printed.join('\n'));
  assert.ok(waits >= 1, 'the land waited');
  assert.equal(git(main, 'rev-parse', 'main'), branch, 'the waiting land lands after the first');
  assert.equal(existsSync(lock), false, 'the lock is released after the land');
});

test('a land removes the lock of a land that no longer runs (K495)', (t) => {
  const { main, branch, lock } = lockFixture(t);
  const gone = spawnSync('true').pid;
  writeFileSync(lock, JSON.stringify({ pid: gone, branch: 'feat/gone' }));
  const printed: string[] = [];
  land(main, 'feat/x', { print: text => printed.push(text) });
  assert.ok(printed.some(text => text.includes(`removed the lock of the land of feat/gone (pid ${gone})`)), printed.join('\n'));
  assert.equal(git(main, 'rev-parse', 'main'), branch);
  assert.equal(existsSync(lock), false);
});

// K495-1: land rebases a branch that main has left behind onto main in its own clean worktree, under its lock, and runs its gates on
// the rebased commits; a rebase that conflicts is aborted, leaves the branch as it was and refuses naming the file.
test('land rebases a branch behind main in its worktree and lands it, and refuses a conflicting rebase naming the file (K495-1)', (t) => {
  const { main } = lockFixture(t);
  // main moves after the branch forked: another land put src/other.txt on it.
  put(main, { 'src/other.txt': 'other\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'other');
  const printed: string[] = [];
  land(main, 'feat/x', { print: text => printed.push(text) });
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
  assert.throws(() => land(main, 'feat/y', { print: () => {} }), /src\/x\.txt/);
  assert.equal(git(main, 'rev-parse', 'main'), mainBefore, 'nothing is merged');
  assert.equal(git(main, 'rev-parse', 'feat/y'), branchY, 'the branch is as it was');
  assert.equal(git(folder, 'status', '--porcelain'), '', 'the aborted rebase leaves the worktree clean');
});

// K497: land refuses a branch whose checklist holds a row with an ID that main holds with another task, unless the ID is the row of
// the branch itself (TYPE/NAME-ID); the refusal names the ID, the task on main and the next ID that main and no branch holds. A row
// that main lacks, a state change and a change of the branch's own row pass.
test('land refuses a row whose ID main holds with another task, naming the next free ID (K497)', (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-land-ids-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  const header = '<!-- doc-id: checklist-work -->\n# Execution checklist\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n';
  const row = (id: string, task: string, state = '[ ]') => `| ${id} | ${task} | \`src/a.ts\` | \`make test\` | ${state} |\n`;
  put(main, {
    'Makefile': 'kit-gates: docs-check commits-check\ndocs-check:\n\ttrue\ncommits-check:\n\ttrue\nbuild:\n\ttrue\n',
    'config/owner-checks.json': JSON.stringify({ schema: 1, owners: [{ paths: ['**'], targets: ['docs-check'] }] }, null, 2) + '\n',
    'config/checklist.json': '{ "schema": 1, "hooks": ["pre-push"], "idPattern": "T[0-9]+(?:[.-][0-9]+)*" }\n',
    'docs/plans/work/checklist.md': `${header}${row('T1', 'Write the parser', '[o]')}${row('T5', 'Print the union on main')}`,
  });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const branchWith = (name: string, text: string) => {
    const folder = path.join(parent, name.replace('/', '-'));
    git(main, 'worktree', 'add', '--quiet', folder, '-b', name, 'main');
    put(folder, { 'docs/plans/work/checklist.md': text });
    git(folder, 'add', '-A');
    git(folder, 'commit', '--quiet', '-m', name);
    return git(main, 'rev-parse', name);
  };
  const quiet = { print: () => {} };

  // Another branch registers T5 with its own task, as a rebase resolved by hand would leave it.
  branchWith('fix/other-T9', `${header}${row('T1', 'Write the parser', '[o]')}${row('T5', 'Link the composer shim')}`);
  const before = git(main, 'rev-parse', 'main');
  assert.throws(() => land(main, 'fix/other-T9', quiet), (error: Error) => {
    assert.match(error.message, /T5/);
    assert.match(error.message, /Print the union on main/, 'the refusal names the task that main holds');
    assert.match(error.message, /T6/, 'the refusal names the next free ID');
    return true;
  });
  assert.equal(git(main, 'rev-parse', 'main'), before, 'nothing is merged');

  // The branch of T5 itself restates its task; a branch adds a row that main lacks; a branch changes a state: each lands.
  const own = branchWith('fix/edit-T5', `${header}${row('T1', 'Write the parser', '[o]')}${row('T5', 'Print the union of two types on main')}`);
  land(main, 'fix/edit-T5', quiet);
  assert.equal(git(main, 'rev-parse', 'main'), own);
  const added = branchWith('fix/new-T7', `${header}${row('T1', 'Write the parser', '[o]')}${row('T5', 'Print the union of two types on main')}${row('T7', 'Add a row')}`);
  land(main, 'fix/new-T7', quiet);
  assert.equal(git(main, 'rev-parse', 'main'), added);
  const state = branchWith('fix/state-T7', `${header}${row('T1', 'Write the parser', '[o]')}${row('T5', 'Print the union of two types on main', '[~]')}${row('T7', 'Add a row')}`);
  land(main, 'fix/state-T7', quiet);
  assert.equal(git(main, 'rev-parse', 'main'), state);
});

test('K516: land called from a detached worktree lands into the main checkout (K516)', (t) => {
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
  land(detached, 'feat/k516', { print: () => {} });
  assert.equal(git(main, 'rev-parse', 'main'), tip, 'main of the main checkout moves to the branch');
  git(main, 'checkout', '--quiet', '--detach');
  assert.throws(() => land(detached, 'feat/none', { print: () => {} }), /no checkout has main checked out/);
});

// K531: land waits for the exit of each make it runs, not for the close of its output, so a gate that leaves a process running with the
// inherited output returns at its own exit; a run past its deadline is stopped and fails with the target.
test('runGate returns at the exit of make while a process it started holds the output, and stops a run past its deadline (K531)', (t) => {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-gate-')));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  put(folder, { Makefile: ['left:', '\t@(sleep 20 &); echo checked', 'slow:', '\t@sleep 20', ''].join('\n') });
  const started = Date.now();
  const run = runGate(folder, 'left');
  assert.ok(Date.now() - started < 10_000, `runGate waited ${Date.now() - started} ms for the process that the gate left`);
  assert.equal(run.result.status, 0);
  assert.equal(run.result.stdout, 'checked\n');
  assert.throws(() => runGate(folder, 'slow', [], 1000), /make slow ran past its deadline of 1 s in .* and was stopped/);
});

// K571: the gates run without the land lock; the lock covers only checking that main is still the commit they ran on and fast-forwarding.
// A gate here fails in the worktree while the lock exists, and passes on main, so no comparison with main passes it.
test('the gates of a land run without the land lock, which covers only the merge (K571)', (t) => {
  const { main, branch, lock } = lockFixture(t, () => 'if [ "$$(git rev-parse --abbrev-ref HEAD)" != main ]; then test ! -e $$(git rev-parse --git-common-dir)/kit-land.lock; fi');
  land(main, 'feat/x', { print: () => {} });
  assert.equal(git(main, 'rev-parse', 'main'), branch, 'the branch lands');
  assert.equal(existsSync(lock), false, 'the lock is released after the merge');
});

// K571: a land whose main moved while its gates ran rebases and runs them again, up to LAND_ATTEMPTS times, instead of refusing.
test('a land whose main moved while its gates ran rebases and lands on the new main (K571)', (t) => {
  const marker = (main: string) => path.join(path.dirname(main), 'moved');
  const { main } = lockFixture(t, root => `test -e ${marker(root)} || { touch ${marker(root)} && git -C ${root} -c user.name=t -c user.email=t@t commit --quiet --allow-empty -m moved-once; }`);
  const printed: string[] = [];
  land(main, 'feat/x', { print: text => printed.push(text) });
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'x', 'the branch lands on the new main');
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main^'), 'moved-once', 'on top of the commit that moved main');
  assert.ok(printed.some(text => text.includes('moved-once') && text.includes('runs the gates again')), printed.join('\n'));
});

// K580: when main moves during the gates of a land, the land reruns only the gates that the paths of the moved commits select, and
// commits-check, since the rebased commits are new; a gate whose inputs no moved commit touched keeps its result. Here lint-x runs
// for src/**, and main moves once by a commit that touches no path of src.
test('a land whose main moved reruns only the gates that the moved commits select (K580)', (t) => {
  const count = (main: string) => path.join(path.dirname(main), 'lint-runs');
  const marker = (main: string) => path.join(path.dirname(main), 'moved');
  const { main } = lockFixture(t, root => `echo run >> ${count(root)}; test -e ${marker(root)} || { touch ${marker(root)} && git -C ${root} -c user.name=t -c user.email=t@t commit --quiet --allow-empty -m moved-once; }`);
  const printed: string[] = [];
  land(main, 'feat/x', { print: text => printed.push(text) });
  assert.equal(git(main, 'log', '-1', '--format=%s', 'main^'), 'moved-once', 'the branch lands on the moved main');
  assert.equal(readFileSync(count(main), 'utf8'), 'run\n', 'lint-x ran once: the moved commit touches nothing that it checks');
  assert.ok(printed.some(text => text.includes('lint-x keeps its result')), printed.join('\n'));
});

// K600: jscpd ends its report with the time of its run, which differs on every run, so an identical clone set is no new finding.
test('land counts no jscpd timing line as a finding (K600)', () => {
  const clone = '\u001b[1mClone found (go)\u001b[22m\n - packages/go/a.go [10:1 - 16:2] (7 lines, 40 tokens)\n   packages/go/b.go [20:1 - 26:2]';
  const asDuplication = (output: string): GateRun => ({
    folder: process.cwd(),
    gate: 'duplication-check',
    result: { pid: 0, output: [null, output, ''], stdout: output, stderr: '', status: 1, signal: null },
  });
  assert.equal(newFindings(process.cwd(), asDuplication(`${clone}\n\u001b[90mtime: 748.289ms\u001b[39m`), asDuplication(`${clone}\ntime: 512.03ms`)), undefined);
});
