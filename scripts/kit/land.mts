#!/usr/bin/env node
// Lands a branch on main (K394): `make land BRANCH=<branch>`, run in the main checkout. It refuses unless the main checkout is on
// main and clean, the branch exists and is rebased on main, and a worktree has the branch checked out (its gates run on its own
// tree and install). It runs the static gates of kit-gates that the changed paths of the branch select through
// config/owner-checks.json, always with docs-check and commits-check (commits-check over main..<branch>); no test runs. On the
// first failure it prints the gate and its output and merges nothing. Then it merges fast-forward, removes the worktree when it
// has no uncommitted change (an ignored install does not count) and deletes the branch. A branch that main already contains
// skips the gates and the merge, and only what is left is removed.
//
//   node scripts/kit/land.mts <branch>
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { kitGates } from './gate-red.mts';
import { git, gitResult } from './git.mts';
import { DECLARATION, importGraph, select } from './owner-check.mts';
import type { OwnerDeclaration } from './owner-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';
import { trackedFiles } from './tracked-files.mts';

// The gates that land whatever the changed paths: the documents and the commit messages of the branch.
const ALWAYS_GATES = ['docs-check', 'commits-check'];

/** The folder of the worktree that has `branch` checked out, from `git worktree list --porcelain`; undefined when none has it. */
function worktreeOf(root: string, branch: string): string | undefined {
  const entries = git(root, 'worktree', 'list', '--porcelain').split('\n\n');
  return entries
    .map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }))
    .find(entry => entry.branch === branch)?.folder;
}

/**
 * The gates of kit-gates that the owners of `changed` select in the worktree `folder`, in the order of kit-gates, with the
 * ALWAYS_GATES; only gates are returned, so no test target runs. Throws on a changed path that no owner declares.
 */
function gatesOf(folder: string, changed: string[]): { gates: string[]; reasons: string[] } {
  const declaration = readConfig<OwnerDeclaration>(folder, DECLARATION, 'owner-checks.schema.json');
  const exists = (file: string) => existsSync(path.join(folder, file));
  const selection = select(declaration, changed, [], exists, importGraph(folder, trackedFiles(folder)));
  if (selection.unowned.length) throw new Error(`${selection.unowned.join(', ')}: no owner in ${DECLARATION} owns the path; add a rule whose paths match it`);
  const kit = kitGates(folder);
  const wanted = new Set<string | undefined>([...selection.checks.map(check => check.target), ...ALWAYS_GATES]);
  for (const gate of ALWAYS_GATES) if (!kit.has(gate)) throw new Error(`${gate} is no gate of kit-gates in ${folder}`);
  return { gates: [...kit].filter(gate => wanted.has(gate)), reasons: selection.reasons };
}

/**
 * Lands `branch` on main in the repository of `root` (the main checkout); throws, merging nothing, when a refusal applies or a gate
 * fails. A branch that main contains skips the gates and the merge.
 */
export function land(root: string, branch: string, { print = (text: string) => console.log(`[land] ${text}`) }: { print?: (text: string) => void } = {}): void {
  if (branch === '') throw new Error('no branch: make land BRANCH=<branch>');
  const head = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (head !== 'main') throw new Error(`the main checkout ${root} is on ${head}, not on main`);
  const dirty = git(root, 'status', '--porcelain').trim();
  if (dirty !== '') throw new Error(`the main checkout ${root} has uncommitted changes:\n${dirty}`);
  if (gitResult(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status !== 0) throw new Error(`the branch ${branch} does not exist`);
  const folder = worktreeOf(root, branch);
  if (gitResult(root, 'merge-base', '--is-ancestor', branch, 'main').status === 0) {
    print(`${branch} is contained in main already: no gate runs and nothing is merged`);
  } else {
    if (gitResult(root, 'merge-base', '--is-ancestor', 'main', branch).status !== 0) throw new Error(`${branch} is not rebased on main; rebase it on main first`);
    if (folder === undefined) throw new Error(`${branch} has no worktree; the gates run on its own tree and install, so make worktree-setup first`);
    const changed = git(root, 'diff', '--name-only', `main...${branch}`).split('\n').filter(line => line !== '');
    const { gates, reasons } = gatesOf(folder, changed);
    for (const reason of reasons) print(reason);
    print(`gates of ${branch} in ${folder}: ${gates.join(', ')}`);
    for (const gate of gates) {
      const args = gate === 'commits-check' ? ['--no-print-directory', gate, `RANGE=main..${branch}`] : ['--no-print-directory', gate];
      print(`${gate} in ${folder}`);
      const result = spawnSync('make', args, { cwd: folder, encoding: 'utf8', maxBuffer: 1 << 28 });
      if (result.error) throw new Error(`make ${gate} could not start in ${folder}: ${result.error.message}`);
      if (result.status !== 0) {
        print(`${gate} failed in ${folder}:\n${result.stdout}${result.stderr}`);
        throw new Error(`${branch} is refused: the gate ${gate} ${result.status === null ? `ended with the signal ${result.signal}` : `exited ${result.status}`}; nothing is merged`);
      }
      print(`${gate} passed`);
    }
    git(root, 'merge', '--ff-only', branch);
    print(`merged ${branch} into main`);
  }
  let kept = false;
  if (folder !== undefined) {
    if (git(folder, 'status', '--porcelain').trim() === '') {
      git(root, 'worktree', 'remove', folder);
      print(`removed the worktree ${folder}`);
    } else {
      kept = true;
      print(`kept the worktree ${folder}: it has uncommitted changes, so ${branch} stays checked out there`);
    }
  }
  if (!kept) {
    git(root, 'branch', '-d', branch);
    print(`deleted the branch ${branch}`);
  }
}

if (isMain(import.meta.url)) {
  const [branch = ''] = process.argv.slice(2);
  try {
    land(repositoryRoot(), branch);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[land] ${error.message}`);
    process.exit(1);
  }
}
