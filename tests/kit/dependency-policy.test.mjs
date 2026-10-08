// Tests of the dependency tools on the fixture of tests/kit/fixture (package.json, packages/fixture-php, packages/fixture-python,
// config/): the gate passes on the fixture, fails on a lock changed without a review, and the review records the fixture
// the same way on every run. The registries are stubs (tests/kit/registry.mjs), so no test queries the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { stubRegistries } from './registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture');
// The files of the fixture: the tools, the stubs' users, the manifests and locks, the policy and the record.
const FILES = [
  'package.json', 'package-lock.json',
  'packages/fixture-php/composer.json', 'packages/fixture-php/composer.lock',
  'packages/fixture-python/pyproject.toml',
  'config/dependency-policy.json', 'config/dependency-review.json',
];
const TOOLS = ['scripts/kit/check-dependency-policy-mutation.mjs', 'scripts/kit/dependency-state.mjs', 'scripts/kit/dependency-review.mjs', 'scripts/kit/check-dependency-policy.mjs', 'scripts/kit/pin-python-dependency.mjs'];

// A copy of the fixture with the tools, so that each tool reads its own checkout.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-dependency-checkout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of FILES) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    cpSync(path.join(FIXTURE, file), path.join(directory, file));
  }
  for (const file of TOOLS) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    cpSync(path.join(ROOT, file), path.join(directory, file));
  }
  return directory;
}

const gate = (root, env = process.env) => spawnSync(process.execPath, ['scripts/kit/check-dependency-policy.mjs'], { cwd: root, encoding: 'utf8', env });
const review = (root, args, env) => spawnSync(process.execPath, ['scripts/kit/dependency-review.mjs', ...args], { cwd: root, encoding: 'utf8', env });

test('the gate passes on the fixture and queries no registry', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t);
  const result = gate(root, stub.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-policy\] 4 registry dependencies and 2 locks match the review of /m);
  assert.equal(stub.calls().filter(call => !call.startsWith('composer validate ')).length, 0, stub.calls().join('\n'));
});

test('the gate fails on a lock changed without a review and names the file, the review and the fix', (t) => {
  const root = fixture(t);
  appendFileSync(path.join(root, 'packages/fixture-php/composer.lock'), '\n');
  const result = gate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[dependency-policy\] packages\/fixture-php\/composer\.lock: the lock changed after the review of .+: its sha256 is [0-9a-f]{64}, the review recorded [0-9a-f]{64}\./m);
});

test('the review reports a newer stable release with the fix command and writes no record without RECORD', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t);
  stub.registry({ npm: { eslint: ['9.0.0', '9.1.0'] }, composer: { 'fixture-php': { 'psr/log': '3.0.2' } }, pypi: { setuptools: { '84.0.0': [{}] }, ruff: { '0.16.10': [{}] } } });
  const before = readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8');
  const result = review(root, [], stub.env);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^\[dependency-review\] package\.json eslint 9\.0\.0 < 9\.1\.0: a newer stable release exists\. Fix: make dependency-review UPDATE=1\.$/m);
  assert.equal(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'), before);
});

test('the review records the fixture, and a second run writes the same record', (t) => {
  const root = fixture(t);
  const stub = stubRegistries(t);
  stub.registry({ npm: { eslint: ['9.0.0'] }, composer: { 'fixture-php': { 'psr/log': '3.0.2' } }, pypi: { setuptools: { '84.0.0': [{}] }, ruff: { '0.16.10': [{}] } } });
  const first = review(root, ['--record'], stub.env);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const once = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  const second = review(root, ['--record'], stub.env);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const twice = JSON.parse(readFileSync(path.join(root, 'config/dependency-review.json'), 'utf8'));
  assert.deepEqual({ ...twice, reviewed: null }, { ...once, reviewed: null });
  assert.deepEqual(twice.dependencies.map(item => [item.ecosystem, item.package, item.version]), [
    ['npm', 'eslint', '9.0.0'], ['composer', 'psr/log', '3.0.2'], ['pypi', 'setuptools', '84.0.0'], ['pypi', 'ruff', '0.16.10'],
  ]);
});

test('the mutation check rejects every mutation of the fixture', (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, ['scripts/kit/check-dependency-policy-mutation.mjs'], { cwd: root, encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /4 mutations rejected/);
});
