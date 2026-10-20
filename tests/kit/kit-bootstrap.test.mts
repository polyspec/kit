// scripts/kit/kit-bootstrap.mk, the copy that a repository includes: it includes the kit.mk of the installed package with
// KIT := node_modules/@polyspec/kit/dist and KIT_EXT := mjs. While the package is absent it offers only the two bootstrap
// steps, install-tools TOOLS=npm and install-packages, and stops every other goal with the commands that install it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');
const MISSING = 'node_modules/@polyspec/kit/dist/kit.mk is missing; run make install, which runs install-tools TOOLS=npm, install-packages, install-tools and install-link';

/** A repository whose Makefile includes the copy of kit-bootstrap.mk, removed with `t.after`. */
function repository(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-bootstrap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts/kit'), { recursive: true });
  cpSync(path.join(KIT, 'kit-bootstrap.mk'), path.join(root, 'scripts/kit/kit-bootstrap.mk'));
  writeFileSync(path.join(root, 'Makefile'), 'include scripts/kit/kit-bootstrap.mk\n');
  return root;
}

const make = (root: string, ...args: string[]) => spawnSync('make', ['--no-print-directory', ...args], { cwd: root, encoding: 'utf8' });

// The absolute path of the tool `file` of var/tools of `root` as make names it, by the real path of the directory (K171).
const tool = (root: string, file: string) => path.join(realpathSync(root), 'var/tools/bin', file);

test('without the package, a goal other than the bootstrap steps stops with the commands that install it', (t) => {
  const root = repository(t);
  for (const goals of [['docs-check'], [], ['install-packages', 'kit-check']]) {
    const run = make(root, ...goals);
    assert.equal(run.status, 2, `${goals.join(' ')}: ${run.stdout}`);
    assert.match(run.stderr, new RegExp(MISSING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), goals.join(' '));
  }
});

test('without the package, install-tools runs the bootstrap installer of npm and refuses another tool', (t) => {
  const root = repository(t);
  const dry = make(root, '-n', 'install-tools', 'TOOLS=npm', 'ONLINE=online-wrapper');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), 'online-wrapper node scripts/kit/bootstrap/bootstrap.mts');
  const other = make(root, 'install-tools', 'TOOLS=go');
  assert.equal(other.status, 2, other.stdout);
  assert.match(other.stdout + other.stderr, /install-tools: only TOOLS=npm runs before the package is installed; run make install, which runs install-tools TOOLS=npm, install-packages, install-tools and install-link/);
});

test('install-packages runs npm ci with the pinned npm of var/tools, with or without the package', (t) => {
  const root = repository(t);
  const dry = make(root, '-n', 'install-packages', 'ONLINE=online-wrapper');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `online-wrapper ${tool(root, 'npm')} ci`);
  mkdirSync(path.join(root, 'node_modules/@polyspec/kit/dist'), { recursive: true });
  cpSync(path.join(KIT, 'kit.mk'), path.join(root, 'node_modules/@polyspec/kit/dist/kit.mk'));
  assert.equal(make(root, '-n', 'install-packages').stdout.trim(), `${tool(root, 'npm')} ci`);
});

test('with the package, the kit.mk of its dist runs the built tools', (t) => {
  const root = repository(t);
  mkdirSync(path.join(root, 'node_modules/@polyspec/kit/dist'), { recursive: true });
  cpSync(path.join(KIT, 'kit.mk'), path.join(root, 'node_modules/@polyspec/kit/dist/kit.mk'));
  const dry = make(root, '-n', 'docs-check');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `${tool(root, 'node')} node_modules/@polyspec/kit/dist/check-documents.mjs`);
  assert.equal(make(root, '-n', 'install-tools', 'TOOLS=go').stdout.trim(), `${tool(root, 'node')} node_modules/@polyspec/kit/dist/install-tools.mjs go`, 'install-tools is the target of the package');
});

