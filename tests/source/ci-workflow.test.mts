// The CI workflow of kit (.github/workflows/ci.yml), which only kit runs. Every gate of a kit commit runs there: the
// documents and the commit messages besides the tests. Without them a commit that fails documents-check passed CI (b415ad8,
// K82).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFixture } from '../kit/json-fixture.mts';
import { known } from '../kit/known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const text = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
// The group always takes part in a match of the pattern.
const runs = [...text.matchAll(/^\s+run: (.+)$/gm)].map(match => known(match[1], 'match[1]'));

test('the CI workflow runs duplication-check after npm ci installed jscpd (K126)', () => {
  const check = runs.indexOf('make duplication-check');
  assert.ok(check > runs.indexOf('make install-packages'), 'a step runs make duplication-check after npm ci');
});

test('the CI workflow lints kit with make lint-ts, the TypeScript lint of its consumers, after npm ci installed it (K142)', () => {
  const lint = runs.indexOf('make lint-ts');
  assert.ok(lint > runs.indexOf('make install-packages'), 'a step runs make lint-ts after npm ci');
});

test('the CI workflow gives kit-test go, python3 and cargo of the pins, not of the runner image (K78, K127)', () => {
  const tools = runs.indexOf('make install-tools');
  const rust = runs.indexOf('rustup toolchain install');
  const kitTest = runs.indexOf('make kit-test');
  // kit.mk puts the shims of mise first on PATH in every recipe, so the steps that run make need no PATH of their own.
  assert.ok(tools >= 0 && tools < kitTest, 'install-tools installs the tools of mise.lock before kit-test runs them');
  assert.ok(!text.includes('GITHUB_PATH'), 'no step puts var/tools on PATH by hand');
  assert.ok(rust > 0 && rust < kitTest, 'rustup installs the channel of rust-toolchain.toml before kit-test runs cargo');
});

test('the CI workflow checks the dependencies of kit as each consumer does: the gate and its mutation check (K169)', () => {
  // Without the gate in CI, the review record of kit went stale from K127 to K169 while every run passed.
  const tools = runs.indexOf('make install-tools');
  assert.ok(runs.indexOf('make dependency-policy-check') > tools, 'a step runs make dependency-policy-check after install-tools');
  assert.ok(runs.indexOf('make dependency-policy-mutation-check') > tools, 'a step runs make dependency-policy-mutation-check after install-tools');
});

test('the CI workflow checks the classes of config/rebuild.json and the owner rules of config/owner-checks.json (K182)', () => {
  // Without them in CI, four tools of scripts/kit went without a class from K156 and config/knip-entries.json without an
  // owner from K173 while every run passed.
  assert.ok(runs.includes('make rebuild-check'), 'a step runs make rebuild-check');
  assert.ok(runs.includes('make owner-validate'), 'a step runs make owner-validate');
});

test('the CI workflow runs every make target of config/owner-checks.json but the exempt ones, each with its reason (K183)', () => {
  // K182 found rebuild-check and owner-validate missing from CI; toolchain-check, kit-check and release-coverage were missing
  // too, so a failure of an owner check stayed hidden until a local run. The test derives the list, so a new owner target
  // needs a step or a reasoned exemption.
  const { owners, ciExempt = [] } = readFixture<{ owners: { targets?: string[] }[]; ciExempt?: { target: string; reason: string }[] }>(ROOT, 'config/owner-checks.json');
  const exempt = new Set(ciExempt.map(entry => entry.target));
  for (const entry of ciExempt) assert.ok(entry.reason.trim().length > 0, `the exemption of ${entry.target} gives its reason`);
  const targets = new Set(owners.flatMap(owner => owner.targets ?? []));
  assert.deepEqual([...exempt].filter(target => !targets.has(target)), [], 'every exemption names a target of an owner rule');
  const ran = new Set(runs.flatMap(run => /^make ([a-z][a-z0-9-]*)/.exec(run)?.[1] ?? []));
  assert.deepEqual([...targets].filter(target => !exempt.has(target) && !ran.has(target)), [], 'no CI step runs these owner targets');
  assert.deepEqual([...exempt].filter(target => ran.has(target)), [], 'an exempt target that a step runs needs no exemption');
});

