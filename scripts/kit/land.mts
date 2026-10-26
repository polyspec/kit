#!/usr/bin/env node
// Lands a branch on main (K394): `make land BRANCH=<branch>`, run in the main checkout. It refuses unless the main checkout is on
// main and clean, the branch exists, and a worktree has the branch checked out (its gates run on its own tree and install); a branch
// that main has left behind is rebased onto main in that worktree first, and a rebase that conflicts is refused (K495-1). It runs the static gates of kit-gates that the changed paths of the branch select through
// config/owner-checks.json, always with docs-check and commits-check (commits-check over main..<branch>). No test runs (K394-1): parity-check
// and every test- target that the owners select are printed as not run. A gate that fails in the worktree is refused only when its
// output has a line that main does not have: the same gate runs in the main checkout, and a line of the branch output that occurs
// more often there than in the output on main is a new finding. A gate that fails on main too, with no new finding, goes on;
// commits-check refuses on any failure. On a refusal it prints the gate and its output and merges nothing. Then it merges
// fast-forward, removes the worktree when it
// has no uncommitted change (an ignored install does not count) and deletes the branch. A branch that main already contains
// skips the gates and the merge, and only what is left is removed. Before a worktree is removed, the make targets that WORKTREE_STOP
// names in its Makefile stop its servers (K441); a stop that fails keeps the worktree. A lock in the common git folder covers the
// check that main is still the commit that the gates ran on and the merge (K495, K571); the gates of independent branches run at the
// same time, and a land whose main moved rebases and runs them again; land merges with KIT_MAIN_WRITER set, which the
// reference-transaction hook of make hooks requires of a move of main (K495).
//
//   node scripts/kit/land.mts <branch>
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { kitGates } from './kit-gates.mts';
import { git, gitResult } from './git.mts';
import { DECLARATION, importGraph, makeDatabase, ownerDeclaration, select } from './owner-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { expandMake } from './recipe-tools.mts';
import { clashMessage, rowClashes } from './row-ids.mts';
import { trackedFiles } from './tracked-files.mts';
import { runCommand, failureOf, type RunCommandResult } from './run-command.mts';
import { watchParent } from './process-group.mts';
import { compactSeconds } from './time.mts';
import { refreshLinked } from './linked-build.mts';

// The gates that land whatever the changed paths: the documents and the commit messages of the branch.
const ALWAYS_GATES = ['docs-check', 'commits-check'];

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


// A gate that runs tests: parity-check and the test- targets. The Verification of the rows runs the tests, so land never does.
export const isTestGate = (gate: string) => gate === 'parity-check' || gate.startsWith('test-');

/**
 * The gates of kit-gates that the owners of `changed` select in the worktree `folder`, in the order of kit-gates, with the
 * ALWAYS_GATES. The test gates are not returned but in `excluded`, so no test target runs. Throws on a changed path that no
 * owner declares.
 */
export function gatesOf(folder: string, changed: string[], installed: string = folder): { gates: string[]; excluded: string[]; reasons: string[] } {
  // K522: the owner rules as owner-validate reads them, the shipped ones of the checkout that holds node_modules included.
  const declaration = ownerDeclaration(folder, installed);
  const exists = (file: string) => existsSync(path.join(folder, file));
  const selection = select(declaration, changed, [], exists, importGraph(folder, trackedFiles(folder)));
  if (selection.unowned.length) throw new Error(`${selection.unowned.join(', ')}: no owner in ${DECLARATION} owns the path; add a rule whose paths match it`);
  const kit = kitGates(folder);
  const wanted = new Set<string | undefined>([...selection.checks.map(check => check.target), ...ALWAYS_GATES]);
  for (const gate of ALWAYS_GATES) if (!kit.has(gate)) throw new Error(`${gate} is no gate of kit-gates in ${folder}`);
  const selected = [...kit].filter(gate => wanted.has(gate));
  return { gates: selected.filter(gate => !isTestGate(gate)), excluded: selected.filter(isTestGate), reasons: selection.reasons };
}

