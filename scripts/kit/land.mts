#!/usr/bin/env node
// Lands a branch on main (K394): `make land BRANCH=<branch>`, run in the main checkout. It refuses unless the main checkout is on
// main and clean, the branch exists and is rebased on main, and a worktree has the branch checked out (its gates run on its own
// tree and install). It runs the static gates of kit-gates that the changed paths of the branch select through
// config/owner-checks.json, always with docs-check and commits-check (commits-check over main..<branch>). No test runs (K394-1): parity-check
// and every test- target that the owners select are printed as not run. A gate that fails in the worktree is refused only when its
// output has a line that main does not have: the same gate runs in the main checkout, and a line of the branch output that occurs
// more often there than in the output on main is a new finding. A gate that fails on main too, with no new finding, goes on;
// commits-check refuses on any failure. On a refusal it prints the gate and its output and merges nothing. Then it merges
// fast-forward, removes the worktree when it
// has no uncommitted change (an ignored install does not count) and deletes the branch. A branch that main already contains
// skips the gates and the merge, and only what is left is removed. Before a worktree is removed, the make targets that WORKTREE_STOP
// names in its Makefile stop its servers (K441); a stop that fails keeps the worktree.
//
//   node scripts/kit/land.mts <branch>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { kitGates } from './gate-red.mts';
import { git, gitResult } from './git.mts';
import { DECLARATION, importGraph, makeDatabase, select } from './owner-check.mts';
import type { OwnerDeclaration } from './owner-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { expandMake } from './recipe-tools.mts';
import { readConfig } from './schema-validate.mts';
import { trackedFiles } from './tracked-files.mts';

// The gates that land whatever the changed paths: the documents and the commit messages of the branch.
const ALWAYS_GATES = ['docs-check', 'commits-check'];

// K429: the processes of the machine that run in a worktree, read with ps and lsof (read only): a command line that names a path in
// the folder, after `=` or a space, and a working directory inside it. land itself and its parent are left out.
export interface MachineListing {
  ps: string;
  // undefined when lsof is missing: only the command lines are then known.
  lsof?: string;
}

/**
 * The processes of the worktree `folder` in `listing`, by pid, with the command line that names them (or pid only for a cwd match).
 * `self` and every ancestor of it, such as the make and the shell that run make land, are left out (K429-1).
 */
export function worktreeProcesses(folder: string, { ps, lsof }: MachineListing, self: number = process.pid): { pid: number; command: string }[] {
  const escaped = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = new RegExp(`(?<![^\\s=])${escaped}(?=/|\\s|$)`);
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
    if (names.test(command)) found.set(Number(id), command);
  }
  const ancestors = new Set<number>();
  for (let pid: number | undefined = self; pid !== undefined && pid > 0 && !ancestors.has(pid); pid = parents.get(pid)) ancestors.add(pid);
  let pid: number | undefined;
  for (const line of (lsof ?? '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== undefined && inside(line.slice(1))) found.set(pid, commands.get(pid) ?? `(no command line in ps)`);
  }
  return [...found]
    .filter(([live]) => !ancestors.has(live))
    .sort(([a], [b]) => a - b)
    .map(([pid, command]) => ({ pid, command }));
}

