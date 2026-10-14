// Tests of the trackers (scripts/kit/checklist.mts): a table and a list are read through the configuration, the active
// state selects the items that block, an unreadable or inconsistent document is an error, and a translation must hold
// the same IDs and states.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { blockingSentence, compareTwin, describeFinding, inspectTrackers, loadConfig, readChecklist, type Tracker } from '../../scripts/kit/checklist.mts';
import { checkConfig } from '../../scripts/kit/kit-check.mts';
import { parseJson } from '../../scripts/kit/schema-validate.mts';
import type { ChecklistConfig } from '../../scripts/kit/checklist.mts';
import { known } from './known.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture');

/** The items and the findings of the lenient reading, each finding as the sentence that the gate prints. */
function parseTracker(text: string, tracker: Tracker) {
  const { items, findings } = readChecklist(text, tracker);
  return { items, errors: findings.map(describeFinding) };
}

const TABLE: Tracker = { path: 'a.md', translation: 'a.ko.md', format: 'table', states: ['[ ]', '[~]', '[o]', '[!]'], active: '[~]' };
const LIST: Tracker = { path: 'b.md', format: 'list', states: ['[ ]', '[~]', '[o]', '[!]'], active: '[~]' };

const TABLE_TEXT = `# Tasks

Prose with a marker [~] outside a row is not an item.

| ID | Task | Done |
|---|---|---|
| T1 | Write the parser | [o] |
| T1.2 | Print \`a \\| b\` for a union | [~] |
| T1.2-1 | Name the members | [ ] |
| T2 | Remove the old runner | [!] cause: blocked; retry: T1.2 done |
`;

const LIST_TEXT = `# Items

## Group

- [o] T1 Write the parser. More text on the item.
- [~] T2 Print a union. Cause: the output.
  - [~] T2.1 Name the members.
    A continuation line of T2.1 is not an item.
- [ ] T3 Remove the runner.
`;

function checkout(t: TestContext, files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-checklist-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

test('a table is read by its rows: ID, title and the state of the last cell', () => {
  const { items, errors } = parseTracker(TABLE_TEXT, TABLE);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map(({ id, title, state }) => [id, title, state]), [
    ['T1', 'Write the parser', '[o]'],
    ['T1.2', 'Print `a \\| b` for a union', '[~]'],
    ['T1.2-1', 'Name the members', '[ ]'],
    ['T2', 'Remove the old runner', '[!]'],
  ]);
});

test('a list is read by its items, with sub-items and the first sentence as the title', () => {
  const { items, errors } = parseTracker(LIST_TEXT, LIST);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map(({ id, title, state }) => [id, title, state]), [
    ['T1', 'Write the parser.', '[o]'],
    ['T2', 'Print a union.', '[~]'],
    ['T2.1', 'Name the members.', '[~]'],
    ['T3', 'Remove the runner.', '[ ]'],
  ]);
});

test('the items are the rows and list items of the Markdown tree: a row or an item in a fenced example is none (K130)', () => {
  const fence = (body: string) => `\n\`\`\`md\n${body}\n\`\`\`\n`;
  const table = parseTracker(`${TABLE_TEXT}${fence('| ID | Task | Done |\n|---|---|---|\n| T9 | An example row | [~] |')}`, TABLE);
  assert.deepEqual(table.errors, []);
  assert.deepEqual(table.items.map(item => item.id), ['T1', 'T1.2', 'T1.2-1', 'T2']);
  const list = parseTracker(`${LIST_TEXT}${fence('- [~] T9 An example item.')}`, LIST);
  assert.deepEqual(list.errors, []);
  assert.deepEqual(list.items.map(item => item.id), ['T1', 'T2', 'T2.1', 'T3']);
  // The strict reading reports the lines of the fence: a checklist holds only tasks.
  const strict = readChecklist(`${LIST_TEXT}${fence('- [~] T9 An example item.')}`, LIST, { strict: true });
  assert.deepEqual(strict.items.map(item => item.id), ['T1', 'T2', 'T2.1', 'T3']);
  assert.deepEqual(strict.findings.map(({ line, rule }) => [line, rule]), [[11, 'checklist-line'], [12, 'checklist-line'], [12, 'checklist-marker'], [13, 'checklist-line']]);
});

