// Tests of scripts/kit/text-absent.mts (K431): the red of a row whose whole change is text. The tool fails with file:line while a
// tracked file holds the stale text, passes once it is gone, and is a Verification command that the Claude Code hook allows.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { refusal } from '../../scripts/kit/claude-hook.mts';
import { makeDatabase } from '../../scripts/kit/owner-check.mts';
import type { Tracker } from '../../scripts/kit/checklist.mts';
import { verificationFindings } from '../../scripts/kit/verification.mts';
import { KIT, KIT_MAKEFILE } from './kit-tools.mts';
import { put, tree } from './tree.mts';

const TOOL = path.join(KIT, 'text-absent.mts');
const anyFile = () => true;
const run = (root: string, args: string[]) => spawnSync(process.execPath, [TOOL, ...args], { cwd: root, encoding: 'utf8' });

test('the pure function finds the line number of each occurrence of the literal text (K431)', async () => {
  const { occurrences } = await import('../../scripts/kit/text-absent.mts');
  assert.deepEqual(occurrences('throws INTERNAL\nok\nthrows INTERNAL and throws INTERNAL\n', 'throws INTERNAL'), [1, 3, 3]);
  assert.deepEqual(occurrences('a.b\nxay\n', 'a.b'), [1], 'the text is a literal, not a pattern');
  assert.deepEqual(occurrences('nothing here\n', 'throws'), []);
});

test('the tool fails with file:line while a tracked file holds the text, and passes once it is gone (K431)', (t) => {
  const root = tree(t, { 'src/db.c': 'int a;\n// throws INTERNAL\n' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const red = run(root, ['src/db.c', 'throws INTERNAL']);
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.equal(red.stderr, '[text-absent] src/db.c:2: holds the stale text "throws INTERNAL"\n');
  put(root, { 'src/db.c': 'int a;\n// throws nothing\n' });
  const green = run(root, ['src/db.c', 'throws INTERNAL']);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.equal(green.stdout, '[text-absent] src/db.c no longer holds the text\n');
});

test('an untracked file, a missing file and an empty text exit 2 with the reason (K431)', (t) => {
  const root = tree(t, { 'notes.md': 'throws INTERNAL\n' });
  const untracked = run(root, ['notes.md', 'throws INTERNAL']);
  assert.equal(untracked.status, 2, untracked.stdout + untracked.stderr);
  assert.match(untracked.stderr, /not tracked by Git/);
  const missing = run(root, ['gone.md', 'throws INTERNAL']);
  assert.equal(missing.status, 2, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /not tracked by Git/);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const empty = run(root, ['notes.md', '']);
  assert.equal(empty.status, 2, empty.stdout + empty.stderr);
  assert.match(empty.stderr, /TEXT is empty/);
});

test('the Claude Code hook takes make text-absent as a Verification command (K431)', (t) => {
  const root = tree(t, { 'Makefile': KIT_MAKEFILE });
  const database = makeDatabase(root);
  const command = 'make text-absent FILE=src/db.c TEXT="throws INTERNAL"';
  assert.ok(database.targets.has('text-absent'), 'the Makefile of kit declares the target text-absent');
  assert.equal(refusal(command, anyFile, () => database), null, 'the hook does not refuse it');
  const tracker: Tracker = { path: 'docs/plans/p/checklist.md', translation: 'docs/plans/p/checklist.ko.md', idPattern: 'T[0-9]+' };
  const text = '| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n'
    + `| T1 | Task | \`src/db.c\` | \`${command}\` | [ ] |\n`;
  assert.deepEqual(verificationFindings([tracker], file => (file === tracker.path ? text : undefined), () => database), []);
});

test('kit.mk declares the text-absent target as a tool with a help line that ends in offline (K431)', () => {
  const kitMk = readFileSync(path.join(KIT, 'kit.mk'), 'utf8');
  assert.match(kitMk, /^\.PHONY: .*\btext-absent\b/m, 'declared .PHONY');
  assert.match(kitMk, /^text-absent: .*## .*K431\)?.*; offline$/m, 'a help line that ends in offline');
  assert.match(kitMk, /^\t\$\(NODE\) \$\(KIT\)\/text-absent\.\$\(KIT_EXT\) "\$\(FILE\)" "\$\(TEXT\)"$/m, 'runs the tool with FILE and TEXT');
});
