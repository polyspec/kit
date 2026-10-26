// kit depends on no repository: the tools import only Node built-ins, files of scripts/kit and the packages that
// package.json declares in dependencies or peerDependencies, and neither the tools nor the tests name another repository. A repository
// differs from another only in config/*.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFixture } from './json-fixture.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';
import { known } from './known.mts';
import { moduleImports, parseModule } from '../../scripts/kit/module-imports.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// A repository is named as a package (polyspec/<name>, also @polyspec/<name>-workspace or github.com/polyspec/<name>) or as a
// path segment (../<name>/ or '<name>/); a bare word such as template names no repository (K361).
const REPOSITORY_NAMES = /\bpolyspec\/(template|crudui|hyper|ordered-json|orm|fsm|flowmark)\b|(?:\.\.\/|['"`])(template|crudui|hyper|ordered-json|orm|fsm|flowmark)\//i;
/** The first name of another repository that a line of kit names, or null. */
const namedRepository = (line: string) => REPOSITORY_NAMES.exec(line.replaceAll('github.com/polyspec/kit', ''));

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
// The specifiers of the imports of a module, as Node.js reads it (module-imports.mts), so a string that holds the word import
// is no import; a computed specifier is named as such and fails the rule.
const importsOf = (file: string, text: string) => moduleImports(file, parseModule(file, text)).map(specifier => specifier ?? '(a computed specifier)');

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
    for (const specifier of importsOf(file, readFileSync(path.join(ROOT, file), 'utf8'))) {
      assert.ok(allowedImport(file, specifier, DEPENDENCIES), `${file} imports ${specifier}, which is neither a node: built-in, a file of scripts/kit nor a package of dependencies or peerDependencies in package.json${file.startsWith('scripts/kit/bootstrap/') ? ' (a bootstrap module imports only node: built-ins and files of scripts/kit/bootstrap)' : ''}`);
    }
  }
});

/** DefinitelyTyped packages actually read by the compiler, including scoped package encodings. */
function consumedTypePackages(files: readonly string[]): string[] {
  return files.flatMap(file => {
    if (!/\.d\.[cm]?ts$/.test(file)) return [];
    const name = /(?:^|\/)node_modules\/(@types\/[^/]+)\//.exec(file.replaceAll('\\', '/'))?.[1];
    return name === undefined ? [] : [name];
  });
}

test('type consumption counts compiler-read declarations, not unused or similarly named packages (K661-10)', () => {
  const consumed = new Set(consumedTypePackages([
    '/checkout/node_modules/@types/picomatch/index.d.ts',
    '/checkout/node_modules/@types/semver/classes/range.d.ts',
    'C:\\checkout\\node_modules\\@types\\scope__name\\index.d.ts',
    '/checkout/node_modules/picomatch/index.js',
    '/checkout/node_modules/@types/not-read/package.json',
  ]));
  assert.deepEqual([...consumed], ['@types/picomatch', '@types/semver', '@types/scope__name']);
  assert.ok(!consumed.has('@types/unused'));
});

test('every package of dependencies and peerDependencies in package.json is used by a kit tool', () => {
  // A package is used when a tool imports it, when a tool runs one of its commands (the name of a command of its bin, as a
  // quoted string of a tool, such as the knip that lint-ts.mts runs), or when it is a peer dependency of a used package,
  // such as the oxlint-tsgolint that oxlint loads for --type-aware; the manifests of node_modules say which.
  // Type declarations are consumed through TypeScript resolution rather than runtime imports. Ask the native
  // compiler which files it reads for tool sources only, so test-only imports cannot make a tool dependency used.
  const modules = tools.filter(name => name.endsWith('.mts')).map(file => ({ file, text: readFileSync(path.join(ROOT, file), 'utf8') }));
  const texts = modules.map(({ text }) => text);
  const manifest = (name: string) => readFixture<NpmManifest>(ROOT, `node_modules/${name}/package.json`);
  const commands = (name: string) => { const { bin } = manifest(name); return typeof bin === 'string' ? [known(name.split('/').at(-1), 'name.split(…).at(-1)')] : Object.keys(bin ?? {}); };
  const used = new Set(modules.flatMap(({ file, text }) => importsOf(file, text)).map(packageOf));
  for (const { name } of DECLARED) if (commands(name).some(command => texts.some(text => text.includes(`'${command}'`)))) used.add(name);
  for (const name of DEPENDENCIES.filter(name => used.has(name))) for (const peer of Object.keys(manifest(name).peerDependencies ?? {})) used.add(peer);
  const typeFiles = execFileSync(process.execPath, [
    path.join(ROOT, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--listFilesOnly',
    '--module', 'nodenext', '--types', 'node', '--allowImportingTsExtensions', '--noEmit',
    ...modules.map(({ file }) => file),
  ], { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/);
  for (const name of consumedTypePackages(typeFiles)) used.add(name);
  for (const { field, name } of DECLARED) assert.ok(used.has(name), `package.json declares ${name} in ${field}, and no module of scripts/kit imports it, runs its command, consumes its type declarations or uses a package that it is a peer of; remove it`);
});

test('no tool or test of kit names another repository', () => {
  assert.ok(sources.some(file => file.endsWith('.mts')), 'the scan found the modules and tests of kit');
  for (const file of sources) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const hit = namedRepository(line);
      assert.equal(hit, null, `${file}:${index + 1} names the repository ${hit?.[0]}: ${line.trim()}`);
    });
  }
});

test('a repository is named by its package, path or URL, not by the same English word (K361)', () => {
  for (const line of ['let template: string | undefined;', 'the hyper link of a word']) assert.equal(namedRepository(line), null, line);
  for (const [line, name] of [["'@polyspec/template-workspace'", 'template'], ['github.com/polyspec/orm', 'orm'], ["path.join(root, '../template/packages')", 'template'], ['polyspec/hyper', 'hyper']] as const) {
    const hit = namedRepository(line);
    assert.ok(hit?.[0].includes(name), `${line} names the repository ${name}`);
  }
});
