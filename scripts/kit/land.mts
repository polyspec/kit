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
// names in its Makefile stop its servers (K441); a stop that fails keeps the worktree. The whole run holds a lock in the common git
// folder, so a second land waits for the first, and the merge is refused when main moved while the gates ran; land merges with
// KIT_MAIN_WRITER set, which the reference-transaction hook of make hooks requires of a move of main (K495).
//
//   node scripts/kit/land.mts <branch>
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { miseEnvironment } from './bootstrap/install-mise.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { kitGates } from './gate-red.mts';
import { git, gitResult } from './git.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { DECLARATION, importGraph, makeDatabase, ownerDeclaration, select } from './owner-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { expandMake } from './recipe-tools.mts';
import { clashMessage, rowClashes } from './row-ids.mts';
import { trackedFiles } from './tracked-files.mts';

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
export function stopServers(folder: string, targets: string[], print: (text: string) => void): void {
  const names = targets.join(' ');
  print(`${names} in ${folder}`);
  const result = runMake(folder, ['--no-print-directory', ...targets]);
  if (result.status !== 0) {
    throw new Error(`the stop target ${names} failed in ${folder} (${result.status ?? result.signal}), so the worktree is kept; its output:\n${result.stdout}${result.stderr}`);
  }
  print(`${names} passed`);
}

/** Refuses with the processes that run in the worktree `folder` (K429), when there are some; `consequence` says what is kept. */
function refuseWhileRunning(folder: string, branch: string, consequence: string): void {
  const listing = machineListing();
  const live = worktreeProcesses(folder, listing);
  if (live.length) {
    throw new Error(`${branch} is refused: ${live.length} processes run in the worktree ${folder}; ${consequence}. Stop them first, then run make land again:\n${live.map(({ pid, command }) => `${pid} ${command}`).join('\n')}`);
  }
}

// A gate that runs tests: parity-check and the test- targets. The Verification of the rows runs the tests, so land never does.
export const isTestGate = (gate: string) => gate === 'parity-check' || gate.startsWith('test-');

// A path inside the temporary folder of the system, which a gate may make afresh on each run, as duplication-check makes the
// folder of its jscpd configuration (K394-2).
const TEMPORARY = new RegExp(`(?:${[...new Set([tmpdir(), realpathSync(tmpdir())])].map(folder => folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})/[^\\s'"]*`, 'g');

/**
 * The lines of `output`, a gate's stdout and stderr run in `folder`, each with its key: every occurrence of the folder of the
 * worktree replaced by `root`, every path inside the temporary folder of the system by <tmp>, every run of digits by #; blank
 * lines are dropped.
 */