// K495: the lock of a land, in the common git folder, which every worktree of the repository shares; the variable that lets the
// reference-transaction hook of make hooks pass the merge of land; how often a waiting land looks at the lock, and for how long.
export const LAND_LOCK = 'kit-land.lock';
// Serializes gates that land compares on main, so they read one stable main tree.
export const MAIN_BUILD_LOCK = 'kit-main-build.lock';
export const MAIN_WRITER = 'KIT_MAIN_WRITER';
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
  const release = takeLandLock(mainCheckout(root), 'main', print, sleep, { name: holder, outcome });
  lockHeld = true;
  try {
    return work();
  } finally {
    lockHeld = false;
    release();
  }
}

/**
 * Rebases `branch` onto main in its worktree `folder` under the land lock (K495-1). A worktree with uncommitted changes is refused as
 * before; a rebase that conflicts is aborted, so the branch stays as it was, and the conflicting files are named.
 */
async function rebaseOnMain(folder: string, branch: string, print: (text: string) => void): Promise<void> {
  if (git(folder, 'status', '--porcelain').trim() !== '') throw new Error(`${branch} is not rebased on main and its worktree ${folder} has uncommitted changes; commit them, then land again`);
  let rebased = await runOperation('git', folder, ['rebase', '--quiet', 'main'], print);
  // K634: a conflict that is only the source-sha256 line of Korean twins keeps one line, is stamped again and the rebase continues.
  for (let conflicts = conflictsOf(folder); rebased.status !== 0 && conflicts.length > 0 && conflicts.every(file => onlyRevisionConflict(path.join(folder, file))); conflicts = conflictsOf(folder)) {
    for (const file of conflicts) writeFileSync(path.join(folder, file), keepOneRevision(readFileSync(path.join(folder, file), 'utf8')));
    const stamp = await runMake(folder, ['--no-print-directory', 'documents-stamp'], print);
    if (stamp.status !== 0) break;
    git(folder, 'add', '-u');
    print(`resolved the source-sha256 line of ${conflicts.join(', ')} and stamped it again`);
    rebased = await runOperation('git', folder, ['-c', 'core.editor=true', 'rebase', '--continue'], print);
  }
  if (rebased.status !== 0) {
    const conflicts = conflictsOf(folder);
    await runOperation('git', folder, ['rebase', '--abort'], print);
    throw new Error(`${branch} does not rebase on main without a conflict (${conflicts.length > 0 ? conflicts.join(', ') : rebased.stderr.trim()}); rebase it by hand and land it again; nothing is merged`);
  }
  print(`rebased ${branch} on main (${git(folder, 'rev-parse', '--short', 'main').trim()})`);
}

