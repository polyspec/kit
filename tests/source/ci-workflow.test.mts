// The CI workflow of kit (.github/workflows/ci.yml), which only kit runs. Every gate of a kit commit runs there: the
// documents and the commit messages besides the tests. Without them a commit that fails docs-check passed CI (b415ad8,
// K82).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFixture } from '../kit/json-fixture.mts';
import { known } from '../kit/known.mts';
import { PINS } from '../../scripts/kit/toolchain-pins.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const text = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
// The group always takes part in a match of the pattern.
const runs = [...text.matchAll(/^\s+run: (.+)$/gm)].map(match => known(match[1], 'match[1]'));
const jobsText = text.slice(text.indexOf('jobs:\n'));
function jobText(name: string): string {
  const lines = jobsText.split('\n');
  const start = lines.findIndex(line => line === `  ${name}:`);
  assert.notEqual(start, -1, `the workflow declares job ${name}`);
  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}
function jobRuns(name: string): string[] {
  return [...jobText(name).matchAll(/^\s+run: (.+)$/gm)].map(match => known(match[1], 'match[1]'));
}
const isolatedMakeEnvironment = (environment: NodeJS.ProcessEnv) => ({
  PATH: environment.PATH ?? '',
  HOME: environment.HOME ?? '',
  TMPDIR: environment.TMPDIR ?? '',
});

test('the CI workflow runs duplication-check after npm ci installed jscpd (K126)', () => {
  const check = runs.indexOf('make duplication-check');
  assert.ok(check > runs.indexOf('make install-packages'), 'a step runs make duplication-check after npm ci');
});

test('the CI workflow lints kit with make lint-ts, the TypeScript lint of its consumers, after npm ci installed it (K142)', () => {
  const lint = runs.indexOf('make lint-ts');
  assert.ok(lint > runs.indexOf('make install-packages'), 'a step runs make lint-ts after npm ci');
});

test('the CI workflow gives kit-test go, python3 and cargo of the pins, not of the runner image (K78, K127)', () => {
  const kitTestRuns = jobRuns('kit_tests');
  const tools = kitTestRuns.indexOf('make install-tools');
  const rust = kitTestRuns.indexOf('rustup toolchain install');
  const cargoDownloads = kitTestRuns.indexOf('make cargo-downloads-fetch');
  const kitTest = kitTestRuns.indexOf('make kit-test-shard SHARD=${{ matrix.shard }}');
  // kit.mk puts the shims of mise first on PATH in every recipe, so the steps that run make need no PATH of their own.
  assert.ok(tools >= 0 && tools < kitTest, 'install-tools installs the tools of mise.lock before kit-test runs them');
  assert.ok(!jobText('kit_tests').includes('GITHUB_PATH'), 'no step puts var/tools on PATH by hand');
  assert.ok(rust > 0 && rust < kitTest, 'rustup installs the channel of rust-toolchain.toml before kit-test runs cargo');
  assert.ok(cargoDownloads > rust && cargoDownloads < kitTest, 'cargo-downloads-fetch fills the offline crate cache before kit-test runs cargo');
  assert.match(jobText('kit_tests'), /- name: fetch Rust crates\n        if: \$\{\{ !cancelled\(\) \}\}\n        run: make cargo-downloads-fetch/);
});

test('the source tests fetch Rust crates before running Cargo offline', () => {
  const sourceRuns = jobRuns('source_tests');
  const rust = sourceRuns.indexOf('rustup toolchain install');
  const cargoDownloads = sourceRuns.indexOf('make cargo-downloads-fetch');
  const sourceTest = sourceRuns.indexOf('make source-test-group GROUP=${{ matrix.group }}');
  assert.ok(rust >= 0 && cargoDownloads > rust && cargoDownloads < sourceTest, 'the source tests fetch crates after installing Rust and before running');
  assert.match(jobText('source_tests'), /- name: fetch Rust crates\n        if: \$\{\{ !cancelled\(\) \}\}\n        run: make cargo-downloads-fetch/);
});

test('the checks job fetches Rust crates before the offline Rust lints', () => {
  const checkRuns = jobRuns('checks');
  const rust = checkRuns.indexOf('rustup toolchain install');
  const cargoDownloads = checkRuns.indexOf('make cargo-downloads-fetch');
  assert.ok(cargoDownloads > rust, 'the checks job installs Rust before fetching crates');
  for (const target of ['make lint-ts', 'make lint-rust']) {
    assert.ok(cargoDownloads < checkRuns.indexOf(target), `${target} runs after the Cargo cache is populated`);
  }
  assert.match(jobText('checks'), /- name: fetch Rust crates\n        if: \$\{\{ !cancelled\(\) \}\}\n        run: make cargo-downloads-fetch/);
});

