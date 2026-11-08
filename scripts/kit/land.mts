#!/usr/bin/env node
// Lands a branch on the target branch that its caller names (K394, K1100): `land.mts <branch> <target>`. A branch that the target has
// left behind is rebased onto the target in its worktree first (K495-1); a rebase that conflicts is aborted and refused, and land
// rewrites no conflict (K1100). Then the target merges it fast-forward, the worktree is removed when it has no uncommitted change (an
// ignored install does not count) and the branch is deleted. land runs no gate and judges no commit (K1053): what a branch must pass
// before it lands is the repository's own recipe, which runs before land. A branch that the target already contains skips the merge,
// and only its worktree and branch are removed; land removes no other worktree or branch (K1100). Before a worktree is removed, the
// make targets that WORKTREE_STOP names in its Makefile stop its servers (K441); a stop that fails keeps the worktree. A lock in the common git folder covers the rebase and the merge (K495).
//
//   node scripts/kit/land.mts <branch> <target>
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git, gitResult } from './git.mts';
import { makeDatabase } from './owner-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { expandMake } from './recipe-tools.mts';
import { runCommand, failureOf, type RunCommandResult } from './run-command.mts';
import { watchParent } from './process-group.mts';
import { compactSeconds } from './time.mts';
import { refreshLinked } from './linked-build.mts';
import { RETAINED_BRANCHES_CONFIG, retainedBranch, retainedBranches } from './retained-branches.mts';

// K429, K441-1: the processes of the machine that run in a worktree, read with ps and lsof (read only). A process runs in a worktree
// when its working directory, one of its open files or its executable lies in it; a path that only its command line names, as the
// argument of a du, is no use of it. land itself and its ancestors are left out.
export interface MachineListing {
  ps: string;
  // The lsof -Fpn output: each process by its p line, with the n line of its cwd, its executable and each open file.
  lsof: string;
}

/**
 * The processes of the worktree `folder` in `listing`, by pid, with the command line of each from ps. `self` and every ancestor of it,
 * such as the make and the shell that run make land, are left out (K429-1).
 */
export function worktreeProcesses(folder: string, { ps, lsof }: MachineListing, self: number = process.pid): { pid: number; command: string }[] {
  const inside = (file: string) => file === folder || file.startsWith(`${folder}/`);
  const commands = new Map<number, string>();
  const parents = new Map<number, number>();
  const found = new Map<number, string>();
  for (const line of ps.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const [, id = '', parent = '', command = ''] = match;
    commands.set(Number(id), command);
    parents.set(Number(id), Number(parent));
  }
  const ancestors = new Set<number>();
  for (let pid: number | undefined = self; pid !== undefined && pid > 0 && !ancestors.has(pid); pid = parents.get(pid)) ancestors.add(pid);
  let pid: number | undefined;
  for (const line of lsof.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== undefined && inside(line.slice(1))) found.set(pid, commands.get(pid) ?? `(no command line in ps)`);
  }
  return [...found]
    .filter(([live]) => !ancestors.has(live))
    .sort(([a], [b]) => a - b)
    .map(([pid, command]) => ({ pid, command }));
}

