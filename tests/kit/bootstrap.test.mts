// The bootstrap of a repository (scripts/kit/bootstrap): the installer of the pinned npm and the modules it imports, which a
// repository holds as copies, because they run before the package @polyspec/kit is installed. kit holds them once, in
// scripts/kit/bootstrap, and the other tools import them there. They import only Node.js built-ins and each other, so the copy
// runs alone; the installer first requires the running node to be the release of .node-version.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');
const BOOTSTRAP = path.join(KIT, 'bootstrap');
const MODULES = ['bootstrap-npm', 'digest', 'files', 'install-npm', 'install-tool', 'tool-wrappers', 'toolchain-declared'];

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
  const run = spawnSync(process.execPath, ['scripts/kit/bootstrap/bootstrap-npm.mts'], { cwd: root, encoding: 'utf8' });
  return { root, run };
}

test('the copied installer stops before any install when the running node is not the release of .node-version', (t) => {
  const { root, run } = copied(t, { '.node-version': '20.0.0\n', 'package.json': '{ "packageManager": "npm@12.2.0" }\n' });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, `[bootstrap-npm] node ${process.versions.node} is running, but .node-version pins 20.0.0; install node 20.0.0 and run make install-tools TOOLS=npm again\n`);
  assert.equal(existsSync(path.join(root, 'var')), false, 'the installer wrote var/');
});

test('the copied installer stops when .node-version is missing', (t) => {
  const { run } = copied(t, { 'package.json': '{ "packageManager": "npm@12.2.0" }\n' });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, '[bootstrap-npm] .node-version is missing; it pins the Node.js release that installs npm\n');
});

test('with the node of .node-version the copied installer reads packageManager, and names it when it is missing', (t) => {
  const { run } = copied(t, { '.node-version': `${process.versions.node}\n`, 'package.json': '{}\n' });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, '[bootstrap-npm] package.json packageManager is "", expected npm@<major>.<minor>.<patch> or npm@<major>.<minor>.<patch>+sha512.<128 hexadecimal digits>\n');
});

test('with the node of .node-version and no package.json the copied installer names package.json', (t) => {
  const { run } = copied(t, { '.node-version': `${process.versions.node}\n` });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, '[bootstrap-npm] package.json is missing; its packageManager pins the npm to install\n');
});
