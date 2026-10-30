// The bootstrap of a repository (scripts/kit/bootstrap): the installer of the pinned npm and the modules it imports, which a
// repository holds as copies, because they run before the package @polyspec/kit is installed. kit holds them once, in
// scripts/kit/bootstrap, and the other tools import them there. They import only Node.js built-ins and each other, so the copy
// runs alone. Any node that runs the copy starts it: the installer installs mise, then with it the node of mise.toml, then
// npm, and every later step runs that node (K171).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit');
// The directory of the installer that the copy starts; named through import.meta.resolve, so the import graph of
// owner-check selects this test when the installer changes (K191).
const BOOTSTRAP = path.dirname(fileURLToPath(import.meta.resolve('../../scripts/kit/bootstrap/bootstrap.mts')));
const MODULES = ['bootstrap', 'digest', 'files', 'install-mise', 'install-tool', 'tool-wrappers', 'toolchain-declared', 'verify-idempotent'];

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

test('the copied installer compares no running node and stops before any install without the mise of config/toolchain.json', (t) => {
  const { root, run } = copied(t, { 'package.json': '{ "devEngines": { "packageManager": { "name": "npm", "version": "12.2.0" } } }\n' });
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.stderr, '[bootstrap] config/toolchain.json declares no mise; declare its version and the sha256 of its archive of each platform\n');
  assert.equal(existsSync(path.join(root, 'var')), false, 'the installer wrote var/');
});