/** The ps and lsof outputs of the machine, read only. lsof is required: a process is in a worktree by its files, which only lsof lists (K441-1). */
export function machineListing(): MachineListing {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (ps.error || ps.status !== 0) throw new Error(`ps could not list the processes: ${ps.error?.message ?? ps.stderr}`);
  // -n and -P skip the name and port lookups, which took 5.6 s on the machine of K453 against 0.4 s with them; land runs this twice.
  const lsof = spawnSync('lsof', ['-nP', '-Fpn'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (lsof.error && (lsof.error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('lsof is missing: make needs it to find the processes that run in a worktree (K441-1); install lsof and run again');
  if (lsof.error) throw new Error(`lsof could not run: ${lsof.error.message}`);
  return { ps: ps.stdout, lsof: lsof.stdout };
}

/** The folder of the worktree that has `branch` checked out, from `git worktree list --porcelain`; undefined when none has it. */
function worktreeOf(root: string, branch: string): string | undefined {
  const entries = git(root, 'worktree', 'list', '--porcelain').split('\n\n');
  return entries
    .map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }))
    .find(entry => entry.branch === branch)?.folder;
}

/** The make targets that WORKTREE_STOP of the Makefile of `folder` names, read from the make database; undefined when it names none. */
export function stopTargetOf(folder: string): string[] | undefined {
  const make = makeDatabase(folder);
  const targets = expandMake(make.variables.get('WORKTREE_STOP') ?? '', make.variables).split(/\s+/).filter(Boolean);
  return targets.length > 0 ? targets : undefined;
}

/** Runs the stop `targets` in the worktree `folder` with make; throws, naming the targets and printing their output, when one fails. */
export async function stopServers(folder: string, targets: string[], print: (text: string) => void): Promise<void> {
  const names = targets.join(' ');
  print(`${names} in ${folder}`);
  const result = await runMake(folder, ['--no-print-directory', ...targets], print);
  if (result.status !== 0) {
    throw new Error(`the stop target ${names} failed in ${folder} (${result.status ?? result.signal}), so the worktree is kept; its output:\n${result.stdout}${result.stderr}`);
  }
  print(`${names} passed`);
}


// K495: the lock of a land, in the common git folder, which every worktree of the repository shares; how often a waiting land
// looks at the lock, and for how long.
export const LAND_LOCK = 'kit-land.lock';
const LOCK_POLL_MS = 2000;
const LOCK_WAIT_MS = 60 * 60 * 1000;

/** Runs a Make operation without a deadline, streaming progress and preserving its captured result. */
async function runOperation(tool: string, folder: string, args: string[], print: (text: string) => void, env: NodeJS.ProcessEnv = process.env): Promise<RunCommandResult> {
  const command = `${tool} ${args.join(' ')}`;
  print(`${command} in ${folder}: started`);
  const unwatch = watchParent(() => process.kill(process.pid, 'SIGTERM'));
  try {
    const result = await runCommand({ command: tool, args, cwd: folder, env, stdout: 'pipe', stderr: 'pipe',
      // The preceding file-backed capture imposed no output-size cap.
      maxOutputBytes: Number.POSITIVE_INFINITY, onLine: (stream, line) => print(`${stream}: ${line}`) });
    const failure = failureOf(result);
    print(`${command} in ${folder}: ${failure ?? 'passed'} (${compactSeconds(result.elapsedMs)})`);
    if (result.error) throw new Error(`${command} could not start in ${folder}: ${result.error.message}`);
    return result;
  } finally {
    unwatch();
  }
}

const runMake = (folder: string, args: string[], print: (text: string) => void) => runOperation('make', folder, args, print);

/** Blocks this process for `ms` milliseconds; a waiting land has nothing else to do. */
function sleepFor(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The code of a Node.js system error, such as EEXIST, or undefined for any other value. */
const codeOf = (error: unknown): unknown => (typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined);

/** The pid and the branch that a lock of land names, each undefined when the parsed lock lacks it or holds another type. */
const pidOf = (lock: unknown): number | undefined => (typeof lock === 'object' && lock !== null && 'pid' in lock && typeof lock.pid === 'number' ? lock.pid : undefined);
const branchOf = (lock: unknown): string | undefined => (typeof lock === 'object' && lock !== null && 'branch' in lock && typeof lock.branch === 'string' ? lock.branch : undefined);
// K524: the holder that a lock names, such as the commit of a row on main; a lock of land names its branch only.
const holderOf = (lock: unknown): string => (typeof lock === 'object' && lock !== null && 'holder' in lock && typeof lock.holder === 'string' ? lock.holder : `the land of ${branchOf(lock) ?? 'an unknown branch'}`);

/** Whether the process `pid` runs: signal 0 checks it without touching it, and EPERM means that it runs as another user. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process; EPERM: it runs as another user. Any other failure says nothing of the process (K559).
    if (codeOf(error) === 'ESRCH') return false;
    if (codeOf(error) === 'EPERM') return true;
    throw error;
  }
}

/**
 * Takes the lock of a land of `branch` in the repository of `root` and returns its release (K495). A lock that a running land holds
 * is waited for, printing its branch and pid once, up to LOCK_WAIT_MS; the lock of a land that no longer runs, or that names no
 * process, is removed.
 */
function takeLandLock(root: string, branch: string, print: (text: string) => void, sleep: (ms: number) => void, holder?: { name: string; outcome: string }, name: string = LAND_LOCK): () => void {
  const file = path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim(), name);
  const started = Date.now();
  let waiting = false;
  for (;;) {
    try {
      writeFileSync(file, `${JSON.stringify({ pid: process.pid, branch, ...(holder === undefined ? {} : { holder: holder.name }) })}\n`, { flag: 'wx' });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if (codeOf(error) !== 'EEXIST') throw error;
    }
    let lock: unknown;
    try {
      lock = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      // A lock that went away meanwhile, or one that is half written and no JSON yet, names no running land; any other
      // failure of the read is the land's own.
      if (codeOf(error) !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    const pid = pidOf(lock);
    const other = holderOf(lock);
    if (pid === undefined || !running(pid)) {
      rmSync(file, { force: true });
      print(`removed the lock of ${other} (pid ${pid ?? 'unknown'}), which no longer runs`);
      continue;
    }
    if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`${other} (pid ${pid}) still holds ${file} after ${LOCK_WAIT_MS / 60000} minutes; ${holder?.outcome ?? 'nothing is merged'}`);
    if (!waiting) print(`${holder?.name ?? branch} waits for ${other} (pid ${pid}) to end`);
    waiting = true;
    sleep(LOCK_POLL_MS);
  }
}

// Whether this process holds the land lock through withLandLock, which a nested call then takes not again (K524).
let lockHeld = false;

/**
 * Runs `work` under the lock of land of the repository of `root`, as `holder`, such as the commit of a row on main (K524): it waits
 * for a land, or another holder, as a land does, and releases the lock at its end, also when `work` throws. A call within `work`
 * runs under the lock that this process already holds. `outcome` says what a wait past the deadline leaves undone.
 */
export function withLandLock<T>(root: string, holder: string, outcome: string, work: () => T, { print = (text: string) => console.log(`[plan] ${text}`), sleep = sleepFor }: { print?: (text: string) => void; sleep?: (ms: number) => void } = {}): T {
  if (lockHeld) return work();
  // The lock lies in the common git folder, which every worktree of the repository shares (K1100).
  const release = takeLandLock(root, holder, print, sleep, { name: holder, outcome });
  lockHeld = true;
  try {
    return work();
  } finally {
    lockHeld = false;
    release();
  }
}

/**
 * Rebases `branch` onto `into` in its worktree `folder` under the land lock (K495-1). A worktree with uncommitted changes cannot be
 * rebased; a rebase that conflicts is aborted, so the branch stays as it was, and the conflicting files are named (K1100).
 */
async function rebaseOnto(folder: string, branch: string, into: string, print: (text: string) => void): Promise<void> {
  if (git(folder, 'status', '--porcelain').trim() !== '') throw new Error(`${branch} is not rebased on ${into} and its worktree ${folder} has uncommitted changes; commit them, then land again`);
  const rebased = await runOperation('git', folder, ['rebase', '--quiet', into], print);
  if (rebased.status !== 0) {
    const conflicts = git(folder, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(line => line !== '');
    await runOperation('git', folder, ['rebase', '--abort'], print);
    throw new Error(`${branch} does not rebase on ${into} without a conflict (${conflicts.length > 0 ? conflicts.join(', ') : rebased.stderr.trim()}); rebase it by hand and land it again; nothing is merged`);
  }
  print(`rebased ${branch} on ${into} (${git(folder, 'rev-parse', '--short', into).trim()})`);
}

/**
 * Lands `branch` on the branch `into` that the caller names (K1100) in the repository of `root`; throws, merging nothing, when the
 * rebase or the merge fails. A branch that `into` contains skips the merge.
 */
export async function land(root: string, branch: string, into: string, { print = (text: string) => console.log(`[land] ${text}`), sleep = sleepFor }: { print?: (text: string) => void; sleep?: (ms: number) => void } = {}): Promise<void> {
  if (branch === '' || into === '') throw new Error('land needs a branch and the target branch: land.mts <branch> <target>');
  // K516: land lands into the checkout that has the target checked out, wherever it is called from.
  await landBranch(targetCheckout(root, into), branch, into, print, sleep);
}

/** The checkout of the repository of `root` whose branch is `into`, from git worktree list; throws when no checkout has it checked out. */
function targetCheckout(root: string, into: string): string {
  const entries = git(root, 'worktree', 'list', '--porcelain').split('\n\n');
  const target = entries.find(entry => entry.split('\n').includes(`branch refs/heads/${into}`));
  const folder = target?.split('\n').find(line => line.startsWith('worktree '))?.slice('worktree '.length);
  if (folder === undefined) throw new Error(`no checkout has ${into} checked out among the worktrees of ${root}; check out ${into} and land from there`);
  return folder;
}



/**
 * The run of a land: under the land lock, a branch that `into` has left behind is rebased in its worktree and `into` merges it
 * fast-forward; then the worktree and the branch are removed.
 */
async function landBranch(root: string, branch: string, into: string, print: (text: string) => void, sleep: (ms: number) => void): Promise<void> {
  retainedBranches(root);
  if (gitResult(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status !== 0) throw new Error(`the branch ${branch} does not exist`);
  const folder = worktreeOf(root, branch);
  const stop = folder === undefined ? undefined : stopTargetOf(folder);
  if (gitResult(root, 'merge-base', '--is-ancestor', branch, into).status === 0) {
    print(`${branch} is contained in ${into} already: nothing is merged`);
  } else {
    const from = git(root, 'rev-parse', into).trim();
    const release = takeLandLock(root, branch, print, sleep);
    try {
      if (gitResult(root, 'merge-base', '--is-ancestor', into, branch).status !== 0) {
        if (folder === undefined) throw new Error(`${branch} is behind ${into} and no worktree has it checked out, so it cannot be rebased; rebase it, then land it again; nothing is merged`);
        await rebaseOnto(folder, branch, into, print);
      }
      const result = await runOperation('git', root, ['merge', '--ff-only', branch], print);
      if (result.status !== 0) throw new Error(`git merge --ff-only ${branch} exited with ${result.status}: ${result.stderr.trim()}; nothing is merged`);
    } finally {
      release();
    }
    print(`merged ${branch} into ${into}`);
    // K609: every consumer links its checkout live, so the land refreshes what they read, as a commit does (K583).
    refreshLinked(root, git(root, 'diff', '--name-only', `${from}..${into}`).split('\n').filter(file => file !== ''), print);
  }
  // K1100: land removes the worktree and the branch that it lands, and no other worktree or branch.
  await removeLanded(root, branch, folder, stop, print);
}

/** Removes the worktree `folder` of the landed `branch`, after stopping its servers with `stop`, and deletes the branch. */
export async function removeLanded(root: string, branch: string, folder: string | undefined, stop: string[] | undefined, print: (text: string) => void): Promise<void> {
  const declaration = retainedBranch(retainedBranches(root), branch);
  if (declaration) {
    if (folder !== undefined && git(folder, 'status', '--porcelain').trim() === '' && stop !== undefined) await stopServers(folder, stop, print);
    print(`kept ${branch} at ${declaration.commit}${folder === undefined ? '' : ` and its worktree ${folder}`} by ${RETAINED_BRANCHES_CONFIG}: ${declaration.reason}; remove when ${declaration.removalCondition}`);
    return;
  }
  let kept = false;
  if (folder !== undefined) {
    if (git(folder, 'status', '--porcelain').trim() === '') {
      if (stop !== undefined) await stopServers(folder, stop, print);
      // K626: a process that still runs in the worktree keeps it and its branch; a land of the branch again removes them once it ends.
      const live = worktreeProcesses(folder, machineListing());
      if (live.length > 0) {
        kept = true;
        print(`kept the worktree ${folder} and ${branch}: ${live.length} processes run in it; land ${branch} again once they end to remove them:\n${live.map(({ pid, command }) => `${pid} ${command}`).join('\n')}`);
      } else {
        const removed = await runOperation('git', root, ['worktree', 'remove', folder], print);
        if (removed.status !== 0) throw new Error(`git worktree remove ${folder} failed: ${removed.stderr}`);
        print(`removed the worktree ${folder}`);
      }
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


// The entry point runs last: it calls land when the module loads, so every constant that land uses must be initialized before it
// (K463).
if (isMain(import.meta.url)) {
  const [branch = '', into = ''] = process.argv.slice(2);
  // A call without the branch or the target branch is a usage error (exit 2): kit names no target of its own (K1100).
  if (branch === '' || into === '') {
    console.error('[land] usage: node scripts/kit/land.mts <branch> <target>');
    process.exit(2);
  }
  land(repositoryRoot(), branch, into).catch((error: unknown) => {
    if (!(error instanceof Error)) throw error;
    console.error(`[land] ${error.message}`);
    process.exitCode = 1;
  });
}
