// Tests of the make targets of the gates in scripts/kit/kit.mk: the commands that each target runs, and the setting of
// core.hooksPath at every make invocation of a checkout that tracks the pre-push hook.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  const made = run(directory, 'make', ['--no-print-directory', '-n', ...args, `NODE=${process.execPath}`]);
  assert.equal(made.status, 0, made.stderr);
  return made.stdout.split('\n').filter(Boolean).map(line => line
    .replaceAll(path.join(realpathSync(directory), 'var/tools/bin/node'), '$(NODE)')
    .replaceAll(process.execPath, '$(NODE)')
    .replaceAll(`${path.join(ROOT, 'scripts/kit')}/`, 'scripts/kit/'));
};

test('each target runs the tool of its gate with the commit and the keys that the variables name', (t) => {
  const directory = repository(t);
  assert.deepEqual(commands(directory, 'hooks'), ['$(NODE) scripts/kit/git-hooks.mts install']);
  assert.deepEqual(commands(directory, 'hooks-check'), ['$(NODE) scripts/kit/git-hooks.mts check']);
  assert.deepEqual(commands(directory, 'push-gate-commit'), ['$(NODE) scripts/kit/push-gate.mts commit HEAD']);
  assert.deepEqual(commands(directory, 'push-gate-commit', 'COMMIT=abc123'), ['$(NODE) scripts/kit/push-gate.mts commit abc123']);
  assert.deepEqual(commands(directory, 'kit-ci-verify-gates'), ['$(NODE) scripts/kit/ci-setup.mts --verify-gates']);
});

test('the provider parity phase targets fix their selectors and accept a concrete implementation name', (t) => {
  const directory = repository(t);
  const makefile = path.join(directory, 'Makefile');
  writeFileSync(makefile, readFileSync(makefile, 'utf8').replace('KIT := scripts/kit', `KIT := ${path.join(ROOT, 'scripts/kit')}`));
  mkdirSync(path.join(directory, 'config'), { recursive: true });
  writeFileSync(path.join(directory, 'config/parity.json'), JSON.stringify({
    schema: 1,
    implementations: [{ name: 'go', runner: 'go', roots: ['packages/go'] }],
    requirements: { pattern: 'REQ-[0-9]+' },
    units: [],
  }));
  assert.deepEqual(commands(directory, 'parity-api-check'), ['$(NODE) scripts/kit/parity.mts --phase api']);
  assert.deepEqual(commands(directory, 'parity-bindings-go-check'), ['$(NODE) scripts/kit/parity.mts --phase bindings --implementation go']);
  writeFileSync(path.join(directory, 'parity-bindings-go-check'), 'existing file');
  assert.deepEqual(commands(directory, 'parity-bindings-go-check'), ['$(NODE) scripts/kit/parity.mts --phase bindings --implementation go']);
  writeFileSync(makefile, `${readFileSync(makefile, 'utf8')}\nparity-bindings-go-check: fixture-setup\nfixture-setup:\n\t@true\n`);
  assert.deepEqual(commands(directory, 'parity-bindings-go-check'), ['true', '$(NODE) scripts/kit/parity.mts --phase bindings --implementation go']);
});

test('the source checkout can dry-run the first npm tool install without a parity declaration or installed SDK packages', (t) => {
  const directory = repository(t);
  assert.deepEqual(commands(directory, 'install-tools', 'TOOLS=npm'), ['node scripts/kit/bootstrap/bootstrap.mts']);
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

test('kit.mk runs the rebuild check and the rules check in every repository that includes it (K248)', (t) => {
  const directory = repository(t);
  assert.deepEqual(commands(directory, 'rebuild-check'), ['$(NODE) scripts/kit/rebuild-check.mts']);
  assert.deepEqual(commands(directory, 'rules-check'), ['$(NODE) scripts/kit/check-rules.mts']);
});
