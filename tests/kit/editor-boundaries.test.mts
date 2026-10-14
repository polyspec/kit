// Tests of scripts/kit/check-editor-boundaries.mts: the boundaries of config/editor-boundaries.json are checked on every
// file that the sources of a package reach through relative imports, and a configuration outside the schema is refused.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { checkBoundaries } from '../../scripts/kit/check-editor-boundaries.mts';
import { tree } from './tree.mts';
import { known } from './known.mts';

const TOOL = path.resolve('scripts/kit/check-editor-boundaries.mts');

// An adapter may not import or declare the parser; the service may not use Node.js, an editor or the DOM outside its
// command line.
const CONFIG = {
  schema: 1,
  boundaries: [
    { packages: ['packages/adapter'], sources: 'src', forbiddenModules: ['@example/parser', '@example/parser/**'] },
    { packages: ['packages/service'], sources: 'src', forbiddenModules: ['node:**', 'vscode', '@codemirror/**'], forbiddenGlobals: ['window', 'document', 'process'], exempt: ['src/cli/**'] },
  ],
};
const PACKAGES = {
  'packages/adapter/package.json': '{ "name": "@example/adapter", "dependencies": { "@example/service": "1" } }',
  'packages/adapter/src/index.ts': "import { open } from '@example/service';\nexport const start = (): string => open();\n",
  'packages/service/package.json': '{ "name": "@example/service" }',
  'packages/service/src/index.ts': "export { open } from './open.js';\n",
  'packages/service/src/open.ts': "// Opens the document.\nexport const open = (document: { text: string } = { text: '' }): string => document.text;\n",
  'packages/service/src/cli/main.ts': "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync(process.argv[2]!, 'utf8'));\n",
};

const boundaryFindings = (root: string): string[] => checkBoundaries(root).findings;
const checkout = (t: TestContext, files: Record<string, string | null> = {}, config: unknown = CONFIG) =>
  tree(t, { 'config/editor-boundaries.json': JSON.stringify(config), ...PACKAGES, ...files });

test('packages within their boundaries pass, the command line of the service may use Node.js, and the command prints the count', (t) => {
  const root = checkout(t);
  assert.deepEqual(boundaryFindings(root), []);
  const run = spawnSync(process.execPath, [TOOL], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '[editor-boundaries] 2 packages of 2 boundaries passed, 3 files checked\n');
});

test('an adapter that imports a forbidden module through a re-export outside its sources fails with the import chain', (t) => {
  const root = checkout(t, {
    'packages/adapter/src/index.ts': "export { parse } from '../../shared/parse.ts';\n",
    'packages/shared/parse.ts': "export * from '@example/parser';\n",
  });
  assert.deepEqual(boundaryFindings(root), ['packages/adapter/src/index.ts -> packages/shared/parse.ts: imports @example/parser']);
  const run = spawnSync(process.execPath, [TOOL], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(run.stderr, 'packages/adapter/src/index.ts -> packages/shared/parse.ts: imports @example/parser\n');
});

test('an unknown rule key is refused before any package is read', (t) => {
  const config = { ...CONFIG, boundaries: [{ ...CONFIG.boundaries[0], forbiddenModule: ['x'] }] };
  const findings = boundaryFindings(checkout(t, {}, config));
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(known(findings[0], 'findings[0]'), /^config\/editor-boundaries\.json: .*forbiddenModule.*not in the schema|^config\/editor-boundaries\.json: .*additional/);
});

test('every way of importing a forbidden module and declaring it fails', (t) => {
  const root = checkout(t, {
    'packages/adapter/package.json': '{ "name": "@example/adapter", "devDependencies": { "@example/parser": "1" } }',
    'packages/adapter/src/index.ts': [
      "import type { Tree } from '@example/parser';",
      "import '@example/parser/side';",
      "export const load = async (): Promise<unknown> => import('@example/parser');",
      "export type { Tree };",
    ].join('\n'),
    'packages/adapter/src/legacy.cts': "const parser = require('@example/parser');\nmodule.exports = parser;\n",
  });
  assert.deepEqual(boundaryFindings(root), [
    'packages/adapter/package.json: declares @example/parser in devDependencies',
    'packages/adapter/src/index.ts: imports @example/parser/side',
    'packages/adapter/src/index.ts: imports @example/parser',
    'packages/adapter/src/legacy.cts: imports @example/parser',
  ]);
});

test('the service fails on a Node.js or editor module, a global by its scope, and a command line file that the library reaches', (t) => {
  const root = checkout(t, {
    'packages/service/src/index.ts': "export { open } from './open.js';\nexport { args } from './cli/args.js';\n",
    'packages/service/src/cli/args.ts': "export const args = (): string[] => process.argv.slice(2);\n",
    'packages/service/src/view.ts': "import * as vscode from 'vscode';\nexport const body = (): unknown => [document.body, globalThis.window, vscode];\n",
  });
  assert.deepEqual(boundaryFindings(root), [
    'packages/service/src/view.ts: imports vscode',
    'packages/service/src/view.ts: uses the global document',
    'packages/service/src/view.ts: uses the global window',
    'packages/service/src/index.ts -> packages/service/src/cli/args.ts: uses the global process',
  ]);
});

test('an import that the check cannot follow is a finding, never skipped', (t) => {
  const root = checkout(t, {
    'packages/service/src/index.ts': "export { open } from './open';\nexport const load = (name: string): Promise<unknown> => import(name);\nimport '#internal';\n",
  });
  assert.deepEqual(boundaryFindings(root), [
    'packages/service/src/index.ts: imports ./open, which is no file; a relative import names its file, with .js for a .ts file',
    'packages/service/src/index.ts: imports a computed specifier, which the check cannot follow',
    'packages/service/src/index.ts: imports #internal, a subpath import, which the check cannot follow',
  ]);
});

test('a source that is not JavaScript or TypeScript of the check fails with its name', (t) => {
  const root = checkout(t, { 'packages/service/src/view.tsx': 'export const view = <div />;\n' });
  assert.deepEqual(boundaryFindings(root), ['packages/service/src/view.tsx: is a .tsx file, which the check does not read']);
});

test('a package directory or source directory that does not exist fails', (t) => {
  const config = { ...CONFIG, boundaries: [{ ...CONFIG.boundaries[0], packages: ['packages/missing'] }] };
  assert.deepEqual(boundaryFindings(checkout(t, {}, config)), ['packages/missing/src: the sources of the package do not exist']);
});
