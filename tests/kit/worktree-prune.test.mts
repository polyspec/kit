// Tests of scripts/kit/worktree-prune.mts (K381): a branch with commits of its own that are all in main is merged; make worktree-prune
// removes it with its clean worktree and keeps a fresh, unmerged or dirty one with the reason, and a second run leaves the same state.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { foreignTrusts } from '../../scripts/kit/bootstrap/install-mise.mts';
import { branchStates, prune } from '../../scripts/kit/worktree-prune.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

const exists = (cwd: string, ref: string) => spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], { cwd }).status === 0;

/** A main checkout with five branches: merged (clean worktree), merged (dirty worktree), fresh, unmerged, and one without a reflog. */
function fixture(t: TestContext) {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-prune-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, { 'base.txt': 'base\n', '.gitignore': 'var/\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');

  const merged = path.join(parent, 'repo-merged');
  git(main, 'worktree', 'add', '--quiet', merged, '-b', 'fix/merged-K1', 'main');
  put(merged, { 'merged.txt': 'merged\n', 'var/install.txt': 'installed\n' });
  git(merged, 'add', '-A');
  git(merged, 'commit', '--quiet', '-m', 'merged');

  const dirty = path.join(parent, 'repo-dirty');
  git(main, 'worktree', 'add', '--quiet', dirty, '-b', 'fix/dirty-K2', 'main');
  put(dirty, { 'dirty.txt': 'dirty\n' });
  git(dirty, 'add', '-A');
  git(dirty, 'commit', '--quiet', '-m', 'dirty');
  put(dirty, { 'scratch.txt': 'uncommitted\n' });

  git(main, 'branch', 'fix/fresh-K3', 'main');

  const open = path.join(parent, 'repo-open');
  git(main, 'worktree', 'add', '--quiet', open, '-b', 'fix/open-K4', 'main');
  put(open, { 'open.txt': 'open\n' });
  git(open, 'add', '-A');
  git(open, 'commit', '--quiet', '-m', 'open');
  git(main, 'worktree', 'remove', open);

  git(main, '-c', 'core.logAllRefUpdates=false', 'branch', 'fix/noreflog-K5', 'main');

  git(main, 'merge', '--quiet', '--no-ff', '-m', 'merge the merged rows', 'fix/merged-K1', 'fix/dirty-K2');
  return { main, merged, dirty, open };
}

test('worktree-prune removes merged branches and their clean worktrees, and keeps fresh, unmerged and dirty ones (K381)', (t) => {
  const { main, merged, dirty } = fixture(t);
  const lines: string[] = [];
  prune(main, { print: text => lines.push(text) });
  assert.equal(existsSync(merged), false, 'the clean worktree of the merged branch is removed');
  assert.equal(exists(main, 'fix/merged-K1'), false, 'the merged branch is deleted');
  assert.equal(existsSync(dirty), true, 'the dirty worktree of a merged branch is kept');
  assert.equal(exists(main, 'fix/dirty-K2'), true, 'its branch is kept with it');
  assert.equal(exists(main, 'fix/fresh-K3'), true, 'a fresh branch is kept');
  assert.equal(exists(main, 'fix/open-K4'), true, 'an unmerged branch is kept');
  assert.equal(exists(main, 'fix/noreflog-K5'), true, 'a branch without a reflog entry is kept');
  assert.match(lines.join('\n'), /fix\/fresh-K3.*no commit of its own/);
  assert.match(lines.join('\n'), /fix\/open-K4.*not in main/);
  assert.match(lines.join('\n'), /fix\/dirty-K2.*uncommitted/);
  assert.match(lines.join('\n'), /fix\/noreflog-K5.*no reflog entry/);

  const before = [git(main, 'worktree', 'list', '--porcelain'), git(main, 'for-each-ref', 'refs/heads')].join('\n');
  prune(main, { print: () => {} });
  assert.equal([git(main, 'worktree', 'list', '--porcelain'), git(main, 'for-each-ref', 'refs/heads')].join('\n'), before, 'a second run leaves the same state');
});

// K381-1: a fresh branch that a rebase moved onto a newer main holds commits of main after its creation point, none of its own; a
// branch is merged when its reflog records a commit made on it and main contains its tip.
test('a fresh branch rebased onto a newer main is fresh, and a rebased branch with a commit of its own is merged once main has it (K381-1)', (t) => {
  const { main } = fixture(t);
  const fresh = path.join(path.dirname(main), 'repo-rebased');
  git(main, 'worktree', 'add', '--quiet', fresh, '-b', 'fix/rebased-K6', 'main~1');
  git(fresh, 'rebase', '--quiet', 'main');
  const row = path.join(path.dirname(main), 'repo-row');
  git(main, 'worktree', 'add', '--quiet', row, '-b', 'fix/row-K7', 'main~1');
  put(row, { 'row.txt': 'row\n' });
  git(row, 'add', '-A');
  git(row, 'commit', '--quiet', '-m', 'row');
  git(row, 'rebase', '--quiet', 'main');
  git(main, 'merge', '--quiet', '--ff-only', 'fix/row-K7');
  const states = new Map(branchStates(main).map(state => [state.branch, state]));
  assert.equal(states.get('fix/rebased-K6')?.merged, false, 'the fresh branch that a rebase moved');
  assert.match(states.get('fix/rebased-K6')?.reason ?? '', /^fresh/);
  assert.equal(states.get('fix/row-K7')?.merged, true, 'the rebased branch with a commit of its own, which main fast-forwarded to');
  const lines: string[] = [];
  prune(main, { print: text => lines.push(text) });
  assert.ok(exists(main, 'fix/rebased-K6'), `the fresh branch is kept: ${lines.join('\n')}`);
  assert.ok(!exists(main, 'fix/row-K7'), 'the merged branch is deleted');
});

