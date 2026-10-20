// Tests of scripts/kit/worktree-prune.mts and of the merged-branch finding of link-state-check (K381): a branch with commits of its
// own that are all in main is merged; make worktree-prune removes it with its clean worktree and keeps a fresh, unmerged or dirty
// one with the reason, and a second run leaves the same state; link-state-check fails while a merged branch or its worktree is left.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { linkFindings } from '../../scripts/kit/link-state-check.mts';
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

test('link-state-check fails while a merged branch is left (K381)', (t) => {
  const { main, dirty } = fixture(t);
  const findings = linkFindings(main, process.env);
  const left = findings.filter(finding => /fix\/dirty-K2/.test(finding));
  assert.equal(left.length, 1, findings.join('\n'));
  assert.match(left[0] ?? '', /repo-dirty/, 'the finding names the worktree');
  assert.match(left[0] ?? '', /make worktree-prune/, 'the finding names the fix');
  assert.equal(existsSync(dirty), true);
  assert.equal(findings.some(finding => /fix\/fresh-K3|fix\/open-K4|fix\/noreflog-K5/.test(finding)), false, 'the other branches are no finding');
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
