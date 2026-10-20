// Tests of scripts/kit/land.mts (K394): make land merges a rebased branch fast-forward only after the static gates that the
// changed paths of the branch select pass, then removes its branch and worktree; a refused branch leaves main unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { land } from '../../scripts/kit/land.mts';
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
