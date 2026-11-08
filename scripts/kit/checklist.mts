// The checklists of a repository: each docs/plans/<plan>/checklist.md with its Korean twin checklist.ko.md (K241); kit finds the
// checklists in the files of a tree, and what else a plan folder holds is the repository's own (K1082).
// The commit check (check-commits.mts) reads the states that a commit changes; the document check (check-documents.mts) reads every
// checklist strictly. One function, readChecklist, reads a checklist at both levels.
//
// A checklist is a table with one row per item, `| ID | title | ... | state |`; the state is the last cell and one of the six states
// (waiting, development, verification, done, bypassed and impossible) whose markers config/checklist.json declares, or else the
// markers that the plan utilities write; the header is checked only against the columns that config/checklist.json declares (K1110).
// A state is the leading `[x]` of its cell, or the whole cell when the cell does not start with `[`. A checklist that cannot be read is an error and
// never an empty result: the gate refuses a push whose items it cannot read.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { lineBlocks } from './markdown.mts';
import { parseJson, readConfigFindings } from './schema-validate.mts';
import { present } from './present.mts';
import { git } from './git.mts';

export const CONFIG = 'config/checklist.json';
// The folder of the plans.
export const PLANS = 'docs/plans';
const CHECKLIST_FILE = /^docs\/plans\/([^/]+)\/checklist\.md$/;

/** The columns of the checklist table that the plan utilities write: the ID, the task, what it delivers, the commands that verify it, and its state. */
export const CHECKLIST_COLUMNS = ['ID', 'Task', 'Deliverables', 'Verification', 'State'] as const;

/** The header of a checklist table, with its delimiter row. */
export const CHECKLIST_HEADER = `| ${CHECKLIST_COLUMNS.join(' | ')} |\n|${CHECKLIST_COLUMNS.map(() => '---').join('|')}|\n`;

/** The markers of the six states of an item. */
export type States = { waiting: string; active: string; verifying: string; done: string; bypassed: string; impossible: string };

/** The markers that the plan utilities read and write when config/checklist.json declares none; a repository declares its own there (K1110). */
export const DEFAULT_STATES: States = { waiting: '[ ]', active: '[~]', verifying: '[v]', done: '[o]', bypassed: '[!]', impossible: '[-]' };

/** The markers of the states of the checklist `tracker`. */
export const statesOf = (tracker: Pick<Tracker, 'states'>): States => tracker.states ?? DEFAULT_STATES;

/** The markers of `states` in their order: waiting, active, verifying, done, bypassed, impossible. */
export const stateList = (states: States): string[] => [states.waiting, states.active, states.verifying, states.done, states.bypassed, states.impossible];

/** The place of the column `name` in the rows of the checklist `tracker`: among its declared columns, else those that the plan utilities write; -1 when it has none. */
export const columnOf = (tracker: Pick<Tracker, 'columns'>, name: string): number => (tracker.columns ?? CHECKLIST_COLUMNS).indexOf(name);

/** A checklist of a plan folder: its document, its Korean twin, the pattern of its item IDs and what config/checklist.json declares of its states and columns (K1110). */
export interface Tracker {
  path: string;
  translation: string;
  idPattern: string;
  states?: States;
  columns?: readonly string[];
}

/** config/checklist.json as checklist.schema.json describes it. */
export interface ChecklistConfig {
  hooks: string[];
  idPattern: string;
  states?: States;
  columns?: string[];
}

/** The config text of a committed tree, validated by the checklist schema. */
export function parseConfig(text: string, source = CONFIG): ChecklistConfig {
  return parseJson<ChecklistConfig>(text, 'checklist.schema.json', source);
}

/** An item of a checklist, with the state as the document writes it. */
export interface ChecklistItem {
  id: string;
  title: string;
  state: string;
  line: number;
}

/** A finding of a checklist; a lenient finding may have no line and column. */
export interface ChecklistFinding {
  line?: number | undefined;
  column?: number | undefined;
  rule: string;
  message: string;
}

/** The configuration of the checkout `root`; throws with every finding when it breaks the schema or a rule of the tools. */
export function loadConfig(root: string): ChecklistConfig {
  const file = path.join(root, CONFIG);
  if (!existsSync(file)) throw new Error(`${CONFIG} does not exist in ${root}; the repository declares its hooks and the pattern of its item IDs there`);
  const { value: config, errors } = readConfigFindings<ChecklistConfig>(root, CONFIG, 'checklist.schema.json');
  if (errors) throw new Error(errors.join('\n'));
  return config;
}

