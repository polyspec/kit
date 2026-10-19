// Tests of the plan utilities (scripts/kit/plan.mts): each writes the files of a plan or a row of a checklist only when the
// result passes the checks that the hooks and documents-check run on it (K249).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { newItem, newPlan } from '../../scripts/kit/plan.mts';
import { readChecklist, trackersOf } from '../../scripts/kit/checklist.mts';
import { sha256 } from '../../scripts/kit/bootstrap/digest.mts';
import { tree } from './tree.mts';

const CONFIG = { 'config/checklist.json': '{"schema":1,"hooks":["pre-push"],"idPattern":"T[0-9]+(?:[.-][0-9]+)*"}\n' };

test('plan-new writes the four files of a plan with their doc-ids, language links and revision markers (K249)', (t) => {
  const root = tree(t, CONFIG);
  const files = newPlan(root, { name: 'parser', title: 'Parser', titleKo: '파서' });
  assert.deepEqual(Object.keys(files).sort(), ['docs/plans/parser/checklist.ko.md', 'docs/plans/parser/checklist.md', 'docs/plans/parser/plan.ko.md', 'docs/plans/parser/plan.md']);
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  assert.equal(read('docs/plans/parser/plan.md'), '<!-- doc-id: plan-parser -->\n# Parser\n\n[한국어](plan.ko.md)\n');
  assert.equal(read('docs/plans/parser/plan.ko.md'), `<!-- doc-id: plan-parser -->\n<!-- source-sha256: ${sha256(read('docs/plans/parser/plan.md'))} -->\n# 파서\n\n[English](plan.md)\n`);
  assert.equal(read('docs/plans/parser/checklist.md'), '<!-- doc-id: checklist-parser -->\n# Parser checklist\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n');
  assert.match(read('docs/plans/parser/checklist.ko.md'), /^<!-- doc-id: checklist-parser -->\n<!-- source-sha256: [0-9a-f]{64} -->\n# 파서 체크리스트\n\n\| ID \| Task \|/);
  const [tracker] = trackersOf({ idPattern: 'T[0-9]+' }, Object.keys(files));
  assert.ok(tracker);
  assert.deepEqual(readChecklist(read(tracker.path), tracker, { strict: true }).items, []);
});

test('plan-new refuses a name that is no slug, an existing plan and a missing title (K249)', (t) => {
  const root = tree(t, CONFIG);
  newPlan(root, { name: 'parser', title: 'Parser', titleKo: '파서' });
  assert.throws(() => newPlan(root, { name: 'parser', title: 'Parser', titleKo: '파서' }), /docs\/plans\/parser exists/);
  assert.throws(() => newPlan(root, { name: 'Parser', title: 'P', titleKo: 'P' }), /the name "Parser" is no slug/);
  assert.throws(() => newPlan(root, { name: 'lexer', title: ' ', titleKo: '렉서' }), /TITLE is empty/);
  assert.throws(() => newPlan(root, { name: 'lexer', title: 'Lexer', titleKo: '' }), /TITLE_KO is empty/);
});

/** A checkout with the plans `names`, each made by newPlan. */
function plans(t: Parameters<typeof tree>[0], ...names: string[]) {
  const root = tree(t, CONFIG);
  for (const name of names) newPlan(root, { name, title: name, titleKo: name });
  return root;
}

const item = (plan: string, id: string, extra: Partial<Parameters<typeof newItem>[1]> = {}) => ({ plan, id, task: `Task ${id}`, taskKo: `작업 ${id}`, deliverables: '`a.mts`', verification: '`node --test a.test.mts`', ...extra });
const rows = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8').split('\n').filter(line => line.startsWith('| T'));

test('item-new adds a waiting row to a checklist and its twin, a sub-item after the last sub-item of its parent (K249-1)', (t) => {
  const root = plans(t, 'parser');
  for (const id of ['T1', 'T2', 'T1-1', 'T1-2', 'T1-1-1']) newItem(root, item('parser', id));
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.md').map(row => row.split(' | ')[0]), ['| T1', '| T1-1', '| T1-1-1', '| T1-2', '| T2']);
  assert.equal(rows(root, 'docs/plans/parser/checklist.md')[0], '| T1 | Task T1 | `a.mts` | `node --test a.test.mts` | [ ] |');
  assert.equal(rows(root, 'docs/plans/parser/checklist.ko.md')[0], '| T1 | 작업 T1 | `a.mts` | `node --test a.test.mts` | [ ] |');
});

test('item-new escapes a pipe of a cell, and refuses a line break (K249-1)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1', { task: 'Read `a | b`' }));
  assert.equal(rows(root, 'docs/plans/parser/checklist.md')[0], '| T1 | Read `a \\| b` | `a.mts` | `node --test a.test.mts` | [ ] |');
  assert.throws(() => newItem(root, item('parser', 'T2', { task: 'one\ntwo' })), /TASK holds a line break/);
});

test('item-new refuses an ID of another checklist, a sub-item without its parent, an ID off the pattern, an empty text and an unknown plan, and writes nothing (K249-1)', (t) => {
  const root = plans(t, 'parser', 'lexer');
  newItem(root, item('parser', 'T1'));
  const before = () => ['parser', 'lexer'].flatMap(name => ['checklist.md', 'checklist.ko.md'].map(file => readFileSync(path.join(root, `docs/plans/${name}/${file}`), 'utf8')));
  const kept = before();
  assert.throws(() => newItem(root, item('lexer', 'T1')), /the item T1 is also an item of docs\/plans\/(?:parser|lexer)\/checklist.md/);
  assert.throws(() => newItem(root, item('lexer', 'T5-1')), /the sub-item T5-1 has no parent T5 in its checklist/);
  assert.throws(() => newItem(root, item('lexer', 'X1')), /the ID "X1" does not match T\[0-9\]/);
  assert.throws(() => newItem(root, item('lexer', 'T2', { taskKo: ' ' })), /TASK_KO is empty/);
  assert.throws(() => newItem(root, item('nothing', 'T2')), /docs\/plans\/nothing\/checklist.md is no checklist/);
  assert.deepEqual(before(), kept);
});
