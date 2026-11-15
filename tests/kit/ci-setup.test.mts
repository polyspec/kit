import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initRepository } from './sandbox-repository.mts';
import { ciPlan, ciSetupInvocations, requiredJudgement, runCIJob, runCISetup } from '../../scripts/kit/ci-setup.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';

const runtimes = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
type FixtureConfig = { runtimes?: string[]; runner?: 'ubuntu-24.04' | 'ubuntu-26.04-arm'; setup: { shared: string[]; runtimes: Record<string, string[]> }; tools?: Record<string, string[]>; contexts?: Record<string, { prepare?: string; cleanup?: string }>; targets?: { shared?: string[]; runtimes?: Record<string, string[]> } };
const fixtureConfig = (root: string) => readConfig<FixtureConfig>(root, 'config/ci.json', 'ci.schema.json');

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-ci-setup-'));
  mkdirSync(path.join(root, 'config'));
  mkdirSync(path.join(root, 'packages/go'), { recursive: true });
  writeFileSync(path.join(root, 'packages/go/go.mod'), 'module example.invalid/fixture\n');
  writeFileSync(path.join(root, 'Makefile'), [
    '.PHONY: shared-setup go-setup context-prepare context-cleanup',
    'shared-setup:',
    '\t@printf shared >> setup.log',
    'go-setup:',
    '\t@printf go >> setup.log',
    'context-prepare:',
    '\t@printf prepare >> setup.log',
    'context-cleanup:',
    '\t@printf cleanup >> setup.log',
    '',
  ].join('\n'));
  const config = {
    schema: 1,
    runtimes: ['go'],
    setup: {
      shared: ['shared-setup'],
      runtimes: Object.fromEntries(runtimes.map(runtime => [runtime, runtime === 'go' ? ['go-setup'] : []])),
    },
  };
  writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
  initRepository(root);
  execFileSync('git', ['add', 'Makefile', 'config/ci.json', 'packages/go/go.mod'], { cwd: root });
  return root;
}

