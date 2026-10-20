#!/usr/bin/env node
// The utilities that write plans and checklist rows (K249). Each computes the files it would write and writes them only when
// they pass the checks that docs-check and the Git hooks run on them, so its output never fails those checks:
//
//   plan-new   NAME=<slug> TITLE=<English title> TITLE_KO=<Korean title>
//              writes docs/plans/<slug>/ with plan.md, checklist.md and their Korean twins: the doc-id, the language link,
//              the header of the checklist table and the revision marker of each Korean file
//   item-new   PLAN=<slug> ID=<id> TASK= TASK_KO= DELIVERABLES= VERIFICATION=
//              adds the row of the item in the waiting state to the checklist of the plan and to its Korean twin: a sub-item
//              (an ID that ends in -<n>) after the last sub-item of its parent, another item at the end of the last table
//   item-state ID=<id> STATE=<state> [CAUSE= RETRY= CAUSE_KO= RETRY_KO=]
//              moves the item to STATE in both languages along an allowed transition; the done state needs a line with
//              (<id>) that the working tree adds to each changelog of the commit rules, the bypassed state a cause and a
//              retry condition, the impossible state a cause; it refuses what the commit-msg hook would refuse
//   item-test  ID=<id>
//              runs each command of the Verification cell of the item in order, in the root, and fails on the first that
//              fails or that the Claude Code hook refuses (verification.mts)
//   commit     ID=<id> TYPE=<type> SCOPE=<scope> SUBJECT=<subject> BODY_FILE=<file>
//              commits the index with the message type(scope): Subject (#id), a blank line and the body of the file, its
//              paragraphs wrapped at the width of the commit rules and its trailer lines kept; it refuses what the
//              commit-msg hook would refuse, and git commit runs the hooks again
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
import { ACTIVE, BYPASSED, CHECKLIST_HEADER, checklistsFindings, describeFinding, DONE, IMPOSSIBLE, loadConfig, PLANS, planFindings, readChecklist, STATES, trackersOf, WAITING, workingPlanFiles } from './checklist.mts';
import { changedLineNumbers, changesATest, COMMIT_RULES, fileAt, indexItemFindings, messageFindings, nextIdentityFindings, workingItemFindings } from './check-commits.mts';
import { git } from './git.mts';
import { refusal } from './claude-hook.mts';
import { makeDatabase, type MakeDatabase } from './owner-check.mts';
import { itemCommands, verificationFindings } from './verification.mts';
import { isFile } from './test-selection.mts';
import { recordRed, redGateLines } from './gate-red.mts';
import { spawnSync } from 'node:child_process';
import { changedFiles, foldersOfChanged, typeErrorMessage, typeErrors } from './ts-typecheck.mts';
import type { FileFinding, Tracker } from './checklist.mts';
import { lineBlocks } from './markdown.mts';
import { stamped } from './documents-stamp.mts';
import { privatePaths, stagedTwinFindings } from './check-documents.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { present } from './present.mts';

const SLUG = /^[a-z][a-z0-9-]*$/;


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
 * nothing, when `name` is no slug, the plan exists, a title is empty, or the plan folders would fail planFindings.
 */
