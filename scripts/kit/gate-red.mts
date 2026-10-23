// The red of a row before its fix (K357, K389). A fix whose defect is a finding of a gate of kit-gates, such as a lint finding, has
// no unit test that reproduces it: the gate is its test. make item-state records the red when the item becomes active: on a tree
// that equals HEAD outside docs/plans it runs the gate commands of the Verification cell of the row and writes their exit statuses
// with HEAD to var/plan/<id>.json. A test has no such run on the parent of a fix that a test file changes, so make item-red runs
// the Verification of the active row after its test is written and before its fix, and records the commands that fail with HEAD
// and the hash of the test files. make commit writes each command of that record that failed as a Red-Gate or Red-Test line
// of the message of a fix commit, and check-commits accepts a fix that moves the item to done when a Red-Gate or Red-Test line names
// a command of the row, a status other than 0 and the parent of the commit; the done state of item-state needs such a record too
// (K335).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, jsonText, readJson, writeAtomic } from './bootstrap/files.mts';
import { git } from './git.mts';
import { makeDatabase } from './owner-check.mts';

/** A command of a Verification with its exit status. */
export type Run = { command: string; status: number };

/**
 * The record of the red of an item: the HEAD that its runs ran on, each gate command with its exit status (K357), and, when item-red
 * ran the Verification before the fix, each command with its exit status and the hash of the test files of that tree.
 */
export type GateRecord = { head: string; gates: Run[]; tests?: { tree: string; commands: Run[] } };

// A line of a commit message that records the red of a command of the row on the parent of the commit: Red-Gate for a gate, Red-Test
// for a test that item-red ran.
const RED_LINE = /^Red-(?:Gate|Test): (.+) exit ([1-9]\d*) at ([0-9a-f]{7,40})$/gm;

// The summary that the test runner of kit prints at the end of a run that fails, marked ✖: the counts of the tests that passed,
// failed and ran out of time. A run that passes marks its summary ✔ (test-progress.mts).
const FAILED_RUN = /✖ [^\n]*?(\d+) passed, (\d+) failed, (\d+) timed out/g;

/**
 * Why the failing run of a command proves no red (K540), or undefined when it does, judged by the cause of the failure (K540-1): a
 * red is a test or a check that runs and reports a failure. Exit 127 is a command that was not found, so nothing ran. A run of the
 * test runner of kit that failed proves a red only when a test failed: one whose tests ran out of time, or that failed before any
 * test ran (a build, a compile or a load that failed), proves nothing about the behaviour that the test checks. A command whose
 * test runs passed, or that runs none, failed in a check that reported its finding, such as a gate or a document check, and is
 * judged by its exit status: a passing run of the test runner before it is no cause of its failure.
 */
export function invalidRed(status: number, output: string): string | undefined {
  if (status === 127) return 'exit 127: the command was not found, so nothing ran';
  const failed = [...output.matchAll(FAILED_RUN)];
  if (failed.length === 0 || failed.some(run => Number(run[2]) > 0)) return undefined;
  if (failed.some(run => Number(run[3]) > 0)) return 'a test ran out of time and none failed; build what the test compiles first, then record the red';
  return 'it failed before any test failed, in a build, a compile or a load, so no test checked the behaviour';
}

/** The file of the record of the item `id`. */
export const recordFile = (root: string, id: string) => path.join(root, 'var/plan', `${id}.json`);

// A command that runs one make target, the form of a gate command, with the make variables that scope it after the target, such as
// UNITS of K400 and RULES of K414 (K357-2); a value is a word or a quoted string.
const MAKE_TARGET = /^make\s+(\S+)(?:\s+[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+))*$/;

/**
 * The gates of kit-gates in the make database of the Makefile of `root`, which includes the kit.mk of the kit that the repository
 * uses: scripts/kit/kit.mk in kit, the kit.mk of the installed kit in a consumer (K357-1). Throws when the Makefile declares none.
 */
export function kitGates(root: string): Set<string> {
  const gates = makeDatabase(root).targets.get('kit-gates')?.prerequisites;
  if (gates === undefined) throw new Error(`${path.join(root, 'Makefile')} declares no kit-gates; a repository includes the kit.mk of kit, which declares the gates`);
  return new Set(gates);
}