// K441: worktree-prune reports each process whose command line names a path under a worktree folder of the repository that is no
// live worktree, with its pid and the dead path; it leaves the process running.
test('worktree-prune reports the processes that name a path under a removed worktree folder, and kills none (K441)', { timeout: 60000 }, async (t) => {
  const { main, open } = fixture(t);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `${open}/data`]);
  t.after(() => child.kill());
  await once(child, 'spawn');
  const lines: string[] = [];
  prune(main, { print: text => lines.push(text) });
  assert.ok(lines.some(line => line.includes(`${child.pid} `) && line.includes(open)), lines.join('\n'));
  assert.equal(child.exitCode, null, 'the process is left running');
  assert.equal(child.signalCode, null, 'the process is not signalled');
});

// K441-1: worktree-prune keeps a merged worktree that a process runs in (its cwd, an open file or its executable), as make land
// refuses it, and removes a merged worktree that a process only names in its arguments.
test('worktree-prune keeps a merged worktree that a process runs in, and removes one that a process only names (K441-1)', { timeout: 60000 }, async (t) => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-prune-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const main = path.join(parent, 'repo');
  initRepository(main, '--initial-branch=main');
  put(main, { 'base.txt': 'base\n', '.gitignore': 'var/\n' });
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'base');
  const run = path.join(parent, 'repo-run');
  const named = path.join(parent, 'repo-named');
  for (const [folder, branch] of [[run, 'fix/run-K5'], [named, 'fix/named-K6']] as const) {
    git(main, 'worktree', 'add', '--quiet', folder, '-b', branch, 'main');
    put(folder, { [`${path.basename(folder)}.txt`]: 'work\n' });
    git(folder, 'add', '-A');
    git(folder, 'commit', '--quiet', '-m', branch);
    git(main, 'merge', '--ff-only', '--quiet', branch);
  }
  // A process in the run worktree: its working directory is inside it.
  const inside = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: run });
  t.after(() => inside.kill());
  // A process that names the named worktree in its arguments only: it runs in the parent folder.
  const argument = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `${named}/marker`], { cwd: parent });
  t.after(() => argument.kill());
  await Promise.all([once(inside, 'spawn'), once(argument, 'spawn')]);
  const lines: string[] = [];
  prune(main, { print: text => lines.push(text) });
  assert.equal(existsSync(run), true, `the worktree a process runs in is kept\n${lines.join('\n')}`);
  assert.equal(branchStates(main).find(state => state.branch === 'fix/run-K5')?.folder, run, 'its branch is still checked out there');
  assert.ok(lines.some(line => line.includes(`kept fix/run-K5 in ${run}`) && line.includes(`${inside.pid} `)), lines.join('\n'));
  assert.equal(existsSync(named), false, 'a process that only names the worktree in its arguments does not keep it');
  assert.equal(inside.exitCode, null, 'the process in the worktree is left running');
});

// K532: a linked worktree runs the tools and the trust store of its main checkout (K519), so the trust of the main checkout is its own;
// and a branch reset onto main is fresh, whatever its reflog held before the reset.
test('a linked worktree has the trust of its main checkout, and a branch reset onto main is fresh (K532)', (t) => {
  const { main } = fixture(t);
  const trusts = path.join(main, 'var/tools/mise/state/trusted-configs');
  mkdirSync(trusts, { recursive: true });
  symlinkSync(main, path.join(trusts, 'repo-trust'));
  const own = path.join(path.dirname(main), 'repo-own');
  git(main, 'worktree', 'add', '--quiet', own, '-b', 'fix/own-K8', 'main');
  assert.deepEqual(foreignTrusts(own), [], 'the trust of the main checkout is the trust of its worktree');
  assert.equal(foreignTrusts(main).length, 0, 'and of the main checkout');

  put(own, { 'own.txt': 'own\n' });
  git(own, 'add', '-A');
  git(own, 'commit', '--quiet', '-m', 'own');
  git(main, 'merge', '--quiet', '--ff-only', 'fix/own-K8');
  git(own, 'reset', '--quiet', '--hard', 'main');
  put(own, { 'next.txt': 'the next row, uncommitted\n' });
  const state = branchStates(main).find(entry => entry.branch === 'fix/own-K8');
  assert.equal(state?.merged, false, 'a branch that main contains, in a worktree with uncommitted changes, is in use');
  assert.match(state?.reason ?? '', /^in use/);
  const moved = path.join(path.dirname(main), 'repo-moved');
  git(main, 'worktree', 'add', '--quiet', moved, '-b', 'fix/moved-K9', 'main');
  put(moved, { 'dropped.txt': 'dropped\n' });
  git(moved, 'add', '-A');
  git(moved, 'commit', '--quiet', '-m', 'dropped');
  git(moved, 'reset', '--quiet', '--hard', 'main');
  const reset = branchStates(main).find(entry => entry.branch === 'fix/moved-K9');
  assert.equal(reset?.merged, false, 'a branch that a reset moved onto main starts anew');
  assert.match(reset?.reason ?? '', /^fresh/);

});