/** The files of `folder` with a conflict of the rebase in progress. */
const conflictsOf = (folder: string): string[] => git(folder, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(line => line !== '');

// The revision marker of a Korean twin: the sha256 of its English file (check-documents).
const REVISION_LINE = /^<!-- source-sha256: [0-9a-f]* -->$/;

/** Whether every conflict of the file `file` is a Korean twin's revision marker on both sides (K634). */
function onlyRevisionConflict(file: string): boolean {
  if (!file.endsWith('.ko.md')) return false;
  const hunks = [...readFileSync(file, 'utf8').matchAll(/^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*\n/gm)];
  return hunks.length > 0 && hunks.every(([, ours = '', theirs = '']) => [ours, theirs].every(side => side.split('\n').filter(line => line !== '').every(line => REVISION_LINE.test(line))));
}

/** `text` with each conflict of revision markers replaced by its first side, which documents-stamp then writes again (K634). */
const keepOneRevision = (text: string): string => text.replace(/^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n[\s\S]*?^>>>>>>> [^\n]*\n/gm, '$1');

/** The commits that moved main from `from`, newest first, as `<short sha> <subject>` lines. */
function movesOf(root: string, from: string): string {
  return git(root, 'log', '--format=%h %s', `${from}..main`).trim();
}

/**
 * Lands `branch` on main in the repository of `root` (the main checkout); throws, merging nothing, when a refusal applies or a gate
 * fails. A branch that main contains skips the gates and the merge. The land lock covers only the merge (K571).
 */
export async function land(root: string, branch: string, { print = (text: string) => console.log(`[land] ${text}`), sleep = sleepFor }: { print?: (text: string) => void; sleep?: (ms: number) => void } = {}): Promise<void> {
  if (branch === '') throw new Error('no branch: make land BRANCH=<branch>');
  // K516: land lands into the checkout that has main checked out, wherever it is called from.
  await landBranch(mainCheckout(root), branch, print, sleep);
}

/** How often a land rebases and runs its gates again when main moved while they ran (K571). */
export const LAND_ATTEMPTS = 3;

/** The checkout of the repository of `root` whose branch is main, from git worktree list; throws when no checkout has main checked out. */
function mainCheckout(root: string): string {
  const entries = git(root, 'worktree', 'list', '--porcelain').split('\n\n');
  const main = entries.find(entry => entry.split('\n').includes('branch refs/heads/main'));
  const folder = main?.split('\n').find(line => line.startsWith('worktree '))?.slice('worktree '.length);
  if (folder === undefined) throw new Error(`no checkout has main checked out among the worktrees of ${root}; check out main in the main checkout and land from there`);
  return folder;
}

/** Throws unless the main checkout `root` is on main and clean, as a land and its merge need it. */
function requireCleanMain(root: string): void {
  const head = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (head !== 'main') throw new Error(`the main checkout ${root} is on ${head}, not on main`);
  const dirty = git(root, 'status', '--porcelain').trim();
  if (dirty !== '') throw new Error(`the main checkout ${root} has uncommitted changes:\n${dirty}`);
}

/**
 * The run of a land (K571): the gates run without the land lock, on the main commit that they record; the lock covers the check that
 * main is still that commit and the fast-forward. A main that moved meanwhile is rebased on and the gates
 * run again, up to LAND_ATTEMPTS times, so nothing merges that its gates did not see on the exact main.
 */
async function landBranch(root: string, branch: string, print: (text: string) => void, sleep: (ms: number) => void): Promise<void> {
  requireCleanMain(root);
  if (gitResult(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status !== 0) throw new Error(`the branch ${branch} does not exist`);
  const folder = worktreeOf(root, branch);
  // The worktree of a repository whose Makefile declares WORKTREE_STOP has its servers stopped after the merge, before its removal,
  // so its running servers are no refusal here; the check before the removal still refuses a server that the stop left alive.
  const stop = folder === undefined ? undefined : stopTargetOf(folder);
  if (gitResult(root, 'merge-base', '--is-ancestor', branch, 'main').status === 0) {
    print(`${branch} is contained in main already: no gate runs and nothing is merged`);
  } else {
    if (folder === undefined) throw new Error(`${branch} has no worktree; the gates run on its own tree and install, so make worktree-setup first`);
    let passed: GatesRun | undefined;
    for (let attempt = 1; ; attempt += 1) {
      passed = await gateBranch(root, folder, branch, print, sleep, passed);
      const { gated } = passed;
      const release = takeLandLock(root, branch, print, sleep);
      let merged = false;
      try {
        requireCleanMain(root);
        // K495: main must still be the commit the gates ran on.
        if (git(root, 'rev-parse', 'main').trim() === gated) {
          const result = await runOperation('git', root, ['merge', '--ff-only', branch], print, { ...process.env, [MAIN_WRITER]: 'land' });
          if (result.error) throw new Error(`git merge --ff-only ${branch} could not start in ${root}: ${result.error.message}`);
          if (result.status !== 0) throw new Error(`git merge --ff-only ${branch} exited with ${result.status}: ${result.stderr.trim()}; nothing is merged`);
          merged = true;
        }
      } finally {
        release();
      }
      if (merged) break;
      const moves = movesOf(root, gated);
      if (attempt === LAND_ATTEMPTS) throw new Error(`main moved while the gates of ${branch} ran, ${LAND_ATTEMPTS} times; the last moves:\n${moves}\nland it again; nothing is merged`);
      print(`main moved while the gates of ${branch} ran:\n${moves}\n${branch} rebases on main and runs the gates again`);
    }
    print(`merged ${branch} into main`);
    // K609: every consumer links main live, so the land refreshes what they read, as a commit on main does (K583).
    const merged = passed === undefined ? [] : git(root, 'diff', '--name-only', `${passed.gated}..main`).split('\n').filter(file => file !== '');
    refreshLinked(root, merged, print);
  }
  await removeLanded(root, branch, folder, stop, print);
  removeMerged(root, branch, print);
}

// A reflog entry of a commit made on a branch: a rebase or a fast-forward moves it onto commits of main and makes none of its own.
const OWN_COMMIT = /^(?:commit|cherry-pick|revert)\b/;
// A reflog entry that starts a branch anew: its creation, or a reset that moves it, as onto main for the next row.
const NEW_START = /^(?:branch: (?:Created|Reset)|reset: moving to)\b/;

/**
 * Whether `branch` is merged (K628): its reflog records commits of its own since its creation or its latest reset, and main contains
 * every commit of it. A fresh branch, a row about to start, has none, though main contains it.
 */
function ownCommitsMerged(root: string, branch: string): boolean {
  const entries = git(root, 'reflog', 'show', '--format=%gs', `refs/heads/${branch}`).split('\n').filter(line => line !== '');
  const start = entries.findIndex(entry => NEW_START.test(entry));
  if (!entries.slice(0, start === -1 ? entries.length : start).some(entry => OWN_COMMIT.test(entry))) return false;
  return git(root, 'rev-list', branch, '^main').trim() === '';
}

/**
 * Removes the worktree and deletes the branch of each other branch that main contains, whose worktree is clean and in which no process
 * runs: a worktree that an earlier land kept while a process ran in it (K626); a fresh branch is no merged one (K628).
 */
function removeMerged(root: string, landed: string, print: (text: string) => void): void {
  const entries = git(root, 'worktree', 'list', '--porcelain').split('\n\n').map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }));
  for (const { folder, branch } of entries) {
    if (folder === undefined || branch === undefined || branch === 'main' || branch === landed || path.resolve(folder) === path.resolve(root)) continue;
    if (!ownCommitsMerged(root, branch)) continue;
    if (git(folder, 'status', '--porcelain').trim() !== '' || worktreeProcesses(folder, machineListing()).length > 0) continue;
    git(root, 'worktree', 'remove', folder);
    git(root, 'branch', '-d', branch);
    print(`removed the worktree ${folder} of ${branch}, which main contains and in which no process runs any longer`);
  }
}

