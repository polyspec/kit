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
// skips the gates and the merge, and only what is left is removed.
//
//   node scripts/kit/land.mts <branch>
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
function linesOf(output: string, folder: string, root: string): { line: string; key: string }[] {
  return output
    .split('\n')
    .map(line => ({ line, key: line.split(folder).join(root).replace(TEMPORARY, '<tmp>').replace(/\d+/g, '#') }))
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
function gatesOf(folder: string, changed: string[]): { gates: string[]; excluded: string[]; reasons: string[] } {
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
      const args = gate === 'commits-check' ? ['--no-print-directory', gate, `RANGE=main..${branch}`] : ['--no-print-directory', gate];
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
