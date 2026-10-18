// The checklists of a repository: the documents whose items carry a state, declared in config/checklist.json. The push gate
// (push-gate.mts) and the guard of the full run (full-run.mts) read the items that are in the active state of each
// checklist; the document check (check-documents.mts) reads the same checklists strictly. One function, readChecklist,
// reads a checklist at both levels.
//
// A table tracker has one row per item, `| ID | title | ... | state |`; the state is the last cell or the cell `column`.
// A list tracker has one line per item, `- [state] ID text`, indented for a sub-item. A state is the leading `[x]` of
// its cell or item, or the whole cell when the cell does not start with `[`. A tracker that cannot be read is an error
// and never an empty result: the gate refuses a push whose items it cannot read.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { lineBlocks } from './markdown.mts';
import { readConfigFindings } from './schema-validate.mts';
import { present } from './present.mts';

export const CONFIG = 'config/checklist.json';
export const PRE_PUSH_HOOK = 'pre-push';

/** A tracker of config/checklist.json (checklist.schema.json). */
export interface Tracker {
  path: string;
  translation?: string;
  format: 'table' | 'list';
  idPattern?: string;
  column?: number;
  states?: string[];
  active: string;
  done?: string;
}

/** config/checklist.json as checklist.schema.json describes it. */
export interface ChecklistConfig {
  schema: 1;
  hooks: string[];
  trackers: Tracker[];
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

/** A list item with its continuation lines, for the cause and retry of its state. */
interface ListEntry {
  id: string;
  state: string;
  line: number;
  text: string;
  indent: number;
}

const DEFAULT_ID = '[A-Za-z][A-Za-z0-9.-]*';
const LIST_ITEM = /^( *)- (\[[^\]]*\]) (\S+)\s*(.*)$/;

/** The configuration of the checkout `root`; throws with every finding when it breaks the schema or a rule of the tools. */
export function loadConfig(root: string): ChecklistConfig {
  const file = path.join(root, CONFIG);
  if (!existsSync(file)) throw new Error(`${CONFIG} does not exist in ${root}; the repository declares its trackers and hooks there`);
  const { value: config, errors } = readConfigFindings<ChecklistConfig>(root, CONFIG, 'checklist.schema.json');
  if (errors) throw new Error(errors.join('\n'));
  const findings: string[] = [];
  if (!config.hooks.includes(PRE_PUSH_HOOK)) findings.push(`${CONFIG}: $.hooks is ${JSON.stringify(config.hooks)}, it must include "${PRE_PUSH_HOOK}", which runs the push gate`);
  const paths = config.trackers.flatMap(tracker => [tracker.path, ...(tracker.translation ? [tracker.translation] : [])]);
  for (const duplicate of paths.filter((item, index) => paths.indexOf(item) !== index)) findings.push(`${CONFIG}: ${duplicate} is declared twice in $.trackers`);
  for (const tracker of config.trackers) {
    if (tracker.states && !tracker.states.includes(tracker.active)) findings.push(`${CONFIG}: $.trackers ${tracker.path} has the active state ${JSON.stringify(tracker.active)}, which is not in its states ${JSON.stringify(tracker.states)}`);
  }
  if (findings.length > 0) throw new Error(findings.join('\n'));
  return config;
}

const MARKER = /\[[ ~o!xX-]\]/g;
const DOCUMENT_MARKER = /^<!-- (?:doc-id|source-sha256): \S+ -->$/;
const TABLE_BYPASS = /^\[!\] (?:cause|원인): \S.*; (?:retry|재시도): \S.*$/;
const TABLE_IMPOSSIBLE = /^\[-\] (?:cause|원인): \S.*$/;
const BYPASSED = '[!]';
const IMPOSSIBLE = '[-]';
const FIVE_STATES = ['[ ]', '[~]', '[o]', '[!]', '[-]'];
// The first cell of a task row is the task ID, which a code span may follow: `T3.2 \`parallel\``.
const ID_CELL = /^(\S+)(?:\s+`[^`]*`)?$/;

const stateOf = (cell: string): string => /^\[[^\]]*\]/.exec(cell)?.[0] ?? cell;
const firstSentence = (text: string): string => /^(.+?\.)(?:\s|$)/.exec(text)?.[1] ?? text.trim();
const listOf = (words: string[]): string => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`);

