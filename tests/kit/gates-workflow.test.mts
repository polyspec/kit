// Tests of the gates workflow that kit vendors to every repository (workflows/gates.yml, K270): it runs make -k kit-gates with
// the commit range of the run, and kit-gates reaches every make target that a rule of PRINCIPLES.md names as its check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertWorkflowPackageBootstrap } from './workflow-package-bootstrap.mts';
import { fileURLToPath } from 'node:url';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

test('the gates workflow runs make -k kit-gates, which names every make target that a rule of PRINCIPLES.md is enforced by (K270)', () => {
  assert.match(read('workflows/gates.yml'), /^\s+run: make -k kit-gates RANGE="\$range"$/m);
  const rule = /^kit-gates:([^#\n]*)/m.exec(read('scripts/kit/kit.mk'));
  assert.ok(rule, 'kit.mk defines kit-gates');
  const gates = new Set((rule[1] ?? '').trim().split(/\s+/));
  const enforced = read('PRINCIPLES.md').split('\n').filter(line => line.trim().startsWith('Enforced by:')).join('\n');
  const named = new Set([...enforced.matchAll(/`make ([a-z0-9-]+)`/g)].map(match => match[1]));
  assert.ok(named.size > 10, 'the rules of PRINCIPLES.md name their checks');
  for (const target of named) assert.ok(gates.has(target ?? ''), `kit-gates runs make ${target}`);
});

test('kit ships the gates workflow source with its npm package (K270, K614)', () => {
  const manifest = readJsonObject(ROOT, 'package.json');
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes('workflows/gates.yml'), 'the published package ships the gates workflow');
  assert.match(read('workflows/gates.yml'), /^name: gates$/m);
});

test('K671-3: gates bootstrap the installed package with exact npm before Make, while kit skips it', { timeout: 5000 }, (t) => {
  assertWorkflowPackageBootstrap(read('workflows/gates.yml'), t);
});

test('K473: the gates workflow runs make link after install and before the gates', () => {
  const workflow = read('workflows/gates.yml');
  const link = workflow.indexOf('        run: make link\n');
  assert.ok(link !== -1, 'a step runs make link');
  assert.ok(workflow.indexOf('      - name: install\n') < link, 'make link runs after install');
  assert.ok(link < workflow.indexOf('      - name: gates\n'), 'make link runs before the gates');
});

test('K671-3: gates use the standard root checkout and retain the native installation sequence', () => {
  const workflow = read('workflows/gates.yml');
  assert.doesNotMatch(workflow, /working-directory:|path: \$\{\{ github\.event\.repository\.name/);
  assert.match(workflow, /node-version-file: mise\.toml/);
  const commands = [...workflow.matchAll(/^        run: (make .+)$/gm)].map(match => match[1]);
  assert.deepEqual(commands.slice(0, 3), ['make install-tools TOOLS=npm', 'make install-packages', 'make install']);
});

test('kit-gates runs the full parity check, which runs only in CI, so every implementation runs its bindings in the gates (S6, K272)', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.match(kitMk, /^kit-gates:[^#\n]* parity-check /m);
  assert.match(kitMk, /^ifneq \(\$\(filter parity-check kit-gates,\$\(MAKECMDGOALS\)\),\)$/m, 'the CI guard of parity-check covers kit-gates');
});

// K515: a tracked lock records the release of each polyspec package (K448, K507), so kit has no check that a tracked file names
// none and no config/polyspec.json; gates install the committed package locks.
test('K515: kit runs no polyspec lock check and reads no config/polyspec.json', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.doesNotMatch(kitMk, /polyspec-lock-check/);
  assert.doesNotMatch(read('PRINCIPLES.md'), /config\/polyspec\.json/);
  assert.doesNotMatch(read('workflows/gates.yml'), /config\/polyspec\.json/);
});
