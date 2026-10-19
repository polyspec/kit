// Tests of the checklists (scripts/kit/checklist.mts): kit finds them in the plan folders (K241), reads each as a table with
// the five states, the active state selects the items that block, an unreadable or inconsistent document is an error, a
// translation must hold the same IDs and states, and an item ID is unique among the checklists of a repository.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BLOCKING, compareTwin, crossFindings, describeFinding, inspectTrackers, loadConfig, planFindings, readChecklist, trackersOf, undeclaredChecklists, type Tracker } from '../../scripts/kit/checklist.mts';
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

const TABLE: Tracker = { path: 'a.md', translation: 'a.ko.md', idPattern: 'T[0-9]+(?:[.-][0-9]+)*' };

const TABLE_TEXT = `# Tasks

Prose with a marker [~] outside a row is not an item.

| ID | Task | Done |
|---|---|---|
| T1 | Write the parser | [o] |
| T1.2 | Print \`a \\| b\` for a union | [~] |
| T1.2-1 | Name the members | [ ] |
| T2 | Remove the old runner | [!] cause: blocked; retry: T1.2 done |
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

test('the items are the rows of the Markdown tree: a row in a fenced example is none (K130)', () => {
  const fence = (body: string) => `\n\`\`\`md\n${body}\n\`\`\`\n`;
  const table = parseTracker(`${TABLE_TEXT}${fence('| ID | Task | Done |\n|---|---|---|\n| T9 | An example row | [~] |')}`, TABLE);
  assert.deepEqual(table.errors, []);
  assert.deepEqual(table.items.map(item => item.id), ['T1', 'T1.2', 'T1.2-1', 'T2']);
  // The strict reading reports the lines of the fence: a checklist holds only tasks.
  const strict = readChecklist(`| ID | Task | Done |\n|---|---|---|\n| T1 | A | [o] |\n${fence('| T9 | An example row | [~] |')}`, TABLE, { strict: true });
  assert.deepEqual(strict.items.map(item => item.id), ['T1']);
  assert.deepEqual(strict.findings.map(({ line, rule }) => [line, rule]), [[5, 'checklist-line'], [6, 'checklist-line'], [6, 'checklist-marker'], [7, 'checklist-line']]);
});

test('the lenient reading ignores the prose of a checklist that the strict reading reports', () => {
  const text = `# Items\n\nFree text before the table.\n\n| ID | Task | Done |\n|---|---|---|\n| T1 | A | [o] |\n\nmore free text\n`;
  assert.deepEqual(parseTracker(text, TABLE).errors, []);
  const strict = readChecklist(text, TABLE, { strict: true });
  assert.deepEqual(strict.findings.map(({ line, rule }) => [line, rule]), [[3, 'checklist-line'], [9, 'checklist-line']]);
  assert.deepEqual(strict.items.map(item => item.id), ['T1']);
});

test('a document that cannot be read as the tracker is an error and never an empty list', () => {
  // Each document below has a finding, so [0] exists.
  const errors = (text: string) => parseTracker(text, TABLE).errors;
  assert.deepEqual(errors('# Tasks\n\nNo table.\n'), ['it has no item']);
  assert.match(known(errors('| ID | Task | Done |\n|---|---|---|\n| T1 | A | [x] |\n')[0], 'errors(…)[0]'), /line 3: T1 has the state "\[x\]", the states are \[ \], \[~\], \[o\], \[!\], \[-\]/);  // the document has a finding.
  assert.match(known(errors('| ID | Task | Done |\n|---|---|---|\n| T1 | A | [o] |\n| T1 | B | [o] |\n')[0], 'errors(…)[0]'), /line 4: the item T1 is listed twice/);  // the document has a finding.
  assert.match(known(errors('| ID | Task | Done |\n|---|---|---|\n| not an id | A | [o] |\n')[0], 'errors(…)[0]'), /line 3: .* is not a row with an ID in its first cell and a state in its last cell/);  // the document has a finding.
});

test('the impossible state is a state of its own that the lenient reading accepts', () => {
  const table = parseTracker(`${TABLE_TEXT}| T4 | Impossible | [-] cause: no form fits |\n`, TABLE);
  assert.deepEqual(table.errors, []);
  assert.deepEqual(table.items.at(-1), { id: 'T4', title: 'Impossible', state: '[-]', line: 11 });
});