/** A finding as one sentence: `line 3: ...` when it has a line. */
export const describeFinding = (finding: ChecklistFinding): string => (finding.line ? `line ${finding.line}: ${finding.message}` : finding.message);

/**
 * Reads the checklist of `text` as the tracker `tracker` declares it (format, idPattern, column, states). Returns
 * `{ items, findings }`: the items as `{ id, title, state, line }` with the state as the document writes it, for example
 * `[o]`, and the findings as `{ line, column, rule, message }`.
 *
 * The lenient reading (the default) is the reading of the push gate and the guard of the full run. It looks only at the
 * items and reports what makes the document unreadable as a tracker: a row or an item that is malformed, a state outside
 * `states`, an ID listed twice and a document without an item.
 *
 * The strict reading (`strict: true`) is the reading of the document check. It reports the same and also that a checklist
 * holds only tasks: a line that is not a heading, a task or a document marker; a state marker that is not the state of a
 * task; a state cell that holds more than its state (a table state is alone in its cell, but `[!]` is followed by
 * `cause: <cause>; retry: <condition>` and `[-]` by `cause: <cause>`); a bypassed list item without `Cause:` and
 * `Retry:`; an impossible list item without `Cause:`. The Korean labels 원인: and 재시도: are accepted. Each finding has
 * a line and a column.
 */