/** The gates that passed for a branch and the main commit that they ran on (K571, K580). */
interface GatesRun {
  gated: string;
  gates: string[];
}

/**
 * Rebases `branch` on main in its worktree `folder` when main has left it behind, runs its gates there, and returns the main commit
 * that they ran on and the gates that passed (K571); throws, merging nothing, on a refusal. After `previous`, the run of a
 * main that moved since, only the gates that the paths of the moved commits select run again, and commits-check, since the rebased
 * commits are new; a gate that passed before and whose inputs no moved commit touched keeps its result (K580).
 */
async function gateBranch(root: string, folder: string, branch: string, print: (text: string) => void, sleep: (ms: number) => void, previous?: GatesRun): Promise<GatesRun> {
  // K495-1: a branch that main has left behind, as the land this one waited for leaves it, is rebased here; the gates below run on
  // the rebased commits, so nothing is merged that they did not see.
  if (gitResult(root, 'merge-base', '--is-ancestor', 'main', branch).status !== 0) await rebaseOnMain(folder, branch, print);
  // K497: a row of the rebased branch whose ID main holds with another task is refused before any gate runs.
  const clashes = rowClashes(root, branch, branch);
  if (clashes.length > 0) throw new Error(`${branch} is refused; nothing is merged:\n${clashes.map(clashMessage).join('\n')}`);
  const gated = git(root, 'rev-parse', 'main').trim();
  const changed = git(root, 'diff', '--name-only', `main...${branch}`).split('\n').filter(line => line !== '');
  const { gates, excluded, reasons } = gatesOf(folder, changed);
  for (const reason of reasons) print(reason);
  for (const gate of excluded) print(`${gate} runs tests, which the Verification of the rows runs; land does not run it`);
  print(`gates of ${branch} in ${folder}: ${gates.join(', ')}`);
  const moved = previous === undefined ? undefined : git(root, 'diff', '--name-only', `${previous.gated}..${gated}`).split('\n').filter(line => line !== '');
  const touched = moved === undefined ? undefined : new Set([...gatesOf(folder, moved).gates, 'commits-check']);
  for (const gate of gates) {
    if (touched !== undefined && previous?.gates.includes(gate) === true && !touched.has(gate)) {
      print(`${gate} keeps its result: no commit that moved main touches what it checks (K580)`);
      continue;
    }
    print(`${gate} in ${folder}`);
    const args = gate === 'commits-check' ? [`RANGE=main..${branch}`] : [];
    const candidate = await runGate(folder, gate, args, print);
    // K631: a gate red on main does not block a branch when it is red there too; a branch owes only not to break a green gate.
    // K631-1: report both failures truthfully and keep the candidate's diagnostics visible; no output line is compared.
    if (candidate.result.status !== 0 && gate !== 'commits-check' && (await mainRun(root, gate, args, print, sleep)).result.status !== 0) {
      print(`${gate} fails on candidate and main; continuing under K631`);
      print(`${gate} candidate stdout:\n${candidate.result.stdout}`);
      print(`${gate} candidate stderr:\n${candidate.result.stderr}`);
      continue;
    }
    if (candidate.result.status !== 0) {
      print(`${gate} failed in ${folder}:\n${candidate.result.stdout}${candidate.result.stderr}`);
      throw new Error(`${branch} is refused: the gate ${gate} ${endOf(candidate)}; nothing is merged`);
    }
    print(`${gate} passed`);
  }
  return { gated, gates };
}

