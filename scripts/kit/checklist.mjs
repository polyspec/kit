// The trackers of a repository: the documents whose items carry a state, declared in config/checklist.json. The push gate
// (push-gate.mjs) and the guard of the full run (full-run.mjs) read the items that are in the active state of each tracker.
//
// A table tracker has one row per item, `| ID | title | ... | state |`; the state is the last cell or the cell `column`.
// A list tracker has one line per item, `- [state] ID text`, indented for a sub-item. A state is the leading `[x]` of
// its cell or item, or the whole cell when the cell does not start with `[`. A tracker that cannot be read is an error
// and never an empty result: the gate refuses a push whose items it cannot read.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './schema-validate.mjs';

export const CONFIG = 'config/checklist.json';
export const PRE_PUSH_HOOK = 'pre-push';

const SCHEMA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema/checklist.schema.json');
const ID = /^[A-Za-z][A-Za-z0-9.-]*$/;
const SEPARATOR_CELL = /^:?-{3,}:?$/;
const LIST_ITEM = /^( *)- (\[[^\]]*\]) (\S+)\s*(.*)$/;

/** The configuration of the checkout `root`; throws with every finding when it breaks the schema or a rule of the tools. */
export function loadConfig(root) {
  const file = path.join(root, CONFIG);
  if (!existsSync(file)) throw new Error(`${CONFIG} does not exist in ${root}; the repository declares its trackers and hooks there`);
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const findings = validate(config, JSON.parse(readFileSync(SCHEMA, 'utf8'))).map(error => `${CONFIG}: ${error}`);
  if (findings.length === 0) {
    if (!config.hooks.includes(PRE_PUSH_HOOK)) findings.push(`${CONFIG}: $.hooks is ${JSON.stringify(config.hooks)}, it must include "${PRE_PUSH_HOOK}", which runs the push gate`);
    const paths = config.trackers.flatMap(tracker => [tracker.path, ...(tracker.translation ? [tracker.translation] : [])]);
    for (const duplicate of paths.filter((item, index) => paths.indexOf(item) !== index)) findings.push(`${CONFIG}: ${duplicate} is declared twice in $.trackers`);
    for (const tracker of config.trackers) {
      if (tracker.states && !tracker.states.includes(tracker.active)) findings.push(`${CONFIG}: $.trackers ${tracker.path} has the active state ${JSON.stringify(tracker.active)}, which is not in its states ${JSON.stringify(tracker.states)}`);
    }
  }
  if (findings.length > 0) throw new Error(findings.join('\n'));
  return config;
}

const stateOf = cell => /^\[[^\]]*\]/.exec(cell)?.[0] ?? cell;
const cellsOf = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim());
const firstSentence = text => /^(.+?\.)(?:\s|$)/.exec(text)?.[1] ?? text.trim();

/** The items of `text` as `{ id, title, state, line }` and the errors that make the text unreadable as `tracker`. */
export function parseTracker(text, tracker) {
  const items = [];
  const errors = [];
  const lines = text.split('\n');
  const add = (item, index) => {
    if (items.some(known => known.id === item.id)) errors.push(`line ${index + 1}: the item ${item.id} is listed twice`);
    if (tracker.states && !tracker.states.includes(item.state)) errors.push(`line ${index + 1}: ${item.id} has the state ${JSON.stringify(item.state)}, the states are ${tracker.states.map(state => JSON.stringify(state)).join(', ')}`);
    items.push({ ...item, line: index + 1 });
  };
  lines.forEach((line, index) => {
    if (tracker.format === 'list') {
      if (!/^ *- \[/.test(line)) return;
      const match = LIST_ITEM.exec(line);
      if (!match || !ID.test(match[3])) {
        errors.push(`line ${index + 1}: ${JSON.stringify(line.trim())} is not an item of the form "- [state] ID text"`);
        return;
      }
      add({ id: match[3], title: firstSentence(match[4]), state: match[2] }, index);
      return;
    }
    if (!line.trim().startsWith('|')) return;
    const cells = cellsOf(line);
    const separator = cells.every(cell => SEPARATOR_CELL.test(cell));
    const header = !separator && SEPARATOR_CELL.test(cellsOf(lines[index + 1] ?? '')[0] ?? '') && (lines[index + 1] ?? '').trim().startsWith('|');
    if (separator || header) return;
    const column = tracker.column ?? cells.length - 1;
    if (!ID.test(cells[0]) || cells.length <= column || column === 0) {
      errors.push(`line ${index + 1}: ${JSON.stringify(line.trim().slice(0, 60))} is not a row with an ID in its first cell and a state in cell ${column + 1}`);
      return;
    }
    add({ id: cells[0], title: cells[1] ?? '', state: stateOf(cells[column]) }, index);
  });
  if (items.length === 0 && errors.length === 0) errors.push('it has no item');
  return { items, errors };
}

/** The items of `text` in the active state of `tracker`; throws with every error when the text cannot be read. */
export function activeItems(text, tracker) {
  const { items, errors } = parseTracker(text, tracker);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return items.filter(item => item.state === tracker.active);
}

/** The differences between a document and its translation: IDs in another order or missing, and states that differ. */
export function compareTwin(english, korean, tracker) {
  const a = parseTracker(english, tracker);
  const b = parseTracker(korean, tracker);
  if (a.errors.length > 0 || b.errors.length > 0) throw new Error([...a.errors.map(e => `${tracker.path}: ${e}`), ...b.errors.map(e => `${tracker.translation}: ${e}`)].join('; '));
  const differences = [];
  const ids = items => items.map(item => item.id).join(' ');
  if (ids(a.items) !== ids(b.items)) {
    const missing = a.items.filter(item => !b.items.some(other => other.id === item.id)).map(item => item.id);
    const extra = b.items.filter(item => !a.items.some(other => other.id === item.id)).map(item => item.id);
    differences.push(`${tracker.translation} lists other items than ${tracker.path}: missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}${missing.length + extra.length === 0 ? ', in another order' : ''}`);
    return differences;
  }
  for (const [index, item] of a.items.entries()) {
    if (item.state !== b.items[index].state) differences.push(`${item.id} is ${item.state} in ${tracker.path} and ${b.items[index].state} in ${tracker.translation}`);
  }
  return differences;
}

/**
 * The state of every tracker as read by `read(file)`, which returns the text of a file or throws why it cannot. Returns
 * `{ active, problems }`: the active items as `{ file, id, title }` and the sentences that name what cannot be read.
 */
export function inspectTrackers(config, read) {
  const active = [];
  const problems = [];
  for (const tracker of config.trackers) {
    let english;
    try {
      english = read(tracker.path);
      for (const item of activeItems(english, tracker)) active.push({ file: tracker.path, id: item.id, title: item.title });
    } catch (error) {
      problems.push(`${tracker.path}: ${error.message}`);
      continue;
    }
    if (!tracker.translation) continue;
    let korean;
    try {
      korean = read(tracker.translation);
    } catch (error) {
      problems.push(`${tracker.translation}: ${error.message}`);
      continue;
    }
    try {
      problems.push(...compareTwin(english, korean, tracker));
    } catch (error) {
      problems.push(error.message);
    }
  }
  return { active, problems };
}

/** The sentence that says which states stop a push and which do not. */
export function blockingSentence(config) {
  return config.trackers.map((tracker) => {
    const others = (tracker.states ?? []).filter(state => state !== tracker.active);
    return `${tracker.path}: only the state ${tracker.active} blocks${others.length > 0 ? `; ${others.join(', ')} do not block` : ''}`;
  }).join('; ');
}
