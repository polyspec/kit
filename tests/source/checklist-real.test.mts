// kit's own plans are plan folders of docs/plans, so the document check reads the items and states of their checklists and
// the commit rules (commit-items, the push gate) apply to kit's commits. Without a checklist the check read none, and a state
// could only be read by eye (K128); since K241 kit finds the checklists by their folders.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig, trackersOf, workingPlanFiles } from '../../scripts/kit/checklist.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('kit holds its plans as plan folders, each checklist with its Korean twin', () => {
  const trackers = trackersOf(loadConfig(ROOT), workingPlanFiles(ROOT));
  assert.deepEqual(trackers.map(tracker => [tracker.path, tracker.translation]), [
    ['docs/plans/common-standard/checklist.md', 'docs/plans/common-standard/checklist.ko.md'],
    ['docs/plans/standards-enforcement/checklist.md', 'docs/plans/standards-enforcement/checklist.ko.md'],
    ['docs/plans/tool-unification/checklist.md', 'docs/plans/tool-unification/checklist.ko.md'],
  ]);
});

test('the document check reads every checklist of the plan folders', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/check-documents.mts')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /, 3 checklists,/);
});