test('the CI workflow checks the dependencies of kit as each consumer does: the gate and its mutation check (K169)', () => {
  const checkRuns = jobRuns('checks');
  const tools = checkRuns.indexOf('make install-tools');
  assert.ok(checkRuns.indexOf('make dependency-policy-check') > tools, 'a step runs make dependency-policy-check after install-tools');
  assert.ok(checkRuns.indexOf('make dependency-policy-mutation-check') > tools, 'a step runs make dependency-policy-mutation-check after install-tools');
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
  if (ran.has('kit-test-shard')) ran.add('kit-test'); // The six explicit matrix shards cover the owner target's complete test inventory.
  assert.deepEqual([...targets].filter(target => !exempt.has(target) && !ran.has(target)), [], 'no CI step runs these owner targets');
  assert.deepEqual([...exempt].filter(target => ran.has(target)), [], 'an exempt target that a step runs needs no exemption');
});

test('the CI workflow installs the packages of the PHP symbol extractor after install-tools and before lint-php (K248-4)', () => {
  // lint-php runs PHPStan on scripts/kit/symbols/php with the autoloader of its Composer project; without the install the
  // step failed in the run of e9d0bb8.
  const checkRuns = jobRuns('checks');
  const install = checkRuns.indexOf('make kit-install-symbols-php');
  assert.ok(install > checkRuns.indexOf('make install-tools'), 'make kit-install-symbols-php runs after install-tools installed Composer');
  assert.ok(install < checkRuns.indexOf('make lint-php'), 'make kit-install-symbols-php runs before make lint-php');
});

test('the CI workflow runs docs-check', () => {
  assert.ok(runs.includes('make docs-check'), 'a step runs make docs-check');
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
  const bootstrap = ['make install-tools TOOLS=npm', 'make install-packages', 'make install-tools'];
  for (const name of ['checks', 'kit_tests', 'source_tests']) {
    assert.deepEqual(jobRuns(name).slice(0, 3), bootstrap, `${name} bootstraps from its own checkout`);
  }
});

test('the CI workflow installs the PHP of .php-version before install-tools, which runs PHPUnit on it (K78)', () => {
  // The Composer projects of kit (config/phpunit, config/php-lint) require the PHP of the pin; the runner's own PHP is
  // older, so the workflow installs the declared release first (CI run 38438896766 failed on PHP 8.3.6).
  assert.equal(readFileSync(path.join(ROOT, '.php-version'), 'utf8').trim(), PINS.php);
  const checkJob = jobText('checks');
  const setup = checkJob.indexOf('php-version-file: .php-version');
  const tools = checkJob.indexOf('run: make install-tools\n');
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
  const sourceRuns = jobRuns('source_tests');
  assert.ok(sourceRuns.indexOf('make install-tools') < sourceRuns.indexOf('make source-test-group GROUP=${{ matrix.group }}'), 'make install-tools runs before each source-test group');
});

test('rust-toolchain.toml declares the clippy that make lint-rust runs, so rustup installs it with the channel (K77)', () => {
  // The runner's Rust has no clippy component (CI run 38448878705); rustup installs the components that the toolchain file
  // declares when `rustup toolchain install` reads it.
  const toolchain = readFileSync(path.join(ROOT, 'rust-toolchain.toml'), 'utf8');
  assert.match(toolchain, /^components = \[[^\]]*"clippy"[^\]]*\]$/m);
});

test('every check step runs after an earlier step failed, so one run shows every failure (K251)', () => {
  for (const name of ['checks', 'kit_tests', 'source_tests']) {
    const steps = jobText(name).split(/\n(?= {6}- )/).slice(1);
    const install = steps.findLastIndex(step => /run: (make (?:kit-)?install-|rustup toolchain install)/.test(step));
    assert.ok(install >= 0, `${name} installs its tools`);
    const checks = steps.slice(install + 1);
    assert.ok(checks.length > 0, `${name} runs checks after the installs`);
    for (const step of checks) assert.match(step, /^ {8}if: \$\{\{ !cancelled\(\) \}\}$/m, `${name} continues after a failed setup step:\n${step}`);
  }
});

