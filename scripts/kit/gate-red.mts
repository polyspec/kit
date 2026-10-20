// The red of a kit gate (K357). A fix whose defect is a finding of a gate of kit-gates, such as a lint finding, has no unit test
// that reproduces it: the gate is its test. make item-state records the red when the item becomes active: on a tree that equals
// HEAD outside docs/plans it runs the gate commands of the Verification cell of the row and writes their exit statuses with HEAD
// to var/plan/<id>.json. make commit writes each gate of that record that failed as a Red-Gate line of the message of a fix commit
// that changes no test file, and check-commits accepts such a commit when a Red-Gate line names a gate command of the row, a status
// other than 0 and the parent of the commit, and the commit moves the item to done, whose verification ran the gate green on the
// tree of the commit (K335).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, jsonText, readJson, writeAtomic } from './bootstrap/files.mts';
import { gatesOf } from './bypass-check.mts';
import { git } from './git.mts';

/** The record of the red of the gates of an item: the HEAD that they ran on and each gate command with its exit status. */
export type GateRecord = { head: string; gates: { command: string; status: number }[] };

// A line of a commit message that records the red of a gate on the parent of the commit.
const RED_GATE = /^Red-Gate: (make \S+) exit ([1-9]\d*) at ([0-9a-f]{7,40})$/gm;

/** The file of the record of the item `id`. */
const recordFile = (root: string, id: string) => path.join(root, 'var/plan', `${id}.json`);

/** The gates of kit-gates that scripts/kit/kit.mk of `root` declares; none without the file. */
export function kitGates(root: string): Set<string> {
  const kit = path.join(root, 'scripts/kit/kit.mk');
  return new Set(existsSync(kit) ? gatesOf(readFileSync(kit, 'utf8')) : []);
}

/** The commands of `commands` that run a gate of `gates` and nothing else: `make <gate>`. */
export function gateCommands(commands: readonly string[], gates: ReadonlySet<string>): string[] {
  return commands.filter((command) => {
    const words = command.trim().split(/\s+/);
    return words.length === 2 && words[0] === 'make' && gates.has(words[1] ?? '');
  });
}

/**
 * Runs the gate commands of `commands`, the Verification of the item `id`, on the tree of `root` and records their exit statuses
 * with HEAD; returns the record, or undefined when the Verification runs no gate. A tree that differs from HEAD outside
 * docs/plans is no tree of the parent, so it records nothing and says so; the record of an earlier activation is removed first.
 */
export function recordRed(root: string, id: string, commands: readonly string[], print: (text: string) => void): GateRecord | undefined {
  const gates = gateCommands(commands, kitGates(root));
  if (gates.length === 0) return undefined;
  rmSync(recordFile(root, id), { force: true });
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
    print(`[plan] ${id}: ${command} exit ${result.status}${result.status === 0 ? '; the gate passes on HEAD, so it records no red' : ''}`);
    record.gates.push({ command, status: result.status });
  }
  writeAtomic(recordFile(root, id), jsonText(record));
  return record;
}

/** The record of the item `id`, or undefined when there is none. */
function readRecord(root: string, id: string): GateRecord | undefined {
  const file = recordFile(root, id);
  if (!existsSync(file)) return undefined;
  const value = readJson(file);
  if (!isJsonObject(value) || typeof value.head !== 'string' || !Array.isArray(value.gates)) throw new Error(`${path.relative(root, file)} is no record of the red of a gate; make item-state writes it`);
  const gates = value.gates.map((gate: unknown) => {
    if (!isJsonObject(gate) || typeof gate.command !== 'string' || typeof gate.status !== 'number') throw new Error(`${path.relative(root, file)} holds a gate that is no { command, status }`);
    return { command: gate.command, status: gate.status };
  });
  return { head: value.head, gates };
}

/** The Red-Gate lines of the item `id` for a commit on HEAD: each gate of its record that failed on HEAD; none for another HEAD. */
export function redGateLines(root: string, id: string): string[] {
  const record = readRecord(root, id);
  if (!record || record.head !== git(root, 'rev-parse', 'HEAD').trim()) return [];
  return record.gates.filter(gate => gate.status !== 0).map(gate => `Red-Gate: ${gate.command} exit ${gate.status} at ${record.head.slice(0, 12)}`);
}

/** Whether `message` holds a Red-Gate line that names a command of `gateCommandsOfRow` and a prefix of the commit `parent`. */
export function provesRed(message: string, gateCommandsOfRow: readonly string[], parent: string): boolean {
  return [...message.matchAll(RED_GATE)].some(match => gateCommandsOfRow.includes(match[1] ?? '') && parent.startsWith(match[3] ?? '-'));
}