test('the lenient reading ignores the prose of a list document that the strict reading reports', () => {
  const text = `# Items\n\nFree text before the list.\n\n${LIST_TEXT}\nmore free text\n`;
  assert.deepEqual(parseTracker(text, LIST).errors, []);
  const strict = readChecklist(text, { ...LIST, idPattern: 'T[0-9.]+' }, { strict: true });
  assert.deepEqual(strict.findings.map(({ line, rule }) => [line, rule]), [[3, 'checklist-line'], [15, 'checklist-line']]);
  assert.deepEqual(strict.items.map(item => item.id), ['T1', 'T2', 'T2.1', 'T3']);
});

test('a table state may be a cell of another column and any word', () => {
  const features: Tracker = { path: 'f.md', format: 'table', column: 2, active: 'partial' };
  const text = '| ID | Feature | Implementation | Evidence |\n|---|---|---|---|\n| F-A | Parse | implemented | x |\n| F-B | Print | partial | y |\n';
  const { items, errors } = parseTracker(text, features);
  assert.deepEqual(errors, []);
  assert.deepEqual(items.filter(item => item.state === features.active).map(item => item.id), ['F-B']);
});

test('a document that cannot be read as the tracker is an error and never an empty list', () => {
  // Each document below has a finding, so [0] exists.
  const errors = (text: string) => parseTracker(text, TABLE).errors;
  assert.deepEqual(errors('# Tasks\n\nNo table.\n'), ['it has no item']);
  assert.match(known(errors('| ID | Task | Done |\n|---|---|---|\n| T1 | A | [x] |\n')[0], 'errors(…)[0]'), /line 3: T1 has the state "\[x\]", the states are "\[ \]", "\[~\]", "\[o\]", "\[!\]"/);  // the document has a finding.
  assert.match(known(errors('| ID | Task | Done |\n|---|---|---|\n| T1 | A | [o] |\n| T1 | B | [o] |\n')[0], 'errors(…)[0]'), /line 4: the item T1 is listed twice/);  // the document has a finding.
  assert.match(known(errors('| ID | Task | Done |\n|---|---|---|\n| not an id | A | [o] |\n')[0], 'errors(…)[0]'), /line 3: .* is not a row with an ID in its first cell and a state in cell 3/);  // the document has a finding.
  assert.match(known(parseTracker('- [x] T1 Done.\n', LIST).errors[0], 'parseTracker(…, LIST).errors[0]'), /line 1: T1 has the state "\[x\]"/);  // the document has a finding.
  assert.match(known(parseTracker('- [o]T1 Done.\n', LIST).errors[0], 'parseTracker(…, LIST).errors[0]'), /line 1: .* is not an item of the form "- \[state\] ID text"/);  // the document has a finding.
});

test('the impossible state is a state of its own that the lenient reading accepts', () => {
  const states = ['[ ]', '[~]', '[o]', '[!]', '[-]'];
  const list = parseTracker('# Items\n\n- [-] T4 No form fits this grammar. Cause: the shape has no room.\n', { ...LIST, states });
  assert.deepEqual(list.errors, []);
  assert.deepEqual(list.items.map(({ id, state }) => [id, state]), [['T4', '[-]']]);
  const table = parseTracker(`${TABLE_TEXT}| T4 | Impossible | [-] cause: no form fits |\n`, { ...TABLE, states });
  assert.deepEqual(table.errors, []);
  assert.deepEqual(table.items.at(-1), { id: 'T4', title: 'Impossible', state: '[-]', line: 11 });
});

test('the strict reading requires a cause on an impossible list item', () => {
  const states = ['[ ]', '[~]', '[o]', '[!]', '[-]'];
  const list = readChecklist('# Items\n\n- [-] T4 Impossible without a cause.\n', { ...LIST, states }, { strict: true });
  assert.deepEqual(list.findings.map(({ line, rule, message }) => [line, rule, message]), [
    [3, 'checklist-state', 'the impossible task T4 names no cause; write "Cause: <cause>" on the item'],
  ]);
  const table = readChecklist('| ID | Task | Done |\n|---|---|---|\n| T4 | Impossible | [-] |\n', { ...TABLE, states }, { strict: true });
  assert.deepEqual(table.findings, []);
});

test('the strict reading reports a state marker of the impossible state outside a task', () => {
  const strict = readChecklist('# Items\n\n- [o] T1 Done. A note names [-] in its text.\n', LIST, { strict: true });
  assert.deepEqual(strict.findings.map(({ line, column, rule }) => [line, column, rule]), [[3, 29, 'checklist-marker']]);
});

