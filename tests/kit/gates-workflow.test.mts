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
  assert.match(read('workflows/gates.yml'), /needs: \[shared, parity, runtime\]/);
});

// K515: a tracked lock records the release of each polyspec package (K448, K507), so kit has no check that a tracked file names
// none and no config/polyspec.json; gates install the committed package locks.
test('K515: kit runs no polyspec lock check and reads no config/polyspec.json', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.doesNotMatch(kitMk, /polyspec-lock-check/);
  assert.doesNotMatch(read('PRINCIPLES.md'), /config\/polyspec\.json/);
  assert.doesNotMatch(read('workflows/gates.yml'), /config\/polyspec\.json/);
});