test('a row whose number of cells differs from the header of its table fails with the line and both counts (K242)', () => {
  // A missing or an extra cell moves the cells that the reading takes by position, such as the state in the last cell.
  const text = '| ID | Task | Done |\n|---|---|---|\n| T1 | A | [o] |\n| T2 | [ ] |\n| T3 | B | C | [ ] |\n';
  for (const strict of [false, true]) {
    const { findings } = readChecklist(text, TABLE, { strict });
    assert.deepEqual(findings.filter(finding => finding.rule === 'checklist-cells').map(({ line, message }) => [line, message]), [
      [4, 'the row has 2 cells; the header of its table on line 1 has 3'],
      [5, 'the row has 4 cells; the header of its table on line 1 has 3'],
    ], `strict: ${strict}`);
  }
});

test('the strict reading reports a state marker of the impossible state outside a task', () => {
  const strict = readChecklist('| ID | Task | Done |\n|---|---|---|\n| T1 | Done; a note names [-] | [o] |\n', TABLE, { strict: true });
  assert.deepEqual(strict.findings.map(({ line, column, rule }) => [line, column, rule]), [[3, 27, 'checklist-marker']]);
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
  const other: Tracker = { path: 'b.md', translation: 'b.ko.md', idPattern: TABLE.idPattern };
  const trackers = [TABLE, other];
  const second = '| ID | Task | Done |\n|---|---|---|\n| T5 | Print a union | [~] |\n';
  const files: Record<string, string> = { 'a.md': TABLE_TEXT, 'a.ko.md': TABLE_TEXT, 'b.md': second, 'b.ko.md': second };
  const read = (name: string) => {
    if (!(name in files)) throw new Error('does not exist');
    // The check above throws for a name that files lacks.
    return known(files[name], 'files[name]');
  };
  const found = inspectTrackers(trackers, read);
  assert.deepEqual(found.problems, []);
  assert.deepEqual(found.active, [
    { file: 'a.md', id: 'T1.2', title: 'Print `a \\| b` for a union' },
    { file: 'b.md', id: 'T5', title: 'Print a union' },
  ]);
  delete files['b.md'];
  assert.deepEqual(inspectTrackers(trackers, read).problems, ['b.md: does not exist']);
  files['a.ko.md'] = TABLE_TEXT.replace('| [~] |', '| [o] |');
  assert.deepEqual(inspectTrackers(trackers, read).problems, ['T1.2 is [~] in a.md and [o] in a.ko.md', 'b.md: does not exist']);
  delete files['a.ko.md'];
  assert.deepEqual(inspectTrackers([TABLE], read).problems, ['a.ko.md: does not exist']);
});

test('the sentence of the blocking state names the other states', () => {
  assert.equal(BLOCKING, 'only the state [~] blocks; [ ], [o], [!], [-] do not block');
});

test('loadConfig accepts the configuration of the fixture and names each rule that another breaks', (t) => {
  const good = readFileSync(path.join(FIXTURE, 'config/checklist.json'), 'utf8');
  const root = checkout(t, { 'config/checklist.json': good });
  assert.equal(loadConfig(root).idPattern, 'T[0-9]+(?:[.-][0-9]+)*');
  const write = (value: unknown) => writeFileSync(path.join(root, 'config/checklist.json'), JSON.stringify(value));
  const config = parseJson<ChecklistConfig>(good, 'checklist.schema.json', 'config/checklist.json');
  write({ ...config, hooks: ['commit-msg'] });
  assert.throws(() => loadConfig(root), /\$\.hooks is \["commit-msg"\], it must include "pre-push"/);
  write({ ...config, trackers: [] });
  assert.throws(() => loadConfig(root), /must NOT have additional properties \{"additionalProperty":"trackers"\}/);
  write({ schema: 1, hooks: ['pre-push'] });
  assert.throws(() => loadConfig(root), /must have required property 'idPattern'/);
  rmSync(path.join(root, 'config/checklist.json'));
  assert.throws(() => loadConfig(root), /config\/checklist\.json does not exist/);
});

