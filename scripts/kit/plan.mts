#!/usr/bin/env node
// The utilities that write plans and checklist rows (K249). Each computes the files it would write and writes them only when
// they pass the checks that docs-check and the Git hooks run on them, so its output never fails those checks:
//
//   plan-new   NAME=<name> TITLE=<English title> TITLE_KO=<Korean title> [NAME_PATTERN=<regular expression>]
//              writes docs/plans/<slug>/ with plan.md, checklist.md and their Korean twins: the doc-id, the language link,
//              the header of the checklist table and the revision marker of each Korean file
//   item-new   PLAN=<slug> ID=<id> TASK= TASK_KO= DELIVERABLES= VERIFICATION=
//              adds the row of the item in the waiting state to the checklist of the plan and to its Korean twin: a sub-item
//              (an ID that ends in -<n>) after the last sub-item of its parent, another item at the end of the last table
//   item-edit  ID=<id> [TASK= TASK_KO= DELIVERABLES= VERIFICATION= | CAUSE= RETRY= CAUSE_KO= RETRY_KO=] [DONE_STAYS=1]
//              replaces the Task, Deliverables or Verification cells of the item in both languages, or rewrites the cause and the
//              retry of a bypassed item (the cause alone of an impossible one) with the checks of item-state
//   item-state ID=<id> STATE=<state> [CAUSE= RETRY= CAUSE_KO= RETRY_KO=]
//              moves the item to STATE in both languages from any state (K1090); the bypassed state needs a cause and a
//              retry condition, the impossible state a cause; it runs no test and reads no changelog (K1053)
//   item-test  ID=<id>
//              runs each command of the Verification cell of the item in order, in the root, and fails on the first that
//              fails (verification.mts)
//   commit     ID=<id> TYPE=<type> SCOPE=<scope> SUBJECT=<subject> BODY_FILE=<file>
//              commits the index with the message type(scope): Subject (#id), a blank line and the body of the file, its
//              paragraphs wrapped at the width of the commit rules and its trailer lines kept; it judges neither the message
//              nor the index (K1053)
//
//   plan-split FROM=<slug> TO=<slug> IDS="<id> <id>" [TITLE= TITLE_KO=]
//              moves the rows of the items, with their text unchanged, from the checklist of FROM to the checklist of TO and
//              in the Korean twins; TO is made with plan-new when it does not exist, and then needs TITLE and TITLE_KO. A
//              sub-item moves with its parent. K241 forbids a catch-all plan, and this splits one
//
// make passes the variables of its command line to the recipe in the environment, so a text with quotes or backticks needs
// no quoting.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './bootstrap/digest.mts';
import { CHECKLIST_HEADER, loadConfig, PLANS, readChecklist, stateList, statesOf, trackersOf, workingPlanFiles } from './checklist.mts';
import { COMMIT_RULES } from './check-commits.mts';
import { itemCommands } from './verification.mts';
import { spawnSync } from 'node:child_process';
import { changedFiles, foldersOfChanged, typeErrorMessage, typeErrors } from './ts-typecheck.mts';
import type { States, Tracker } from './checklist.mts';
import { lineBlocks } from './markdown.mts';
import { stamped } from './documents-stamp.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { withLandLock } from './land.mts';
import { refreshLinked } from './linked-build.mts';
import { present } from './present.mts';
import { git, gitAnswer } from './git.mts';
import { cleanupAfter } from './process.mts';



/** The text of a Korean twin of `english`: `korean` with the revision marker of `english` after its doc-id. */
const twin = (english: string, korean: string) => present(stamped(korean, sha256(english)), 'stamped(korean)');

/**
 * `files` ({ path: text }) with the revision marker of each Korean twin in it set to the sha256 of the new English text, but only
 * when the twin was current: its marker on disk was the sha256 of the English text before the change (K368). A stale twin stays
 * stale, since its translation was never reviewed.
 */