test('the CI workflow runs documents-check', () => {
  assert.ok(runs.includes('make documents-check'), 'a step runs make documents-check');
});

test('the CI workflow runs commits-check over the commits it was triggered by, on the full commit graph', () => {
  assert.ok(runs.some(run => /^make commits-check RANGE="\$range"$/.test(run)), 'a step runs make commits-check RANGE="$range"');
  assert.match(text, /fetch-depth: 0/, 'the checkout carries the full commit graph, so the range resolves');
});

test('the CI workflow installs the packages with the pinned npm and then checks the types (K71-1)', () => {
  const install = runs.indexOf('make install-packages');
  const typecheck = runs.indexOf('make typecheck');
  assert.ok(runs.indexOf('make install-tools TOOLS=npm') >= 0 && install > runs.indexOf('make install-tools TOOLS=npm'), 'npm ci runs after install-tools installed the npm of packageManager');
  assert.ok(typecheck > install, 'make typecheck runs after npm ci installed TypeScript');
});

test('the CI workflow bootstraps in the order of a repository: the npm of packageManager, npm ci, then the other tools (K71-2)', () => {
  assert.deepEqual(runs.slice(0, 3), ['make install-tools TOOLS=npm', 'make install-packages', 'make install-tools'], 'the first steps');
});

test('the CI workflow installs the PHP of .php-version before install-tools, which runs PHPUnit on it (K78)', () => {
  // The Composer projects of kit (config/phpunit, config/php-lint) require the PHP of the pin; the runner's own PHP is
  // older, so the workflow installs the declared release first (CI run 38438896766 failed on PHP 8.3.6).
  assert.equal(readFileSync(path.join(ROOT, '.php-version'), 'utf8').trim(), '8.5');
  const setup = text.indexOf('php-version-file: .php-version');
  const tools = text.indexOf('run: make install-tools\n');
  assert.ok(setup >= 0, 'the workflow sets up PHP from .php-version');
  assert.ok(tools > setup, 'install-tools runs after the PHP of .php-version is installed');
});

// parity-real runs the rust symbol extractor on the Rust nightly of its exception; CI has no nightly unless make install-tools,
// which runs before the tests, installs it: install-tools installs each Rust channel that config/toolchain.json exceptions
// declare (install-rust.mts), so kit declares every nightly that its tests run.
test('kit declares every Rust nightly that parity-real runs, which make install-tools installs before the tests (K75)', () => {
  const used = new Set(readFileSync(path.join(ROOT, 'tests/source/parity-real.test.mts'), 'utf8').match(/nightly-\d{4}-\d{2}-\d{2}/g) ?? []);
  assert.ok(used.size > 0, 'parity-real names a nightly');
  const { exceptions } = readFixture<{ pythonBackend: { requirement: string; sha256: string }; exceptions?: { tool: string; channel: string }[]; mise: unknown }>(ROOT, 'config/toolchain.json');
  assert.ok(exceptions, 'config/toolchain.json declares no exceptions');
  const declared = new Set(exceptions.filter(entry => entry.tool === 'rust').map(entry => entry.channel));
  assert.deepEqual([...used].filter(channel => !declared.has(channel)), [], 'config/toolchain.json exceptions declare these nightlies');
  assert.ok(runs.indexOf('make install-tools') < runs.indexOf('make source-test'), 'make install-tools runs before make source-test');
});

test('rust-toolchain.toml declares the clippy that make lint-rust runs, so rustup installs it with the channel (K77)', () => {
  // The runner's Rust has no clippy component (CI run 38448878705); rustup installs the components that the toolchain file
  // declares when `rustup toolchain install` reads it.
  const toolchain = readFileSync(path.join(ROOT, 'rust-toolchain.toml'), 'utf8');
  assert.match(toolchain, /^components = \[[^\]]*"clippy"[^\]]*\]$/m);
});