test('without the package, a recipe of the repository that runs before install-packages starts the node of the checkout as $(NODE) (K185)', (t) => {
  // A repository step that install-packages needs, such as one that orders a JSON file before npm ci, runs before kit.mk
  // exists; an empty $(NODE) made it hard-code var/tools/bin/node.
  const root = repository(t);
  writeFileSync(path.join(root, 'Makefile'), 'include scripts/kit/kit-bootstrap.mk\ninstall-packages: ordered\n.PHONY: ordered\nordered:\n\t$(NODE) ordered.mjs\n');
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const file of ['node', 'npm']) writeFileSync(path.join(root, 'var/tools/bin', file), `#!/bin/sh\necho "${file} of the checkout: $*"\n`, { mode: 0o755 });
  const run = make(root, 'install-packages');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout, `${tool(root, 'node')} ordered.mjs\nnode of the checkout: ordered.mjs\n${tool(root, 'npm')} ci\nnpm of the checkout: ci\n`);
});

test('npm of install-packages and of dependency-review gets allow-remote=root from one setting, so a lock that pins a URL installs and updates (K189)', (t) => {
  // dependency-review UPDATE=1 ran npm audit fix without allow-remote, and npm refused the URL-pinned @polyspec/kit (EALLOWREMOTE).
  const root = repository(t);
  mkdirSync(path.join(root, 'node_modules/@polyspec/kit/dist'), { recursive: true });
  cpSync(path.join(KIT, 'kit.mk'), path.join(root, 'node_modules/@polyspec/kit/dist/kit.mk'));
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const file of ['node', 'npm']) writeFileSync(path.join(root, 'var/tools/bin', file), `#!/bin/sh\necho "${file} allow-remote=$npm_config_allow_remote: $*"\n`, { mode: 0o755 });
  const lines = (...goal: string[]) => make(root, '-s', ...goal).stdout.split('\n').filter(line => line.includes(' allow-remote='));
  assert.deepEqual(lines('install-packages'), ['npm allow-remote=root: ci']);
  assert.deepEqual(lines('dependency-review', 'UPDATE=1'), ['node allow-remote=root: node_modules/@polyspec/kit/dist/dependency-review.mjs --update']);
  assert.deepEqual(lines('docs-check'), ['node allow-remote=: node_modules/@polyspec/kit/dist/check-documents.mjs'], 'another recipe does not get it');
});

test('make install runs the bootstrap of kit first, then the install steps that the repository adds to install (K246-2)', (t) => {
  const root = repository(t);
  writeFileSync(path.join(root, 'Makefile'), 'include scripts/kit/kit-bootstrap.mk\ninstall: demo-install\n.PHONY: demo-install\ndemo-install: install-kit\n\t@echo demo-install\n');
  const lines = make(root, '-n', 'install').stdout.split('\n').filter(Boolean);
  const kit = lines.findIndex(line => line.includes('install-tools TOOLS=npm'));
  assert.ok(kit !== -1, `make install runs the bootstrap of kit:\n${lines.join('\n')}`);
  assert.ok(lines.indexOf('echo demo-install') > kit, `the steps of the repository follow the bootstrap:\n${lines.join('\n')}`);
});

test('install-packages runs the targets that INSTALL_PACKAGES_EXTRA names after its npm ci, in order, with the npm of var/tools and the allow-remote setting (K428)', (t) => {
  // A tools project outside the workspaces of the repository installs its own lock in a target of the repository.
  const root = repository(t);
  writeFileSync(path.join(root, 'Makefile'), 'include scripts/kit/kit-bootstrap.mk\nINSTALL_PACKAGES_EXTRA := first-extra second-extra\n.PHONY: first-extra second-extra\nfirst-extra:\n\t$(NPM) extra-one\nsecond-extra:\n\t$(NPM) extra-two\n');
  // After npm ci the package is installed: its kit.mk is there for the targets that the sub-makes read, as the stub npm assumes.
  mkdirSync(path.join(root, 'node_modules/@polyspec/kit/dist'), { recursive: true });
  cpSync(path.join(KIT, 'kit.mk'), path.join(root, 'node_modules/@polyspec/kit/dist/kit.mk'));
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/npm'), '#!/bin/sh\necho "npm allow-remote=$npm_config_allow_remote: $*"\n', { mode: 0o755 });
  const run = make(root, '-s', 'install-packages');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout, 'npm allow-remote=root: ci\nnpm allow-remote=root: extra-one\nnpm allow-remote=root: extra-two\n');
});