function restamped(root: string, files: Record<string, string>): Record<string, string> {
  const disk = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const result = { ...files };
  for (const [korean, text] of Object.entries(files)) {
    const english = korean.replace(/\.ko\.md$/, '.md');
    if (english === korean || !(english in files)) continue;
    const marker = /<!-- source-sha256: ([^>]*?) -->/.exec(disk(korean))?.[1];
    if (marker !== sha256(disk(english))) continue;
    result[korean] = present(stamped(text, sha256(present(files[english], 'files[english]'))), 'stamped(text)');
  }
  return result;
}

/** A required text value; `name` is the variable that gives it. */
function required(value: string | undefined, name: string): string {
  const text = value?.trim() ?? '';
  if (!text) throw new Error(`${name} is empty; give it on the command line, such as make plan-new ${name}=...`);
  return text;
}

/**
 * Writes the four files of the plan `name` below docs/plans of `root` and returns them as { path: text }. Throws, writing
 * nothing, when `name` is no folder name, does not match the `pattern` that the caller declares (K1089), the plan exists or a
 * title is empty; the other plan folders are not judged (K1082).
 */
export function newPlan(root: string, { name, title, titleKo, pattern }: { name: string; title: string | undefined; titleKo: string | undefined; pattern?: string | undefined }): Record<string, string> {
  if (name === '' || name === '.' || name === '..' || /[/\\]/.test(name)) throw new Error(`the name ${JSON.stringify(name)} is no folder name; a plan is the folder docs/plans/<name>`);
  if (pattern !== undefined && !new RegExp(pattern, 'u').test(name)) throw new Error(`the name ${JSON.stringify(name)} does not match ${pattern}, the NAME_PATTERN of the caller`);
  const folder = `${PLANS}/${name}`;
  if (existsSync(path.join(root, folder))) throw new Error(`${folder} exists; a plan is created once`);
  const english = required(title, 'TITLE');
  const korean = required(titleKo, 'TITLE_KO');
  const plan = `<!-- doc-id: plan-${name} -->\n# ${english}\n\n[한국어](plan.ko.md)\n`;
  const checklist = `<!-- doc-id: checklist-${name} -->\n# ${english} checklist\n\n${CHECKLIST_HEADER}`;
  const files: Record<string, string> = {
    [`${folder}/plan.md`]: plan,
    [`${folder}/plan.ko.md`]: twin(plan, `<!-- doc-id: plan-${name} -->\n# ${korean}\n\n[English](plan.md)\n`),
    [`${folder}/checklist.md`]: checklist,
    [`${folder}/checklist.ko.md`]: twin(checklist, `<!-- doc-id: checklist-${name} -->\n# ${korean} 체크리스트\n\n${CHECKLIST_HEADER}`),
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return files;
}

/** The text of a table cell: `value` with each pipe escaped, so it stays one cell; throws on a line break. */
function cell(value: string | undefined, name: string): string {
  const text = required(value, name);
  if (/[\r\n]/.test(text)) throw new Error(`${name} holds a line break; a cell of a checklist row is one line`);
  return text.replace(/(?<!\\)\|/g, '\\|');
}

/** The ID of the first cell of each row of `text` with the index of its line. */
function rowIds(text: string): { id: string; index: number }[] {
  return lineBlocks(text).flatMap((block, index) => (block.kind === 'tableRow' ? [{ id: block.cells[0]?.text.trim() ?? '', index }] : []));
}

/**
 * `text` with `row` inserted: after the last row of the parent of `id` or of its sub-items for a sub-item, after the last row
 * of the last table otherwise, or after the header of an empty table.
 */
function inserted(text: string, id: string, row: string): string {
  const lines = text.split('\n');
  const parent = /^(.*)-[0-9]+$/.exec(id)?.[1];
  const ids = rowIds(text);
  const family = parent === undefined ? ids : ids.filter(entry => entry.id === parent || entry.id.startsWith(`${parent}-`));
  const last = family.at(-1)?.index ?? lineBlocks(text).findLastIndex(block => block.kind === 'tableDelimiter');
  if (last < 0) throw new Error('the checklist holds no table; make plan-new writes its header');
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}

/**
 * The checklists of the branch main of `root` that hold a row of `id` (K868): two worktrees can pick the same ID, so a registration
 * reads main as check-commits does. None in a checkout without main.
 */
function mainHolders(root: string, config: ReturnType<typeof loadConfig>, id: string): string[] {
  // A repository without main has no holder there; any failure of git to read main is an error (K1159).
  if (gitAnswer(root, 'show-ref', '--verify', '--quiet', 'refs/heads/main') === undefined) return [];
  return trackersOf(config, git(root, 'ls-tree', '-r', '--name-only', 'main', '--', PLANS).split('\n').filter(Boolean)).map(tracker => tracker.path)
    .filter(file => rowIds(git(root, 'show', `main:${file}`)).some(entry => entry.id === id));
}

/** The branch of HEAD; undefined while HEAD has no commit yet, which is no main to commit on (K1159). */
function headBranch(root: string): string | undefined {
  if (gitAnswer(root, 'rev-parse', '--verify', '--quiet', 'HEAD') === undefined) return undefined;
  return git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
}

/** The new row of an item. */
export type NewItem = { plan: string; id: string; task: string | undefined; taskKo: string | undefined; deliverables: string | undefined; verification: string | undefined };

/**
 * Adds the waiting row of `item` to the checklist of its plan and to the Korean twin, and returns the two files as
 * { path: text }. Throws, writing nothing, when the plan has no checklist, a checklist of the checkout or of main holds the ID (K868), the ID does not
 * match the pattern, a text is empty
 * or holds a line break, or the checklists with the row fail the checks of docs-check (an ID of two checklists, a
 * sub-item without its parent).
 */
export function newItem(root: string, item: NewItem): Record<string, string> {
  const config = loadConfig(root);
  const trackers = trackersOf(config, workingPlanFiles(root));
  const file = `${PLANS}/${item.plan}/checklist.md`;
  const tracker = trackers.find(entry => entry.path === file);
  if (!tracker) throw new Error(`${file} is no checklist; make plan-new NAME=${item.plan} writes the plan`);
  const own = trackers.find(entry => rowIds(readFileSync(path.join(root, entry.path), 'utf8')).some(row => row.id === item.id));
  if (own !== undefined) throw new Error(`${item.id} is held by ${own.path}; choose a fresh ID`);
  const [held] = mainHolders(root, config, item.id);
  if (held !== undefined) throw new Error(`${item.id} is held by ${held} of main; choose a fresh ID`);
  const tail = ` | ${cell(item.deliverables, 'DELIVERABLES')} | ${cell(item.verification, 'VERIFICATION')} | ${statesOf(tracker).waiting} |`;
  const english = `| ${item.id} | ${cell(item.task, 'TASK')}${tail}`;
  const korean = `| ${item.id} | ${cell(item.taskKo, 'TASK_KO')}${tail}`;
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const files = restamped(root, {
    [tracker.path]: inserted(read(tracker.path), item.id, english),
    [tracker.translation]: inserted(read(tracker.translation), item.id, korean),
  });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return files;
}

/**
 * Replaces the Verification cell of the row of the item `id` in the checklist and in its Korean twin (K353), or its Task cells, the
 * English `task` and the Korean `taskKo` together (K373), or its Deliverables cell, the same in both languages (K388), through the
 * checks of newItem; returns the two files as { path: text }. Throws, writing nothing, for an item that is no row, the Verification or
 * the Verification or the Deliverables of a done item when the caller declares `doneStays` (K1116), a Task without its Korean twin and a
 * cell that fails the checks of docs-check. The Task of a done item is corrected, since its words are no state.
 */
export function editItem(root: string, { id, deliverables, verification, task, taskKo, doneStays = false }: { id: string; deliverables?: string | undefined; verification?: string | undefined; task?: string | undefined; taskKo?: string | undefined; doneStays?: boolean }): Record<string, string> {
  if ((task === undefined) !== (taskKo === undefined)) throw new Error('item-edit takes TASK and TASK_KO together: the Korean twin holds the same information');
  // Without a Task or a Deliverables the Verification is edited, and an empty one is refused by its cell.
  const editsVerification = verification !== undefined || (task === undefined && deliverables === undefined);
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const tracker = trackers.find(entry => readChecklist(read(entry.path), entry).items.some(item => item.id === id));
  if (!tracker) throw new Error(`${id} is no item of a checklist of ${PLANS}`);
  const replaced = (text: string, taskText: string | undefined, taskName: string) => {
    const lines = text.split('\n');
    const index = lines.findIndex(line => line.startsWith(`| ${id} |`));
    const cells = (lines[index] ?? '').replace(/^\| /, '').replace(/ \|$/, '').split(' | ');
    if (cells.length !== 5) throw new Error(`the row of ${id} holds ${cells.length} cells, not the 5 of a checklist row`);
    // The Deliverables cell is the same text in both languages (K388), so it is edited in each file like the Verification.
    if (doneStays && (editsVerification || deliverables !== undefined)) {
      const { done } = statesOf(tracker);
      if (cells[4]?.startsWith(done)) throw new Error(`${id} is ${done}; from ${done} an item stays; a new finding is an item of its own`);
    }
    if (editsVerification) cells[3] = cell(verification, 'VERIFICATION');
    if (deliverables !== undefined) cells[2] = cell(deliverables, 'DELIVERABLES');
    if (taskText !== undefined) cells[1] = cell(taskText, taskName);
    lines[index] = `| ${cells.join(' | ')} |`;
    return lines.join('\n');
  };
  const files = restamped(root, { [tracker.path]: replaced(read(tracker.path), task, 'TASK'), [tracker.translation]: replaced(read(tracker.translation), taskKo, 'TASK_KO') });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return files;
}

/**
 * The files that write the English and Korean state cells into the row of `entry` in its checklist and twin, through the checks of
 * the commit rules and of the checklists; throws, writing nothing, on a finding that writing them would add.
 */
function stateFiles(root: string, trackers: Tracker[], entry: ReturnType<typeof findItem>, id: string, [english, korean]: [string, string]): Record<string, string> {
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const files = restamped(root, {
    [entry.tracker.path]: withState(read(entry.tracker.path), id, english),
    [entry.tracker.translation]: withState(read(entry.tracker.translation), id, korean),
  });
  return files;
}

/** The item `id` with its checklist, found in `trackers`; throws when no checklist holds it. */
function findItem(trackers: Tracker[], read: (name: string) => string, id: string) {
  const [entry] = trackers.flatMap(tracker => readChecklist(read(tracker.path), tracker).items.filter(item => item.id === id).map(item => ({ tracker, item })));
  if (!entry) throw new Error(`${id} is no item of a checklist of ${PLANS}`);
  return entry;
}

/**
 * Rewrites the cause and the retry condition of the bypassed item `change.id`, or only the cause of the impossible one, in its checklist
 * and the Korean twin, through the checks of setState for the same texts (K442); returns the two files as { path: text }. Throws, writing
 * nothing, for an item in another state, a retry of an impossible item, and a missing or evasive cause or retry.
 */
export function editState(root: string, change: Omit<NewState, 'state'>): Record<string, string> {
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const entry = findItem(trackers, read, change.id);
  const state = entry.item.state;
  const { bypassed, impossible } = statesOf(entry.tracker);
  if (state !== bypassed && state !== impossible) throw new Error(`${change.id} is ${state}; item-edit rewrites the cause and the retry of a bypassed (${bypassed}) item and the cause of an impossible (${impossible}) one`);
  if (state === impossible && (change.retry !== undefined || change.retryKo !== undefined)) throw new Error(`${change.id} is ${impossible}, which has no retry condition; RETRY and RETRY_KO belong to a bypassed item`);
  const files = stateFiles(root, trackers, entry, change.id, stateCells({ ...change, state }, statesOf(entry.tracker)));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return files;
}

/** The plan, the target and the items of a split. */
export type PlanSplit = { from: string; to: string; ids: string[]; title: string | undefined; titleKo: string | undefined };

/** `text` without the rows of the items `ids`, and those rows, in the order of the file. */
function withoutRows(text: string, ids: ReadonlySet<string>): { text: string; moved: { id: string; row: string }[] } {
  const lines = text.split('\n');
  const taken = rowIds(text).filter(entry => ids.has(entry.id));
  const moved = taken.map(entry => ({ id: entry.id, row: lines[entry.index] ?? '' }));
  const indexes = new Set(taken.map(entry => entry.index));
  return { text: lines.filter((_, index) => !indexes.has(index)).join('\n'), moved };
}

/**
 * Moves the rows of the items `ids` from the checklist of the plan `from` to that of the plan `to`, and in the Korean twins, and
 * returns the four files as { path: text }. Throws, writing nothing, when `from` is no plan, an item is not in it, a sub-item
 * would be apart from its parent, `to` is `from`, a new `to` has no titles, or the checklists would fail the checks of docs-check.
 */
export function splitPlan(root: string, { from, to, ids, title, titleKo }: PlanSplit): Record<string, string> {
  const config = loadConfig(root);
  const source = trackersOf(config, workingPlanFiles(root)).find(entry => entry.path === `${PLANS}/${from}/checklist.md`);
  if (!source) throw new Error(`${PLANS}/${from}/checklist.md is no checklist`);
  if (from === to) throw new Error('FROM and TO name one plan; a split moves rows to another plan');
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const chosen = new Set(ids);
  if (chosen.size === 0) throw new Error('IDS is empty; name the items to move, such as make plan-split IDS="K1 K2"');
  const present = rowIds(read(source.path)).map(entry => entry.id);
  for (const id of chosen) if (!present.includes(id)) throw new Error(`${id} is no item of ${PLANS}/${from}`);
  for (const id of chosen) {
    const parent = /^(.*)-[0-9]+$/.exec(id)?.[1];
    if (parent !== undefined && present.includes(parent) && !chosen.has(parent)) throw new Error(`${id} moves without its parent ${parent}; name ${parent} too`);
  }
  for (const id of present) {
    const parent = /^(.*)-[0-9]+$/.exec(id)?.[1];
    if (parent !== undefined && chosen.has(parent) && !chosen.has(id)) throw new Error(`${id}, a sub-item of ${parent}, stays; a sub-item moves with its parent`);
  }
  const target = `${PLANS}/${to}/checklist.md`;
  const created = !existsSync(path.join(root, PLANS, to));
  if (created) {
    required(title, 'TITLE');
    required(titleKo, 'TITLE_KO');
    newPlan(root, { name: to, title, titleKo });
  }
  try {
    const trackers = trackersOf(config, workingPlanFiles(root));
    const destination = trackers.find(entry => entry.path === target);
    if (!destination) throw new Error(`${target} is no checklist`);
    const changed: Record<string, string> = {};
    for (const [origin, goal] of [[source.path, destination.path], [source.translation, destination.translation]] as const) {
      const { text, moved } = withoutRows(read(origin), chosen);
      changed[origin] = text;
      changed[goal] = moved.reduce((result, entry) => inserted(result, entry.id, entry.row), read(goal));
    }
    const files = restamped(root, changed);
      for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
    return files;
  } catch (error) {
    cleanupAfter(error, () => { if (created) rmSync(path.join(root, PLANS, to), { recursive: true, force: true }); });
  }
}

/** The new state of an item, with the texts that its cell needs in the bypassed and the impossible state. */
export type NewState = { id: string; state: string; cause?: string | undefined; retry?: string | undefined; causeKo?: string | undefined; retryKo?: string | undefined };

/** The state cells of `change` in English and Korean, with the markers `states` of its checklist. */
function stateCells({ state, cause, retry, causeKo, retryKo }: NewState, states: States): [string, string] {
  if (state === states.bypassed) return [`${state} cause: ${cell(cause, 'CAUSE')}; retry: ${cell(retry, 'RETRY')}`, `${state} 원인: ${cell(causeKo, 'CAUSE_KO')}; 재시도: ${cell(retryKo, 'RETRY_KO')}`];
  if (state === states.impossible) return [`${state} cause: ${cell(cause, 'CAUSE')}`, `${state} 원인: ${cell(causeKo, 'CAUSE_KO')}`];
  return [state, state];
}

/** `text` with the last cell of the row of `id` replaced by `state`. */
function withState(text: string, id: string, state: string): string {
  const lines = text.split('\n');
  const index = rowIds(text).find(entry => entry.id === id)?.index;
  const block = index === undefined ? undefined : lineBlocks(text)[index];
  if (index === undefined || block?.kind !== 'tableRow') throw new Error(`the checklist holds no row of ${id}`);
  const last = present(block.cells.at(-1), 'block.cells.at(-1)');
  lines[index] = `${present(lines[index], 'lines[index]').slice(0, last.start)} ${state} |`;
  return lines.join('\n');
}

/**
 * The item `change.id` with its checklist and the trackers of the checkout; throws on a state that is none of the checklist
 * states. The item moves to the state the repository asks for, from any state (K1090). `already` is true when the item holds
 * `change.state`, which is no move (K937-1).
 */
function movableItem(root: string, change: NewState) {
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const entry = findItem(trackers, name => readFileSync(path.join(root, name), 'utf8'), change.id);
  const states = statesOf(entry.tracker);
  const markers = stateList(states);
  if (!markers.includes(change.state)) throw new Error(`the state ${JSON.stringify(change.state)} is none of ${markers.join(', ')}`);
  const from = entry.item.state;
  const already = from === change.state;
  return { trackers, entry, already };
}

/**
 * Moves the item `change.id` to `change.state` in its checklist and the Korean twin and returns the two files as
 * { path: text }, none when the item already holds the state. Throws, writing nothing, on a state that is not declared and a
 * missing cause or retry condition.
 */
export function setState(root: string, change: NewState): Record<string, string> {
  const { trackers, entry, already } = movableItem(root, change);
  if (already) return {};
  const files = stateFiles(root, trackers, entry, change.id, stateCells(change, statesOf(entry.tracker)));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return files;
}

/**
 * Runs each command of the Verification cell of the item `id` in order, in `root`, with its output on this process, and
 * returns them. Throws on an item that names no command and on the first command that fails, naming it and its status.
 */
export function testItem(root: string, id: string, print: (text: string) => void = text => console.log(text)): string[] {
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const tracker = trackers.find(entry => readChecklist(read(entry.path), entry).items.some(item => item.id === id));
  if (!tracker) throw new Error(`${id} is no item of a checklist of ${PLANS}`);
  const commands = itemCommands(read(tracker.path), tracker, id);
  if (commands.length === 0) throw new Error(`${id} names no command in backticks in its Verification cell`);
  // The types of the changed TypeScript are checked first (K309): the tests transpile without checking them.
  const typeFailure = typeErrorMessage(typeErrors(root, foldersOfChanged(root, changedFiles(root))));
  if (typeFailure) throw new Error(`${id}: ${typeFailure}`);
  for (const command of commands) {
    print(`[plan] ${id}: ${command}`);
    const result = spawnSync('sh', ['-c', command], { cwd: root, stdio: 'inherit' });
    if (result.error) throw new Error(`\`${command}\` of ${id} could not start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`\`${command}\` of ${id} ended with ${result.status === null ? `the signal ${result.signal}` : `exit status ${result.status}`}`);
  }
  return commands;
}

// A trailer line of a commit message, such as Co-Authored-By: Name <mail>, which git reads by its key and is never wrapped.
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: \S/;

/** `body` with each paragraph of prose joined and wrapped at `width`; a paragraph of trailer lines stays as written. */
export function wrapBody(body: string, width: number): string {
  return body.trim().split(/\n\s*\n/).map(paragraph => {
    const lines = paragraph.split('\n');
    if (lines.every(line => TRAILER.test(line))) return lines.join('\n');
    // A Red or No-Red line stays a line of its own wherever it stands; the prose around it wraps (K624, K627).
    const out: string[] = [];
    let prose: string[] = [];
    const flush = () => {
      if (prose.length) out.push(wrapText(prose.join(' '), width));
      prose = [];
    };
    for (const line of lines) {
      if (RED_STATEMENT.test(line.trim())) {
        flush();
        out.push(line.trim());
      } else {
        prose.push(line);
      }
    }
    flush();
    return out.join('\n');
  }).join('\n\n');
}

/** A line that states the red of a row, or why it has none (K624). */
const RED_STATEMENT = /^(?:No-Red|Red(?:-Gate|-Test)?): /;

/** `text` wrapped by words at `width`. */
function wrapText(text: string, width: number): string {
  const wrapped: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      wrapped.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) wrapped.push(line);
  return wrapped.join('\n');
}

