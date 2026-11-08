// Tests of the make targets of the gates in scripts/kit/kit.mk: the commands that each target runs, and the setting of
// core.hooksPath at every make invocation of a checkout that tracks the pre-commit hook.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from './gates-checkout.mts';
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
  // K1099: the recipe passes kit's own declaration of its merges and drivers; the tool fixes none.
  const declaration = "--merge 'CHANGELOG.md=kit-changelog' --merge 'CHANGELOG.ko.md=kit-twin' --merge 'docs/plans/*/checklist.md=kit-checklist' --merge 'docs/plans/*/checklist.ko.md=kit-twin' --driver 'kit-twin=make --no-print-directory twin-merge MERGE=\"%O %A %B %P\"' --driver 'kit-changelog=make --no-print-directory twin-merge MERGE=\"%O %A %B %P\"' --driver 'kit-checklist=make --no-print-directory twin-merge MERGE=\"%O %A %B %P\"'";
  assert.deepEqual(commands(directory, 'hooks'), [`$(NODE) scripts/kit/git-hooks.mts install ${declaration}`]);
  assert.deepEqual(commands(directory, 'hooks-check'), [`$(NODE) scripts/kit/git-hooks.mts check ${declaration}`]);
});

test('the source checkout can dry-run the first npm tool install without installed SDK packages', (t) => {
  const directory = repository(t);
  assert.deepEqual(commands(directory, 'install-tools', 'TOOLS=npm'), ['node scripts/kit/bootstrap/bootstrap.mts']);
});

// K1053: kit sets core.hooksPath only in make hooks, for the hooks that its declaration names (K1099); a make invocation sets none.
test('a make invocation sets no core.hooksPath, even in a checkout that tracks a pre-commit hook (K1053)', (t) => {
  const directory = repository(t);
  mkdirSync(path.join(directory, '.githooks'));
  writeFileSync(path.join(directory, '.githooks/pre-commit'), '#!/bin/sh\n');
  commands(directory, 'hooks-check');
  assert.equal(run(directory, 'git', ['config', 'core.hooksPath']).status, 1, 'a make invocation set a hooks path');
});

test('kit.mk runs the rebuild check and the rules check in every repository that includes it (K248)', (t) => {
  const directory = repository(t);
  // The tool sources and the files that are none are the --source and --exclude globs of kit's recipe (K1080).
  const rebuild = commands(directory, 'rebuild-check');
  assert.equal(rebuild.length, 1, rebuild.join('\n'));
  assert.match(rebuild[0] ?? '', /^\$\(NODE\) scripts\/kit\/rebuild-check\.mts --source 'scripts\/\*\*\/\*\.\{mts,[^']*\}'( --(source|exclude) '[^']+')+$/);
  assert.deepEqual(commands(directory, 'rules-check'), ['$(NODE) scripts/kit/check-rules.mts']);
});
