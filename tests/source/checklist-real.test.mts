// kit's own plans are plan folders of docs/plans, so the document check reads the items and states of their checklists and
// the commit rules (commit-items, the push gate) apply to kit's commits. Without a checklist the check read none, and a state
// could only be read by eye (K128); since K241 kit finds the checklists by their folders.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig, trackersOf, workingPlanFiles } from '../../scripts/kit/checklist.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The checklists of the plan folders, as the folders hold them; a new plan folder adds its own.
const CHECKLISTS = globSync('docs/plans/*/checklist.md', { cwd: ROOT }).sort((left, right) => left.localeCompare(right));

test('kit holds its plans as plan folders, each checklist with its Korean twin', () => {
  const trackers = trackersOf(loadConfig(ROOT), workingPlanFiles(ROOT));
  assert.ok(CHECKLISTS.length > 0, 'kit has plan folders');
  assert.deepEqual(trackers.toSorted((left, right) => left.path.localeCompare(right.path)).map(tracker => [tracker.path, tracker.translation]), CHECKLISTS.map(file => [file, file.replace(/\.md$/, '.ko.md')]));
});

test('the document check reads every checklist of the plan folders', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/check-documents.mts')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`, ${CHECKLISTS.length} checklists,`));
});