/** The paths of the plan files of the working tree of `root`: the tracked ones and those that Git does not ignore yet. */
export const workingPlanFiles = (root: string): string[] => git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', PLANS).split('\n').filter(Boolean);

/** The checklists of the tree whose paths are `files`, sorted: docs/plans/<plan>/checklist.md with its Korean twin. */
export function trackersOf(config: Pick<ChecklistConfig, 'idPattern' | 'states' | 'columns'>, files: Iterable<string>): Tracker[] {
  return [...files].filter(file => CHECKLIST_FILE.test(file)).sort().map(file => ({
    path: file,
    translation: file.replace(/\.md$/, '.ko.md'),
    idPattern: config.idPattern,
    ...(config.states ? { states: config.states } : {}),
    ...(config.columns ? { columns: config.columns } : {}),
  }));
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DOCUMENT_MARKER = /^<!-- (?:doc-id|source-sha256): \S+ -->$/;
// The first cell of a task row is the task ID, which a code span may follow: `T3.2 \`parallel\``.
const ID_CELL = /^(\S+)(?:\s+`[^`]*`)?$/;
// The state cell of a row as the strict reading accepts it.
const expectedCell = (states: States) => `${states.waiting}, ${states.active}, ${states.verifying}, ${states.done}, ${states.bypassed} cause: <cause>; retry: <condition> or ${states.impossible} cause: <cause>`;

const stateOf = (cell: string): string => /^\[[^\]]*\]/.exec(cell)?.[0] ?? cell;

/** A finding as one sentence: `line 3: ...` when it has a line. */
export const describeFinding = (finding: ChecklistFinding): string => (finding.line ? `line ${finding.line}: ${finding.message}` : finding.message);

/**
 * Reads the checklist `text` of `tracker`. Returns `{ items, findings }`: the items as `{ id, title, state, line }` with the
 * state as the document writes it, for example `[o]`, and the findings as `{ line, column, rule, message }`.
 *
 * The lenient reading (the default) is the reading of the push gate and the commit check. It looks only at the items and
 * reports what makes the document unreadable as a checklist: a row that is malformed, a state outside the six, an ID listed
 * twice and a document without an item.
 *
 * The strict reading (`strict: true`) is the reading of the document check. It reports the same and also that a checklist
 * holds only tasks: a line that is not a heading, a task or a document marker; a state marker that is not the state of a
 * task; a state cell that holds more than its state (a state is alone in its cell, but the bypassed marker is followed by
 * `cause: <cause>; retry: <condition>` and the impossible marker by `cause: <cause>`), and, when config/checklist.json declares
 * columns, a table header that differs from them (K1110). The Korean labels of the cause and the retry condition are accepted. Each
 * finding has a line and a column.
 */
export function readChecklist(text: string, tracker: Tracker, { strict = false }: { strict?: boolean } = {}): { items: ChecklistItem[]; findings: ChecklistFinding[] } {
  const id = new RegExp(`^(?:${tracker.idPattern})$`);
  const states = statesOf(tracker);
  const markers = stateList(states);
  const marker = new RegExp(markers.map(escaped).join('|'), 'g');
  const tableBypass = new RegExp(`^${escaped(states.bypassed)} (?:cause|원인): \\S.*; (?:retry|재시도): \\S.*$`);
  const tableImpossible = new RegExp(`^${escaped(states.impossible)} (?:cause|원인): \\S.*$`);
  const expected = expectedCell(states);
  const findings: ChecklistFinding[] = [];
  const items: ChecklistItem[] = [];
  const seen = new Map<string, number>();
  const finding = (line: number | undefined, column: number | undefined, rule: string, message: string) => findings.push({ line, column, rule, message });
  // A call without plainMessage runs only in the strict reading, so the lenient reading always has one.
  const both = (line: number, column: number, rule: string, strictMessage: string, plainMessage?: string) => finding(line, column, rule, strict ? strictMessage : present(plainMessage, 'plainMessage'));
  const strictOnly = (...found: Parameters<typeof finding>) => { if (strict) finding(...found); };
  const plainOnly = (line: number, rule: string, message: string) => { if (!strict) finding(line, undefined, rule, message); };
  const add = (number: number, item: Omit<ChecklistItem, 'line'>) => {
    if (seen.has(item.id)) both(number, 1, 'checklist-duplicate', `the task ${item.id} has a second row; the first is on line ${seen.get(item.id)}`, `the item ${item.id} is listed twice`);
    else seen.set(item.id, number);
    items.push({ ...item, line: number });
  };
  const lines = text.replace(/\n$/, '').split('\n');
  // What each line is, as the Markdown tree reads it (markdown.mts): a task is a row of a table, never a line of a fenced
  // block or a paragraph.
  const blocks = lineBlocks(text);
  lines.forEach((line, index) => {
    const number = index + 1;
    const indent = Math.max(line.search(/\S/), 0);
    let place = -1;
    // lineBlocks reads every line of the text, and lines holds no line after the last.
    const block = present(blocks[index], 'blocks[index]');
    let allowed = block.kind === 'blank' || block.kind === 'heading' || (block.kind === 'html' && DOCUMENT_MARKER.test(line));
    const row = block.kind === 'tableRow' ? block.cells : [];
    // A missing or an extra cell moves the cells that the reading takes by position (K242).
    if (block.kind === 'tableRow') {
      // lineBlocks marks the first row of every table as its header.
      const header = blocks[block.header - 1];
      if (header?.kind !== 'tableHeader') throw new Error(`line ${block.header}, the header of the table of line ${number}, is no table header`);
      if (header.names.length !== row.length) finding(number, indent + 1, 'checklist-cells', `the row has ${row.length} cells; the header of its table on line ${block.header} has ${header.names.length}`);
    }
    const first = row[0]?.text.trim() ?? '';
    const task = ID_CELL.exec(first)?.[1];
    if (block.kind === 'tableHeader' || block.kind === 'tableDelimiter') {
      allowed = true;
      // The columns that the repository declares are the header of its tables, so a reader finds the verification and the state of a
      // row by their place (K249-3); with none declared the header is not judged (K1110).
      if (block.kind === 'tableHeader' && tracker.columns && block.names.join(' | ') !== tracker.columns.join(' | ')) strictOnly(number, indent + 1, 'checklist-header', `the header is | ${block.names.join(' | ')} |; config/checklist.json declares the header | ${tracker.columns.join(' | ')} |`);
    } else if (task && id.test(task)) {
      allowed = true;
      const column = row.length - 1;
      if (column === 0) {
        both(number, indent + 1, 'checklist-state', `the row of ${task} has ${row.length} cells; expected a state cell after the ID`, `${JSON.stringify(line.trim().slice(0, 60))} is not a row with an ID in its first cell and a state in its last cell`);
      } else {
        // A row of more than one cell has a last cell.
        const cell = present(row[column], 'row[column]');
        const state = cell.text.trim();
        place = cell.start + cell.text.search(/\S/);
        if (strict && (!line.trimEnd().endsWith('|') || !state)) {
          finding(number, line.length + 1, 'checklist-state', `the row of ${task} does not end with a state cell; expected a closing | after ${expected}`);
        } else {
          const kept = stateOf(state);
          const alone = !strict || state === kept || (kept === states.bypassed && tableBypass.test(state)) || (kept === states.impossible && tableImpossible.test(state));
          if (!alone) both(number, place + 1, 'checklist-state', `the state of ${task} is ${JSON.stringify(state)}; expected ${expected}`);
          else if (!markers.includes(kept)) both(number, place + 1, 'checklist-state', `the state of ${task} is ${JSON.stringify(state)}; expected ${expected}`, `${task} has the state ${JSON.stringify(kept)}, the states are ${markers.join(', ')}`);
          add(number, { id: task, title: row[1]?.text.trim() ?? '', state: kept });
        }
      }
    } else if (row.length > 0) {
      plainOnly(number, 'checklist-state', `${JSON.stringify(line.trim().slice(0, 60))} is not a row with an ID in its first cell and a state in its last cell`);
    }
    if (!allowed) {
      const where = row.length ? `the first cell ${JSON.stringify(first)} is not a task ID matching ${tracker.idPattern}` : 'the line is not a heading or a task table row';
      strictOnly(number, indent + 1, 'checklist-line', `${where}; a checklist holds only tasks, so its plan and notes belong in plan.md`);
    }
    if (strict) {
      for (const found of line.matchAll(marker)) {
        if (found.index !== place) finding(number, found.index + 1, 'checklist-marker', `the state marker ${found[0]} is not the state of a task; a state marker stands only at the start of the last cell of a task row`);
      }
    }
  });
  if (items.length === 0 && (strict || findings.length === 0)) {
    if (strict) finding(1, 1, 'checklist-empty', `the checklist has no task whose ID matches ${tracker.idPattern}`);
    else finding(undefined, undefined, 'checklist-empty', 'it has no item');
  }
  return { items, findings };
}

/**
 * The findings across the checklists of a repository, each `{ tracker, items }`: an item ID in two checklists, and a sub-item
 * (an ID that ends in -<number> after an ID of the pattern of its tracker, K249-5) whose parent is no item of its checklist.
 */
export function crossFindings(checklists: { tracker: Tracker; items: ChecklistItem[] }[]): { file: string; line: number; message: string }[] {
  const findings: { file: string; line: number; message: string }[] = [];
  const owners = new Map<string, string>();
  for (const { tracker, items } of checklists) {
    const ids = new Set(items.map(item => item.id));
    const isId = (id: string) => new RegExp(`^(?:${tracker.idPattern})$`).test(id);
    for (const item of items) {
      const owner = owners.get(item.id);
      if (owner !== undefined && owner !== tracker.path) findings.push({ file: tracker.path, line: item.line, message: `the item ${item.id} is also an item of ${owner}; an item ID is unique among the checklists of a repository` });
      else owners.set(item.id, tracker.path);
      const parent = /^(.+)-[0-9]+$/.exec(item.id)?.[1];
      if (parent !== undefined && isId(parent) && !ids.has(parent)) findings.push({ file: tracker.path, line: item.line, message: `the sub-item ${item.id} has no parent ${parent} in its checklist; a sub-item follows its item in one plan` });
    }
  }
  return findings;
}

/**
 * The items of `text` in the active state, and with `open` also in the waiting state; throws with every finding when the
 * text cannot be read.
 */
export function activeItems(text: string, tracker: Tracker, { open = false }: { open?: boolean } = {}): ChecklistItem[] {
  const { items, findings } = readChecklist(text, tracker);
  if (findings.length > 0) throw new Error(findings.map(describeFinding).join('; '));
  const states = statesOf(tracker);
  return items.filter(item => item.state === states.active || (open && item.state === states.waiting));
}

/**
 * The differences between the items of a document and of its translation: IDs in another order or missing, and states
 * that differ. A strict difference names the line of the translation and the rule `checklist-pair`.
 */
export function twinFindings(english: ChecklistItem[], korean: ChecklistItem[], tracker: Tracker, { strict = false }: { strict?: boolean } = {}): ChecklistFinding[] {
  const ids = (items: ChecklistItem[]) => items.map(item => item.id).join(' ');
  if (ids(english) !== ids(korean)) {
    if (strict) return [{ rule: 'checklist-pair', message: `the task IDs differ from ${tracker.path}: [${ids(korean)}] and [${ids(english)}]` }];
    const missing = english.filter(item => !korean.some(other => other.id === item.id)).map(item => item.id);
    const extra = korean.filter(item => !english.some(other => other.id === item.id)).map(item => item.id);
    return [{ rule: 'checklist-pair', message: `${tracker.translation} lists other items than ${tracker.path}: missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}${missing.length + extra.length === 0 ? ', in another order' : ''}` }];
  }
  // korean[index] exists: both lists hold the same IDs in the same order.
  return english.flatMap((item, index) => (item.state === present(korean[index], 'korean[index]').state ? [] : [strict
    ? { line: present(korean[index], 'korean[index]').line, column: 1, rule: 'checklist-pair', message: `the state of ${item.id} is ${present(korean[index], 'korean[index]').state}; ${tracker.path} has ${item.state}` }  // korean[index] exists, as above.
    : { rule: 'checklist-pair', message: `${item.id} is ${item.state} in ${tracker.path} and ${present(korean[index], 'korean[index]').state} in ${tracker.translation}` }]));  // korean[index] exists, as above.
}

/** A finding of one file of a checklist. */
export type FileFinding = { file: string; finding: ChecklistFinding };

/**
 * The findings of the checklists of `trackers` as docs-check reads them: the strict reading of each checklist and of its
 * translation that `read` gives (undefined for a missing file, which the pair check reports), the comparison of the twins
 * and the cross check of the item IDs. The plan utilities check the files they would write with it too (K249).
 */
export function checklistsFindings(trackers: readonly Tracker[], read: (file: string) => string | undefined): FileFinding[] {
  const found: FileFinding[] = [];
  const checklists: { tracker: Tracker; items: ChecklistItem[] }[] = [];
  const strictItems = (file: string) => {
    const text = read(file);
    if (text === undefined) return undefined;
    const result = readChecklist(text, tracker(file), { strict: true });
    for (const finding of result.findings) found.push({ file, finding });
    return result.items;
  };
  const byFile = new Map(trackers.flatMap(entry => [[entry.path, entry], [entry.translation, entry]] as const));
  const tracker = (file: string) => present(byFile.get(file), 'byFile.get(file)');
  for (const entry of trackers) {
    const english = strictItems(entry.path);
    strictItems(entry.translation);
    if (english) checklists.push({ tracker: entry, items: english });
  }
  for (const entry of crossFindings(checklists)) found.push({ file: entry.file, finding: { line: entry.line, column: 1, rule: 'checklist-cross', message: entry.message } });
  return found;
}

/** The differences between a document and its translation, read leniently; throws when either cannot be read. */
export function compareTwin(english: string, korean: string, tracker: Tracker): string[] {
  const a = readChecklist(english, tracker);
  const b = readChecklist(korean, tracker);
  if (a.findings.length > 0 || b.findings.length > 0) {
    throw new Error([...a.findings.map(found => `${tracker.path}: ${describeFinding(found)}`), ...b.findings.map(found => `${tracker.translation}: ${describeFinding(found)}`)].join('; '));
  }
  return twinFindings(a.items, b.items, tracker).map(found => found.message);
}

// A line that holds a checklist item: a table row whose last cell starts with a state marker, or a list item whose state
// marker is followed by an ID (a bullet that only names a marker in prose, such as `- [o] never reopened`, is no item).
const itemLine = (markers: readonly string[]) => {
  const marker = `(?:${markers.map(escaped).join('|')})`;
  return new RegExp(`^\\|.*\\| ${marker}[^|]*\\|\\s*$|^ *[-*] ${marker} [A-Z][A-Z0-9]*[-.]?[0-9]`, 'm');
};

/**
 * The documents of `files` (repository paths under docs/, each with its text) that hold a checklist item but are no
 * checklist of a plan folder: a checklist in another place, which the push gate would not read.
 */
export function undeclaredChecklists(trackers: readonly Tracker[], files: { path: string; text: string }[]): string[] {
  const declared = new Set(trackers.flatMap(tracker => [tracker.path, tracker.translation]));
  const line = itemLine([...new Set((trackers.length ? trackers : [{}]).flatMap(tracker => stateList(statesOf(tracker))))]);
  return files.filter(file => file.path.startsWith('docs/') && !declared.has(file.path) && line.test(file.text)).map(file => file.path);
}

/**
 * The state of every checklist of `trackers` as read by `read(file)`, which returns the text of a file or throws why it
 * cannot. Returns `{ active, verification, problems }`: the active items as `{ file, id, title }` and the sentences that name what cannot
 * be read.
 */
export function inspectTrackers(trackers: readonly Tracker[], read: (file: string) => string, { open = false }: { open?: boolean } = {}): { active: { file: string; id: string; title: string }[]; verification: { file: string; id: string; title: string }[]; problems: string[] } {
  const active: { file: string; id: string; title: string }[] = [];
  const verification: { file: string; id: string; title: string }[] = [];
  const problems: string[] = [];
  for (const tracker of trackers) {
    let english;
    try {
      english = read(tracker.path);
      const parsed = readChecklist(english, tracker);
      if (parsed.findings.length > 0) throw new Error(parsed.findings.map(describeFinding).join('; '));
      const states = statesOf(tracker);
      for (const item of parsed.items) {
        if (item.state === states.active || (open && item.state === states.waiting)) active.push({ file: tracker.path, id: item.id, title: item.title });
        if (item.state === states.verifying) verification.push({ file: tracker.path, id: item.id, title: item.title });
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      problems.push(`${tracker.path}: ${error.message}`);
      continue;
    }
    let korean;
    try {
      korean = read(tracker.translation);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      problems.push(`${tracker.translation}: ${error.message}`);
      continue;
    }
    try {
      problems.push(...compareTwin(english, korean, tracker));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      problems.push(error.message);
    }
  }
  return { active, verification, problems };
}