test('a translation must hold the same IDs in the same order and the same states', () => {
  assert.deepEqual(compareTwin(TABLE_TEXT, TABLE_TEXT, TABLE), []);
  const state = TABLE_TEXT.replace('| [~] |', '| [o] |');
  assert.deepEqual(compareTwin(TABLE_TEXT, state, TABLE), ['T1.2 is [~] in a.md and [o] in a.ko.md']);
  const missing = TABLE_TEXT.replace(/\| T2 .*\n/, '');
  assert.deepEqual(compareTwin(TABLE_TEXT, missing, TABLE), ['a.ko.md lists other items than a.md: missing T2, extra none']);
  const order = TABLE_TEXT.replace('| T1 | Write the parser | [o] |\n', '').concat('| T1 | Write the parser | [o] |\n');
  assert.deepEqual(compareTwin(TABLE_TEXT, order, TABLE), ['a.ko.md lists other items than a.md: missing none, extra none, in another order']);
});

test('inspectTrackers names each active item with its file and ID, and each unreadable document', () => {
  const config = { trackers: [TABLE, LIST] };
  const files: Record<string, string> = { 'a.md': TABLE_TEXT, 'a.ko.md': TABLE_TEXT, 'b.md': LIST_TEXT };
  const read = (name: string) => {
    if (!(name in files)) throw new Error('does not exist');
    // The check above throws for a name that files lacks.
    return known(files[name], 'files[name]');
  };
  const found = inspectTrackers(config, read);
  assert.deepEqual(found.problems, []);
  assert.deepEqual(found.active, [
    { file: 'a.md', id: 'T1.2', title: 'Print `a \\| b` for a union' },
    { file: 'b.md', id: 'T2', title: 'Print a union.' },
    { file: 'b.md', id: 'T2.1', title: 'Name the members.' },
  ]);
  delete files['b.md'];
  assert.deepEqual(inspectTrackers(config, read).problems, ['b.md: does not exist']);
  files['a.ko.md'] = TABLE_TEXT.replace('| [~] |', '| [o] |');
  assert.deepEqual(inspectTrackers(config, read).problems, ['T1.2 is [~] in a.md and [o] in a.ko.md', 'b.md: does not exist']);
  delete files['a.ko.md'];
  assert.deepEqual(inspectTrackers({ trackers: [TABLE] }, read).problems, ['a.ko.md: does not exist']);
});

test('the sentence of the blocking state names the other states', () => {
  assert.equal(blockingSentence({ trackers: [TABLE] }), 'a.md: only the state [~] blocks; [ ], [o], [!] do not block');
});

test('loadConfig accepts the configuration of the fixture and names each rule that another breaks', (t) => {
  const good = readFileSync(path.join(FIXTURE, 'config/checklist.json'), 'utf8');
  const root = checkout(t, { 'config/checklist.json': good });
  // The schema requires at least one tracker.
  assert.equal(known(loadConfig(root).trackers[0], 'loadConfig(root).trackers[0]').path, 'docs/plans/execution-checklist.md');
  const write = (value: unknown) => writeFileSync(path.join(root, 'config/checklist.json'), JSON.stringify(value));
  const config = parseJson<ChecklistConfig>(good, 'checklist.schema.json', 'config/checklist.json');
  write({ ...config, hooks: ['commit-msg'] });
  assert.throws(() => loadConfig(root), /\$\.hooks is \["commit-msg"\], it must include "pre-push"/);
  write({ ...config, trackers: [{ ...config.trackers[0], format: 'tree' }] });
  assert.throws(() => loadConfig(root), /\/trackers\/0\/format must be equal to one of the allowed values \{"allowedValues":\["table","list"\]\}, value "tree"/);
  write({ ...config, trackers: [{ ...config.trackers[0], active: '[?]' }] });
  assert.throws(() => loadConfig(root), /the active state "\[\?\]", which is not in its states/);
  write({ ...config, trackers: [config.trackers[0], config.trackers[0]] });
  assert.throws(() => loadConfig(root), /docs\/plans\/execution-checklist\.md is declared twice/);
  rmSync(path.join(root, 'config/checklist.json'));
  assert.throws(() => loadConfig(root), /config\/checklist\.json does not exist/);
});

test('kit-check validates config/checklist.json against its schema', (t) => {
  const root = checkout(t, { 'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], trackers: [{ path: 'a.md', format: 'table', active: '[~]', extra: 1 }] }) });
  mkdirSync(path.join(root, 'scripts/kit/schema'), { recursive: true });
  cpSync(path.join(HERE, '../../scripts/kit/schema/checklist.schema.json'), path.join(root, 'scripts/kit/schema/checklist.schema.json'));
  assert.deepEqual(checkConfig(root), ['config/checklist.json: /trackers/0 must NOT have additional properties {"additionalProperty":"extra"}. Rule: the schema checklist.schema.json of @polyspec/kit']);
});