test('K731: CI setup executes only the declared existing runtime targets', () => {
  const root = fixture();
  try {
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go'), [{ target: 'go-setup', args: [] }]);
    runCISetup(root, 'runtime', 'go');
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'go');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: the CLI is explicit and an unknown mode or job cannot execute a valid group', () => {
  const root = fixture();
  try {
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    assert.throws(() => execFileSync(process.execPath, [script, '--context-typo', 'shared'], { cwd: root, stdio: 'pipe' }), /unknown CI setup mode/);
    assert.throws(() => execFileSync(process.execPath, [script, '--job', 'sharde'], { cwd: root, stdio: 'pipe' }), /unknown CI job sharde/);
    assert.equal(existsSync(path.join(root, 'setup.log')), false, 'an unknown mode cannot start any configured Make target');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K1250: the job recipes of kit.mk start the job of ci-setup.mts, so CI and a local run make the same call.
test('K1250: the ci-shared, ci-runtime and ci-required targets of kit.mk run the jobs of ci-setup', () => {
  const root = fixture();
  try {
    const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    writeFileSync(path.join(root, 'Makefile'), [`KIT := ${path.join(kitRoot, 'scripts/kit')}`, 'KIT_EXT := mts', `include ${path.join(kitRoot, 'scripts/kit/kit.mk')}`, ''].join('\n'));
    const dry = (...args: string[]) => execFileSync('make', ['--no-print-directory', '-n', ...args, `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8' });
    assert.match(dry('ci-shared'), /ci-setup\.mts --job shared\n/);
    assert.match(dry('ci-runtime', 'RUNTIME=go'), /ci-setup\.mts --job runtime go\n/);
    assert.match(dry('ci-required'), /ci-setup\.mts --required\n/);
    assert.match(dry('ci-plan'), /ci-setup\.mts --plan\n/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A make that records the arguments of each call of the job and fails the calls that `failing` names. */
function recorder(failing: (args: string[]) => boolean = () => false) {
  const calls: string[] = [];
  return { calls, make: (args: string[]) => { calls.push(args.filter(arg => arg !== '--no-print-directory').join(' ')); return failing(args) ? 1 : 0; } };
}

test('K1250: a job installs its tools and runs its setup, then prepares its context, runs its checks and cleans up', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.tools = { go: ['go'] };
    config.targets = { runtimes: { go: ['test-go'] } };
    config.contexts = { go: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const { calls, make } = recorder();
    assert.equal(runCIJob(root, 'runtime', 'go', make), 0);
    assert.deepEqual(calls, ['install-tools TOOLS=go', 'context-prepare', '-k ci-targets TARGETS=kit-gates-runtime-go test-go', 'context-cleanup']);
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'go', 'the setup target ran after the install and before the context');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K1250: a failed check fails the job after the cleanup, and a failed preparation runs no check', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const checks = recorder(args => args.includes('ci-targets'));
    assert.equal(runCIJob(root, 'shared', undefined, checks.make), 1);
    assert.deepEqual(checks.calls, ['context-prepare', '-k ci-targets TARGETS=kit-gates-static', 'context-cleanup']);
    const prepare = recorder(args => args.includes('context-prepare'));
    assert.equal(runCIJob(root, 'shared', undefined, prepare.make), 1);
    assert.deepEqual(prepare.calls, ['context-prepare', 'context-cleanup'], 'the cleanup runs once the preparation was entered');
    const cleanup = recorder(args => args.includes('context-cleanup'));
    assert.equal(runCIJob(root, 'shared', undefined, cleanup.make), 1, 'a failed cleanup fails the job');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K1250: a failed install or setup stops the job before its context and checks', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.tools = { go: ['go'] };
    config.contexts = { go: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const install = recorder(args => args.includes('install-tools'));
    assert.equal(runCIJob(root, 'runtime', 'go', install.make), 1);
    assert.deepEqual(install.calls, ['install-tools TOOLS=go']);
    assert.equal(existsSync(path.join(root, 'setup.log')), false, 'no setup runs after a failed install');
    config.setup.runtimes.go = ['missing-setup'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const setup = recorder();
    assert.throws(() => runCIJob(root, 'runtime', 'go', setup.make), /make missing-setup failed in the CI setup runtime\/go/);
    assert.deepEqual(setup.calls, ['install-tools TOOLS=go']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K1250: the runtime job needs a runtime of the plan and the shared job takes none', () => {
  const root = fixture();
  try {
    const { calls, make } = recorder();
    assert.throws(() => runCIJob(root, 'runtime', undefined, make), /make ci-runtime needs RUNTIME, a runtime of the plan .*; choose go/);
    assert.throws(() => runCIJob(root, 'runtime', 'python', make), /choose go/);
    assert.throws(() => runCIJob(root, 'shared', 'go', make), /make ci-shared takes no RUNTIME/);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K910, K950: required fails on a failed, cancelled or skipped job that the plan selected; the runtime job is selected only when
// config/ci.json declares a runtime.
test('K950: required judges every selected job and leaves the runtime job of a repository without runtimes unjudged', () => {
  const root = fixture();
  try {
    const needs = (plan: string, shared: string, runtime: string) => JSON.stringify({ plan: { result: plan, outputs: {} }, shared: { result: shared, outputs: {} }, runtime: { result: runtime, outputs: {} } });
    assert.equal(requiredJudgement(root, needs('success', 'success', 'success')).status, 0);
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(requiredJudgement(root, needs(result, 'success', 'success')).status, 1, `plan ${result}`);
      assert.equal(requiredJudgement(root, needs('success', result, 'success')).status, 1, `shared ${result}`);
      assert.equal(requiredJudgement(root, needs('success', 'success', result)).status, 1, `runtime ${result}`);
    }
    const config = fixtureConfig(root);
    config.runtimes = [];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const none = requiredJudgement(root, needs('success', 'success', 'skipped'));
    assert.equal(none.status, 0, none.lines.join('\n'));
    assert.ok(none.lines.includes('[ci-passed] runtime: skipped, not selected by the plan, not judged'));
    assert.equal(requiredJudgement(root, needs('success', 'failure', 'skipped')).status, 1);
    writeFileSync(path.join(root, 'config/ci.json'), '{');
    const broken = requiredJudgement(root, needs('failure', 'skipped', 'skipped'));
    assert.equal(broken.status, 1);
    assert.match(broken.lines.join('\n'), /\[ci-passed\] plan: failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K1068: a declared target is planned as declared; make reports a target that does not exist when the setup runs it.
test('K1068: a declared setup target that does not exist is planned and make reports it when it runs', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.setup.runtimes.go = ['missing-setup'];
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go'), [{ target: 'missing-setup', args: [] }]);
    assert.throws(() => runCISetup(root, 'runtime', 'go'), /make missing-setup failed in the CI setup runtime\/go/);
    assert.equal(existsSync(path.join(root, 'setup.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: contexts require a complete pair of targets, planned as declared', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(ciSetupInvocations(root, 'shared', undefined), [{ target: 'shared-setup', args: [] }]);

    config.contexts = { shared: { prepare: 'context-prepare' } };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /contexts\/shared must have required property 'cleanup'/);

    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'missing-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    assert.equal(ciPlan(root).runner, 'ubuntu-24.04', 'K1068: a declared context target is not pre-checked against the Makefile');

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: missing consumer setup config names its required declaration and schema', () => {
  const root = fixture();
  try {
    unlinkSync(path.join(root, 'config/ci.json'));
    assert.throws(() => ciSetupInvocations(root, 'shared', undefined), /config\/ci\.json is missing\. Fix: declare shared and runtime setup targets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K859: kit wraps no package install; the default setup of a runtime is the repository's own deps-<runtime> target, a thin call of its
// package manager. K1068: it is planned whether or not the Makefile defines it; make reports a missing one when it runs.
test('K859: the default setup of a runtime is the deps target of the repository, and an absent runtime needs none', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, 'packages/go/go.mod'), 'module example.invalid/fixture\n\nrequire example.com/library v1.2.3\n');
    mkdirSync(path.join(root, 'packages/php'), { recursive: true });
    writeFileSync(path.join(root, 'packages/php/composer.json'), '{}');
    writeFileSync(path.join(root, 'packages/php/composer.lock'), '{}');
    writeFileSync(path.join(root, 'packages/php/A.php'), '<?php\n');
    const config = fixtureConfig(root);
    config.runtimes = ['go', 'php'];
    config.setup.runtimes.go = [];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'packages', 'config/ci.json'], { cwd: root });
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go'), [{ target: 'deps-go', args: [] }], 'K1068: planned before the Makefile defines it');
    writeFileSync(path.join(root, 'Makefile'), `${readFileSync(path.join(root, 'Makefile'), 'utf8')}.PHONY: deps-go deps-php\ndeps-go:\n\t@true\ndeps-php:\n\t@true\n`);
    execFileSync('git', ['add', 'Makefile'], { cwd: root });
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go'), [{ target: 'deps-go', args: [] }]);
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php'), [{ target: 'deps-php', args: [] }], 'no install wrapper of each locked folder');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: the plan takes the declared runtimes', () => {
  const root = fixture();
  try {
    const result = ciPlan(root);
    assert.deepEqual(result.runtimes.map(job => job.runtime), ['go']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K745: runner selection defaults to Ubuntu 24.04 and can select the supported ARM runner', () => {
  const root = fixture();
  try {
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    assert.equal(ciPlan(root).runner, 'ubuntu-24.04');
    config.runner = 'ubuntu-26.04-arm';
    writeFileSync(configFile, JSON.stringify(config));
    const selected = ciPlan(root);
    assert.equal(selected.runner, 'ubuntu-26.04-arm');
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.match(readFileSync(output, 'utf8'), /^runner=ubuntu-26\.04-arm$/m);
    writeFileSync(configFile, JSON.stringify({ ...config, runner: 'ubuntu-26.04-x64' }));
    assert.throws(() => ciPlan(root), /must be equal to one of the allowed values/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K745: shared native parsers install their Go and Python toolchains even when runtime jobs also use them', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'tests'), { recursive: true });
    writeFileSync(path.join(root, 'tests/test_markers.py'), 'def test_marker_parser():\n    pass\n');
    writeFileSync(path.join(root, 'mise.toml'), '[tools]\ngo = "1.26.0"\npython = "3.13.0"\n');
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.runtimes = ['go', 'python'];
    config.setup.runtimes.python = ['python-setup'];
    writeFileSync(configFile, JSON.stringify(config));
    writeFileSync(path.join(root, 'Makefile'), readFileSync(path.join(root, 'Makefile'), 'utf8').replace('.PHONY: shared-setup', '.PHONY: python-setup shared-setup').replace('shared-setup:\n', 'python-setup:\n\t@true\nshared-setup:\n'));
    execFileSync('git', ['add', 'tests/test_markers.py', 'mise.toml'], { cwd: root });
    execFileSync('git', ['add', 'config/ci.json', 'Makefile'], { cwd: root });
    assert.deepEqual(ciPlan(root).commonTools, ['go', 'python']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K910: config/ci.json declares the targets of each job, which the plan passes to the pipeline; a runtime that targets.runtimes
// names joins the plan, its setup and its contexts although `runtimes` does not name it; no declared targets pass empty lists.
test('K910: the plan passes the declared targets of each job and takes the runtimes that targets.runtimes names', () => {
  const root = fixture();
  try {
    const configFile = path.join(root, 'config/ci.json');
    const empty = ciPlan(root);
    assert.deepEqual([empty.sharedTargets, empty.runtimes], [[], [{ runtime: 'go', installTools: [], targets: [] }]]);
    const config = fixtureConfig(root);
    config.targets = { shared: ['shared-check'], runtimes: { go: ['test-go'], python: ['test-python'] } };
    config.setup.runtimes.python = ['shared-setup'];
    config.contexts = { python: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(configFile, JSON.stringify(config));
    const plan = ciPlan(root);
    assert.deepEqual(plan.sharedTargets, ['shared-check']);
    assert.deepEqual(plan.runtimes.map(({ runtime, targets }) => [runtime, targets]), [['go', ['test-go']], ['python', ['test-python']]]);
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'python'), [{ target: 'shared-setup', args: [] }]);
    const { calls, make } = recorder();
    assert.equal(runCIJob(root, 'runtime', 'python', make), 0);
    assert.deepEqual(calls, ['context-prepare', '-k ci-targets TARGETS=kit-gates-runtime-python test-python', 'context-cleanup']);
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    const written = readFileSync(output, 'utf8');
    // K1250: the plan publishes the fan-out; each job reads its targets from config/ci.json.
    assert.match(written, /^runtimes=\[\{"runtime":"go"\},\{"runtime":"python"\}\]$/m);
    assert.match(written, /^shared_php=false$/m);
    assert.doesNotMatch(written, /shared_targets|common_tools|installTools/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: PHP extension jobs install their declared PHP and Composer tools', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'packages/php-ext'));
    writeFileSync(path.join(root, 'packages/php-ext/composer.json'), '{}');
    writeFileSync(path.join(root, 'packages/php-ext/composer.lock'), '{}');
    writeFileSync(path.join(root, '.php-version'), '8.4\n');
    writeFileSync(path.join(root, 'mise.toml'), '[tools]\n"http:composer" = { version = "2.9.0", url = "https://example.invalid/composer.phar" }\n');
    writeFileSync(path.join(root, 'Makefile'), [
      '.PHONY: shared-setup go-setup extension-setup',
      'shared-setup:', '\t@printf shared >> setup.log',
      'go-setup:', '\t@printf go >> setup.log',
      'extension-setup:', '\t@printf extension >> setup.log',
      '',
    ].join('\n'));
    const config = fixtureConfig(root);
    // The extension is a runtime that config/ci.json declares (K1114).
    config.runtimes = ['go', 'php-ext'];
    config.setup.runtimes['php-ext'] = ['extension-setup'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'Makefile', 'config/ci.json', '.php-version', 'mise.toml', 'packages/php-ext'], { cwd: root });

    const plan = ciPlan(root);
    const extension = plan.runtimes.find(job => job.runtime === 'php-ext');
    assert.ok(extension, 'the declared php-ext runtime selects a PHP extension job');
    assert.deepEqual(extension.installTools, ['php', 'composer']);
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php-ext'), [
      { target: 'extension-setup', args: [] },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: extra pinned tools follow the setup target that needs them', () => {
  const root = fixture();
  try {
    execFileSync('git', ['rm', '-q', '-f', '-r', 'packages/go'], { cwd: root });
    mkdirSync(path.join(root, 'packages/ts'), { recursive: true });
    writeFileSync(path.join(root, 'packages/ts/index.ts'), 'export const value = 1;\n');
    writeFileSync(path.join(root, 'mise.toml'), '[tools]\ngo = "1.26.0"\n');
    writeFileSync(path.join(root, 'Makefile'), [
      '.PHONY: shared-setup deps-node',
      'shared-setup:', '\t@true',
      'deps-node:', '\t@true',
      '',
    ].join('\n'));
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.runtimes = ['ts'];
    config.setup.runtimes.go = [];
    config.tools = { ts: ['go'] };
    writeFileSync(configFile, JSON.stringify(config));
    execFileSync('git', ['add', 'Makefile', 'config/ci.json', 'packages/ts', 'mise.toml'], { cwd: root });

    const plan = ciPlan(root);
    const ts = plan.runtimes.find(job => job.runtime === 'ts');
    assert.ok(ts);
    assert.deepEqual(ts.installTools, ['go']);
    assert.deepEqual(plan.commonTools, ['go'], 'the shared toolchain parser still receives Go although the TypeScript job also needs it');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K1018: the php runtime setup installs the PHP symbol extractor', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'packages/php/src'), { recursive: true });
    writeFileSync(path.join(root, 'packages/php/composer.json'), '{}');
    writeFileSync(path.join(root, 'packages/php/composer.lock'), '{}');
    writeFileSync(path.join(root, 'packages/php/src/A.php'), '<?php\n');
    writeFileSync(path.join(root, '.php-version'), '8.4\n');
    writeFileSync(path.join(root, 'mise.toml'), '[tools]\n"http:composer" = { version = "2.9.0", url = "https://example.invalid/composer.phar" }\n');
    writeFileSync(path.join(root, 'config/toolchain.json'), JSON.stringify({ schema: 1, symbolExtractors: ['php'] }));
    writeFileSync(path.join(root, 'Makefile'), `${readFileSync(path.join(root, 'Makefile'), 'utf8')}.PHONY: deps-php\ndeps-php:\n\t@true\n`);
    const config = fixtureConfig(root);
    config.runtimes = ['go', 'php'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'Makefile', '.php-version', 'mise.toml', 'config/toolchain.json', 'config/ci.json', 'packages/php'], { cwd: root });
    const plan = ciPlan(root);
    assert.ok(plan.runtimes.some(job => job.runtime === 'php'), 'the declared php runtime has a PHP runtime job, which owns PHP and Composer');
    // K1018: the setup of the php runtime job installs the extractor, so the pipeline names no language.
    const extractor = { target: 'kit-install-symbols', args: ['EXTRACTORS=php'] };
    assert.deepEqual(ciSetupInvocations(root, 'shared', undefined), [{ target: 'shared-setup', args: [] }], 'the shared setup installs no PHP extractor');
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php').at(-1), extractor, 'the php runtime setup installs the PHP extractor');
    assert.ok(!ciSetupInvocations(root, 'runtime', 'go').some(invocation => invocation.target === 'kit-install-symbols'), 'a go runtime setup installs no PHP extractor');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K860: ci-setup plans and runs the declared setup; it refuses no tool selector or context scope that a package manager or a target
// judges itself.
test('K860: ci-setup refuses no tool selector or context scope of its own', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.tools = { go: ['rust', 'node'] };
    config.contexts = { rust: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const plan = ciPlan(root);
    assert.equal(plan.runtimes.find(job => job.runtime === 'go')?.installTools.includes('rust'), true, 'the selector reaches install-tools, which judges it');
    assert.equal(plan.runtimes.find(job => job.runtime === 'go')?.installTools.includes('node'), true, 'a configured node passes as written too; only kit defaults are filtered');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K1114: the runtimes of the plan are those that config/ci.json declares in runtimes and targets.runtimes; kit reads none from a
// folder name or a tracked file, and a config without runtimes fails with the fix.
test('K1114 the runtimes of the plan are those that config/ci.json declares, not folder names or tracked files', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'packages/php-ext'), { recursive: true });
    writeFileSync(path.join(root, 'packages/php-ext/config.m4'), 'dnl\n');
    mkdirSync(path.join(root, 'lib/ts'), { recursive: true });
    writeFileSync(path.join(root, 'lib/ts/a.ts'), 'export const a = 1;\n');
    const config = fixtureConfig(root);
    config.setup.runtimes['php-ext'] = ['go-setup'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'config', 'packages/php-ext/config.m4', 'lib/ts/a.ts'], { cwd: root });
    assert.deepEqual(ciPlan(root).runtimes.map(job => job.runtime), ['go'], 'a php-ext root and a .ts file name no runtime');
    config.runtimes = ['go', 'php-ext'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.deepEqual(ciPlan(root).runtimes.map(job => job.runtime), ['go', 'php-ext']);
    delete config.runtimes;
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.throws(() => ciPlan(root), /config\/ci\.json declares no runtimes\. Fix: declare "runtimes"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