test('kit-check validates config/checklist.json against its schema', (t) => {
  const root = checkout(t, { 'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: 'T[0-9]+', states: ['[ ]'] }) });
  mkdirSync(path.join(root, 'scripts/kit/schema'), { recursive: true });
  cpSync(path.join(HERE, '../../scripts/kit/schema/checklist.schema.json'), path.join(root, 'scripts/kit/schema/checklist.schema.json'));
  assert.deepEqual(checkConfig(root), ['config/checklist.json: / must NOT have additional properties {"additionalProperty":"states"}. Rule: the schema checklist.schema.json of @polyspec/kit']);
});

test('undeclaredChecklists names each document under docs/ with checklist items that is no checklist of a plan folder', () => {
  const trackers: Tracker[] = [{ path: 'docs/a.md', translation: 'docs/a.ko.md', idPattern: TABLE.idPattern }];
  const files = [
    { path: 'docs/a.md', text: '| T1 | x | y | [ ] |\n' },
    { path: 'docs/a.ko.md', text: '| T1 | x | y | [ ] |\n' },
    { path: 'docs/b.md', text: '| T2 | x | y | [o] |\n' },
    { path: 'docs/c.md', text: '- [!] C-1 A bypassed item.\n' },
    { path: 'docs/d.md', text: 'A plain document that names [o] in prose.\n' },
    { path: 'docs/f.md', text: '    - [o] never reopened\n' },
    { path: 'tests/e.md', text: '| T3 | x | y | [ ] |\n' },
  ];
  assert.deepEqual(undeclaredChecklists(trackers, files), ['docs/b.md', 'docs/c.md']);
});

test('the checklists are the checklist.md files of the plan folders, each with its Korean twin (K241)', () => {
  const files = ['docs/plans/b/checklist.md', 'docs/plans/a/checklist.md', 'docs/plans/a/checklist.ko.md', 'docs/plans/a/plan.md', 'docs/checklist.md', 'docs/plans/c/sub/checklist.md'];
  assert.deepEqual(trackersOf({ idPattern: 'K[0-9]+' }, files), [
    { path: 'docs/plans/a/checklist.md', translation: 'docs/plans/a/checklist.ko.md', idPattern: 'K[0-9]+' },
    { path: 'docs/plans/b/checklist.md', translation: 'docs/plans/b/checklist.ko.md', idPattern: 'K[0-9]+' },
  ]);
});

test('a plan folder holds its four files, and docs/plans holds plan folders only (K241)', () => {
  const plan = (name: string) => ['plan.md', 'plan.ko.md', 'checklist.md', 'checklist.ko.md'].map(file => `docs/plans/${name}/${file}`);
  assert.deepEqual(planFindings(plan('a')), []);
  const findings = planFindings([...plan('a'), 'docs/plans/a/notes.md', 'docs/plans/b/checklist.md', 'docs/plans/c.md', 'docs/plans/d/e/plan.md']).map(entry => entry.file);
  assert.deepEqual(findings, [
    'docs/plans/a/notes.md', 'docs/plans/c.md', 'docs/plans/d/e/plan.md',
    'docs/plans/b/plan.md', 'docs/plans/b/plan.ko.md', 'docs/plans/b/checklist.ko.md',
  ]);
});

test('an item ID is unique among the checklists, and a sub-item has its parent in its checklist (K241)', () => {
  const a: Tracker = { path: 'docs/plans/a/checklist.md', translation: 'docs/plans/a/checklist.ko.md', idPattern: 'K[0-9]+(?:-[0-9]+)*' };
  const b: Tracker = { ...a, path: 'docs/plans/b/checklist.md', translation: 'docs/plans/b/checklist.ko.md' };
  const item = (id: string, line: number) => ({ id, title: id, state: '[ ]', line });
  assert.deepEqual(crossFindings([{ tracker: a, items: [item('K1', 3), item('K1-1', 4), item('K1-1-1', 5)] }]), []);
  assert.deepEqual(crossFindings([{ tracker: a, items: [item('K1', 3), item('K2-1', 4)] }, { tracker: b, items: [item('K1', 3)] }]).map(entry => `${entry.file}:${entry.line} ${entry.message}`), [
    'docs/plans/a/checklist.md:4 the sub-item K2-1 has no parent K2 in its checklist; a sub-item follows its item in one plan',
    'docs/plans/b/checklist.md:3 the item K1 is also an item of docs/plans/a/checklist.md; an item ID is unique among the checklists of a repository',
  ]);
});
