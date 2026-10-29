// scripts/kit/kit-bootstrap.mk, which a repository includes from the kit checkout beside it (K614): it includes the kit.mk beside
// it with KIT, the scripts/kit of that checkout, and KIT_EXT := mts, so the repository runs the sources of kit with no build (K613).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertWorkflowPackageBootstrap } from './workflow-package-bootstrap.mts';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');

/**
 * A repository beside a kit checkout that holds the bootstrap and the kit.mk of this kit, whose Makefile includes the bootstrap and
 * then `makefile`; removed with `t.after`.
 */
function repository(t: TestContext, makefile = '') {
  const parent = mkdtempSync(path.join(tmpdir(), 'kit-bootstrap-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(path.join(parent, 'kit/scripts/kit'), { recursive: true });
  for (const file of ['kit-bootstrap.mk', 'kit.mk']) cpSync(path.join(KIT, file), path.join(parent, 'kit/scripts/kit', file));
  const root = path.join(parent, 'repo');
  mkdirSync(root);
  writeFileSync(path.join(root, 'Makefile'), `include ../kit/scripts/kit/kit-bootstrap.mk\n${makefile}`);
  return root;
}

const make = (root: string, ...args: string[]) => spawnSync('make', ['--no-print-directory', ...args], { cwd: root, encoding: 'utf8' });

// The real path of the scripts of the kit checkout beside `root`, which the bootstrap names as KIT (K762).
const kit = (root: string) => path.join(realpathSync(path.dirname(root)), 'kit/scripts/kit');

// The absolute path of the tool `file` of var/tools of `root` as make names it, by the real path of the directory (K171).
const tool = (root: string, file: string) => path.join(realpathSync(root), 'var/tools/bin', file);

test('the bootstrap includes the kit.mk beside it, which runs the sources of the kit checkout beside the repository (K613)', (t) => {
  const root = repository(t);
  const dry = make(root, '-n', 'docs-check');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `${tool(root, 'node')} ${kit(root)}/check-documents.mts`);
  assert.equal(make(root, '-n', 'install-tools', 'TOOLS=go').stdout.trim(), `${tool(root, 'node')} ${kit(root)}/install-tools.mts go`);
});

test('install-tools TOOLS=npm runs the bootstrap installer of the kit checkout with the node of the machine', (t) => {
  const root = repository(t);
  const dry = make(root, '-n', 'install-tools', 'TOOLS=npm', 'ONLINE=online-wrapper');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `online-wrapper node ${kit(root)}/bootstrap/bootstrap.mts`);
});

test('install-packages runs npm ci with the pinned npm of var/tools', (t) => {
  const root = repository(t);
  const dry = make(root, '-n', 'install-packages', 'ONLINE=online-wrapper');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `online-wrapper ${tool(root, 'npm')} ci`);
});

test('a recipe of the repository that runs before install-packages starts the node of the checkout as $(NODE) (K185)', (t) => {
  // A repository step that install-packages needs, such as one that orders a JSON file before npm ci, starts the node of the checkout.
  const root = repository(t, 'install-packages: ordered\n.PHONY: ordered\nordered:\n\t$(NODE) ordered.mjs\n');
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const file of ['node', 'npm']) writeFileSync(path.join(root, 'var/tools/bin', file), `#!/bin/sh\necho "${file} of the checkout: $*"\n`, { mode: 0o755 });
  const run = make(root, 'install-packages');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout, `${tool(root, 'node')} ordered.mjs\nnode of the checkout: ordered.mjs\n${tool(root, 'npm')} ci\nnpm of the checkout: ci\n`);
});

test('npm of install-packages and of dependency-review gets allow-remote=root from one setting, so a lock that pins a URL installs and updates (K189)', (t) => {
  // dependency-review UPDATE=1 ran npm audit fix without allow-remote, and npm refused the URL-pinned @polyspec/kit (EALLOWREMOTE).
  const root = repository(t);
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const file of ['node', 'npm']) writeFileSync(path.join(root, 'var/tools/bin', file), `#!/bin/sh\necho "${file} allow-remote=$npm_config_allow_remote: $*"\n`, { mode: 0o755 });
  const lines = (...goal: string[]) => make(root, '-s', ...goal).stdout.split('\n').filter(line => line.includes(' allow-remote='));
  assert.deepEqual(lines('install-packages'), ['npm allow-remote=root: ci']);
  assert.deepEqual(lines('dependency-review', 'UPDATE=1'), [`node allow-remote=root: ${kit(root)}/dependency-review.mts --update`]);
  assert.deepEqual(lines('docs-check'), [`node allow-remote=: ${kit(root)}/check-documents.mts`], 'another recipe does not get it');
});

test('make install runs the bootstrap of kit first, then the install steps that the repository adds to install (K246-2)', (t) => {
  const root = repository(t, 'install: demo-install\n.PHONY: demo-install\ndemo-install: install-kit\n\t@echo demo-install\n');
  const lines = make(root, '-n', 'install').stdout.split('\n').filter(Boolean);
  const kit = lines.findIndex(line => line.includes('install-tools TOOLS=npm'));
  assert.ok(kit !== -1, `make install runs the bootstrap of kit:\n${lines.join('\n')}`);
  assert.ok(lines.indexOf('echo demo-install') > kit, `the steps of the repository follow the bootstrap:\n${lines.join('\n')}`);
});

test('install-packages runs the targets that INSTALL_PACKAGES_EXTRA names after its npm ci, in order, with the npm of var/tools and the allow-remote setting (K428)', (t) => {
  // A tools project outside the workspaces of the repository installs its own lock in a target of the repository.
  const root = repository(t, 'INSTALL_PACKAGES_EXTRA := first-extra second-extra\n.PHONY: first-extra second-extra\nfirst-extra:\n\t$(NPM) extra-one\nsecond-extra:\n\t$(NPM) extra-two\n');
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/npm'), '#!/bin/sh\necho "npm allow-remote=$npm_config_allow_remote: $*"\n', { mode: 0o755 });
  const run = make(root, '-s', 'install-packages');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout, 'npm allow-remote=root: ci\nnpm allow-remote=root: extra-one\nnpm allow-remote=root: extra-two\n');
});

test('the gates workflow bootstraps the installed kit with pinned npm before Make and builds no sibling checkout (K686-2)', (t) => {
  const workflow = readFileSync(path.resolve(KIT, '../../workflows/gates.yml'), 'utf8');
  assertWorkflowPackageBootstrap(workflow, t);
  assert.doesNotMatch(workflow, /make -C \.\.\/kit|kit-build/, 'package bootstrap never builds a sibling kit');
});