/** The run of `gate` with `args` in the main checkout `root`, under the main gate lock. */
async function mainRun(root: string, gate: string, args: string[], print: (text: string) => void, sleep: (ms: number) => void): Promise<GateRun> {
  const release = takeLandLock(root, 'main', print, sleep, { name: `the run of ${gate} on main`, outcome: 'nothing is merged' }, MAIN_BUILD_LOCK);
  try {
    return await runGate(root, gate, args, print);
  } finally {
    release();
  }
}

/** Removes the worktree `folder` of the landed `branch`, after stopping its servers with `stop`, and deletes the branch. */
async function removeLanded(root: string, branch: string, folder: string | undefined, stop: string[] | undefined, print: (text: string) => void): Promise<void> {
  let kept = false;
  if (folder !== undefined) {
    if (git(folder, 'status', '--porcelain').trim() === '') {
      if (stop !== undefined) await stopServers(folder, stop, print);
      // K626: a process that still runs in the worktree keeps it and its branch; the next land removes them once it ends.
      const live = worktreeProcesses(folder, machineListing());
      if (live.length > 0) {
        kept = true;
        print(`kept the worktree ${folder} and ${branch}: ${live.length} processes run in it, and the next land removes them once they end:\n${live.map(({ pid, command }) => `${pid} ${command}`).join('\n')}`);
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


/** One run of a gate in `folder`: the folder and make's outcome, read with make -s (K446-3). */
export interface GateRun {
  folder: string;
  gate?: string;
  result: RunCommandResult;
}

/**
 * Runs `gate` in `folder` with make -s, with `args` after the gate (such as RANGE=), and returns the run at the exit of make (runMake,
 * K531). A make that cannot start throws; no whole-operation deadline applies.
 */
export async function runGate(folder: string, gate: string, args: string[] = [], print: (text: string) => void = text => console.log(`[land] ${text}`)): Promise<GateRun> {
  return { folder, gate, result: await runMake(folder, ['--no-print-directory', '-s', gate, ...args], print) };
}

/** The text of how a gate run ended: its exit status, or the signal that ended it. */
const endOf = (run: GateRun) => (run.result.status === null ? `ended with the signal ${run.result.signal}` : `exited ${run.result.status}`);

// The entry point runs last: it calls land when the module loads, so every constant that land uses (endOf, among others) must be
// initialized before it (K463).
if (isMain(import.meta.url)) {
  const [branch = ''] = process.argv.slice(2);
  land(repositoryRoot(), branch).catch((error: unknown) => {
    if (!(error instanceof Error)) throw error;
    console.error(`[land] ${error.message}`);
    process.exitCode = 1;
  });
}
