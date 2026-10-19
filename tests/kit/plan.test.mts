// Tests of the plan utilities (scripts/kit/plan.mts): each writes the files of a plan or a row of a checklist only when the
// result passes the checks that the hooks and documents-check run on it (K249).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { newPlan } from '../../scripts/kit/plan.mts';
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
