// Tests of the gates workflow that kit vendors to every repository (workflows/gates.yml, K270): it partitions every gate named by
// PRINCIPLES.md, with a final job that requires the selected parity path and all other required partitions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertWorkflowPackageBootstrap } from './workflow-package-bootstrap.mts';
import { fileURLToPath } from 'node:url';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { GATE_REQUIRED_NEEDS } from '../../scripts/kit/ci-setup.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

function workflowJob(source: string, name: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line === `  ${name}:`);
  assert.notEqual(start, -1, `workflow defines job ${name}`);
  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
}

function workflowNeeds(block: readonly string[], name: string): string[] {
  const line = block.find(entry => entry.startsWith('    needs:'));
  assert.ok(line, `${name} declares its job dependencies`);
  const match = /^    needs: \[([^\]]*)\]$/.exec(line);
  assert.ok(match, `${name} uses an explicit complete needs list`);
  return (match[1] ?? '').split(',').map(value => value.trim()).filter(Boolean);
}

test('the gates workflow partitions every kit-gates target across shared, parity and runtime jobs (K270)', () => {
  const rule = /^kit-gates:([^#\n]*)/m.exec(read('scripts/kit/kit.mk'));
  assert.ok(rule, 'kit.mk defines kit-gates');
  const gates = new Set((rule[1] ?? '').trim().split(/\s+/));
  const mk = read('scripts/kit/kit.mk');
  const partitions = ['static', 'parity', 'runtime-ts', 'runtime-php', 'runtime-python', 'runtime-go', 'runtime-rust', 'runtime-php-ext']
    .flatMap(name => {
      const line = new RegExp(`^kit-gates-${name}:([^#\\n]*)`, 'm').exec(mk);
      assert.ok(line, `kit.mk defines kit-gates-${name}`);
      return (line[1] ?? '').trim().split(/\s+/);
    });
  assert.deepEqual([...partitions].sort(), [...gates].sort(), 'every original gate occurs once in the workflow partitions');
  const workflow = read('workflows/gates.yml');
  assert.match(workflow, /run: make -k toolchain-check TOOLS="node npm mise \$COMMON_TOOLS" kit-gates-static/);
  assert.match(workflow, /run: make -k kit-gates-parity/);
  assert.match(workflow, /kit-gates-runtime-\$\{\{ matrix\.runtime \}\}/);
  assert.match(workflow, /run: make kit-ci-plan/, 'the tracked setup planner selects runtime jobs and pinned tools');
  assert.match(workflow, /run: make kit-ci-setup GROUP=shared/);
  assert.match(workflow, /run: make kit-ci-setup GROUP=parity/);
  assert.match(workflow, /run: make kit-ci-setup GROUP=runtime RUNTIME=\$\{\{ matrix\.runtime \}\}/);
  assert.match(workflow, /join\(matrix\.installTools, ' '\)/, 'runtime tool selectors are joined into the form install-tools accepts');
  const setup = read('scripts/kit/ci-setup.mts');
  assert.match(setup, /declaredMiseTools\(root\)/, 'tool selection uses the same declaration reader as install-tools');
  assert.match(setup, /declaredToolchain\(root\)/);
  assert.match(setup, /trackedFiles\(root\)/);
  assert.match(setup, /implementationFolders\(files\)/);
  assert.match(workflow, /include: \$\{\{ fromJSON\(needs\.discover\.outputs\.runtimes\) \}\}/);
  assert.match(setup, /declared\.symbolExtractors/);
  assert.match(setup, /target: 'composer-install'/);
  assert.match(setup, /target: 'uv-install'/);
  assert.match(setup, /target: 'build-go'/);
  assert.match(setup, /target: 'build-ts'/);
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

test('K473: the parity job links local packages before link-state and parity gates', () => {
  const workflow = read('workflows/gates.yml');
  const link = workflow.indexOf('        run: make link\n');
  assert.ok(link !== -1, 'a step runs make link');
  assert.ok(link < workflow.indexOf('      - name: parity gate\n'), 'make link runs before parity');
});

test('K671-3: gates use the standard root checkout and retain the native installation sequence', () => {
  const workflow = read('workflows/gates.yml');
  assert.doesNotMatch(workflow, /working-directory:|path: \$\{\{ github\.event\.repository\.name/);
  assert.match(workflow, /node-version-file: mise\.toml/);
  assert.match(workflow, /run: make install-tools TOOLS=npm/);
  assert.match(workflow, /run: make install-packages/);
  assert.doesNotMatch(workflow, /^\s+run: make install$/m, 'the split workflow does not run the full install target');
});

test('the parity partition runs the full parity check, which runs only in CI, so every implementation runs its bindings in the gates (S6, K272)', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.match(kitMk, /^kit-gates-parity: link-state-check parity-check /m);
  assert.match(kitMk, /^ifneq \(\$\(filter parity-check kit-gates kit-gates-parity,\$\(MAKECMDGOALS\)\),\)$/m, 'the CI guard of parity-check covers both aggregate and parity gates');
  assert.deepEqual(workflowNeeds(workflowJob(read('workflows/gates.yml'), 'required'), 'required').sort(), [...GATE_REQUIRED_NEEDS].sort());
});

test('K734: the provider workflow selects exactly one parity path and aggregates every phase job', () => {
  const workflow = read('workflows/gates.yml');
  const full = workflowJob(workflow, 'parity');
  const api = workflowJob(workflow, 'parity-api');
  const bindings = workflowJob(workflow, 'parity-bindings');
  const required = workflowJob(workflow, 'required');
  assert.ok(full.includes("    if: ${{ needs.discover.outputs.parity_mode == 'full' }}"));
  assert.ok(api.includes("    if: ${{ needs.discover.outputs.parity_mode == 'phases' }}"));
  assert.ok(bindings.includes("    if: ${{ needs.discover.outputs.parity_mode == 'phases' }}"));
  assert.ok(bindings.includes('        include: ${{ fromJSON(needs.discover.outputs.parity_matrix) }}'));
  assert.ok(bindings.some(line => line.includes('run: make parity-bindings-${{ matrix.implementation }}-check')));
  assert.ok(api.some(line => line.includes('run: make -k link-state-check parity-api-check')));
  assert.deepEqual(workflowNeeds(required, 'required').sort(), [...GATE_REQUIRED_NEEDS].sort());
  assert.ok(required.some(line => line.includes('run: make kit-ci-verify-gates')));
  assert.ok(required.some(line => line.includes('KIT_CI_PARITY_API_RESULT: ${{ needs.parity-api.result }}')));
  assert.ok(required.some(line => line.includes('KIT_CI_PARITY_BINDINGS_RESULT: ${{ needs.parity-bindings.result }}')));
});

// K515: a tracked lock records the release of each polyspec package (K448, K507), so kit has no check that a tracked file names
// none and no config/polyspec.json; gates install the committed package locks.
test('K515: kit runs no polyspec lock check and reads no config/polyspec.json', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.doesNotMatch(kitMk, /polyspec-lock-check/);
  assert.doesNotMatch(read('PRINCIPLES.md'), /config\/polyspec\.json/);
  assert.doesNotMatch(read('workflows/gates.yml'), /config\/polyspec\.json/);
});