export function readChecklist(text: string, tracker: Tracker, { strict = false }: { strict?: boolean } = {}): { items: ChecklistItem[]; findings: ChecklistFinding[] } {
  const { format, states } = tracker;
  const id = new RegExp(`^(?:${tracker.idPattern ?? DEFAULT_ID})$`);
  const findings: ChecklistFinding[] = [];
  const items: ChecklistItem[] = [];
  const seen = new Map<string, number>();
  const finding = (line: number | undefined, column: number | undefined, rule: string, message: string) => findings.push({ line, column, rule, message });
  // A call without plainMessage runs only in the strict reading, so the lenient reading always has one.
  const both = (line: number, column: number, rule: string, strictMessage: string, plainMessage?: string) => finding(line, column, rule, strict ? strictMessage : present(plainMessage, 'plainMessage'));
  const strictOnly = (...found: Parameters<typeof finding>) => { if (strict) finding(...found); };
  const plainOnly = (line: number, rule: string, message: string) => { if (!strict) finding(line, undefined, rule, message); };
  const expected = states ?? FIVE_STATES;
  const expectedCell = listOf(expected.map(known => (known === BYPASSED ? `${known} cause: <cause>; retry: <condition>` : known === IMPOSSIBLE ? `${known} cause: <cause>` : known)));
  const stateRule = (task: string, number: number, column: number, shown: string, state: string): boolean => {
    if (states && !states.includes(state)) {
      both(number, column, 'checklist-state', `the state of ${task} is ${shown}; expected ${(format === 'table' ? expectedCell : listOf(expected))}`, `${task} has the state ${JSON.stringify(state)}, the states are ${states.map(known => JSON.stringify(known)).join(', ')}`);
      return false;
    }
    return true;
  };
  const add = (number: number, item: Omit<ChecklistItem, 'line'>) => {
    if (seen.has(item.id)) both(number, 1, 'checklist-duplicate', `the task ${item.id} has a second row; the first is on line ${seen.get(item.id)}`, `the item ${item.id} is listed twice`);
    else seen.set(item.id, number);
    items.push({ ...item, line: number });
  };
  const lines = text.replace(/\n$/, '').split('\n');
  // What each line is, as the Markdown tree reads it (markdown.mts): a task is a row of a table or an item of a list, never a
  // line of a fenced block or a paragraph.
  const blocks = lineBlocks(text);
  let current: ListEntry | null = null;
  const lists: ListEntry[] = [];
  lines.forEach((line, index) => {
    const number = index + 1;
    const indent = Math.max(line.search(/\S/), 0);
    let place = -1;
    // lineBlocks reads every line of the text, and lines holds no line after the last.
    const block = present(blocks[index], 'blocks[index]');
    let allowed = block.kind === 'blank' || block.kind === 'heading' || (block.kind === 'html' && DOCUMENT_MARKER.test(line));
    if (format === 'table') {
      const row = block.kind === 'tableRow' ? block.cells : [];
      const first = row[0]?.text.trim() ?? '';
      const task = ID_CELL.exec(first)?.[1];
      if (block.kind === 'tableHeader' || block.kind === 'tableDelimiter') {
        allowed = true;
      } else if (task && id.test(task)) {
        allowed = true;
        const column = tracker.column ?? row.length - 1;
        if (column === 0 || row.length <= column) {
          both(number, indent + 1, 'checklist-state', `the row of ${task} has ${row.length} cells; expected a state cell at position ${column + 1}`, `${JSON.stringify(line.trim().slice(0, 60))} is not a row with an ID in its first cell and a state in cell ${column + 1}`);
        } else {
          // The branch above took a row without the cell column.
          const cell = present(row[column], 'row[column]');
          const state = cell.text.trim();
          place = cell.start + cell.text.search(/\S/);
          if (strict && (!line.trimEnd().endsWith('|') || !state)) {
            finding(number, line.length + 1, 'checklist-state', `the row of ${task} does not end with a state cell; expected a closing | after ${expectedCell}`);
          } else {
            const kept = stateOf(state);
            const alone = !strict || state === kept || (kept === BYPASSED && TABLE_BYPASS.test(state)) || (kept === IMPOSSIBLE && TABLE_IMPOSSIBLE.test(state));
            if (alone) stateRule(task, number, place + 1, JSON.stringify(state), kept);
            else both(number, place + 1, 'checklist-state', `the state of ${task} is ${JSON.stringify(state)}; expected ${expectedCell}`);
            add(number, { id: task, title: row[1]?.text.trim() ?? '', state: kept });
          }
        }
      } else if (row.length > 0) {
        plainOnly(number, 'checklist-state', `${JSON.stringify(line.trim().slice(0, 60))} is not a row with an ID in its first cell and a state in cell ${(tracker.column ?? row.length - 1) + 1}`);
      }
      if (!allowed) {
        const where = row.length ? `the first cell ${JSON.stringify(first)} is not a task ID matching ${tracker.idPattern ?? DEFAULT_ID}` : 'the line is not a heading or a task table row';
        strictOnly(number, indent + 1, 'checklist-line', `${where}; a checklist holds only tasks, so its plan and notes belong in another document`);
      }
    } else {
      const attempt = block.kind === 'listItem' && /^ *- \[/.test(line);
      const match = LIST_ITEM.exec(line);
      // Every group of LIST_ITEM takes part in a match.
      const entry = match && { lead: present(match[1], 'the indentation of a list item'), state: present(match[2], 'the state of a list item'), id: present(match[3], 'the id of a list item'), text: present(match[4], 'the text of a list item') };
      if (attempt && entry && id.test(entry.id)) {
        allowed = true;
        place = entry.lead.length + 2;
        stateRule(entry.id, number, place + 1, entry.state, entry.state);
        add(number, { id: entry.id, title: firstSentence(entry.text), state: entry.state });
        current = { id: entry.id, state: entry.state, line: number, text: line, indent: entry.lead.length };
        lists.push(current);
      } else if (attempt) {
        plainOnly(number, 'checklist-line', `${JSON.stringify(line.trim())} is not an item of the form "- [state] ID text"`);
      } else if (current && (block.kind === 'listContinuation' || (block.kind === 'listItem' && indent > current.indent))) {
        allowed = true;
        current.text += `\n${line}`;
      }
      if (block.kind === 'heading') current = null;
      if (!allowed) strictOnly(number, indent + 1, 'checklist-line', 'the line is not a heading, a task item "- [ ] <ID> text" or the continuation of one; a checklist holds only tasks');
    }
    if (strict) {
      for (const marker of line.matchAll(MARKER)) {
        if (marker.index !== place) finding(number, marker.index + 1, 'checklist-marker', `the state marker ${marker[0]} is not the state of a task; a state marker stands only at the start of ${format === 'table' ? `${tracker.column === undefined ? 'the last' : 'the state'} cell of a task row` : 'a task item'}`);
      }
    }
  });
  // A bypassed list item names its cause and its retry condition on the item or its continuation lines; an impossible one names its cause.
  if (strict) {
    for (const entry of lists.filter(candidate => candidate.state === BYPASSED)) {
      if (!/(?:cause|원인):\s*\S/i.test(entry.text)) finding(entry.line, 1, 'checklist-state', `the bypassed task ${entry.id} names no cause; write "Cause: <cause>" on the item`);
      if (!/(?:retry|재시도):\s*\S/i.test(entry.text)) finding(entry.line, 1, 'checklist-state', `the bypassed task ${entry.id} names no retry condition; write "Retry: <condition>" on the item`);
    }
    for (const entry of lists.filter(candidate => candidate.state === IMPOSSIBLE)) {
      if (!/(?:cause|원인):\s*\S/i.test(entry.text)) finding(entry.line, 1, 'checklist-state', `the impossible task ${entry.id} names no cause; write "Cause: <cause>" on the item`);
    }
  }
  if (items.length === 0 && (strict || findings.length === 0)) {
    if (strict) finding(1, 1, 'checklist-empty', `the checklist has no task whose ID matches ${tracker.idPattern ?? DEFAULT_ID}`);
    else finding(undefined, undefined, 'checklist-empty', 'it has no item');
  }
  return { items, findings };
}

/** The waiting state: an item not yet started. The full run treats it as open, like the active state. */
export const WAITING = '[ ]';

/**
 * The items of `text` in the active state of `tracker`, and with `open` also in the waiting state; throws with every
 * finding when the text cannot be read.
 */
export function activeItems(text: string, tracker: Tracker, { open = false }: { open?: boolean } = {}): ChecklistItem[] {
  const { items, findings } = readChecklist(text, tracker);
  if (findings.length > 0) throw new Error(findings.map(describeFinding).join('; '));
  return items.filter(item => item.state === tracker.active || (open && item.state === WAITING));
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

/** The differences between a document and its translation, read leniently; throws when either cannot be read. */
export function compareTwin(english: string, korean: string, tracker: Tracker): string[] {
  const a = readChecklist(english, tracker);
  const b = readChecklist(korean, tracker);
  if (a.findings.length > 0 || b.findings.length > 0) {
    throw new Error([...a.findings.map(found => `${tracker.path}: ${describeFinding(found)}`), ...b.findings.map(found => `${tracker.translation}: ${describeFinding(found)}`)].join('; '));
  }
  return twinFindings(a.items, b.items, tracker).map(found => found.message);
}

/**
 * The state of every tracker as read by `read(file)`, which returns the text of a file or throws why it cannot. Returns
 * `{ active, problems }`: the active items as `{ file, id, title }` and the sentences that name what cannot be read.
 */
export function inspectTrackers(config: Pick<ChecklistConfig, 'trackers'>, read: (file: string) => string, { open = false }: { open?: boolean } = {}): { active: { file: string; id: string; title: string }[]; problems: string[] } {
  const active: { file: string; id: string; title: string }[] = [];
  const problems: string[] = [];
  for (const tracker of config.trackers) {
    let english;
    try {
      english = read(tracker.path);
      for (const item of activeItems(english, tracker, { open })) active.push({ file: tracker.path, id: item.id, title: item.title });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      problems.push(`${tracker.path}: ${error.message}`);
      continue;
    }
    if (!tracker.translation) continue;
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
  return { active, problems };
}

/** The sentence that says which states stop a push and which do not. */
export function blockingSentence(config: Pick<ChecklistConfig, 'trackers'>): string {
  return config.trackers.map((tracker) => {
    const others = (tracker.states ?? []).filter(state => state !== tracker.active);
    return `${tracker.path}: only the state ${tracker.active} blocks${others.length > 0 ? `; ${others.join(', ')} do not block` : ''}`;
  }).join('; ');
}
