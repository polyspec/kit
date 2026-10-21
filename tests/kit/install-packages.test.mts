// K448-8: install-packages of kit-bootstrap.mk, which every consumer's make install reaches, installs the packages of package-lock.json with
// make npm-install DIR=. (link from the start, K448-6), not with a bare npm ci, so a sibling-provided polyspec package that the lock pins from
// a release URL is linked and no release is fetched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bootstrap = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/kit-bootstrap.mk');

test('install-packages of the bootstrap runs make npm-install DIR=. in place of npm ci (K448-8)', () => {
  const lines = readFileSync(bootstrap, 'utf8').split('\n');
  const start = lines.findIndex(line => line.startsWith('install-packages:'));
  assert.notEqual(start, -1, 'install-packages is defined in kit-bootstrap.mk');
  const recipe: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break;
    recipe.push(line);
  }
  assert.ok(recipe.some(line => /\$\(MAKE\)[^\n]*npm-install DIR=\./.test(line)), recipe.join('\n'));
  assert.ok(!recipe.some(line => /\$\(NPM\) ci|\bnpm ci\b/.test(line)), recipe.join('\n'));
});