/** The commands of `commands` that run a gate of `gates`: `make <gate>`, with its make variables (K357-2). */
export function gateCommands(commands: readonly string[], gates: ReadonlySet<string>): string[] {
  return commands.filter(command => gates.has(MAKE_TARGET.exec(command.trim())?.[1] ?? ''));
}

/**
 * Runs the gate commands of `commands`, the Verification of the item `id`, on the tree of `root` and records their exit statuses
 * with HEAD; returns the record, or undefined when the Verification runs no gate. A tree that differs from HEAD outside
 * docs/plans is no tree of the parent, so it records nothing and says so. The tests of a record on the same HEAD stay (K357).
 */
export function recordRed(root: string, id: string, commands: readonly string[], print: (text: string) => void): GateRecord | undefined {
  // The gates are read only for a command that runs one make target, which a gate command is.
  const targets = commands.filter(command => MAKE_TARGET.test(command.trim()));
  if (targets.length === 0) return undefined;
  const gates = gateCommands(targets, kitGates(root));
  if (gates.length === 0) return undefined;
  const loose = git(root, 'status', '--porcelain', '-uall').split('\n').filter(line => line !== '' && !line.slice(3).startsWith('docs/plans/'));
  if (loose.length > 0) {
    print(`[plan] ${id}: the tree differs from HEAD, so the gates of its Verification do not run on the parent and no red is recorded; a fix commit without a test file needs that red:\n${loose.join('\n')}`);
    return undefined;
  }
  const record: GateRecord = { head: git(root, 'rev-parse', 'HEAD').trim(), gates: [] };
  for (const command of gates) {
    print(`[plan] ${id}: ${command} on HEAD ${record.head.slice(0, 12)}`);
    const result = spawnSync('sh', ['-c', command], { cwd: root, stdio: 'inherit' });
    if (result.error) throw new Error(`\`${command}\` of ${id} could not start: ${result.error.message}`);
    if (result.status === null) throw new Error(`\`${command}\` of ${id} ended with the signal ${result.signal}`);
    // A gate prints to this process, so only its exit status is judged (K540).
    const invalid = result.status === 0 ? undefined : invalidRed(result.status, '');
    if (invalid !== undefined) throw new Error(`\`${command}\` of ${id} proves no red: ${invalid} (K540)`);
    print(`[plan] ${id}: ${command} exit ${result.status}${result.status === 0 ? '; the gate passes on HEAD, so it records no red' : ''}`);
    record.gates.push({ command, status: result.status });
  }
  const previous = readRecord(root, id);
  if (previous?.head === record.head && previous.tests) record.tests = previous.tests;
  writeRecord(root, id, record);
  return record;
}

/** Writes the record of the item `id`. */
export function writeRecord(root: string, id: string, record: GateRecord): void {
  writeAtomic(recordFile(root, id), jsonText(record));
}

/** The record of the item `id`, or undefined when there is none. */
export function readRecord(root: string, id: string): GateRecord | undefined {
  const file = recordFile(root, id);
  if (!existsSync(file)) return undefined;
  const value = readJson(file);
  const runs = (list: unknown, name: string): Run[] => {
    if (!Array.isArray(list)) throw new Error(`${path.relative(root, file)} holds no ${name} list; make item-state or make item-red writes it`);
    return list.map((run: unknown) => {
      if (!isJsonObject(run) || typeof run.command !== 'string' || typeof run.status !== 'number') throw new Error(`${path.relative(root, file)} holds a run that is no { command, status }`);
      return { command: run.command, status: run.status };
    });
  };
  if (!isJsonObject(value) || typeof value.head !== 'string') throw new Error(`${path.relative(root, file)} is no record of the red of an item; make item-state writes it`);
  const gates = runs(value.gates, 'gates');
  if (value.tests === undefined) return { head: value.head, gates };
  if (!isJsonObject(value.tests) || typeof value.tests.tree !== 'string') throw new Error(`${path.relative(root, file)} holds no tests tree; make item-red writes it`);
  return { head: value.head, gates, tests: { tree: value.tests.tree, commands: runs(value.tests.commands, 'tests') } };
}

