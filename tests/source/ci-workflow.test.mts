// The CI workflow of kit (.github/workflows/ci.yml), which only kit runs. Every gate of a kit commit runs there: the
// documents besides the tests. Without them a commit that fails docs-check passed CI (b415ad8,
// K82). Each job is one recipe of the Makefile (K1250), so these tests read the recipes and their dry runs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { reached } from '../../scripts/kit/check-rules.mts';
import { makeDatabase } from '../../scripts/kit/owner-check.mts';
import { readFixture } from '../kit/json-fixture.mts';
import { known } from '../kit/known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const text = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
type Step = { uses?: string; run?: string; if?: string };
const workflow = parse(text) as { jobs: Record<string, { needs?: string[]; 'runs-on'?: string; strategy?: { matrix?: Record<string, unknown> }; steps: Step[] }> };
const job = (name: string) => known(workflow.jobs[name], `job ${name}`);
const jobRun = (name: string) => known(job(name).steps.find(step => step.run !== undefined)?.run, `the run step of ${name}`);
const isolatedMakeEnvironment = (environment: NodeJS.ProcessEnv) => ({
  PATH: environment.PATH ?? '',
  HOME: environment.HOME ?? '',
  TMPDIR: environment.TMPDIR ?? '',
});
/** The commands that `make -n <target> <variables>` prints, recursive makes included. */
function dryRun(target: string, ...variables: string[]): string[] {
  const result = spawnSync('make', ['--no-print-directory', '-n', target, ...variables], { cwd: ROOT, encoding: 'utf8', env: isolatedMakeEnvironment(process.env) });
  assert.equal(result.status, 0, `make -n ${target} ${variables.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout.split('\n');
}
const indexOf = (lines: readonly string[], pattern: RegExp) => lines.findIndex(line => pattern.test(line));
const make = makeDatabase(ROOT);
const ciChecks = (make.variables.get('CI_CHECKS') ?? '').trim().split(/\s+/);

test('the checks job sets up PHP and bootstraps before its one recipe, which installs every tool before the checks (K71-1, K78, K248-4)', () => {
  const steps = job('checks').steps;
  const php = steps.findIndex(step => step.uses?.startsWith('shivammathur/setup-php@'));
  const bootstrap = steps.findIndex(step => step.uses === './.github/actions/kit-bootstrap');
  const run = steps.findIndex(step => step.run !== undefined);
  assert.ok(php >= 0 && bootstrap > php && run > bootstrap, 'PHP of .php-version, then the bootstrap, then make ci-checks');
  assert.equal(jobRun('checks'), 'make ci-checks');
  const lines = dryRun('ci-checks');
  const tools = indexOf(lines, /install-tools\.mts --no-self-update\s*$/);
  const symbols = indexOf(lines, /composer install --working-dir=scripts\/kit\/symbols\/php/);
  const lintPhp = indexOf(lines, /lint-php\.mts/);
  assert.ok(tools >= 0 && symbols > tools && lintPhp > symbols, 'install-tools, then the PHP symbol packages, then lint-php');
  assert.ok(indexOf(lines, /tsc -p tsconfig\.json/) > tools, 'typecheck runs after the installs');
});

test('the checks job runs each check once, past the failure of another (K126, K142, K182, K251)', () => {
  assert.equal(new Set(ciChecks).size, ciChecks.length, 'each check target runs once');
  for (const check of ['duplication-check', 'lint-ts', 'catch-check', 'rebuild-check', 'owner-validate', 'docs-check', 'typecheck', 'release-coverage'])
    assert.ok(ciChecks.includes(check), `ci-checks runs ${check}`);
  assert.ok(!ciChecks.includes('kit-test') && !ciChecks.includes('source-test'));
  assert.match(known(make.targets.get('ci-checks'), 'ci-checks').recipe, /\$\(MAKE\) --no-print-directory -k \$\(CI_CHECKS\)$/m);
  assert.match(known(make.targets.get('ci-bootstrap'), 'ci-bootstrap').recipe, /\$\(MAKE\) --no-print-directory -k \$\(CI_BOOTSTRAP_CHECKS_\$\(CI_BOOTSTRAP_PLATFORM\)\)$/m);
});

test('kit-test shards install only their declared PHP, Composer and runtime prerequisites (K78, K127)', () => {
  assert.equal(jobRun('kit-tests'), 'make ci-kit-tests SHARD=${{ matrix.shard }}');
  for (const [shard, tools] of [[1, 'php composer'], [2, ''], [3, 'php composer phpunit'], [4, 'php composer python go'], [5, 'php composer phpunit'], [6, 'rust'], [7, 'php composer']] as const) {
    const lines = dryRun('ci-kit-tests', `SHARD=${shard}`);
    const install = indexOf(lines, /install-tools\.mts --no-self-update/);
    const tests = indexOf(lines, /run-tests\.mts node -- --test-concurrency=1 tests\/kit\//);
    assert.ok(tests >= 0, `shard ${shard} runs its tests`);
    if (tools === '') assert.equal(install, -1, `shard ${shard} installs no tool`);
    else assert.ok(install >= 0 && install < tests && lines[install]?.endsWith(`--no-self-update ${tools}`), `shard ${shard} installs ${tools}:\n${lines.join('\n')}`);
    const parser = indexOf(lines, /composer install --working-dir=scripts\/kit\/symbols\/php/);
    assert.equal(parser >= 0, shard === 5, 'only shard 5 installs the source parser for its consumer fixtures');
  }
  assert.match(text, /if: \$\{\{ contains\(fromJSON\('\[1,3,4,5,7\]'\), matrix\.shard\) \}\}/);
});

test('source groups install their declared tools before their tests, Rust through install-tools (K1014)', () => {
  assert.equal(jobRun('source-tests'), 'make ci-source-tests GROUP=${{ matrix.group }}');
  const lines = dryRun('ci-source-tests', 'GROUP=rust');
  const rust = indexOf(lines, /install-tools\.mts --no-self-update rust$/);
  assert.ok(rust >= 0 && rust < indexOf(lines, /run-tests\.mts .*tests\/source\//), 'Rust groups install their toolchain before tests');
  assert.ok(!lines.some(line => line.includes('rustup toolchain install')), 'install-tools owns Rust toolchain installation');
  assert.equal(indexOf(dryRun('ci-source-tests', 'GROUP=ts'), /install-tools\.mts/), -1, 'the ts group installs no tool');
  assert.match(text, /if: \$\{\{ contains\(fromJSON\('\["php","common-1","common-2","common-3"\]'\), matrix\.group\) \}\}/);
});

test('the CI workflow runs every make target of config/owner-checks.json but the exempt ones, each with its reason (K183)', () => {
  // K182 found rebuild-check and owner-validate missing from CI; toolchain-check, the configuration check and release-coverage were missing
  // too, so a failure of an owner check stayed hidden until a local run. The test derives the list, so a new owner target
  // needs a step or a reasoned exemption.
  const { owners, ciExempt = [] } = readFixture<{ owners: { targets?: string[] }[]; ciExempt?: { target: string; reason: string }[] }>(ROOT, 'config/owner-checks.json');
  const exempt = new Set(ciExempt.map(entry => entry.target));
  for (const entry of ciExempt) assert.ok(entry.reason.trim().length > 0, `the exemption of ${entry.target} gives its reason`);
  const targets = new Set(owners.flatMap(owner => owner.targets ?? []));
  assert.deepEqual([...exempt].filter(target => !targets.has(target)), [], 'every exemption names a target of an owner rule');
  // The targets that the run steps of the workflows reach through their recipes (K1250).
  const ran = reached(ROOT, make).targets;
  if (ran.has('kit-test-shard')) ran.add('kit-test'); // The explicit matrix shards cover the owner target's complete test inventory.
  assert.deepEqual([...targets].filter(target => !exempt.has(target) && !ran.has(target)), [], 'no CI job runs these owner targets');
  assert.deepEqual([...exempt].filter(target => ran.has(target)), [], 'an exempt target that a job runs needs no exemption');
});

test('the jobs bootstrap npm and package-lock with the bootstrap action before their recipe (K71-2, K992)', () => {
  for (const name of ['checks', 'kit-tests', 'source-tests']) {
    const steps = job(name).steps;
    const bootstrap = steps.findIndex(step => step.uses === './.github/actions/kit-bootstrap');
    assert.ok(bootstrap >= 0 && bootstrap < steps.findIndex(step => step.run !== undefined), `${name} bootstraps from its own checkout`);
  }
});

test('rust-toolchain.toml declares the clippy that make lint-rust runs, so rustup installs it with the channel (K77)', () => {
  // The runner's Rust has no clippy component (CI run 38448878705); rustup installs the components that the toolchain file
  // declares when `rustup toolchain install` reads it.
  const toolchain = readFileSync(path.join(ROOT, 'rust-toolchain.toml'), 'utf8');
  assert.match(toolchain, /^components = \[[^\]]*"clippy"[^\]]*\]$/m);
});

test('the kit required check aggregates independent checks, kit tests and source tests exactly once', () => {
  const kit = job('kit') as { name?: string; if?: string; needs?: string[] };
  assert.equal(kit.name, 'kit', 'the required check keeps the name kit');
  assert.equal(kit.if, '${{ always() }}', 'the aggregator runs after failures');
  assert.deepEqual(kit.needs, ['checks', 'kit-tests', 'source-tests', 'bootstrap'], 'the aggregator needs every independent job, the platform bootstrap included (K912)');
  assert.equal(jobRun('kit'), "make ci-kit NODE=node RESULTS='${{ toJSON(needs) }}'", 'the aggregator receives every job result');
  assert.match(known(make.targets.get('ci-kit'), 'ci-kit').recipe, /ci-passed FAIL_SKIPPED=1/);
  assert.deepEqual(job('kit-tests').strategy?.matrix, { shard: [1, 2, 3, 4, 5, 6, 7] });
  assert.deepEqual(job('source-tests').strategy?.matrix, { group: ['ts', 'php', 'rust', 'go', 'python', 'common-1', 'common-2', 'common-3'] });
});

function assertShardInventory(prefix: string, directory: string, groups: string[]): void {
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
  assert.deepEqual(names(prefix).sort(), groups.map(group => `${prefix}${group}`).sort());
  assertExactOnce(files(prefix), tracked(directory), `${directory} shards`);
}

test('CI test shard declarations cover every tracked kit test file exactly once (K718, K1038)', () => {
  assertShardInventory('KIT_TEST_FILES_', 'tests/kit', ['1', '2', '3', '4', '5', '6', '7']);
});

test('CI test shard declarations cover every tracked source test file exactly once (K718, K1038)', () => {
  assertShardInventory('SOURCE_TEST_FILES_', 'tests/source', ['common-1', 'common-2', 'common-3', 'go', 'php', 'python', 'rust', 'ts']);
});

test('the CI shard targets reject an empty or unknown selection before starting the runner (K718)', () => {
  for (const [target, args] of [
    ['kit-test-shard', []], ['kit-test-shard', ['SHARD=unknown']],
    ['source-test-group', []], ['source-test-group', ['GROUP=unknown']],
    ['ci-kit-tests', []], ['ci-kit-tests', ['SHARD=unknown']],
    ['ci-source-tests', []], ['ci-source-tests', ['GROUP=unknown']],
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

test('K1041: POSIX source coverage runs in Linux source CI and macOS bootstrap while common process checks run on every platform', () => {
  assert.equal(job('source-tests')['runs-on'], 'ubuntu-24.04');
  assert.equal(jobRun('bootstrap'), 'make ci-bootstrap');
  const checks = (platform: string) => {
    const lines = dryRun('ci-bootstrap', `CI_BOOTSTRAP_PLATFORM=${platform}`);
    return known(lines.find(line => / -k case-sensitive-runner-smoke /.test(line) || / -k owner-validate /.test(line)), `the checks of ${platform}`).split(' -k ')[1]?.split(' ') ?? [];
  };
  for (const platform of ['linux', 'macos', 'windows']) assert.ok(checks(platform).includes('bootstrap-process-smoke'), `${platform} retains the common process ownership checks`);
  assert.deepEqual(['linux', 'macos', 'windows'].filter(platform => checks(platform).includes('bootstrap-posix-smoke')), ['macos'], 'macOS owns its bootstrap execution of the POSIX case');
  assert.match(known(make.targets.get('bootstrap-posix-smoke'), 'bootstrap-posix-smoke').recipe, /tests\/source\/process-group-posix\.test\.mts/);
  assert.ok(checks('windows').includes('owner-validate') && checks('windows').includes('bootstrap-windows-versions-check'), 'Windows checks Git Bash make and its native wrappers');
});