export function newPlan(root: string, { name, title, titleKo }: { name: string; title: string | undefined; titleKo: string | undefined }): Record<string, string> {
  if (!SLUG.test(name)) throw new Error(`the name ${JSON.stringify(name)} is no slug; a plan is named by [a-z][a-z0-9-]*`);
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
  const findings = planFindings([...workingPlanFiles(root), ...Object.keys(files)]);
  if (findings.length) throw new Error(findings.map(finding => `${finding.file}: ${finding.message}`).join('\n'));
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

/** The new row of an item. */
export type NewItem = { plan: string; id: string; task: string | undefined; taskKo: string | undefined; deliverables: string | undefined; verification: string | undefined };

/**
 * Adds the waiting row of `item` to the checklist of its plan and to the Korean twin, and returns the two files as
 * { path: text }. Throws, writing nothing, when the plan has no checklist, the ID does not match the pattern, a text is empty
 * or holds a line break, or the checklists with the row fail the checks of docs-check (an ID of two checklists, a
 * sub-item without its parent).
 */
export function newItem(root: string, item: NewItem): Record<string, string> {
  const config = loadConfig(root);
  const trackers = trackersOf(config, workingPlanFiles(root));
  const file = `${PLANS}/${item.plan}/checklist.md`;
  const tracker = trackers.find(entry => entry.path === file);
  if (!tracker) throw new Error(`${file} is no checklist; make plan-new NAME=${item.plan} writes the plan`);
  if (!new RegExp(`^(?:${config.idPattern})$`).test(item.id)) throw new Error(`the ID ${JSON.stringify(item.id)} does not match ${config.idPattern}, the pattern of config/checklist.json`);
  const tail = ` | ${cell(item.deliverables, 'DELIVERABLES')} | ${cell(item.verification, 'VERIFICATION')} | ${WAITING} |`;
  const english = `| ${item.id} | ${cell(item.task, 'TASK')}${tail}`;
  const korean = `| ${item.id} | ${cell(item.taskKo, 'TASK_KO')}${tail}`;
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const files = restamped(root, {
    [tracker.path]: inserted(read(tracker.path), item.id, english),
    [tracker.translation]: inserted(read(tracker.translation), item.id, korean),
  });
  refuseAdded(root, trackers, files);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return files;
}

/**
 * Replaces the Verification cell of the row of the item `id` in the checklist and in its Korean twin (K353), or its Task cells, the
 * English `task` and the Korean `taskKo` together (K373), through the checks of newItem; returns the two files as { path: text }.
 * Throws, writing nothing, for an item that is no row, the Verification of a done item (an item that is done stays), a Task without
 * its Korean twin and a cell that fails the checks of docs-check. The Task of a done item is corrected, since its words are no state.
 */
export function editItem(root: string, { id, verification, task, taskKo }: { id: string; verification?: string | undefined; task?: string | undefined; taskKo?: string | undefined }): Record<string, string> {
  if ((task === undefined) !== (taskKo === undefined)) throw new Error('item-edit takes TASK and TASK_KO together: the Korean twin holds the same information');
  // Without a Task the Verification is edited, and an empty one is refused by its cell.
  const editsVerification = verification !== undefined || task === undefined;
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const tracker = trackers.find(entry => readChecklist(read(entry.path), entry).items.some(item => item.id === id));
  if (!tracker) throw new Error(`${id} is no item of a checklist of ${PLANS}`);
  const replaced = (text: string, taskText: string | undefined, taskName: string) => {
    const lines = text.split('\n');
    const index = lines.findIndex(line => line.startsWith(`| ${id} |`));
    const cells = (lines[index] ?? '').replace(/^\| /, '').replace(/ \|$/, '').split(' | ');
    if (cells.length !== 5) throw new Error(`the row of ${id} holds ${cells.length} cells, not the 5 of a checklist row`);
    if (editsVerification) {
      if (cells[4]?.startsWith(DONE)) throw new Error(`${id} is ${DONE}; from ${DONE} an item stays; a new finding is an item of its own`);
      cells[3] = cell(verification, 'VERIFICATION');
    }
    if (taskText !== undefined) cells[1] = cell(taskText, taskName);
    lines[index] = `| ${cells.join(' | ')} |`;
    return lines.join('\n');
  };
  const files = restamped(root, { [tracker.path]: replaced(read(tracker.path), task, 'TASK'), [tracker.translation]: replaced(read(tracker.translation), taskKo, 'TASK_KO') });
  refuseAdded(root, trackers, files);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return files;
}

/**
 * Throws with the findings that writing `files` ({ path: text }) would add to the checklists of `trackers`, as docs-check
 * reads them. A finding that the checkout has already, such as an empty checklist of another plan, is the work of another
 * change; a finding is the same when its file, rule and message are, since an inserted row moves the lines.
 */
function refuseAdded(root: string, trackers: Tracker[], files: Record<string, string>): void {
  const current = (name: string) => (existsSync(path.join(root, name)) ? readFileSync(path.join(root, name), 'utf8') : undefined);
  const key = ({ file, finding }: FileFinding) => `${file}\0${finding.rule}\0${finding.message}`;
  let database: MakeDatabase | undefined;
  const make = () => (database ??= makeDatabase(root));
  // A path into a home directory is refused as docs-check refuses it (K373).
  const privates = (read: (name: string) => string | undefined): FileFinding[] => trackers.flatMap(tracker => [tracker.path, tracker.translation]).flatMap((file) => {
    const text = read(file);
    return text === undefined ? [] : privatePaths(text).map(finding => ({ file, finding }));
  });
  const findings = (read: (name: string) => string | undefined) => [...checklistsFindings(trackers, read), ...verificationFindings(trackers, read, make), ...privates(read)];
  const before = new Set(findings(current).map(key));
  const added = findings(name => files[name] ?? current(name)).filter(entry => !before.has(key(entry)));
  if (added.length) throw new Error(added.map(({ file, finding }) => `${file}: ${describeFinding(finding)}`).join('\n'));
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
    refuseAdded(root, trackers, files);
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
    return files;
  } catch (error) {
    if (created) rmSync(path.join(root, PLANS, to), { recursive: true, force: true });
    throw error;
  }
}