/** The gates and the tests of the record of the item `id` that failed on HEAD; none for another HEAD. */
function failedRuns(root: string, id: string): { head: string; gates: Run[]; tests: Run[] } | undefined {
  const record = readRecord(root, id);
  if (!record || record.head !== git(root, 'rev-parse', 'HEAD').trim()) return undefined;
  const failed = (runs: Run[]) => runs.filter(run => run.status !== 0);
  return { head: record.head, gates: failed(record.gates), tests: failed(record.tests?.commands ?? []) };
}

/** Whether the item `id` has a red on HEAD: a gate or a test that failed on it, as item-state requires to move the item to done. */
export function hasRed(root: string, id: string): boolean {
  const failed = failedRuns(root, id);
  return failed !== undefined && failed.gates.length + failed.tests.length > 0;
}

/**
 * Whether a commit of the history of HEAD that fixes the item `id` proves its red: its subject ends with (#<id>) and its message holds
 * a Red-Gate or Red-Test line that names one of `commands` and failed on the parent of that commit. A close in a later commit reads
 * the red from its fix commit this way, in any checkout.
 */
export function fixProvesRed(root: string, id: string, commands: readonly string[]): boolean {
  // The commits of HEAD that name the item in a subject; each is read with its message, separated by a record separator.
  const log = spawnSync('git', ['log', '--format=%H%x1f%B%x1e', '--fixed-strings', `--grep=(#${id})`, 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (log.status !== 0) throw new Error(`git log ended with exit status ${log.status}: ${log.stderr}`);
  for (const entry of log.stdout.split('\x1e')) {
    const [sha = '', message = ''] = entry.trim().split('\x1f');
    if (sha === '' || !(message.split('\n')[0] ?? '').endsWith(`(#${id})`)) continue;
    const parent = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${sha}^`], { cwd: root, encoding: 'utf8' });
    if (parent.status !== 0) continue;
    if (provesRed(message, () => commands, parent.stdout.trim(), gitIsAncestor(root))) return true;
  }
  return false;
}

/** The Red-Gate and Red-Test lines of the item `id` for a commit on HEAD: each gate and test of its record that failed on HEAD. */
export function redLines(root: string, id: string): string[] {
  const failed = failedRuns(root, id);
  if (!failed) return [];
  // The line names the merge-base of HEAD and main: a row branch is rebased on main before it lands, which rewrites the commits
  // of the branch and keeps that commit as an ancestor of the fix (K389-2). On main, or without a main, it is HEAD itself.
  const base = spawnSync('git', ['merge-base', failed.head, 'main'], { cwd: root, encoding: 'utf8' });
  const at = base.status === 0 && base.stdout.trim() !== '' ? base.stdout.trim() : failed.head;
  const line = (kind: string, run: Run) => `${kind}: ${run.command} exit ${run.status} at ${at.slice(0, 12)}`;
  return [...failed.gates.map(run => line('Red-Gate', run)), ...failed.tests.map(run => line('Red-Test', run))];
}

/**
 * Whether `message` holds a Red-Gate or Red-Test line that names a command of `commandsOfRow`, the commands of the row, and a prefix of
 * the commit `parent`; the commands are read only for a message with such a line.
 */
export function provesRed(message: string, commandsOfRow: () => readonly string[], parent: string, isAncestor: (sha: string, of: string) => boolean = () => false): boolean {
  const lines = [...message.matchAll(RED_LINE)];
  if (lines.length === 0) return false;
  const commands = commandsOfRow();
  // The red holds on the parent, or on an ancestor of it when the branch was rebased after the red was taken.
  return lines.some(match => commands.includes(match[1] ?? '') && (parent.startsWith(match[3] ?? '-') || isAncestor(match[3] ?? '-', parent)));
}

/** The ancestry test of a repository: whether the commit `sha` is an ancestor of `of`, which provesRed takes for a rebased branch. */
export function gitIsAncestor(root: string): (sha: string, of: string) => boolean {
  return (sha, of) => spawnSync('git', ['merge-base', '--is-ancestor', sha, of], { cwd: root }).status === 0;
}
