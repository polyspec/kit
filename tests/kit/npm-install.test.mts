// K448-2: `npm install` of a consumer links the polyspec packages of a sibling checkout from the start, with no release fetched, and
// the tracked package.json and package-lock.json stay byte for byte.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { npmInstall } from '../../scripts/kit/npm-install.mts';

test('npm install of a consumer links a sibling polyspec package from its folder and changes no tracked file (K448-2)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sibling = path.join(root, 'ordered-json');
  const project = path.join(root, 'app');
  mkdirSync(sibling, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@polyspec/ordered-json', version: '0.0.9', main: 'index.js' }));
  writeFileSync(path.join(sibling, 'index.js'), 'module.exports = 1;\n');
  // The tracked manifest names the released tarball; the sibling provides the same package.
  const tracked = JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/ordered-json': 'https://example.invalid/ordered-json-0.0.9.tgz' } }, null, 2) + '\n';
  writeFileSync(path.join(project, 'package.json'), tracked);
  writeFileSync(path.join(project, 'package-lock.json'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n');
  const lines: string[] = [];
  const took = npmInstall({ directory: project, checkouts: [sibling], print: text => lines.push(text), env: process.env });
  assert.equal(took, 'linked', lines.join('\n'));
  assert.equal(readFileSync(path.join(project, 'package.json'), 'utf8'), tracked, 'the tracked manifest is unchanged');
  assert.equal(readFileSync(path.join(project, 'package-lock.json'), 'utf8'), '{"name":"app","lockfileVersion":3,"requires":true,"packages":{}}\n', 'the tracked lock is unchanged');
  const link = path.join(project, 'node_modules/@polyspec/ordered-json');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the package is a link');
  assert.equal(realpathSync(link), realpathSync(sibling), 'the link resolves to the sibling folder');
  assert.equal(readlinkSync(link).startsWith('/'), true, 'the link is absolute, so it survives the move out of the temporary folder');
  assert.equal(existsSync(path.join(project, 'node_modules/@polyspec/ordered-json/index.js')), true);
});

// K448-7: the checkouts that the CLI is given are linked whatever their origin, and a declared polyspec package without a checkout fails
// instead of running npm ci of the tracked lock.
test('the CLI links the checkouts that it is given, whatever their name and origin, and fails for a declared polyspec package with none (K448-7)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-npm-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'deep/nested/left-x');
  mkdirSync(checkout, { recursive: true });
  writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: 'left-x', version: '0.0.1', main: 'index.js' }));
  writeFileSync(path.join(checkout, 'index.js'), 'module.exports = 2;\n');
  const project = path.join(root, 'app');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { 'left-x': 'https://example.invalid/left-x.tgz' } }));
  const cli = fileURLToPath(new URL('../../scripts/kit/npm-install.mts', import.meta.url));
  const linked = spawnSync(process.execPath, [cli, project, checkout], { encoding: 'utf8', env: { ...process.env, NPM_BIN: 'npm' } });
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(lstatSync(path.join(project, 'node_modules/left-x')).isSymbolicLink(), true, 'the explicit checkout is linked, not skipped');
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: { '@polyspec/missing': 'https://example.invalid/missing.tgz' } }));
  const missing = spawnSync(process.execPath, [cli, project, checkout], { encoding: 'utf8', env: { ...process.env, NPM_BIN: 'npm' } });
  assert.notEqual(missing.status, 0, 'a declared polyspec package with no checkout fails');
  assert.match(missing.stderr, /@polyspec\/missing has no checkout/);
});
