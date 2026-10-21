#!/usr/bin/env node
// Prunes the merged branches and their worktrees (K381): `make worktree-prune`, run in a checkout. A local branch other than main is
// merged when it has commits of its own and all of them are in main; its own commits are those that its reflog records as made on
// it (commit, cherry-pick, revert), so a fresh branch with no commit of its own is never merged, though main contains it, also after a
// rebase moved it onto a newer main (K381-1). For each merged branch, the worktree that has it checked out is removed when it
// has no uncommitted change (an ignored install does not count), then the branch is deleted with `git branch -d`. A dirty worktree, an unmerged, a fresh or a reflog-less
// branch is listed with its reason and left, so a second run leaves the same state. It is a module of its own beside land.mts, which
// removes one branch and its worktree after a merge; link-state-check reads its branchStates to find a merged branch that is left.
// Before a worktree is removed, the stop targets of WORKTREE_STOP run in it (K441), and the processes that name a dead worktree
// folder of the repository are listed by pid and path, and never killed.
//
//   node scripts/kit/worktree-prune.mts
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { machineListing, stopServers, stopTargetOf } from './land.mts';
import { git, gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';

export type BranchState = { branch: string; folder: string | undefined; merged: boolean; reason: string };

/**
 * The processes of the ps `listing` whose command line names a path `<parent>/<name>-<rest>` under the worktree folders of `root`
 * (the parent folder, the repository's name as a prefix, as worktree-setup names them) that no live worktree of `root` has, with
 * the pid, the command and the dead path (K441).
 */
export function deadWorktreeProcesses(root: string, listing: string): { pid: number; command: string; folder: string }[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = `${realpathSync(path.dirname(root))}/${path.basename(root)}-`;
  const pattern = new RegExp(`(?<![^\\s=])(${escape(prefix)}[^\\s/'"]+)`, 'g');
  const live = new Set(git(root, 'worktree', 'list', '--porcelain').split('\n').map(line => /^worktree (.*)$/.exec(line)?.[1]));
  const found: { pid: number; command: string; folder: string }[] = [];
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+\d+\s+(.*)$/.exec(line);
    if (match === null) continue;
    const [, id = '', command = ''] = match;
    for (const named of command.matchAll(pattern)) {
      const folder = named[1] ?? '';
      if (!live.has(folder)) found.push({ pid: Number(id), command, folder });
    }
  }
  return found.filter((entry, index) => found.findIndex(other => other.pid === entry.pid && other.folder === entry.folder) === index);
}

/** The folders of the worktrees of `root` that have a branch checked out, by branch, from `git worktree list --porcelain`. */
function worktreeFolders(root: string): Map<string, string> {
  const folders = new Map<string, string>();
  for (const entry of git(root, 'worktree', 'list', '--porcelain').split('\n\n')) {
    const folder = /^worktree (.*)$/m.exec(entry)?.[1];
    const branch = /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1];
    if (folder !== undefined && branch !== undefined) folders.set(branch, folder);
  }
  return folders;
}

// A reflog entry of a commit made on the branch: a rebase (rebase (finish)) or a fast-forward moves the branch onto commits of main
// and makes none of its own (K381-1).
const OWN_COMMIT = /^(?:commit|cherry-pick|revert)\b/;

/**
 * Whether `branch` is merged into main, with the reason (K381): it has commits of its own, which its reflog records as commits made
 * on it, and main contains its tip. A fresh branch, which a rebase onto a newer main moves past commits of main, has none (K381-1).
 */
function mergedReason(root: string, branch: string): { merged: boolean; reason: string } {
  const entries = git(root, 'reflog', 'show', '--format=%gs', `refs/heads/${branch}`).split('\n').filter(line => line !== '');
  if (entries.length === 0) return { merged: false, reason: 'no reflog entry, so its creation point is unknown' };
  if (!entries.some(entry => OWN_COMMIT.test(entry))) return { merged: false, reason: 'fresh: no commit of its own since its creation' };
  const outside = git(root, 'rev-list', branch, '^main').split('\n').filter(line => line !== '');
  if (outside.length > 0) return { merged: false, reason: `${outside.length} of its commits are not in main` };
  return { merged: true, reason: 'merged: all of its commits are in main' };
}

/** The state of every local branch other than main; none while main does not exist. */
export function branchStates(root: string): BranchState[] {
  if (gitResult(root, 'rev-parse', '--verify', '--quiet', 'refs/heads/main').status !== 0) return [];
  const folders = worktreeFolders(root);
  const branches = git(root, 'for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads').split('\n').filter(name => name !== '' && name !== 'main');
  return branches.map(branch => ({ branch, folder: folders.get(branch), ...mergedReason(root, branch) }));
}

/**
 * Removes the worktree and deletes the branch of each merged branch of `root`, and reports every branch that is left with its reason;
 * a worktree with uncommitted changes, the checkout that runs the prune and a refusal of `git branch -d` keep the branch.
 */
export function prune(root: string, { print = (text: string) => console.log(`[worktree-prune] ${text}`) }: { print?: (text: string) => void } = {}): void {
  for (const { branch, folder, merged, reason } of branchStates(root)) {
    if (!merged) {
      print(`kept ${branch}: ${reason}`);
      continue;
    }
    if (folder !== undefined) {
      if (folder === root) {
        print(`kept ${branch}: it is checked out in ${root}, the checkout that runs the prune`);
        continue;
      }
      const status = gitResult(folder, 'status', '--porcelain');
      if (status.status !== 0) {
        print(`kept ${branch} in ${folder}: git status failed: ${status.stderr.trim()}`);
        continue;
      }
      if (status.stdout.trim() !== '') {
        print(`kept ${branch} in ${folder}: it has uncommitted changes`);
        continue;
      }
      const stop = stopTargetOf(folder);
      if (stop !== undefined) stopServers(folder, stop, print);
      git(root, 'worktree', 'remove', folder);
      print(`removed the worktree ${folder} of ${branch}`);
    }
    const deleted = gitResult(root, 'branch', '-d', branch);
    if (deleted.status !== 0) {
      print(`kept ${branch}: git branch -d refused it: ${deleted.stderr.trim()}`);
      continue;
    }
    print(`deleted the branch ${branch}`);
  }
  for (const { pid, command, folder } of deadWorktreeProcesses(root, machineListing().ps)) {
    print(`process ${pid} names the path ${folder} of a removed worktree, which no live worktree has; it is left running: ${command}`);
  }
}

if (isMain(import.meta.url)) {
  try {
    prune(repositoryRoot());
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-prune] ${error.message}`);
    process.exit(1);
  }
}