export function linesOf(output: string, folder: string, root: string): { line: string; key: string }[] {
  // The checkout of the branch, of main and of a temporary worktree, under their own paths and under their real paths (/var and
  // /private/var alike), all read as <repo>, so that one finding has one key whichever checkout printed it (K446-1).
  const prefixes = [...new Set([folder, root, realpathSync(folder), realpathSync(root)])].sort((a, b) => b.length - a.length);
  const repo = new RegExp(prefixes.map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return output
    .split('\n')
    .map(line => ({ line, key: line.replace(repo, '<repo>').replace(TEMPORARY, '<tmp>').replace(/\d+/g, '#') }))
    .filter(({ key }) => key.trim() !== '');
}

// A line that a kit tool prints on stdout as its progress, which starts with the name of the tool in brackets ([parity] tools root
// ...); a kit tool prints its findings on stderr, and another tool, such as a linter, prints its findings on stdout without it (K394-3).
const PROGRESS = /^\[[a-z0-9-]+\] /;

// The per-language rows in jscpd's seven-column console summary describe the scanned tree, not duplicate blocks.
const JSCPD_STATISTICS = /^\s*│\s*(?:c|go|php|python|rust|typescript|javascript)\s*│\s*\d[\d,]*\s*│\s*[\d,]+\s*│\s*[\d,]+\s*│\s*\d[\d,]*\s*│\s*[\d,]+\s*\([\d.]+%\)\s*│\s*[\d,]+\s*\([\d.]+%\)\s*│\s*$/;
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const isJscpdStatistics = (line: string): boolean => JSCPD_STATISTICS.test(line.replace(ANSI_SGR, ''));

/** The lines of the stdout and the stderr of a gate that land compares: every line of stderr, and the lines of stdout but progress. */
const findingLines = ({ stdout, stderr }: { stdout: string; stderr: string }, folder: string, root: string, gate?: string) =>
  [...linesOf(stdout, folder, root).filter(({ line }) => !PROGRESS.test(line) && !(gate === 'duplication-check' && isJscpdStatistics(line))),
    ...linesOf(stderr, folder, root)];

/** The lines of `branch` that occur more times in `branch` than in `main`, counting repeats, in their order. */
function newLines(branch: { line: string; key: string }[], main: { key: string }[]): string[] {
  const left = new Map<string, number>();
  for (const { key } of main) left.set(key, (left.get(key) ?? 0) + 1);
  return branch
    .filter(({ key }) => {
      const count = left.get(key) ?? 0;
      if (count > 0) left.set(key, count - 1);
      return count === 0;
    })
    .map(({ line }) => line);
}

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

/**
 * Runs `make build` in `folder`; a failing build throws with `failed`, the end of the message. Land builds the worktree of the branch,
 * whose tree is the merge result, before main moves (K513), and the main checkout after the fast-forward (K453), so its build output,
 * which is ignored and read by linked consumers, holds the merged sources.
 */
function build(folder: string, failed: string, print: (text: string) => void): void {
  const started = Date.now();
  print(`make build in ${folder}`);
  const result = runMake(folder, ['--no-print-directory', 'build']);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    throw new Error(`make build failed in ${folder} (${result.status ?? result.signal}, ${elapsed}s):\n${`${result.stdout}${result.stderr}`.trim().split('\n').slice(-40).join('\n')}\n${failed}`);
  }
  print(`make build in ${folder} passed (${elapsed}s)`);
}

// K495: the lock of a land, in the common git folder, which every worktree of the repository shares; the variable that lets the
// reference-transaction hook of make hooks pass the merge of land; how often a waiting land looks at the lock, and for how long.
export const LAND_LOCK = 'kit-land.lock';
export const MAIN_WRITER = 'KIT_MAIN_WRITER';
const LOCK_POLL_MS = 2000;
const LOCK_WAIT_MS = 60 * 60 * 1000;

/** The deadline of one make that land runs, a gate, a build or a stop target (K531): 30 minutes. */
export const MAKE_DEADLINE_MS = 30 * 60 * 1000;

/**
 * Runs make with `args` in `folder` and returns its run when make exits (K531): its output goes to files, not to pipes, since a wait
 * on pipes ends only when every holder closes them, and a process that a recipe leaves running holds the inherited output after make
 * has exited. A run past `deadline` is stopped and throws, naming the target and the deadline; a make that cannot start throws.
 */
function runMake(folder: string, args: string[], deadline: number = MAKE_DEADLINE_MS): SpawnSyncReturns<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-make-'));
  const files = [path.join(dir, 'stdout'), path.join(dir, 'stderr')];
  const [out, err] = files.map(file => openSync(file, 'w'));
  try {
    const result = spawnSync('make', args, { cwd: folder, stdio: ['ignore', out, err], timeout: deadline, killSignal: 'SIGTERM' });
    const target = args.filter(arg => !arg.startsWith('-')).join(' ');
    if (codeOf(result.error) === 'ETIMEDOUT') throw new Error(`make ${target} ran past its deadline of ${deadline / 1000} s in ${folder} and was stopped`);
    if (result.error) throw new Error(`make ${target} could not start in ${folder}: ${result.error.message}`);
    const [stdout = '', stderr = ''] = files.map(file => readFileSync(file, 'utf8'));
    return { pid: result.pid, output: [null, stdout, stderr], stdout, stderr, status: result.status, signal: result.signal };
  } finally {
    for (const fd of [out, err]) if (fd !== undefined) closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}

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
    return codeOf(error) === 'EPERM';
  }
}

