// The bootstrap of a repository (scripts/kit/bootstrap): the installer of the pinned npm and the modules it imports, which a
// repository holds as copies, because they run before the package @polyspec/kit is installed. kit holds them once, in
// scripts/kit/bootstrap, and the other tools import them there. They import only Node.js built-ins and each other, so the copy
// runs alone; the installer first requires the running node to be the release of .node-version.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');
const BOOTSTRAP = path.join(KIT, 'bootstrap');
const MODULES = ['bootstrap', 'digest', 'files', 'install-mise', 'install-npm', 'install-tool', 'tool-wrappers', 'toolchain-declared'];

test('the bootstrap modules are in scripts/kit/bootstrap, once', () => {
  assert.deepEqual(existsSync(BOOTSTRAP) ? readdirSync(BOOTSTRAP).sort() : [], MODULES.map(name => `${name}.mts`));
  assert.deepEqual(MODULES.filter(name => existsSync(path.join(KIT, `${name}.mts`))), [], 'these modules are also at the top of scripts/kit');
});

test('a bootstrap module imports only Node.js built-ins and the modules of its directory', () => {
  for (const name of MODULES) {
    const text = readFileSync(path.join(BOOTSTRAP, `${name}.mts`), 'utf8');
    for (const [, specifier] of text.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
      if (specifier === undefined) throw new Error(`${name}: an import matched without its specifier`);
      assert.ok(specifier.startsWith('node:') || /^\.\/[a-z-]+\.mts$/.test(specifier), `${name}.mts imports ${specifier}`);
    }
  }
});

/** A repository that holds only the copy of scripts/kit/bootstrap, with `files`; removed with `t.after`. */
function copied(t: TestContext, files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-bootstrap-copy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts/kit'), { recursive: true });
  cpSync(BOOTSTRAP, path.join(root, 'scripts/kit/bootstrap'), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, file), text);
  const run = spawnSync(process.execPath, ['scripts/kit/bootstrap/bootstrap.mts'], { cwd: root, encoding: 'utf8' });
  return { root, run };
}

test('the copied installer stops before any install when the running node is not the release of .node-version', (t) => {
  const { root, run } = copied(t, { '.node-version': '20.0.0\n', 'package.json': '{ "packageManager": "npm@12.2.0" }\n' });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, `[bootstrap] node ${process.versions.node} is running, but .node-version pins 20.0.0; install node 20.0.0 and run make install-tools TOOLS=npm again\n`);
  assert.equal(existsSync(path.join(root, 'var')), false, 'the installer wrote var/');
});

test('the copied installer stops when .node-version is missing', (t) => {
  const { run } = copied(t, { 'package.json': '{ "packageManager": "npm@12.2.0" }\n' });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, '[bootstrap] .node-version is missing; it pins the Node.js release that installs npm\n');
});

test('with the node of .node-version the copied installer reads packageManager, and names it when it is missing', (t) => {
  const { run } = copied(t, { '.node-version': `${process.versions.node}\n`, 'package.json': '{}\n' });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, '[bootstrap] package.json packageManager is "", expected npm@<major>.<minor>.<patch> or npm@<major>.<minor>.<patch>+sha512.<128 hexadecimal digits>\n');
});

test('with the node of .node-version and no package.json the copied installer names package.json', (t) => {
  const { run } = copied(t, { '.node-version': `${process.versions.node}\n` });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, '[bootstrap] package.json is missing; its packageManager pins the npm to install\n');
});

test('printedRelease reads only a missing command as no installation: another error and an output without a release fail', async (t) => {
  const { printedRelease } = await import('../../scripts/kit/bootstrap/tool-wrappers.mts');
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-printed-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(printedRelease(path.join(directory, 'missing'), 'uv'), undefined);
  const command = path.join(directory, 'uv');
  writeFileSync(command, '#!/bin/sh\necho "uv twelve"\n', { mode: 0o755 });
  assert.throws(() => printedRelease(command, 'uv'), /uv --version printed no release: "uv twelve"$/);
  // A command that cannot run, a file without execute permission, fails with EACCES and is no missing installation. A file
  // keeps the directory removable by a plain rm -r, also when a run is killed before t.after (a directory without
  // permissions was left behind so).
  const unrunnable = path.join(directory, 'uv-unrunnable');
  writeFileSync(unrunnable, '#!/bin/sh\necho "uv 0.12.24"\n', { mode: 0o644 });
  assert.throws(() => printedRelease(unrunnable, 'uv'), { code: 'EACCES' });
  assert.deepEqual(readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isDirectory() && (statSync(path.join(entry.parentPath, entry.name)).mode & 0o500) !== 0o500).map(entry => entry.name), [], 'a directory without read and search permission');
});
