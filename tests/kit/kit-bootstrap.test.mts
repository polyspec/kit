// scripts/kit/kit-bootstrap.mk, the copy that a repository includes: it includes the kit.mk of the installed package with
// KIT := node_modules/@polyspec/kit/dist and KIT_EXT := mjs. While the package is absent it offers only the two bootstrap
// steps, install-tools TOOLS=npm and install-packages, and stops every other goal with the commands that install it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');
const MISSING = 'node_modules/@polyspec/kit/dist/kit.mk is missing; run make install-tools TOOLS=npm, then make install-packages';

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

test('without the package, a goal other than the bootstrap steps stops with the commands that install it', (t) => {
  const root = repository(t);
  for (const goals of [['documents-check'], [], ['install-packages', 'kit-check']]) {
    const run = make(root, ...goals);
    assert.equal(run.status, 2, `${goals.join(' ')}: ${run.stdout}`);
    assert.match(run.stderr, new RegExp(MISSING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), goals.join(' '));
  }
});

test('without the package, install-tools runs the bootstrap installer of npm and refuses another tool', (t) => {
  const root = repository(t);
  const dry = make(root, '-n', 'install-tools', 'TOOLS=npm', 'ONLINE=online-wrapper');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), 'online-wrapper node scripts/kit/bootstrap/bootstrap-npm.mts');
  const other = make(root, 'install-tools', 'TOOLS=go');
  assert.equal(other.status, 2, other.stdout);
  assert.match(other.stdout + other.stderr, /install-tools: only TOOLS=npm runs before the package is installed; run make install-tools TOOLS=npm, then make install-packages/);
});

test('install-packages runs npm ci with the pinned npm of var/tools, with or without the package', (t) => {
  const root = repository(t);
  const dry = make(root, '-n', 'install-packages', 'ONLINE=online-wrapper');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), 'online-wrapper var/tools/bin/npm ci');
  mkdirSync(path.join(root, 'node_modules/@polyspec/kit/dist'), { recursive: true });
  cpSync(path.join(KIT, 'kit.mk'), path.join(root, 'node_modules/@polyspec/kit/dist/kit.mk'));
  assert.equal(make(root, '-n', 'install-packages').stdout.trim(), 'var/tools/bin/npm ci');
});

test('with the package, the kit.mk of its dist runs the built tools', (t) => {
  const root = repository(t);
  mkdirSync(path.join(root, 'node_modules/@polyspec/kit/dist'), { recursive: true });
  cpSync(path.join(KIT, 'kit.mk'), path.join(root, 'node_modules/@polyspec/kit/dist/kit.mk'));
  const dry = make(root, '-n', 'documents-check');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), 'node node_modules/@polyspec/kit/dist/check-documents.mjs');
  assert.equal(make(root, '-n', 'install-tools', 'TOOLS=go').stdout.trim(), 'node node_modules/@polyspec/kit/dist/install-tools.mjs go', 'install-tools is the target of the package');
});
