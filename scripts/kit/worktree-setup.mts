#!/usr/bin/env node
// The worktree of a row (K348, docs/operations/local-links.md, Worktrees): `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]`
// creates the worktree `../<repository>-<name>-<id>` of the main checkout on the branch `<type>/<name>-<id>` from main and runs
// `make install` in it, which installs its own tools, packages and links (K858); a worktree without node_modules first gets npm ci
// of the npm that packageManager names, so a Makefile that includes kit from node_modules can run. A second run on an existing
// worktree of that branch installs and checks it again, so a run leaves the same state.
//
//   node scripts/kit/worktree-setup.mts <name> <id> [<type>]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, gitResult } from './git.mts';
import { PACKAGE as KIT_PACKAGE } from './kit-check.mts';
import { linkFolders, providedFolders } from './link-folders.mts';
import { declaredCheckouts, providerKey, providers } from './link-providers.mts';
import { readNpmManifestFile } from './manifests.mts';
import { isMain, repositoryRoot } from './paths.mts';

/** The worktree of a row: its folder beside the main checkout and its branch. */
export function worktreeOf(main: string, { name, id, type }: { name: string; id: string; type: string }): { folder: string; branch: string } {
  return { folder: path.join(path.dirname(main), `${path.basename(main)}-${name}-${id}`), branch: `${type}/${name}-${id}` };
}

/** Runs `command` with `args` in `folder`, throwing when it does not start or ends with a failure. */
function run(command: string, args: string[], folder: string, env: NodeJS.ProcessEnv): void {
  const shown = [command, ...args].join(' ');
  const result = spawnSync(command, args, { cwd: folder, stdio: 'inherit', env });
  if (result.error) throw new Error(`${shown} could not start in ${folder}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${shown} ended with ${result.status === null ? `the signal ${result.signal}` : `exit status ${result.status}`} in ${folder}`);
}

/**
 * Creates or reuses the worktree of the row and runs `make install`, then `make link-check`, in it; returns its folder. Throws
 * before it creates anything when the folder exists as anything but the worktree of the branch, and throws with the worktree kept
 * when a step in it fails, so a second run retries it.
 */
export function setupWorktree(root: string, row: { name: string; id: string; type: string }, { print = (text: string) => console.log(text), env = process.env }: { print?: (text: string) => void; env?: NodeJS.ProcessEnv } = {}): string {
  const main = path.dirname(path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim()));
  const { folder, branch } = worktreeOf(main, row);
  const listed = git(main, 'worktree', 'list', '--porcelain').split('\n\n').map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }));
  const existing = listed.find(entry => entry.folder === folder);
  if (existing && existing.branch !== branch) throw new Error(`${folder} is the worktree of ${existing.branch ?? 'a detached HEAD'}, not of ${branch}`);
  if (!existing) {
    if (existsSync(folder)) throw new Error(`${folder} exists and is no worktree of ${branch}; remove it or choose another name`);
    const known = gitResult(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
    git(main, 'worktree', 'add', '--quiet', folder, ...(known ? [branch] : ['-b', branch, 'main']));
    print(`[worktree-setup] created ${folder} on ${branch}`);
  } else {
    print(`[worktree-setup] ${folder} is the worktree of ${branch}; installing and checking it again`);
  }
  // The make of the main checkout that runs this puts its var/tools first on PATH and passes its flags; the worktree runs its own
  // tools in a make of its own (K858).
  const tools = path.join(main, 'var', 'tools');
  const own: NodeJS.ProcessEnv = { ...env, PATH: (env.PATH ?? '').split(path.delimiter).filter(entry => entry !== tools && !entry.startsWith(`${tools}${path.sep}`)).join(path.delimiter) };
  for (const name of ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL']) delete own[name];
  // A consumer Makefile includes kit from node_modules, which a new worktree lacks: npm ci of the npm that packageManager names
  // installs it first, as the clean checkout of the gates workflow does (release.md), and make install then runs its own.
  const manifest = path.join(folder, 'package.json');
  if (!existsSync(path.join(folder, 'node_modules')) && existsSync(path.join(folder, 'package-lock.json')) && existsSync(manifest)) {
    const { packageManager } = readNpmManifestFile(manifest);
    if (packageManager?.startsWith('npm@')) {
      print(`[worktree-setup] npm ci of ${packageManager.split('+')[0]} in ${folder}`);
      run('npm', ['exec', '--yes', `--package=${packageManager.split('+')[0]}`, '--', 'npm', 'ci', '--ignore-scripts', '--allow-remote=root'], folder, own);
    }
  }
  // make reads that include before make install links the packages, so the installed kit gets its link one step early: the provider
  // that install-link resolves (the link declaration of main, declaredCheckouts, and providers, link-providers.mts) and its link
  // (linkFolders), kit alone. With no declaration nothing is linked, and the installed release runs.
  const kit = providers(declaredCheckouts(folder) ?? [], undefined, folder, folder).get(providerKey('npm', KIT_PACKAGE));
  for (const line of kit === undefined ? [] : linkFolders(providedFolders(folder, [kit]))) print(`[worktree-setup] ${line}`);
  for (const target of ['install', 'link-check']) {
    print(`[worktree-setup] make ${target} in ${folder}`);
    run('make', ['--no-print-directory', target], folder, own);
  }
  return folder;
}

if (isMain(import.meta.url)) {
  const [name = '', id = '', type = 'fix', ...extra] = process.argv.slice(2);
  try {
    if (extra.length > 0) throw new Error(`unexpected argument ${JSON.stringify(extra[0])}`);
    console.log(`[worktree-setup] ready: ${setupWorktree(repositoryRoot(), { name, id, type })}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-setup] ${error.message}`);
    process.exit(1);
  }
}
