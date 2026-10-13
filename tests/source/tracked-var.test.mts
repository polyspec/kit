// var/ of this checkout holds the outputs of runs (var/tools, logs, reports) and is ignored by .gitignore; no file under it is
// tracked (K50). A tracked file there is rewritten by every run that writes it, so each checkout shows a change nobody made:
// var/kit-test.log was committed with the release 0.0.14 and every make kit-test rewrote it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('var/ holds no tracked file (K50)', () => {
  const listed = spawnSync('git', ['ls-files', '--', 'var'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.stdout.split('\n').filter(Boolean), [], 'remove the tracked files of var/ with git rm --cached');
});
