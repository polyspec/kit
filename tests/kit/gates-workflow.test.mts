// Tests of the gates workflow that kit vendors to every repository (workflows/gates.yml, K270): it runs make -k kit-gates with
// the commit range of the run, and kit-gates reaches every make target that a rule of PRINCIPLES.md names as its check.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
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

test('K473: the gates workflow clones, beside the project, each sibling repository at its default branch, before install', () => {
  const workflow = read('workflows/gates.yml');
  const step = /^      - name: sibling checkouts\n([\s\S]*?)(?=^      - name: )/m.exec(workflow);
  assert.ok(step, 'a step named sibling checkouts clones the sibling repositories');
  assert.match(step[1] ?? '', /git clone --depth 1 "https:\/\/github\.com\/polyspec\/\$repository\.git"/, 'a clone without a branch takes the default branch');
  assert.match(step[1] ?? '', /"\.\.\/\$repository"/, 'each clone lies beside the project, where link reads it');
  assert.ok(workflow.indexOf('      - name: sibling checkouts\n') < workflow.indexOf('      - name: install\n'), 'the siblings are cloned before install, which links them');
});

test('K473: the gates workflow runs make link after install and before the gates', () => {
  const workflow = read('workflows/gates.yml');
  const link = workflow.indexOf('        run: make link\n');
  assert.ok(link !== -1, 'a step runs make link');
  assert.ok(workflow.indexOf('      - name: install\n') < link, 'make link runs after install');
  assert.ok(link < workflow.indexOf('      - name: gates\n'), 'make link runs before the gates');
});

test('K473: every run step of the gates workflow works in the project folder, which the checkout names by the repository', () => {
  const workflow = read('workflows/gates.yml');
  assert.match(workflow, /^          path: \$\{\{ github\.event\.repository\.name \}\}$/m, 'the project is checked out beside its siblings');
  const steps = workflow.split(/^      - /m).slice(1);
  for (const step of steps) {
    if (!/^        run: /m.test(step)) continue;
    assert.match(step, /^        working-directory: \$\{\{ github\.event\.repository\.name \}\}$/m, `a run step names its folder: ${step.split('\n')[0]}`);
  }
});

test('kit-gates runs the full parity check, which runs only in CI, so every implementation runs its bindings in the gates (S6, K272)', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.match(kitMk, /^kit-gates:[^#\n]* parity-check /m);
  assert.match(kitMk, /^ifneq \(\$\(filter parity-check kit-gates,\$\(MAKECMDGOALS\)\),\)$/m, 'the CI guard of parity-check covers kit-gates');
});

// K515: a tracked lock records the release of each polyspec package (K448, K507), so kit has no check that a tracked file names
// none and no config/polyspec.json; the gates clone the sibling repositories that the release URLs of the tracked locks name.
test('K515: kit runs no polyspec lock check and reads no config/polyspec.json', () => {
  const kitMk = read('scripts/kit/kit.mk');
  assert.doesNotMatch(kitMk, /polyspec-lock-check/);
  assert.doesNotMatch(read('PRINCIPLES.md'), /config\/polyspec\.json/);
  assert.doesNotMatch(read('workflows/gates.yml'), /config\/polyspec\.json/);
});

test('K515: the sibling checkouts step clones each github.com/polyspec repository that a tracked lock names, but the repository itself', (t) => {
  const workflow = read('workflows/gates.yml');
  const step = /^      - name: sibling checkouts\n([\s\S]*?)(?=^      - name: )/m.exec(workflow);
  assert.ok(step, 'a step named sibling checkouts');
  const script = /node -e '([\s\S]*?)'\)/.exec(step[1] ?? '');
  assert.ok(script, 'the step lists the repositories with node');
  const root = mkdtempSync(path.join(tmpdir(), 'kit-siblings-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/@polyspec/kit': { resolved: 'https://github.com/polyspec/kit/releases/download/v0.0.54/polyspec-kit-0.0.54.tgz' } } }),
    'php/composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/orm', dist: { url: 'https://github.com/polyspec/orm/releases/download/v0.0.18/orm.zip' } }, { name: 'polyspec/self', dist: { url: 'https://github.com/polyspec/self.git' } }] }),
    'notes.md': 'https://github.com/polyspec/not-a-lock\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  const listed = spawnSync('node', ['-e', script[1] ?? ''], { cwd: root, encoding: 'utf8', env: { ...process.env, SELF: 'self' } });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.stdout.trim().split('\n'), ['kit', 'orm']);
});
