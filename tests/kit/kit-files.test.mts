// The files that the package @polyspec/kit ships and what they need (K582): a consumer that type-checks a shipped source of kit
// through the per-file links of K558 resolves its imports from the consumer's own node_modules, which holds the dependencies of kit
// and none of its devDependencies, so the type package of each module that a shipped source imports is a dependency.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isJsonObject, readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { kitPackageRoot } from '../../scripts/kit/kit-files.mts';

test('the type package of each module that a shipped source imports is a dependency, not a devDependency (K582)', () => {
  const root = kitPackageRoot();
  const development = readJsonObject(root, 'package.json').devDependencies;
  const sources = readdirSync(path.join(root, 'scripts/kit'), { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.mts'));
  const imported = new Set(sources.flatMap(file => [...readFileSync(path.join(root, 'scripts/kit', file), 'utf8').matchAll(/^import\s[^;]*?from '([^'.][^']*)'/gm)].map(match => match[1] ?? '')));
  const typeOf = (name: string) => `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
  const misplaced = [...imported].filter(name => !name.startsWith('node:')).map(typeOf).filter(types => isJsonObject(development) && development[types] !== undefined);
  assert.deepEqual(misplaced, []);
});
