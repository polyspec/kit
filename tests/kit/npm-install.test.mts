// K448-2: `npm install` of a consumer links the polyspec packages of a sibling checkout from the start, with no release fetched, and
// the tracked package.json and package-lock.json stay byte for byte.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