// The states that an item in each state may move to: work starts, ends done, bypassed or impossible, or stops; a bypass
// resumes. A done or an impossible item stays; a new finding on it is an item of its own (a derived ID).
const TRANSITIONS: Record<string, readonly string[]> = {
  [WAITING]: [ACTIVE, IMPOSSIBLE],
  [ACTIVE]: [DONE, BYPASSED, IMPOSSIBLE, WAITING],
  [BYPASSED]: [ACTIVE],
  [DONE]: [],
  [IMPOSSIBLE]: [],
};

/** The new state of an item, with the texts that its cell needs in the bypassed and the impossible state. */
export type NewState = { id: string; state: string; cause?: string | undefined; retry?: string | undefined; causeKo?: string | undefined; retryKo?: string | undefined };

/** The state cells of `change` in English and Korean. */
// A cause that closes an item without a fix (K315): a release, a failure that is not reproduced, a flake, a transient failure, an
// unrelated one or the environment explains nothing, so the item stays open until its cause is found.
const EVASIVE_CAUSE = /\b(?:releas(?:e|ed|es)|not reproducible|cannot reproduce|can't reproduce|flak(?:e|y|iness)|transient|unrelated|environment(?:al)?)\b/i;

function stateCells({ state, cause, retry, causeKo, retryKo }: NewState): [string, string] {
  for (const [name, text] of [['CAUSE', cause], ['RETRY', retry], ['CAUSE_KO', causeKo], ['RETRY_KO', retryKo]] as const) {
    const evasive = text === undefined ? undefined : EVASIVE_CAUSE.exec(text)?.[0];
    if (evasive !== undefined && (state === BYPASSED || state === IMPOSSIBLE)) throw new Error(`${name} cites "${evasive}"; a release, a failure that is not reproduced, a flake, a transient or unrelated failure and the environment are no cause that closes an item. Find the cause and fix it, or name the defect that blocks it`);
  }
  if (state === BYPASSED) return [`${state} cause: ${cell(cause, 'CAUSE')}; retry: ${cell(retry, 'RETRY')}`, `${state} 원인: ${cell(causeKo, 'CAUSE_KO')}; 재시도: ${cell(retryKo, 'RETRY_KO')}`];
  if (state === IMPOSSIBLE) return [`${state} cause: ${cell(cause, 'CAUSE')}`, `${state} 원인: ${cell(causeKo, 'CAUSE_KO')}`];
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
 * Moves the item `change.id` to `change.state` in its checklist and the Korean twin and returns the two files as
 * { path: text }. Throws, writing nothing, on a state that is none of the five, a transition that TRANSITIONS does not allow,
 * the done state without a line with (<id>) that the working tree adds to each changelog of the commit rules, a missing
 * cause or retry condition, and what the commit-msg hook would refuse: a second item whose state differs from HEAD.
 */
export function setState(root: string, change: NewState, print: (text: string) => void = text => console.log(text)): Record<string, string> {
  if (!(STATES as readonly string[]).includes(change.state)) throw new Error(`the state ${JSON.stringify(change.state)} is none of ${STATES.join(', ')}`);
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const found = trackers.flatMap(tracker => readChecklist(read(tracker.path), tracker).items.filter(item => item.id === change.id).map(item => ({ tracker, item })));
  const [entry] = found;
  if (!entry) throw new Error(`${change.id} is no item of a checklist of ${PLANS}`);
  const allowed = present(TRANSITIONS[entry.item.state], 'TRANSITIONS[state]');
  if (!allowed.includes(change.state)) {
    const next = allowed.length ? `an item moves to ${allowed.join(', ').replace(/, ([^,]*)$/, ' or $1')}` : 'an item stays; a new finding is an item of its own';
    throw new Error(`${change.id} is ${entry.item.state}; from ${entry.item.state} ${next}`);
  }
  const rules = COMMIT_RULES;
  if (change.state === DONE) {
    const changelogs = rules.changelog ? [rules.changelog.path, ...(rules.changelog.translation ? [rules.changelog.translation] : [])] : [];
    if (changelogs.length === 0) throw new Error('the commit rules declare no changelog; the done state needs the entry of the item in it');
    const count = (text: string) => text.split('\n').filter(line => line.includes(`(${change.id})`)).length;
    for (const file of changelogs) {
      if (count(existsSync(path.join(root, file)) ? read(file) : '') <= count(fileAt(root, 'HEAD', file))) throw new Error(`${file} adds no line with (${change.id}) to HEAD; record the item in the changelog of both languages first`);
    }
  }
  const [english, korean] = stateCells(change);
  const files = restamped(root, {
    [entry.tracker.path]: withState(read(entry.tracker.path), change.id, english),
    [entry.tracker.translation]: withState(read(entry.tracker.translation), change.id, korean),
  });
  refuseAdded(root, trackers, files);
  const refused = workingItemFindings(root, rules, files);
  if (refused.length) throw new Error(refused.map(finding => finding.message).join('\n'));
  // An item that becomes active records the red of the gates that its Verification runs, on the parent of its commit (K357).
  if (change.state === ACTIVE) recordRed(root, change.id, itemCommands(read(entry.tracker.path), entry.tracker, change.id), print);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  return files;
}

/**
 * Runs each command of the Verification cell of the item `id` in order, in `root`, with its output on this process, and
 * returns them. Throws on an item that names no command, a command that the Claude Code hook refuses, and the first command
 * that fails, naming it and its status.
 */
export function testItem(root: string, id: string, print: (text: string) => void = text => console.log(text)): string[] {
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
  const tracker = trackers.find(entry => readChecklist(read(entry.path), entry).items.some(item => item.id === id));
  if (!tracker) throw new Error(`${id} is no item of a checklist of ${PLANS}`);
  const commands = itemCommands(read(tracker.path), tracker, id);
  if (commands.length === 0) throw new Error(`${id} names no command in backticks in its Verification cell`);
  let database: MakeDatabase | undefined;
  for (const command of commands) {
    // The command runs in the root, so a file that it names is judged from there (K353-2).
    const refused = refusal(command, file => isFile(path.resolve(root, file)), () => (database ??= makeDatabase(root)));
    if (refused) throw new Error(`the command \`${command}\` of ${id} is refused by the Claude Code hook: ${refused}`);
  }
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

/** The cells of the row of the item `id` in the checklist text `text`, or undefined. */
function rowCells(text: string, id: string): string[] | undefined {
  const line = text.split('\n').find(row => row.startsWith(`| ${id} |`));
  return line?.split(' | ').map(cell => cell.replace(/^\| /, '').replace(/ \|$/, ''));
}

/**
 * The checks before an item is marked done by the command (K335): the files it delivers have no change that is neither staged nor
 * committed, so the verification below runs on the tree that the commit holds, and the commands of its Verification cell pass
 * (testItem). Throws with the cause; an agent's word that the tests passed closes nothing.
 */
export function verifyDone(root: string, id: string, print: (text: string) => void = text => console.log(text)): void {
  const trackers = trackersOf(loadConfig(root), workingPlanFiles(root));
  const tracker = trackers.find(entry => readChecklist(readFileSync(path.join(root, entry.path), 'utf8'), entry).items.some(item => item.id === id));
  if (!tracker) throw new Error(`${id} is no item of a checklist of ${PLANS}`);
  // The transition is checked first (K353-1): a waiting row goes through the active state, which staging the files would not tell.
  const state = readChecklist(readFileSync(path.join(root, tracker.path), 'utf8'), tracker).items.find(item => item.id === id)?.state ?? '';
  const allowed = present(TRANSITIONS[state], 'TRANSITIONS[state]');
  if (!allowed.includes(DONE)) throw new Error(`${id} is ${state}; from ${state} ${allowed.length ? `an item moves to ${allowed.join(', ').replace(/, ([^,]*)$/, ' or $1')}` : 'an item stays; a new finding is an item of its own'}`);
  const cells = rowCells(readFileSync(path.join(root, tracker.path), 'utf8'), id);
  const delivered = (cells?.[2] ?? '').split(/[\s,]+/).map(token => token.replace(/^`|`$/g, '')).filter(token => token !== '' && existsSync(path.join(root, token)));
  if (delivered.length > 0) {
    const status = spawnSync('git', ['status', '--porcelain', '-uall', '--', ...delivered], { cwd: root, encoding: 'utf8' });
    if (status.status !== 0) throw new Error(`git status ended with exit status ${status.status}: ${status.stderr}`);
    const loose = status.stdout.split('\n').filter(line => line !== '' && (line.startsWith('??') || line[1] !== ' '));
    if (loose.length > 0) throw new Error(`${id}: the verification must run on the tree that the commit holds; stage or commit these files first:\n${loose.join('\n')}`);
  }
  testItem(root, id, print);
}

// A trailer line of a commit message, such as Co-Authored-By: Name <mail>, which git reads by its key and is never wrapped.
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: \S/;

/** `body` with each paragraph of prose joined and wrapped at `width`; a paragraph of trailer lines stays as written. */
export function wrapBody(body: string, width: number): string {
  return body.trim().split(/\n\s*\n/).map(paragraph => {
    const lines = paragraph.split('\n');
    if (lines.every(line => TRAILER.test(line))) return lines.join('\n');
    const wrapped: string[] = [];
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        wrapped.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) wrapped.push(line);
    return wrapped.join('\n');
  }).join('\n\n');
}

/** The commit of an item: its ID, the type and scope of the subject, the subject and the file of the body. */
export type ItemCommit = { id: string; type: string; scope: string; subject: string; bodyFile: string };

/**
 * Commits the index of `root` with the message of `commit` and returns the message. Throws, committing nothing, when nothing
 * is staged, the body file is missing or empty, or the message or the change fails what the commit-msg hook checks
 * (messageFindings and indexItemFindings of check-commits.mts). `env` adds to the environment of git commit.
 */
export function commitItem(root: string, commit: ItemCommit, env: NodeJS.ProcessEnv = {}): string {
  if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root }).status === 0) throw new Error('nothing is staged; stage the change of the item with git add first');
  if (!existsSync(commit.bodyFile)) throw new Error(`the body file ${commit.bodyFile} does not exist; write why the change is made there`);
  const rules = COMMIT_RULES;
  const body = wrapBody(readFileSync(commit.bodyFile, 'utf8'), rules.bodyMax);
  if (!body) throw new Error(`the body file ${commit.bodyFile} is empty; write why the change is made there`);
  // A fix without a test carries the red of its gate that make item-state recorded on HEAD (K357); a Rust unit test is a test (K370).
  const cached = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const tested = cached.some(file => changesATest(file, entry => fileAt(root, '', entry), entry => changedLineNumbers(git(root, 'diff', '--cached', '-U0', '--', entry))));
  const red = commit.type === 'fix' && !tested ? redGateLines(root, commit.id) : [];
  const message = `${commit.type}(${commit.scope}): ${commit.subject} (#${commit.id})\n\n${body}\n${red.length ? `\n${red.join('\n')}\n` : ''}`;
  // A staged Korean twin with a stale source-sha256 is refused as the pre-commit check refuses it (K382).
  const twins = stagedTwinFindings(root);
  if (twins.length) throw new Error(twins.join('\n'));
  const findings = [...messageFindings(message, rules), ...nextIdentityFindings(root), ...indexItemFindings(root, rules, message)];
  if (findings.length) throw new Error(findings.map(finding => finding.message).join('\n'));
  // The types of the TypeScript that the commit changes (K309): vitest and node transpile without checking them, so tsc runs here.
  const staged = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const typeFailure = typeErrorMessage(typeErrors(root, foldersOfChanged(root, staged)));
  if (typeFailure) throw new Error(typeFailure);
  const result = spawnSync('git', ['commit', '--quiet', '-F', '-'], { cwd: root, input: message, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.error) throw new Error(`git commit could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git commit ended with exit status ${result.status}: ${result.stdout}${result.stderr}`);
  return message;
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [command] = process.argv.slice(2);
  const env = process.env;
  try {
    if (command === 'plan-new') {
      for (const file of Object.keys(newPlan(root, { name: required(env.NAME, 'NAME'), title: env.TITLE, titleKo: env.TITLE_KO }))) console.log(`[plan] wrote ${file}`);
    } else if (command === 'item-new') {
      const item = { plan: required(env.PLAN, 'PLAN'), id: required(env.ID, 'ID'), task: env.TASK, taskKo: env.TASK_KO, deliverables: env.DELIVERABLES, verification: env.VERIFICATION };
      for (const file of Object.keys(newItem(root, item))) console.log(`[plan] added ${item.id} to ${file}`);
    } else if (command === 'item-edit') {
      const id = required(env.ID, 'ID');
      for (const file of Object.keys(editItem(root, { id, verification: env.VERIFICATION, task: env.TASK, taskKo: env.TASK_KO }))) console.log(`[plan] edited ${id} in ${file}`);
    } else if (command === 'item-state') {
      const change = { id: required(env.ID, 'ID'), state: required(env.STATE, 'STATE'), cause: env.CAUSE, retry: env.RETRY, causeKo: env.CAUSE_KO, retryKo: env.RETRY_KO };
      // The done state needs the verification of the row to pass on the tree of the commit (K335).
      if (change.state === DONE) verifyDone(root, change.id);
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
