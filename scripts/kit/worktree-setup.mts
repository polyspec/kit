#!/usr/bin/env node
// The worktree of a row (K348, docs/operations/local-links.md, Worktrees): `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]`
// creates the worktree `../<repository>-<name>-<id>` of the main checkout on the branch `<type>/<name>-<id>` from main, links its
// node_modules to the main checkout's and installs nothing (K519: the tools of var/tools are the main checkout's through kit.mk and
// toolsPath), rebuilds its own packages and checks it with `make link-state-check`. It refuses while the free disk is under
// WORKTREE_DISK_FLOOR, and a second run on an existing worktree of that branch links and checks it again, so a run leaves the same state.
//
//   node scripts/kit/worktree-setup.mts <name> <id> [<type>]
import { appendFileSync, existsSync, lstatSync, readFileSync, readlinkSync, statfsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { COMMIT_RULES } from './check-commits.mts';
import { git, gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';

/** The free disk under which no worktree is made, in bytes: 30 GB, the floor of the owner's guidelines for a new worktree. */
export const WORKTREE_DISK_FLOOR = 30 * 1024 ** 3;

// A name of a worktree: a slug of lower case letters, digits and hyphens; an id: the letters, digits, dots and hyphens of a row.
const NAME = /^[a-z][a-z0-9-]*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** The free bytes of the file system of `directory` for an unprivileged user. */
export const freeBytes = (directory: string): number => {
  const stats = statfsSync(directory);
  return stats.bavail * stats.bsize;
};

/** The worktree of a row: its folder beside the main checkout and its branch. */
export function worktreeOf(main: string, { name, id, type }: { name: string; id: string; type: string }): { folder: string; branch: string } {
  if (!NAME.test(name)) throw new Error(`the name ${JSON.stringify(name)} is no slug of lower case letters, digits and hyphens`);
  if (!ID.test(id)) throw new Error(`the id ${JSON.stringify(id)} is no id of a row`);
  if (!COMMIT_RULES.types.includes(type)) throw new Error(`the type ${JSON.stringify(type)} is none of ${COMMIT_RULES.types.join(', ')}`);
  return { folder: path.join(path.dirname(main), `${path.basename(main)}-${name}-${id}`), branch: `${type}/${name}-${id}` };
}

/** The folders of the main checkout that a worktree links instead of installing them (K519). */
export const LINKED_FOLDERS = ['node_modules'] as const;

/**
 * Links each of LINKED_FOLDERS of the worktree `folder` to that of the main checkout `main`, and adds the links to the exclude file of
 * the common git folder, since an ignore pattern with a trailing slash matches a folder and not a link. Throws when the main checkout
 * has no such folder, or the worktree holds the name as anything but that link.
 */
function linkFolders(main: string, folder: string, print: (text: string) => void): void {
  const exclude = path.join(path.resolve(main, git(main, 'rev-parse', '--git-common-dir').trim()), 'info', 'exclude');
  for (const name of LINKED_FOLDERS) {
    const source = path.join(main, name);
    const target = path.join(folder, name);
    if (!existsSync(source)) throw new Error(`${source} is missing; run make install in the main checkout, whose ${name} a worktree links`);
    const entry = lstatSync(target, { throwIfNoEntry: false });
    if (entry === undefined) {
      symlinkSync(source, target);
      print(`[worktree-setup] linked ${name} to ${source}`);
    } else if (!entry.isSymbolicLink() || path.resolve(folder, readlinkSync(target)) !== source) {
      throw new Error(`${target} exists and is not the link to ${source}; remove it, since a worktree installs nothing (K519)`);
    }
    const pattern = `/${name}`;
    const lines = existsSync(exclude) ? readFileSync(exclude, 'utf8').split('\n') : [];
    if (!lines.includes(pattern)) {
      appendFileSync(exclude, `${lines.length > 0 && lines.at(-1) !== '' ? '\n' : ''}${pattern}\n`);
      print(`[worktree-setup] excluded ${pattern} in ${exclude}`);
    }
  }
}

/**
 * Creates or reuses the worktree of the row in the repository of `root`, links its folders (linkFolders), rebuilds its packages and runs
 * `make link-state-check` in it; returns its folder. Throws, creating nothing, while `free` is under WORKTREE_DISK_FLOOR, and when the
 * folder exists as anything but the worktree of the branch.
 */
/**
 * The link tool that rebuilds the packages of a worktree (K482). A consumer runs the link of its installed kit, and kit itself runs its
 * own scripts/kit/link.mts, which the worktree has as a source; the tool is chosen by which of the two the worktree holds.
 */
function linkTool(folder: string): string {
  const own = path.join(folder, 'scripts/kit/link.mts');
  return existsSync(own) ? own : path.join(folder, 'node_modules/@polyspec/kit/dist/link.mjs');
}

export function setupWorktree(root: string, row: { name: string; id: string; type: string }, { free = freeBytes, print = (text: string) => console.log(text) }: { free?: (directory: string) => number; print?: (text: string) => void } = {}): string {
  const main = path.dirname(path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim()));
  const { folder, branch } = worktreeOf(main, row);
  const listed = git(main, 'worktree', 'list', '--porcelain').split('\n\n').map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }));
  const existing = listed.find(entry => entry.folder === folder);
  if (existing && existing.branch !== branch) throw new Error(`${folder} is the worktree of ${existing.branch ?? 'a detached HEAD'}, not of ${branch}`);
  if (!existing) {
    if (existsSync(folder)) throw new Error(`${folder} exists and is no worktree of ${branch}; remove it or choose another name`);
    const available = free(path.dirname(main));
    if (available < WORKTREE_DISK_FLOOR) throw new Error(`the free disk is ${(available / 1024 ** 3).toFixed(1)} GB, under the floor of ${WORKTREE_DISK_FLOOR / 1024 ** 3} GB for a new worktree; free disk first`);
    const known = gitResult(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
    git(main, 'worktree', 'add', '--quiet', folder, ...(known ? [branch] : ['-b', branch, 'main']));
    print(`[worktree-setup] created ${folder} on ${branch}`);
  } else {
    print(`[worktree-setup] ${folder} is the worktree of ${branch}; linking and checking it again`);
  }
  linkFolders(main, folder, print);
  for (const target of ['rebuild', 'link-state-check']) {
    // The rebuild (K482) builds the packages of the worktree's own repository before the check reads their builds: a new worktree has none yet.
    const [command, args] = target === 'rebuild'
      ? [process.execPath, [linkTool(folder), 'rebuild', '.']]
      : ['make', ['--no-print-directory', target]];
    print(`[worktree-setup] ${target === 'rebuild' ? 'link rebuild' : `make ${target}`} in ${folder}`);
    const result = spawnSync(command, args, { cwd: folder, stdio: 'inherit' });
    if (result.error) throw new Error(`${target} could not start in ${folder}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${target} ended with ${result.status === null ? `the signal ${result.signal}` : `exit status ${result.status}`} in ${folder}`);
  }
  return folder;
}

if (isMain(import.meta.url)) {
  const [name = '', id = '', type = 'fix'] = process.argv.slice(2);
  try {
    console.log(`[worktree-setup] ready: ${setupWorktree(repositoryRoot(), { name, id, type })}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-setup] ${error.message}`);
    process.exit(1);
  }
}