/** The ps and lsof outputs of the machine, read only; lsof is undefined when it is not installed. */
export function machineListing(): MachineListing {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (ps.error || ps.status !== 0) throw new Error(`ps could not list the processes: ${ps.error?.message ?? ps.stderr}`);
  const lsof = spawnSync('lsof', ['-d', 'cwd', '-Fpn'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (lsof.error && (lsof.error as NodeJS.ErrnoException).code === 'ENOENT') return { ps: ps.stdout };
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
  const result = spawnSync('make', ['--no-print-directory', ...targets], { cwd: folder, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error) throw new Error(`make ${names} could not start in ${folder}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`the stop target ${names} failed in ${folder} (${result.status ?? result.signal}), so the worktree is kept; its output:\n${result.stdout}${result.stderr}`);
  }
  print(`${names} passed`);
}

/** Refuses with the processes that run in the worktree `folder` (K429), when there are some; `consequence` says what is kept. */
function refuseWhileRunning(folder: string, branch: string, consequence: string, print: (text: string) => void): void {
  const listing = machineListing();
  if (listing.lsof === undefined) print(`lsof is missing: only the command lines name the processes of ${folder}`);
  const live = worktreeProcesses(folder, listing);
  if (live.length) {
    throw new Error(`${branch} is refused: ${live.length} processes run in the worktree ${folder}; ${consequence}. Stop them first, then run make land again:\n${live.map(({ pid, command }) => `${pid} ${command}`).join('\n')}`);
  }
}

// A gate that runs tests: parity-check and the test- targets. The Verification of the rows runs the tests, so land never does.
const isTestGate = (gate: string) => gate === 'parity-check' || gate.startsWith('test-');

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

/** The lines of the stdout and the stderr of a gate that land compares: every line of stderr, and the lines of stdout but progress. */
const findingLines = ({ stdout, stderr }: { stdout: string; stderr: string }, folder: string, root: string) =>
  [...linesOf(stdout, folder, root).filter(({ line }) => !PROGRESS.test(line)), ...linesOf(stderr, folder, root)];

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
export function gatesOf(folder: string, changed: string[]): { gates: string[]; excluded: string[]; reasons: string[] } {
  const declaration = readConfig<OwnerDeclaration>(folder, DECLARATION, 'owner-checks.schema.json');
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
  // The worktree of a repository whose Makefile declares WORKTREE_STOP has its servers stopped after the merge, before its removal,
  // so its running servers are no refusal here; the check before the removal still refuses a server that the stop left alive.
  const stop = folder === undefined ? undefined : stopTargetOf(folder);
  // K429: no gate runs, nothing is merged and nothing is removed while a process of the worktree runs.
  if (folder !== undefined && stop === undefined) refuseWhileRunning(folder, branch, 'nothing is merged, removed or deleted', print);
  if (gitResult(root, 'merge-base', '--is-ancestor', branch, 'main').status === 0) {
    print(`${branch} is contained in main already: no gate runs and nothing is merged`);
  } else {
    if (gitResult(root, 'merge-base', '--is-ancestor', 'main', branch).status !== 0) throw new Error(`${branch} is not rebased on main; rebase it on main first`);
    if (folder === undefined) throw new Error(`${branch} has no worktree; the gates run on its own tree and install, so make worktree-setup first`);
    const changed = git(root, 'diff', '--name-only', `main...${branch}`).split('\n').filter(line => line !== '');
    const { gates, excluded, reasons } = gatesOf(folder, changed);
    for (const reason of reasons) print(reason);
    for (const gate of excluded) print(`${gate} runs tests, which the Verification of the rows runs; land does not run it`);
    print(`gates of ${branch} in ${folder}: ${gates.join(', ')}`);
    for (const gate of gates) {
      // make -s: the recipes that make echoes differ between checkouts and are not findings of the gate (K446-3).
      const args = gate === 'commits-check' ? ['--no-print-directory', '-s', gate, `RANGE=main..${branch}`] : ['--no-print-directory', '-s', gate];
      print(`${gate} in ${folder}`);
      const result = spawnSync('make', args, { cwd: folder, encoding: 'utf8', maxBuffer: 1 << 28 });
      if (result.error) throw new Error(`make ${gate} could not start in ${folder}: ${result.error.message}`);
      if (result.status !== 0 && gate !== 'commits-check') {
        const onMain = spawnSync('make', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
        if (onMain.error) throw new Error(`make ${gate} could not start in ${root}: ${onMain.error.message}`);
        if (onMain.status !== 0) {
          const added = newLines(findingLines(result, folder, root), findingLines(onMain, folder, root));
          if (added.length === 0) {
            print(`${gate} fails on main too, with no finding that main does not have`);
            continue;
          }
          print(`${gate} has findings that main does not have:\n${added.join('\n')}`);
          throw new Error(`${branch} is refused: the gate ${gate} has ${added.length} findings that main does not have; nothing is merged`);
        }
      }
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
      if (stop !== undefined) stopServers(folder, stop, print);
      refuseWhileRunning(folder, branch, 'the worktree and the branch are kept', print);
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

/**
 * Runs the static gates of land that the changed paths of `folder` select, before a commit on main (K446), and refuses only the
 * findings that HEAD lacks, as land does (K394-1): a gate that fails on HEAD too is printed and passes. The commit gate
 * (commits-check) is left to the commit itself. The gate runs on HEAD in a temporary worktree that shares the tools of `folder`.
 * Throws, naming the gate and its new findings, when one is new; nothing is committed then.
 */
export function runCommitGates(folder: string, changed: string[], print: (text: string) => void = text => console.log(`[plan] ${text}`)): void {
  const { gates } = gatesOf(folder, changed);
  for (const gate of gates.filter(gate => gate !== 'commits-check')) {
    print(`${gate} in ${folder}`);
    const result = spawnSync('make', ['--no-print-directory', '-s', gate], { cwd: folder, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (result.error) throw new Error(`make ${gate} could not start in ${folder}: ${result.error.message}`);
    if (result.status === 0) continue;
    const head = mkdtempSync(path.join(tmpdir(), 'kit-commit-gate-'));
    try {
      const made = spawnSync('git', ['worktree', 'add', '--quiet', '--detach', head, 'HEAD'], { cwd: folder, encoding: 'utf8' });
      if (made.status !== 0) throw new Error(`git worktree add of HEAD failed: ${made.stderr}`);
      for (const shared of ['var', 'node_modules']) if (existsSync(path.join(folder, shared)) && !existsSync(path.join(head, shared))) symlinkSync(path.join(folder, shared), path.join(head, shared));
      const base = spawnSync('make', ['--no-print-directory', '-s', gate], { cwd: head, encoding: 'utf8', maxBuffer: 1 << 28 });
      if (base.error) throw new Error(`make ${gate} could not start on HEAD: ${base.error.message}`);
      const added = newLines(findingLines(result, folder, folder), findingLines(base, head, folder));
      if (added.length === 0) { print(`${gate} fails on HEAD too, with no finding that HEAD lacks`); continue; }
      throw new Error(`the gate ${gate} has ${added.length} findings that HEAD lacks, so nothing is committed on main:\n${added.join('\n')}`);
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', head], { cwd: folder, encoding: 'utf8' });
      rmSync(head, { recursive: true, force: true });
    }
  }
}
