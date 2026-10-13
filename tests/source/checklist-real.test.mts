// kit's own execution checklist is a tracker of config/checklist.json, so the document check reads its items and states and
// the commit rules (commit-items, the push gate) apply to kit's commits. Without the declaration the check read no
// checklist, and a state could only be read by eye (K128).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../scripts/kit/checklist.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('config/checklist.json declares the execution checklist of kit with its Korean twin', () => {
  const tracker = loadConfig(ROOT).trackers.find(entry => entry.path === 'docs/plans/execution-checklist.md');
  assert.ok(tracker, 'config/checklist.json declares docs/plans/execution-checklist.md');
  assert.equal(tracker.translation, 'docs/plans/execution-checklist.ko.md');
  assert.equal(tracker.active, '[~]');
  assert.equal(tracker.done, '[o]');
});

test('the document check reads the execution checklist as a checklist', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/check-documents.mts')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /, 1 checklists?,/);
});