/**
 * Takes the lock of a land of `branch` in the repository of `root` and returns its release (K495). A lock that a running land holds
 * is waited for, printing its branch and pid once, up to LOCK_WAIT_MS; the lock of a land that no longer runs, or that names no
 * process, is removed.
 */
function takeLandLock(root: string, branch: string, print: (text: string) => void, sleep: (ms: number) => void, holder?: { name: string; outcome: string }): () => void {
  const file = path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim(), LAND_LOCK);
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
function rebaseOnMain(folder: string, branch: string, print: (text: string) => void): void {
  if (git(folder, 'status', '--porcelain').trim() !== '') throw new Error(`${branch} is not rebased on main and its worktree ${folder} has uncommitted changes; commit them, then land again`);
  const rebased = gitResult(folder, 'rebase', '--quiet', 'main');
  if (rebased.status !== 0) {
    const conflicts = git(folder, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(line => line !== '');
    gitResult(folder, 'rebase', '--abort');
    throw new Error(`${branch} does not rebase on main without a conflict (${conflicts.length > 0 ? conflicts.join(', ') : rebased.stderr.trim()}); rebase it by hand and land it again; nothing is merged`);
  }
  print(`rebased ${branch} on main (${git(folder, 'rev-parse', '--short', 'main').trim()})`);
}

/** The commits that moved main from `from`, newest first, as `<short sha> <subject>` lines. */
function movesOf(root: string, from: string): string {
  return git(root, 'log', '--format=%h %s', `${from}..main`).trim();
}

/**
 * Lands `branch` on main in the repository of `root` (the main checkout); throws, merging nothing, when a refusal applies or a gate
 * fails. A branch that main contains skips the gates and the merge. The whole run holds the land lock (K495).
 */
export function land(root: string, branch: string, { print = (text: string) => console.log(`[land] ${text}`), sleep = sleepFor }: { print?: (text: string) => void; sleep?: (ms: number) => void } = {}): void {
  if (branch === '') throw new Error('no branch: make land BRANCH=<branch>');
  // K516: land lands into the checkout that has main checked out, wherever it is called from.
  const main = mainCheckout(root);
  const release = takeLandLock(main, branch, print, sleep);
  try {
    landLocked(main, branch, print);
  } finally {
    release();
  }
}

/** The checkout of the repository of `root` whose branch is main, from git worktree list; throws when no checkout has main checked out. */
function mainCheckout(root: string): string {
  const entries = git(root, 'worktree', 'list', '--porcelain').split('\n\n');
  const main = entries.find(entry => entry.split('\n').includes('branch refs/heads/main'));
  const folder = main?.split('\n').find(line => line.startsWith('worktree '))?.slice('worktree '.length);
  if (folder === undefined) throw new Error(`no checkout has main checked out among the worktrees of ${root}; check out main in the main checkout and land from there`);
  return folder;
}

/** The run of land under its lock. */
function landLocked(root: string, branch: string, print: (text: string) => void): void {
  const head = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (head !== 'main') throw new Error(`the main checkout ${root} is on ${head}, not on main`);
  const dirty = git(root, 'status', '--porcelain').trim();
  if (dirty !== '') throw new Error(`the main checkout ${root} has uncommitted changes:\n${dirty}`);
  if (gitResult(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status !== 0) throw new Error(`the branch ${branch} does not exist`);
  const folder = worktreeOf(root, branch);
  // The worktree of a repository whose Makefile declares WORKTREE_STOP has its servers stopped after the merge, before its removal,
  // so its running servers are no refusal here; the check before the removal still refuses a server that the stop left alive.
  const stop = folder === undefined ? undefined : stopTargetOf(folder);
  // K429: no gate runs, nothing is merged and nothing is removed while a process of the worktree runs.
  if (folder !== undefined && stop === undefined) refuseWhileRunning(folder, branch, 'nothing is merged, removed or deleted');
  if (gitResult(root, 'merge-base', '--is-ancestor', branch, 'main').status === 0) {
    print(`${branch} is contained in main already: no gate runs and nothing is merged`);
  } else {
    if (folder === undefined) throw new Error(`${branch} has no worktree; the gates run on its own tree and install, so make worktree-setup first`);
    // K495-1: a branch that main has left behind, as the land this one waited for leaves it, is rebased here; the gates below run on
    // the rebased commits, so nothing is merged that they did not see.
    if (gitResult(root, 'merge-base', '--is-ancestor', 'main', branch).status !== 0) rebaseOnMain(folder, branch, print);
    // K497: a row of the rebased branch whose ID main holds with another task is refused before any gate runs.
    const clashes = rowClashes(root, branch, branch);
    if (clashes.length > 0) throw new Error(`${branch} is refused; nothing is merged:\n${clashes.map(clashMessage).join('\n')}`);
    const gated = git(root, 'rev-parse', 'main').trim();
    const changed = git(root, 'diff', '--name-only', `main...${branch}`).split('\n').filter(line => line !== '');
    const { gates, excluded, reasons } = gatesOf(folder, changed);
    for (const reason of reasons) print(reason);
    for (const gate of excluded) print(`${gate} runs tests, which the Verification of the rows runs; land does not run it`);
    print(`gates of ${branch} in ${folder}: ${gates.join(', ')}`);
    for (const gate of gates) {
      print(`${gate} in ${folder}`);
      const args = gate === 'commits-check' ? [`RANGE=main..${branch}`] : [];
      const candidate = runGate(folder, gate, args);
      if (candidate.result.status !== 0 && gate !== 'commits-check') {
        const added = newFindings(root, candidate, runGate(root, gate, args));
        if (added === undefined) {
          print(`${gate} fails on main too, with no finding that main does not have`);
          continue;
        }
        if (added.length > 0) {
          print(`${gate} has findings that main does not have:\n${added.join('\n')}`);
          throw new Error(`${branch} is refused: the gate ${gate} has ${added.length} findings that main does not have; nothing is merged`);
        }
      }
      if (candidate.result.status !== 0) {
        print(`${gate} failed in ${folder}:\n${candidate.result.stdout}${candidate.result.stderr}`);
        throw new Error(`${branch} is refused: the gate ${gate} ${endOf(candidate)}; nothing is merged`);
      }
      print(`${gate} passed`);
    }
    // K513: the build runs on the merge result, the tree of the rebased branch, before main moves, as the gates do.
    build(folder, `${branch} is refused: its build fails; nothing is merged`, print);
    // K495: main must still be the commit the gates ran on; a writer that moved it meanwhile is named, and nothing is merged.
    if (git(root, 'rev-parse', 'main').trim() !== gated) {
      throw new Error(`main moved while the gates of ${branch} ran:\n${movesOf(root, gated)}\nrebase ${branch} on main and land it again; nothing is merged`);
    }
    const merged = spawnSync('git', ['merge', '--ff-only', branch], { cwd: root, encoding: 'utf8', env: { ...process.env, [MAIN_WRITER]: 'land' } });
    if (merged.error) throw new Error(`git merge --ff-only ${branch} could not start in ${root}: ${merged.error.message}`);
    if (merged.status !== 0) throw new Error(`git merge --ff-only ${branch} exited with ${merged.status}: ${merged.stderr.trim()}; nothing is merged`);
    print(`merged ${branch} into main`);
    build(root, 'main already holds the merge', print);
  }
  let kept = false;
  if (folder !== undefined) {
    if (git(folder, 'status', '--porcelain').trim() === '') {
      if (stop !== undefined) stopServers(folder, stop, print);
      refuseWhileRunning(folder, branch, 'the worktree and the branch are kept');
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


/** One run of a gate in `folder`: the folder and make's outcome, read with make -s (K446-3). */
export interface GateRun {
  folder: string;
  gate?: string;
  result: SpawnSyncReturns<string>;
}

// The variables that git gives a hook for the index it commits, and that locate the repository (K404-1).
const HOOK_VARIABLES = ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX'];

/**
 * Runs `body` with the variables of the hook's index removed from the environment of this process, then restores them. Every run that
 * `body` starts, git and make and the tools they start, reads the index and the repository of its own folder (K404-1). git gives a
 * hook a relative GIT_INDEX_FILE, which names no file inside a temporary tree.
 */
function withoutHookVariables<T>(body: () => T): T {
  const saved = HOOK_VARIABLES.map(name => [name, process.env[name]] as const);
  for (const name of HOOK_VARIABLES) delete process.env[name];
  try {
    return body();
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
  }
}

/** The standard output of `git <args>` in `cwd`; throws with git's error when it fails. */
function gitIn(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error) throw new Error(`git ${args.join(' ')} could not start in ${cwd}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`);
  return result.stdout;
}

/**
 * Runs `gate` in `folder` with make -s, with `args` after the gate (such as RANGE=), and returns the run at the exit of make (runMake,
 * K531). A make that cannot start, or that runs past `deadline`, throws.
 */
export function runGate(folder: string, gate: string, args: string[] = [], deadline: number = MAKE_DEADLINE_MS): GateRun {
  // make -s: the recipes that make echoes differ between checkouts and are not findings of the gate (K446-3).
  return { folder, gate, result: runMake(folder, ['--no-print-directory', '-s', gate, ...args], deadline) };
}

/**
 * The verdict of a failed run `candidate` of a gate against its run `baseline` of the same gate on the tree without the change (main
 * for land, HEAD for a commit), read as <repo> through `root` (K394-1, K446-2). Undefined when the gate fails on the baseline too with
 * no finding line that the baseline lacks, so it passes. Otherwise the new finding lines of the candidate; empty when the baseline
 * passes, since no finding of it covers the failure, so the caller refuses with the exit status of the candidate.
 */
export function newFindings(root: string, candidate: GateRun, baseline: GateRun): string[] | undefined {
  if (baseline.result.status === 0) return [];
  // A failure of the environment is no finding of either run, so it is refused with its own output (K474).
  if (environmentFailure(candidate)) throw new Error(`the gate fails in ${candidate.folder} for an environment reason, which is no finding, ${endOf(candidate)}:\n${outputOf(candidate)}`);
  if (environmentFailure(baseline)) throw new Error(`the gate fails on the baseline ${baseline.folder} for an environment reason, so it cannot be compared with the candidate, ${endOf(baseline)}:\n${outputOf(baseline)}`);
  const added = newLines(findingLines(candidate.result, candidate.folder, root, candidate.gate), findingLines(baseline.result, baseline.folder, root, baseline.gate));
  return added.length === 0 ? undefined : added;
}

/** The stdout and the stderr of a gate run, as the text that a refusal names. */
const outputOf = (run: GateRun) => `${run.result.stdout}${run.result.stderr}`;

/**
 * Whether a failed gate run failed for an environment reason rather than for a finding (K474): the signal that ended it, a command
 * that the shell could not find or run (make reports the shell status as `Error 126` or `Error 127`), or a failure with no finding
 * line. Such a run is never compared with a baseline, since a baseline that fails the same way would pass it as failing on HEAD too.
 */
function environmentFailure(run: GateRun): boolean {
  return run.result.status === null || /Error 12[67]\b/.test(outputOf(run)) || findingLines(run.result, run.folder, run.folder, run.gate).length === 0;
}

/** The text of how a gate run ended: its exit status, or the signal that ended it. */
const endOf = (run: GateRun) => (run.result.status === null ? `ended with the signal ${run.result.signal}` : `exited ${run.result.status}`);

/**
 * A temporary folder with the tracked files of `treeish` and no other file (K404-1): a detached worktree of HEAD without files, whose
 * index reads `treeish` and whose files are checked out from that index, so the folder holds the staged or committed tree and no
 * untracked or ignored file. The folder is made beside the checkout `folder`, in its workspace, and not in the temporary folder of the
 * system: a check reads the sibling checkouts of the repository beside it (kitCheckoutOf, siblingCheckouts), so the snapshot must
 * resolve them as the checkout does (K404-1-1). Its tool folders `var` and `node_modules` are symbolic links to those of `folder`,
 * which K446 shares. The returned `remove` removes the worktree and the folder.
 */
function temporaryTree(folder: string, treeish: string, print: (text: string) => void): { dir: string; remove: () => void } {
  const dir = mkdtempSync(path.join(path.dirname(folder), `.${path.basename(folder)}-commit-gate-`));
  let added = false;
  let trusted = false;
  const remove = () => {
    // The trust goes first, while the mise.toml of the tree still exists, so no entry of trusted-configs outlives the tree (K469).
    if (trusted) trustStagedTree(folder, dir, true);
    if (added) gitIn(folder, 'worktree', 'remove', '--force', dir);
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    gitIn(folder, 'worktree', 'add', '--quiet', '--detach', '--no-checkout', dir, 'HEAD');
    added = true;
    gitIn(dir, 'read-tree', treeish);
    gitIn(dir, 'checkout-index', '--all', '--force');
  } catch (error) {
    remove();
    throw error;
  }
  for (const shared of ['var', 'node_modules']) if (existsSync(path.join(folder, shared))) symlinkSync(path.join(folder, shared), path.join(dir, shared));
  try {
    trustStagedTree(folder, dir, false);
  } catch (error) {
    remove();
    throw error;
  }
  trusted = true;
  try {
    installNestedNpmProjects(folder, dir, print);
  } catch (error) {
    remove();
    throw error;
  }
  return { dir, remove };
}

/**
 * Installs nested npm projects that the source checkout has installed already and whose lock the staged tree tracks (K404-1-2): the
 * staged manifest and lock are authoritative, npm runs at the checkout's pinned tool path, and offline mode cannot resolve or fetch a
 * different version. A lock project without a source installation is not part of this checkout's environment and is skipped.
 */
function installNestedNpmProjects(folder: string, staged: string, print: (text: string) => void): void {
  const projects = gitIn(staged, 'ls-files', '-z', '--', '*/package-lock.json').split('\0').filter(Boolean).map(path.dirname);
  for (const project of projects) {
    if (!existsSync(path.join(folder, project, 'node_modules'))) continue;
    if (!existsSync(path.join(staged, project, 'package.json'))) throw new Error(`${path.join(project, 'package.json')} is missing in the staged tree; keep the manifest with ${path.join(project, 'package-lock.json')}`);
    const npm = toolCommand(folder, 'npm');
    const directory = path.join(staged, project);
    const config = mkdtempSync(path.join(tmpdir(), 'kit-npm-ci-'));
    try {
      const environment = toolsEnvironment(folder);
      for (const name of Object.keys(environment)) if (/^npm_config_/i.test(name)) delete environment[name];
      Object.assign(environment, { npm_config_offline: 'true', npm_config_userconfig: path.join(config, 'user'), npm_config_globalconfig: path.join(config, 'global') });
      const args = ['ci', '--offline', '--no-audit', '--no-fund'];
      const started = Date.now();
      print(`${npm} ${args.join(' ')} in staged ${project} started`);
      const result = spawnSync(npm, args, { cwd: directory, env: environment, encoding: 'utf8', maxBuffer: 1 << 28 });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
      if (result.error) {
        print(`${npm} ${args.join(' ')} in staged ${project} could not start (${elapsed}s)`);
        throw new Error(`npm ci --offline could not start in ${project}: ${result.error.message}; run make install-tools TOOLS=npm`);
      }
      if (result.status === 0) {
        print(`${npm} ${args.join(' ')} in staged ${project} exited 0 (${elapsed}s)`);
        continue;
      }
      const ended = result.status === null ? `signal ${result.signal}` : `exit ${result.status}`;
      print(`${npm} ${args.join(' ')} in staged ${project} ${ended} (${elapsed}s)`);
      if (/ENOTCACHED|cache miss|cache is empty/i.test(output)) {
        throw new Error(`npm ci --offline of ${project} cannot use the package-lock.json from the staged tree because its package is missing from the offline cache; run make install in the checkout to populate it:\n${output}`);
      }
      throw new Error(`npm ci --offline of ${project} ${ended} using the staged package.json and package-lock.json:\n${output}`);
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  }
}

/**
 * Trusts the mise.toml of the staged tree `dir` in the mise state of the checkout `folder` with the mise of the checkout (K469), or
 * removes that trust with `untrust`. The state is the checkout's, which its shims read, so mise runs the gates of the tree instead of
 * refusing its untrusted config. A tree without a mise.toml has nothing to trust.
 */
export function trustStagedTree(folder: string, dir: string, untrust: boolean): void {
  const config = path.join(dir, 'mise.toml');
  if (!existsSync(config)) return;
  const environment: NodeJS.ProcessEnv = { ...process.env, ...miseEnvironment(folder) };
  delete environment.MISE_GLOBAL_CONFIG_FILE;
  const args = untrust ? ['trust', '--untrust', config] : ['trust', config];
  const result = spawnSync(toolsPath(folder, 'mise-release', 'mise', 'bin', 'mise'), args, { cwd: dir, env: environment, encoding: 'utf8' });
  if (result.error) throw new Error(`mise ${args.join(' ')} could not run in ${folder}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`mise ${args.join(' ')} failed in ${folder}: ${result.stdout}${result.stderr}`);
}

/**
 * Runs the static gates of land that the changed paths of `folder` select, before a commit on main (K446), on the staged tree (K404-1):
 * the index of `folder` is written as a tree and checked out in a temporary worktree, where each gate runs (the commit-gate of
 * commits-check is left to the commit itself). A gate that fails there is refused only on a finding that HEAD lacks, as land refuses
 * on main (newFindings): HEAD is checked out the same way and the gate runs there. Throws, naming the gate and its new findings, when
 * one is new, so nothing is committed; the temporary trees are removed in every case.
 */
export function runCommitGates(folder: string, changed: string[], print: (text: string) => void = text => console.log(`[plan] ${text}`)): void {
  // write-tree reads the index of the commit that git gives the hook, so it runs before the hook variables are removed.
  const tree = git(folder, 'write-tree').trim();
  withoutHookVariables(() => commitGatesOf(folder, tree, changed, print));
}

/** The body of runCommitGates, run with the hook variables removed: the gates on the tree `tree` against HEAD (K404-1). */
function commitGatesOf(folder: string, tree: string, changed: string[], print: (text: string) => void): void {
  const staged = temporaryTree(folder, tree, print);
  try {
    const { gates } = gatesOf(staged.dir, changed, folder);
    for (const gate of gates.filter(gate => gate !== 'commits-check')) {
      print(`${gate} in the staged tree`);
      const candidate = runGate(staged.dir, gate);
      if (candidate.result.status === 0) continue;
      const head = temporaryTree(folder, 'HEAD', print);
      try {
        const added = newFindings(folder, candidate, runGate(head.dir, gate));
        if (added === undefined) {
          print(`${gate} fails on HEAD too, with no finding that HEAD lacks`);
          continue;
        }
        if (added.length === 0) throw new Error(`the gate ${gate} ${endOf(candidate)} on the staged tree and passes on HEAD, so nothing is committed on main:\n${candidate.result.stdout}${candidate.result.stderr}`);
        throw new Error(`the gate ${gate} has ${added.length} findings that HEAD lacks, so nothing is committed on main:\n${added.join('\n')}`);
      } finally {
        head.remove();
      }
    }
  } finally {
    staged.remove();
  }
}

// The entry point runs last: it calls land when the module loads, so every constant that land uses (endOf, among others) must be
// initialized before it (K463).
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
