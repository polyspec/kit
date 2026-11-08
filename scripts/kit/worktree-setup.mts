#!/usr/bin/env node
// The worktree of a row (K348, docs/operations/local-links.md, Worktrees): creates the worktree `--folder` on the branch `--branch`,
// from `--base` when the branch is new, runs the `--prepare` command of the caller in it, then the make targets that the caller names
// with `--make`, which install its own tools, packages and links (K858). The folder, the branch, its base and every command are the
// caller's (K1107); kit names none, and they run with the environment of the caller as it is. A second run on an existing worktree of that branch prepares and runs the targets again, so a run
// leaves the same state.
//
//   node scripts/kit/worktree-setup.mts --folder <folder> --branch <branch> --base <base> [--prepare <command>] [--make <target>]...
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';

/** The worktree that a caller declares (K1107): its folder, its branch, the base of a new branch, a command to prepare it and make targets. */
export interface WorktreeDeclaration {
  folder: string;
  branch: string;
  base: string;
  prepare?: string | undefined;
  targets: string[];
}

/** Runs `command` with `args` in `folder`, throwing when it does not start or ends with a failure. */
function run(command: string, args: string[], folder: string, env: NodeJS.ProcessEnv, shown: string = [command, ...args].join(' ')): void {
  const result = spawnSync(command, args, { cwd: folder, stdio: 'inherit', env });
  if (result.error) throw new Error(`${shown} could not start in ${folder}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${shown} ended with ${result.status === null ? `the signal ${result.signal}` : `exit status ${result.status}`} in ${folder}`);
}

/**
 * Creates or reuses the worktree that `declaration` names, runs its `prepare` command and then its make targets in it; returns its
 * folder. Throws before it creates anything when the folder exists as anything but the worktree of the branch, and throws with the
 * worktree kept when a step in it fails, so a second run retries it.
 */
export function setupWorktree(root: string, declaration: WorktreeDeclaration, { print = (text: string) => console.log(text), env = process.env }: { print?: (text: string) => void; env?: NodeJS.ProcessEnv } = {}): string {
  const { branch, base, prepare, targets } = declaration;
  if (declaration.folder === '' || branch === '' || base === '') throw new Error('worktree-setup needs --folder, --branch and --base');
  const main = path.dirname(path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim()));
  const folder = path.resolve(root, declaration.folder);
  const listed = git(main, 'worktree', 'list', '--porcelain').split('\n\n').map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }));
  const existing = listed.find(entry => entry.folder === folder);
  if (existing && existing.branch !== branch) throw new Error(`${folder} is the worktree of ${existing.branch ?? 'a detached HEAD'}, not of ${branch}`);
  const known = gitResult(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
  if (!existing) {
    if (existsSync(folder)) throw new Error(`${folder} exists and is no worktree of ${branch}; remove it or choose another folder`);
    git(main, 'worktree', 'add', '--quiet', folder, ...(known ? [branch] : ['-b', branch, base]));
    print(`[worktree-setup] created ${folder} on ${branch}`);
  } else {
    print(`[worktree-setup] ${folder} is the worktree of ${branch}; preparing and checking it again`);
  }
  // The caller's own preparation, such as the npm ci that installs the kit a Makefile includes from node_modules (K1107).
  if (prepare !== undefined) {
    print(`[worktree-setup] ${prepare} in ${folder}`);
    run('/bin/sh', ['-c', prepare], folder, env, prepare);
  }
  for (const target of targets) {
    print(`[worktree-setup] make ${target} in ${folder}`);
    run('make', ['--no-print-directory', target], folder, env);
  }
  return folder;
}

/** The declaration that the arguments `args` make: --folder, --branch, --base and --prepare once each, --make for each target. */
export function declarationOf(args: string[]): WorktreeDeclaration {
  const single: Record<string, string | undefined> = { '--folder': undefined, '--branch': undefined, '--base': undefined, '--prepare': undefined };
  const targets: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const [flag = '', value] = [args[index], args[index + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--make') targets.push(value);
    else if (flag in single && single[flag] === undefined) single[flag] = value;
    else throw new Error(`unexpected argument ${JSON.stringify(flag)}`);
  }
  return { folder: single['--folder'] ?? '', branch: single['--branch'] ?? '', base: single['--base'] ?? '', prepare: single['--prepare'], targets };
}

if (isMain(import.meta.url)) {
  // A call that declares no worktree is a usage error (exit 2): kit names no folder, branch or base of its own (K1107).
  let declaration: WorktreeDeclaration = { folder: '', branch: '', base: '', targets: [] };
  try {
    declaration = declarationOf(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-setup] ${error.message}`);
    process.exit(2);
  }
  if (declaration.folder === '' || declaration.branch === '' || declaration.base === '') {
    console.error('[worktree-setup] usage: node scripts/kit/worktree-setup.mts --folder <folder> --branch <branch> --base <base> [--prepare <command>] [--make <target>]...');
    process.exit(2);
  }
  try {
    console.log(`[worktree-setup] ready: ${setupWorktree(repositoryRoot(), declaration)}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-setup] ${error.message}`);
    process.exit(1);
  }
}
