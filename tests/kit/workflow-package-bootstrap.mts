// Executes the package-first bootstrap of a repository with a recording npm, without downloads or package installation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

/** The composite action of kit that every CI job runs for its bootstrap (K992), and the step of a workflow that runs it. */
export const BOOTSTRAP_ACTION = 'actions/kit-bootstrap/action.yml';
export const BOOTSTRAP_USES = /^\s+- uses: \.\/\.github\/actions\/kit-bootstrap$/m;

/** The `make` commands of the bootstrap action, in its order. */
export function bootstrapActionCommands(action = readFileSync(path.join(import.meta.dirname, '../..', BOOTSTRAP_ACTION), 'utf8')): string[] {
  return [...action.matchAll(/^\s+run: (make .+)$/gm)].map(match => match[1] ?? '');
}

/** The environment of a make that a test starts, without the variables of a make that runs the test. */
function makeEnvironment(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { MAKEFLAGS: _flags, MFLAGS: _mflags, MAKELEVEL: _level, MAKEOVERRIDES: _overrides, ...environment } = process.env;
  return { ...environment, ...extra };
}

/**
 * Verifies that `workflow` runs the bootstrap action before its first Make invocation (K992), that the action provisions Node.js
 * and runs only `make bootstrap` (K1250), and that the bootstrap of a repository (docs/examples/bootstrap.mk) installs the lock
 * with the exact npm of devEngines outside the checkout before its Make steps, while kit's own bootstrap installs no kit package.
 */
export function assertWorkflowPackageBootstrap(workflow: string, t: TestContext): void {
  const uses = workflow.search(BOOTSTRAP_USES);
  assert.ok(uses >= 0, 'the workflow runs the bootstrap action of kit');
  const make = workflow.search(/^\s+run: make /m);
  assert.ok(make < 0 || uses < make, 'the bootstrap action precedes the first Make invocation');
  assert.doesNotMatch(workflow, /git clone|make -C \.\.\/kit|kit_tag|sibling checkouts|npm --prefix/);
  const kit = path.join(import.meta.dirname, '../..');
  const action = readFileSync(path.join(kit, BOOTSTRAP_ACTION), 'utf8');
  assert.deepEqual([...action.matchAll(/^\s+run: (.+)$/gm)].map(match => match[1]), ['make bootstrap'], 'the action runs the one make call of a local bootstrap');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-workflow-bootstrap-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
  // K938-1: the npm of the runner refuses to run in a folder whose devEngines names another npm (EBADDEVENGINES), as npm 11 does.
  writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nif [ -f "$PWD/package.json" ] && grep -q devEngines "$PWD/package.json"; then echo "EBADDEVENGINES" >&2; exit 1; fi\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_LOG"\nprintf "%s" "$npm_config_cache" > "$BOOTSTRAP_CACHE_LOG"\n', { mode: 0o755 });
  mkdirSync(path.join(root, 'runner-temp'));
  const consumer = path.join(root, 'consumer');
  mkdirSync(path.join(consumer, 'make'), { recursive: true });
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: '@example/consumer', devEngines: { packageManager: { name: 'npm', version: '11.14.0' } } }));
  cpSync(path.join(kit, 'docs/examples/bootstrap.mk'), path.join(consumer, 'make/bootstrap.mk'));
  cpSync(path.join(kit, 'scripts/kit/kit.mk'), path.join(consumer, 'make/kit.mk'));
  writeFileSync(path.join(consumer, 'Makefile'), 'include make/bootstrap.mk\n');
  const log = path.join(root, 'npm.log');
  const cache = path.join(root, 'cache.log');
  const environment = makeEnvironment({ PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, RUNNER_TEMP: path.join(root, 'runner-temp'), BOOTSTRAP_LOG: log, BOOTSTRAP_CACHE_LOG: cache });
  const lock = spawnSync('make', ['--no-print-directory', 'bootstrap-lock'], { cwd: consumer, env: environment, encoding: 'utf8' });
  assert.equal(lock.status, 0, `${lock.stdout}${lock.stderr}`);
  assert.equal(readFileSync(log, 'utf8'), `exec --yes --package=npm@11.14.0 -- npm --prefix ${consumer} ci --ignore-scripts\n`);
  assert.equal(readFileSync(cache, 'utf8'), path.join(consumer, 'var/bootstrap/npm-cache'));
  const steps = spawnSync('make', ['--no-print-directory', '-n', 'bootstrap'], { cwd: consumer, env: environment, encoding: 'utf8' });
  assert.equal(steps.status, 0, `${steps.stdout}${steps.stderr}`);
  const order = ['npm exec --yes', 'install-tools TOOLS=npm', 'install-packages'].map(step => steps.stdout.indexOf(step));
  assert.ok(order.every((index, position) => index >= 0 && (position === 0 || index > (order[position - 1] ?? -1))), `the bootstrap installs the lock, then npm, then the packages:\n${steps.stdout}`);
  const own = spawnSync('make', ['--no-print-directory', '-n', 'bootstrap'], { cwd: kit, env: makeEnvironment({}), encoding: 'utf8' });
  assert.equal(own.status, 0, `${own.stdout}${own.stderr}`);
  assert.doesNotMatch(own.stdout, /npm exec|--prefix/, 'kit uses its source Makefile without installing its own published package');
}
