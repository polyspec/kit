// The IDs of checklist rows across branches (K497). Two branches that register one ID for two tasks collide at the rebase or, when
// the conflict is resolved by hand, overwrite the row that main holds; so land, and a commit on a branch, compare each row with the
// row of the same ID on main. A row whose task differs from main's is refused unless the ID is the row of the branch itself
// (worktree-setup names the branch TYPE/NAME-ID), naming the task on main and the next ID that neither main nor any local branch holds.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, loadConfig, readChecklist, trackersOf } from './checklist.mts';
import type { Tracker } from './checklist.mts';
import { fileAt, git, gitResult } from './git.mts';

/** A row of a checklist whose ID main holds with another task. */
export interface RowClash {
  id: string;
  file: string;
  mainTask: string;
  next: string;
}

/** The checklist files under docs/plans of the tree `rev` of `root` (`''` is the index). */
function planFiles(root: string, rev: string): string[] {
  const listing = rev === '' ? git(root, 'ls-files', '--', 'docs/plans') : git(root, 'ls-tree', '-r', '--name-only', rev, '--', 'docs/plans');
  return listing.split('\n').filter(file => /^docs\/plans\/[^/]+\/checklist\.md$/.test(file));
}

/** The task of each row of the checklist `file` in the tree `rev`, by ID; empty when the tree lacks the file. */
function tasksAt(root: string, rev: string, file: string, tracker: Tracker): Map<string, string> {
  return new Map(readChecklist(fileAt(root, rev, file), tracker).items.map(item => [item.id, item.title]));
}

/** The ID of the row of `branch`, which worktree-setup names TYPE/NAME-ID, or undefined. */
export function ownIdOf(branch: string, idPattern: string): string | undefined {
  return new RegExp(`-(${idPattern})$`).exec(branch)?.[1];
}

/** The next ID of the prefix of `id` that none of `held` uses: the largest number of that prefix plus one. */
function nextId(id: string, held: Iterable<string>): string {
  const prefix = /^[A-Za-z]+/.exec(id)?.[0] ?? '';
  let largest = 0;
  for (const other of held) {
    const match = /^([A-Za-z]+)(\d+)/.exec(other);
    if (match?.[1] === prefix) largest = Math.max(largest, Number(match[2]));
  }
  return `${prefix}${largest + 1}`;
}

/**
 * The rows of the tree `rev` (`''` is the index) whose ID main holds with another task, when the tree is that of `branch`. The row
 * of the branch's own ID may restate its task. Every local branch counts for the next free ID, since a branch may hold an ID that
 * main does not yet hold.
 */
export function rowClashes(root: string, rev: string, branch: string): RowClash[] {
  // A repository without a checklist configuration, or without main, has no row to compare.
  if (branch === 'main' || !existsSync(path.join(root, CONFIG)) || gitResult(root, 'rev-parse', '--verify', '--quiet', 'refs/heads/main').status !== 0) return [];
  const config = loadConfig(root);
  const own = ownIdOf(branch, config.idPattern);
  const clashes: RowClash[] = [];
  const refs = git(root, 'for-each-ref', '--format=%(refname)', 'refs/heads').split('\n').filter(ref => ref !== '');
  for (const tracker of trackersOf(config, planFiles(root, rev))) {
    const main = tasksAt(root, 'refs/heads/main', tracker.path, tracker);
    for (const [id, task] of tasksAt(root, rev, tracker.path, tracker)) {
      const onMain = main.get(id);
      if (onMain === undefined || onMain === task || id === own) continue;
      const held = new Set<string>(main.keys());
      for (const ref of refs) for (const key of tasksAt(root, ref, tracker.path, tracker).keys()) held.add(key);
      for (const key of tasksAt(root, rev, tracker.path, tracker).keys()) held.add(key);
      clashes.push({ id, file: tracker.path, mainTask: onMain, next: nextId(id, held) });
    }
  }
  return clashes;
}

/** The message of a clash, which land and the commit check print alike. */
export const clashMessage = (clash: RowClash): string =>
  `${clash.file}: the row ${clash.id} has another task than main's ${clash.id} ("${clash.mainTask}"); register the row as ${clash.next}, which neither main nor any local branch holds, and keep main's ${clash.id} (K497)`;
