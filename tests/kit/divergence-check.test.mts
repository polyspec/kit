// Tests of scripts/kit/divergence-check.mts (K315): each way to let an implementation differ from the contract without a unit that
// says so is a finding, and the same code outside an implementation root, in a comment or in kit itself is not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkedSources, divergenceFindings, reasonKind } from '../../scripts/kit/divergence-check.mts';

import { tree } from './tree.mts';

const run = (texts: Record<string, string>) => divergenceFindings(Object.keys(texts), file => texts[file]);
const PARITY = JSON.stringify({ implementations: [{ name: 'php', roots: ['packages/php'] }, { name: 'ts', roots: ['packages/ts'] }] });

test('a test that branches on the extension, the runtime or the platform is a finding, in each language (K315)', () => {
  assert.deepEqual(run({
    'config/parity.json': PARITY,
    'packages/php/tests/ModelTest.php': "<?php\nif (extension_loaded('x')) { self::assertTrue(true); }\n$v = PHP_VERSION;\n",
    'packages/ts/tests/a.test.ts': "const windows = process.platform === 'win32';\n",
  }), [
    "packages/php/tests/ModelTest.php:2: a test branches on the implementation, the runtime or the platform (extension_loaded), so it asserts something else in another implementation",
    "packages/php/tests/ModelTest.php:3: a test branches on the implementation, the runtime or the platform (PHP_VERSION), so it asserts something else in another implementation",
    "packages/ts/tests/a.test.ts:1: a test branches on the implementation, the runtime or the platform (process.platform), so it asserts something else in another implementation",
  ]);
  assert.deepEqual(run({ 'config/parity.json': PARITY, 'packages/php/tests/a_test.php': '<?php\n// extension_loaded is read here in a comment\n', 'docs/a.md': 'extension_loaded' }), [], 'a comment and a document are no branch');
});

test('the code of an implementation that reads whether another implementation is present is a finding (K315)', () => {
  assert.deepEqual(run({ 'config/parity.json': PARITY, 'packages/php/src/bootstrap.php': "<?php\nif (!extension_loaded('polyspec_x')) { require 'X.php'; }\n", 'scripts/tool.php': "<?php\nextension_loaded('x');\n" }), [
    'packages/php/src/bootstrap.php:2: the code of an implementation branches on the presence of another implementation (extension_loaded), so the library and its extension coexist through a guard of the run time',
  ]);
});

test('--exclude-group in a script or a Makefile, and a partial or unsupported feature, are findings (K315)', () => {
  assert.deepEqual(run({
    Makefile: 'test:\n\tphpunit --exclude-group php\n',
    'scripts/run.mts': "const args = ['--', '--exclude-group', 'slow'];\n",
    'contracts/features.json': '{\n  "createForm": {\n    "python": "partial",\n    "go": "supported",\n    "rust": "unsupported"\n  }\n}\n',
  }), [
    'Makefile:2: --exclude-group narrows the run of an implementation',
    'contracts/features.json:3: the feature file declares an implementation partial; every implementation holds every unit (S6)',
    'contracts/features.json:5: the feature file declares an implementation unsupported; every implementation holds every unit (S6)',
    'scripts/run.mts:1: --exclude-group narrows the run of an implementation',
  ]);
});

test('an exception of a configuration whose reason names no kind of kit is a finding, and each kind passes (K315)', () => {
  const duplication = JSON.stringify({ schema: 1, exclude: [{ glob: 'tests/**', reason: 'a test states its case in full' }, { glob: 'gen/**', reason: 'generated: the tables of a generator' }] }, null, 2);
  const parity = JSON.stringify({ implementations: [{ name: 'php', roots: ['packages/php'], internal: [{ glob: 'packages/php/tests/Internal*.php', reason: 'private helpers' }] }], tools: [{ root: 'packages/editor', reason: 'harness: the editor tests' }, { root: 'packages/other', reason: 'because' }] }, null, 2);
  assert.deepEqual(run({ 'config/duplication.json': duplication, 'config/parity.json': parity }), [
    'config/duplication.json:5: the exception tests/** gives a reason of no kind that kit defines; begin it with one of generated: fixture: test: harness: ecosystem: external:',
    'config/parity.json:10: the exception packages/php/tests/Internal*.php gives a reason of no kind that kit defines; begin it with one of generated: fixture: test: harness: ecosystem: external:',
    'config/parity.json:22: the exception packages/other gives a reason of no kind that kit defines; begin it with one of generated: fixture: test: harness: ecosystem: external:',
  ]);
  for (const kind of ['generated', 'fixture', 'test', 'harness', 'ecosystem', 'external']) assert.equal(reasonKind(`${kind}: why`), true);
  assert.equal(reasonKind('because'), false);
});

test('the tools and tests of kit itself are left out (K315)', () => {
  assert.deepEqual(run({ 'tests/kit/a.test.mts': "process.platform; extension_loaded('x')", 'config/parity.json': PARITY }), []);
});

test('a guard of the library that defines a function only when the extension does not is a finding, also in a generated source that Git ignores (K329)', (t) => {
  assert.deepEqual(run({ 'config/parity.json': PARITY, 'packages/php/src/Machine.php': "<?php\nif (!function_exists('Acme\\initial')) {\n    function initial() {}\n}\n" }), [
    'packages/php/src/Machine.php:2: the code of an implementation branches on the presence of another implementation (function_exists), so the library and its extension coexist through a guard of the run time',
  ]);
  const root = tree(t, { 'config/parity.json': PARITY, '.gitignore': 'packages/php/src/generated/\n' });
  mkdirSync(path.join(root, 'packages/php/src/generated'), { recursive: true });
  writeFileSync(path.join(root, 'packages/php/src/generated/Gen.php'), "<?php\nif (!function_exists('x')) {}\n");
  const read = (file: string) => { try { return readFileSync(path.join(root, file), 'utf8'); } catch { return undefined; } };
  const files = checkedSources(root, ['config/parity.json'], read);
  assert.deepEqual(files, ['config/parity.json', 'packages/php/src/generated/Gen.php']);
  assert.equal(divergenceFindings(files, read).length, 1);
});
