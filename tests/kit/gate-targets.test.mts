// Tests of the make targets of the gates in scripts/kit/kit.mk: the commands that each target runs, and the setting of
// core.hooksPath at every make invocation of a checkout that tracks the pre-push hook.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { git, run } from './gates-checkout.mts';
import { initRepository } from './sandbox-repository.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function repository(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-gate-targets-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'scripts/kit'), { recursive: true });
  cpSync(path.join(ROOT, 'scripts/kit/kit.mk'), path.join(directory, 'scripts/kit/kit.mk'));
  writeFileSync(path.join(directory, 'Makefile'), 'KIT := scripts/kit\nKIT_EXT := mts\ninclude scripts/kit/kit.mk\n');
  initRepository(directory);
  return directory;
}

// The printed lines, with the absolute path of the node of the checkout, which kit.mk names NODE (K171), shown as $(NODE).
const commands = (directory: string, ...args: string[]) => {
  const made = run(directory, 'make', ['--no-print-directory', '-n', ...args]);
  assert.equal(made.status, 0, made.stderr);
  return made.stdout.split('\n').filter(Boolean).map(line => line.replaceAll(path.join(realpathSync(directory), 'var/tools/bin/node'), '$(NODE)'));
};

test('each target runs the tool of its gate with the commit and the keys that the variables name', (t) => {
  const directory = repository(t);
  assert.deepEqual(commands(directory, 'hooks'), ['$(NODE) scripts/kit/git-hooks.mts install']);
  assert.deepEqual(commands(directory, 'hooks-check'), ['$(NODE) scripts/kit/git-hooks.mts check']);
  assert.deepEqual(commands(directory, 'push-gate-commit'), ['$(NODE) scripts/kit/push-gate.mts commit HEAD']);
  assert.deepEqual(commands(directory, 'push-gate-commit', 'COMMIT=abc123'), ['$(NODE) scripts/kit/push-gate.mts commit abc123']);
  assert.deepEqual(commands(directory, 'rerun-failed'), ['$(NODE) scripts/kit/full-run.mts rerun-failed']);
  assert.deepEqual(commands(directory, 'rerun-failed', 'FULL_RUN_KEYS=--key dep=c1'), ['$(NODE) scripts/kit/full-run.mts rerun-failed --key dep=c1']);
});

test('a make invocation sets core.hooksPath in a checkout that tracks the pre-push hook, and in no other', (t) => {
  const directory = repository(t);
  commands(directory, 'hooks-check');
  assert.equal(run(directory, 'git', ['config', 'core.hooksPath']).status, 1, 'a checkout without the hook got a hooks path');
  mkdirSync(path.join(directory, '.githooks'));
  writeFileSync(path.join(directory, '.githooks/pre-push'), '#!/bin/sh\n');
  commands(directory, 'hooks-check');
  assert.equal(git(directory, 'config', 'core.hooksPath'), '.githooks');
  git(directory, 'config', 'core.hooksPath', 'elsewhere');
  commands(directory, 'hooks-check');
  assert.equal(git(directory, 'config', 'core.hooksPath'), '.githooks');
});

test('the dependency targets run the gate, its mutation check and the review with the flags that the variables name', (t) => {
  const directory = repository(t);
  // make leaves the spaces of an empty $(if) in a printed recipe line, so the lines are compared with single spaces and no edge spaces.
  const lines = (...args: string[]) => commands(directory, ...args).map(line => line.trim().replace(/\s+/g, ' '));
  assert.deepEqual(lines('dependency-policy-check'), ['$(NODE) scripts/kit/check-dependency-policy.mts']);
  assert.deepEqual(lines('dependency-policy-mutation-check'), ['$(NODE) scripts/kit/check-dependency-policy-mutation.mts']);
  assert.deepEqual(lines('dependency-review'), ['$(NODE) scripts/kit/dependency-review.mts']);
  assert.deepEqual(lines('dependency-review', 'RECORD=1'), ['$(NODE) scripts/kit/dependency-review.mts --record']);
  assert.deepEqual(lines('dependency-review', 'UPDATE=1', 'RECORD=1'), ['$(NODE) scripts/kit/dependency-review.mts --record --update']);
});