/** The commit of an item: its ID, the type and scope of the subject, the subject and the file of the body. */
export type ItemCommit = { id: string; type: string; scope: string; subject: string; bodyFile: string };

/**
 * Commits the index of `root` with the message of `commit` and returns the message; git commit decides what it accepts, such as an
 * empty index. `env` adds to the environment of git commit.
 */
export function commitItem(root: string, commit: ItemCommit, env: NodeJS.ProcessEnv = {}): string {
  // K524: a commit on main holds the lock of land, so it and a land queue instead of one finding the staged change of the other.
  const head = headBranch(root);
  if (head !== 'main') return commitStaged(root, commit, env);
  return withLandLock(root, `the commit of ${commit.id} on main`, 'nothing is committed', () => {
    // K583: the files of the commit, read before it, since every consumer links main live.
    const files = git(root, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    const message = commitStaged(root, commit, env);
    refreshLinked(root, files, text => console.log(`[plan] ${text}`));
    return message;
  });
}

/** The body of commitItem: writes the message and commits the index (K249-4). */
function commitStaged(root: string, commit: ItemCommit, env: NodeJS.ProcessEnv): string {
  const rules = COMMIT_RULES;
  const body = wrapBody(readFileSync(commit.bodyFile, 'utf8'), rules.bodyMax);
  // The red of the row is a line of the body that its author writes, `Red: …` or `No-Red: <reason>` (K624).
  const message = `${commit.type}(${commit.scope}): ${commit.subject} (#${commit.id})\n\n${body}\n`;
  // K603, K1053: a commit runs no gate, build, type check or rule of the message.
  const result = spawnSync('git', ['commit', '--quiet', '-F', '-'], { cwd: root, input: message, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.error) throw new Error(`git commit could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git commit ended ${result.signal ? `on signal ${result.signal}` : `with exit status ${result.status}`}: ${result.stdout}${result.stderr}`);
  return message;
}

/**
 * Registers the item `item` on main in one docs(plan) commit of its own with the body of `bodyFile` (K499-2), so no row is left
 * staged on main. Refuses before it writes anything when the body file is missing or another change is staged; when the commit is
 * refused, the checklists return to HEAD and the error is thrown.
 */
function registerOnMain(root: string, item: Parameters<typeof newItem>[1], bodyFile: string, env: NodeJS.ProcessEnv): void {
  // K524: the rows stay staged while the hooks of the commit run, so the registration holds the lock of land from the first write.
  withLandLock(root, `the registration of ${item.id} on main`, 'nothing is registered', () => registerLocked(root, item, bodyFile, env));
}

/** The body of registerOnMain, run under the lock of land (K524). */
function registerLocked(root: string, item: Parameters<typeof newItem>[1], bodyFile: string, env: NodeJS.ProcessEnv): void {
  const staged = git(root, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
  if (staged.length > 0) throw new Error(`item-new on main commits the registration of ${item.id} alone; these files are staged, commit or unstage them first: ${staged.join(', ')}`);
  const files = Object.keys(newItem(root, item));
  const add = spawnSync('git', ['add', '--', ...files], { cwd: root, encoding: 'utf8' });
  try {
    if (add.status !== 0) throw new Error(`git add of ${files.join(', ')} failed: ${add.stderr.trim()}`);
    commitItem(root, { id: item.id, type: 'docs', scope: 'plan', subject: `Register ${item.id} as an item`, bodyFile }, env);
  } catch (error) {
    const unstage = spawnSync('git', ['reset', '-q', 'HEAD', '--', ...files], { cwd: root, encoding: 'utf8' });
    const restore = unstage.status === 0 ? spawnSync('git', ['checkout', 'HEAD', '--', ...files], { cwd: root, encoding: 'utf8' }) : unstage;
    if (restore.status !== 0) throw new Error(`${error instanceof Error ? error.message : String(error)}\nand the checklists could not return to HEAD: ${restore.stderr.trim()}`, { cause: error });
    throw error;
  }
  for (const file of files) console.log(`[plan] added ${item.id} to ${file}`);
  console.log(`[plan] committed the registration of ${item.id} on main`);
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [command] = process.argv.slice(2);
  const env = process.env;
  try {
    if (command === 'plan-new') {
      for (const file of Object.keys(newPlan(root, { name: required(env.NAME, 'NAME'), title: env.TITLE, titleKo: env.TITLE_KO, pattern: env.NAME_PATTERN || undefined }))) console.log(`[plan] wrote ${file}`);
    } else if (command === 'item-new') {
      const item = { plan: required(env.PLAN, 'PLAN'), id: required(env.ID, 'ID'), task: env.TASK, taskKo: env.TASK_KO, deliverables: env.DELIVERABLES, verification: env.VERIFICATION };
      const branch = headBranch(root);
      if (branch === 'main') registerOnMain(root, item, required(env.BODY_FILE, 'BODY_FILE'), env);
      else for (const file of Object.keys(newItem(root, item))) console.log(`[plan] added ${item.id} to ${file}`);
    } else if (command === 'item-edit') {
      const id = required(env.ID, 'ID');
      // The cause and the retry of a held item are edited apart from the cells of editItem.
      const held = [env.CAUSE, env.RETRY, env.CAUSE_KO, env.RETRY_KO].some(value => value !== undefined);
      if (held && [env.TASK, env.TASK_KO, env.DELIVERABLES, env.VERIFICATION].some(value => value !== undefined)) throw new Error('item-edit takes CAUSE, RETRY, CAUSE_KO and RETRY_KO apart from TASK, TASK_KO, DELIVERABLES and VERIFICATION');
      const files = held
        ? editState(root, { id, cause: env.CAUSE, retry: env.RETRY, causeKo: env.CAUSE_KO, retryKo: env.RETRY_KO })
        : editItem(root, { id, deliverables: env.DELIVERABLES, verification: env.VERIFICATION, task: env.TASK, taskKo: env.TASK_KO, doneStays: env.DONE_STAYS === '1' });
      for (const file of Object.keys(files)) console.log(`[plan] edited ${id} in ${file}`);
    } else if (command === 'item-state') {
      const change = { id: required(env.ID, 'ID'), state: required(env.STATE, 'STATE'), cause: env.CAUSE, retry: env.RETRY, causeKo: env.CAUSE_KO, retryKo: env.RETRY_KO };
      // The state the item already holds writes nothing (K937-1); a move runs no test (K1053), which make item-test runs.
      if (movableItem(root, change).already) console.log(`[plan] ${change.id} is already ${change.state}`);
      for (const file of Object.keys(setState(root, change))) console.log(`[plan] set ${change.id} to ${change.state} in ${file}`);
    } else if (command === 'plan-split') {
      const split = { from: required(env.FROM, 'FROM'), to: required(env.TO, 'TO'), ids: required(env.IDS, 'IDS').split(/\s+/), title: env.TITLE, titleKo: env.TITLE_KO };
      for (const file of Object.keys(splitPlan(root, split))) console.log(`[plan] moved ${split.ids.join(' ')} in ${file}`);
    } else if (command === 'item-test') {
      const id = required(env.ID, 'ID');
      console.log(`[plan] ${id}: ${testItem(root, id).length} commands passed`);
    } else if (command === 'commit') {
      const commit = { id: required(env.ID, 'ID'), type: required(env.TYPE, 'TYPE'), scope: required(env.SCOPE, 'SCOPE'), subject: required(env.SUBJECT, 'SUBJECT'), bodyFile: path.resolve(required(env.BODY_FILE, 'BODY_FILE')) };
      console.log(`[plan] committed ${commitItem(root, commit).split('\n')[0] ?? ''}`);
    } else {
      throw new Error(`unknown command ${JSON.stringify(command)}; expected plan-new, plan-split, item-new, item-edit, item-state, item-test or commit`);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[plan] ${error.message}`);
    process.exit(1);
  }
}
