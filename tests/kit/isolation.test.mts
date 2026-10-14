// kit depends on no repository: the tools import only Node built-ins, files of scripts/kit and the packages that
// package.json declares in dependencies or peerDependencies, and neither the tools nor the tests name another repository. A repository
// differs from another only in config/*.json.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFixture } from './json-fixture.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';
import { known } from './known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY_NAMES = /\b(template|crudui|hyper|ordered-json|orm|limepie)\b/i;

const files = (directory: string): string[] => readdirSync(path.join(ROOT, directory)).sort().flatMap((entry) => {
  const relative = `${directory}/${entry}`;
  if (relative === 'tests/kit/fixture') return [];
  return statSync(path.join(ROOT, relative)).isDirectory() ? files(relative) : [relative];
});
const tools = files('scripts/kit');
// This file lists the names, so it is the one file the scan skips.
const sources = [...tools, ...files('tests/kit')].filter(file => /\.(mts|json|mk)$/.test(file) && file !== 'tests/kit/isolation.test.mts');

/** The package that a bare import specifier names: `@scope/name` or `name`, without a subpath. */
const packageOf = (specifier: string) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/**
 * Whether the module `file` of scripts/kit may import `specifier`: a node: built-in, a file of scripts/kit, or a package
 * that package.json declares in `dependencies` or `peerDependencies`. A module of scripts/kit/bootstrap runs before npm installs the packages,
 * so it imports only node: built-ins and files of its own directory.
 */
function allowedImport(file: string, specifier: string, dependencies: readonly string[]) {
  if (specifier.startsWith('node:')) return true;
  if (specifier.startsWith('./')) return !specifier.slice(2).includes('..') && !(file.startsWith('scripts/kit/bootstrap/') && specifier.slice(2).includes('/'));
  return !file.startsWith('scripts/kit/bootstrap/') && dependencies.includes(packageOf(specifier));
}

const PACKAGE = readFixture<NpmManifest>(ROOT, 'package.json');
// The packages that kit declares, by the field of package.json that declares each: a peer dependency, such as the
// @vscode/test-electron of install-vscode.mts, is one that the repository which runs the tool installs.
const DECLARED = (['dependencies', 'peerDependencies'] as const).flatMap(field => Object.keys(PACKAGE[field] ?? {}).map(name => ({ field, name })));
const DEPENDENCIES = DECLARED.map(({ name }) => name);
// The specifiers of the imports of a module: `from '…'`, `import '…'` and `import('…')`.
const importsOf = (text: string) => [...text.matchAll(/(?:from|import\(?)\s*'([^']+)'/g)].map(([, specifier]) => known(specifier, 'specifier'));

test('the import rule allows built-ins, files of scripts/kit and declared packages, and keeps bootstrap to built-ins', () => {
  const declared = ['ajv', '@scope/name'];
  assert.ok(allowedImport('scripts/kit/x.mts', 'node:fs', declared));
  assert.ok(allowedImport('scripts/kit/x.mts', './y.mts', declared));
  assert.ok(allowedImport('scripts/kit/x.mts', './bootstrap/files.mts', declared));
  assert.ok(allowedImport('scripts/kit/x.mts', 'ajv', declared), 'a declared package');
  assert.ok(allowedImport('scripts/kit/x.mts', 'ajv/dist/2020.js', declared), 'a subpath of a declared package');
  assert.ok(allowedImport('scripts/kit/x.mts', '@scope/name/sub', declared), 'a subpath of a declared scoped package');
  assert.ok(!allowedImport('scripts/kit/x.mts', 'picomatch', declared), 'an undeclared package');
  assert.ok(!allowedImport('scripts/kit/x.mts', '@scope/other', declared), 'an undeclared scoped package');
  assert.ok(!allowedImport('scripts/kit/x.mts', '../tests/kit/y.mts', declared), 'a file outside scripts/kit');
  assert.ok(!allowedImport('scripts/kit/x.mts', './a/../../y.mts', declared), 'a path that leaves scripts/kit');
  assert.ok(allowedImport('scripts/kit/bootstrap/x.mts', './files.mts', declared));
  assert.ok(!allowedImport('scripts/kit/bootstrap/x.mts', 'ajv', declared), 'bootstrap runs before npm installs the packages');
  assert.ok(!allowedImport('scripts/kit/bootstrap/x.mts', './schema/x.json', declared), 'bootstrap imports files of its own directory only');
});

test('a kit tool imports only Node built-ins, files of scripts/kit and the declared dependencies', () => {
  const modules = tools.filter((name: string) => name.endsWith('.mts'));
  // An empty selection would pass without checking anything, as it did when the tools were renamed (K71-1).
  assert.ok(modules.length > 0, 'the scan found the modules of scripts/kit');
  assert.ok(modules.some(file => file.startsWith('scripts/kit/bootstrap/')), 'the scan found the modules of scripts/kit/bootstrap');
  for (const file of modules) {
    for (const specifier of importsOf(readFileSync(path.join(ROOT, file), 'utf8'))) {
      assert.ok(allowedImport(file, specifier, DEPENDENCIES), `${file} imports ${specifier}, which is neither a node: built-in, a file of scripts/kit nor a package of dependencies or peerDependencies in package.json${file.startsWith('scripts/kit/bootstrap/') ? ' (a bootstrap module imports only node: built-ins and files of scripts/kit/bootstrap)' : ''}`);
    }
  }
});

test('every package of dependencies and peerDependencies in package.json is used by a kit tool', () => {
  // A package is used when a tool imports it, when a tool runs one of its commands (the name of a command of its bin, as a
  // quoted string of a tool, such as the knip that lint-ts.mts runs), or when it is a peer dependency of a used package,
  // such as the oxlint-tsgolint that oxlint loads for --type-aware; the manifests of node_modules say which.
  const texts = tools.filter(name => name.endsWith('.mts')).map(file => readFileSync(path.join(ROOT, file), 'utf8'));
  const manifest = (name: string) => readFixture<NpmManifest>(ROOT, `node_modules/${name}/package.json`);
  const commands = (name: string) => { const { bin } = manifest(name); return typeof bin === 'string' ? [known(name.split('/').at(-1), 'name.split(…).at(-1)')] : Object.keys(bin ?? {}); };
  const used = new Set(texts.flatMap(importsOf).map(packageOf));
  for (const { name } of DECLARED) if (commands(name).some(command => texts.some(text => text.includes(`'${command}'`)))) used.add(name);
  for (const name of DEPENDENCIES.filter(name => used.has(name))) for (const peer of Object.keys(manifest(name).peerDependencies ?? {})) used.add(peer);
  for (const { field, name } of DECLARED) assert.ok(used.has(name), `package.json declares ${name} in ${field}, and no module of scripts/kit imports it, runs its command or uses a package that it is a peer of; remove it`);
});

test('no tool or test of kit names another repository', () => {
  assert.ok(sources.some(file => file.endsWith('.mts')), 'the scan found the modules and tests of kit');
  for (const file of sources) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const hit = REPOSITORY_NAMES.exec(line.replaceAll('github.com/polyspec/kit', ''));
      assert.equal(hit, null, `${file}:${index + 1} names the repository ${hit?.[0]}: ${line.trim()}`);
    });
  }
});