test('the kit required check aggregates independent checks, kit tests and source tests exactly once', () => {
  const kit = jobText('kit');
  assert.match(kit, /^    name: kit$/m, 'the required check keeps the name kit');
  assert.match(kit, /^    if: \$\{\{ always\(\) \}\}$/m, 'the aggregator runs after failures');
  assert.match(kit, /^    needs: \[checks, kit_tests, source_tests\]$/m, 'the aggregator needs every independent job');
  assert.match(kit, /RESULTS: \$\{\{ toJSON\(needs\) \}\}/, 'the aggregator receives every job result');
  assert.match(jobText('kit_tests'), /fail-fast: false[\s\S]*shard: \[1, 2, 3, 4, 5, 6, 7\]/);
  assert.match(jobText('source_tests'), /fail-fast: false[\s\S]*group: \[ts, php, php-ext, rust, go, python, common-1, common-2, common-3\]/);
  assert.deepEqual(jobRuns('kit_tests').filter(run => run === 'make kit-test-shard SHARD=${{ matrix.shard }}'), ['make kit-test-shard SHARD=${{ matrix.shard }}']);
  assert.deepEqual(jobRuns('source_tests').filter(run => run === 'make source-test-group GROUP=${{ matrix.group }}'), ['make source-test-group GROUP=${{ matrix.group }}']);
  const checks = jobRuns('checks').filter(run => run.startsWith('make ') && !/^make (?:install-tools|install-packages|kit-install-)/.test(run));
  const names = checks.map(run => run.split(/\s+/, 2)[1]);
  assert.equal(new Set(names).size, names.length, 'each check target runs once');
  assert.ok(!checks.includes('make kit-test') && !checks.includes('make source-test'));
});

test('CI test shard declarations cover every tracked kit and source test file exactly once (K718)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const assignments = new Map([...makefile.matchAll(/^([A-Za-z][A-Za-z0-9_-]*) := ((?:[^\n]*\\\n)*[^\n]*)/gm)]
    .map(match => [known(match[1], 'match[1]'), known(match[2], 'match[2]').replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean)]));
  const names = (prefix: string) => [...assignments.keys()].filter(name => name.startsWith(prefix));
  const files = (prefix: string) => names(prefix).flatMap(name => assignments.get(name) ?? []);
  const tracked = (directory: string) => execFileSync('git', ['ls-files', '--', directory], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(file => file.endsWith('.test.mts')).sort();
  const assertExactOnce = (declared: string[], expected: string[], label: string) => {
    assert.equal(new Set(declared).size, declared.length, `${label} repeats no file`);
    assert.deepEqual([...declared].sort(), expected, `${label} includes every tracked test file exactly once`);
  };
  assert.deepEqual(names('KIT_TEST_FILES_').sort(), ['KIT_TEST_FILES_1', 'KIT_TEST_FILES_2', 'KIT_TEST_FILES_3', 'KIT_TEST_FILES_4', 'KIT_TEST_FILES_5', 'KIT_TEST_FILES_6', 'KIT_TEST_FILES_7']);
  assertExactOnce(files('KIT_TEST_FILES_'), tracked('tests/kit'), 'kit shards');
  assert.deepEqual(names('SOURCE_TEST_FILES_').sort(), ['SOURCE_TEST_FILES_common-1', 'SOURCE_TEST_FILES_common-2', 'SOURCE_TEST_FILES_common-3', 'SOURCE_TEST_FILES_go', 'SOURCE_TEST_FILES_php', 'SOURCE_TEST_FILES_php-ext', 'SOURCE_TEST_FILES_python', 'SOURCE_TEST_FILES_rust', 'SOURCE_TEST_FILES_ts']);
  assertExactOnce(files('SOURCE_TEST_FILES_'), tracked('tests/source'), 'source groups');
});

test('the CI shard targets reject an empty or unknown selection before starting the runner (K718)', () => {
  for (const [target, args] of [
    ['kit-test-shard', []], ['kit-test-shard', ['SHARD=unknown']],
    ['source-test-group', []], ['source-test-group', ['GROUP=unknown']],
  ] as const) {
    const result = spawnSync('make', ['--no-print-directory', target, ...args], { cwd: ROOT, encoding: 'utf8', env: isolatedMakeEnvironment(process.env) });
    assert.equal(result.status, 2, `${target} ${args.join(' ')}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /unknown or empty/);
  }
});

test('a shard selection probe drops inherited GNU Make variables (K721)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-make-selection-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stub = path.join(directory, 'make');
  writeFileSync(stub, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(Object.fromEntries(['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES', 'GROUP', 'SHARD'].map(name => [name, process.env[name] ?? null]))));\n`);
  chmodSync(stub, 0o755);
  const environment = isolatedMakeEnvironment({
    PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    MAKEFLAGS: '-- GROUP=common-1 SHARD=1',
    MFLAGS: '-- GROUP=common-1 SHARD=1',
    MAKELEVEL: '1',
    MAKEOVERRIDES: 'GROUP=common-1 SHARD=1',
    GROUP: 'common-1',
    SHARD: '1',
  });
  const result = spawnSync('make', ['source-test-group'], { cwd: ROOT, encoding: 'utf8', env: environment });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    MAKEFLAGS: null,
    MFLAGS: null,
    MAKELEVEL: null,
    MAKEOVERRIDES: null,
    GROUP: null,
    SHARD: null,
  });
});
