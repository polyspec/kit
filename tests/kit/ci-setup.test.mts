import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initRepository } from './sandbox-repository.mts';
import { ciPlan, ciSetupInvocations, gateResultsPass, GATE_REQUIRED_NEEDS, parityBindingMatrix, runCIContext, runCISetup } from '../../scripts/kit/ci-setup.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';

const runtimes = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
type FixtureConfig = { parityMode?: 'full' | 'phases'; runner?: 'ubuntu-24.04' | 'ubuntu-26.04-arm'; setup: { shared: string[]; parity: string[]; runtimes: Record<string, string[]> }; tools?: Record<string, string[]>; contexts?: Record<string, { prepare?: string; cleanup?: string }> };
const fixtureConfig = (root: string) => readConfig<FixtureConfig>(root, 'config/ci.json', 'ci.schema.json');

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-ci-setup-'));
  mkdirSync(path.join(root, 'config'));
  mkdirSync(path.join(root, 'packages/go'), { recursive: true });
  writeFileSync(path.join(root, 'packages/go/go.mod'), 'module example.invalid/fixture\n');
  writeFileSync(path.join(root, 'config/parity.json'), JSON.stringify({
    schema: 1,
    implementations: [{ name: 'go-client', runner: 'go', roots: ['packages/go'] }],
    requirements: { pattern: 'REQ-[0-9]+' },
    units: [],
  }));
  writeFileSync(path.join(root, 'Makefile'), [
    '.PHONY: shared-setup parity-setup go-setup parity-api-check context-prepare context-cleanup',
    'shared-setup:',
    '\t@printf shared >> setup.log',
    'parity-setup:',
    '\t@printf parity >> setup.log',
    'go-setup:',
    '\t@printf go >> setup.log',
    'parity-api-check:',
    '\t$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api',
    'parity-bindings-go-client-check:',
    '\t$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation go-client',
    'context-prepare:',
    '\t@printf prepare >> setup.log',
    'context-cleanup:',
    '\t@printf cleanup >> setup.log',
    '',
  ].join('\n'));
  const config = {
    schema: 1,
    setup: {
      shared: ['shared-setup'],
      parity: ['parity-setup'],
      runtimes: Object.fromEntries(runtimes.map(runtime => [runtime, runtime === 'go' ? ['go-setup'] : []])),
    },
  };
  writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
  initRepository(root);
  execFileSync('git', ['add', 'Makefile', 'config/ci.json', 'config/parity.json', 'packages/go/go.mod'], { cwd: root });
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

test('K731-1: setup CLI is explicit and unknown modes cannot execute a valid group', () => {
  const root = fixture();
  try {
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    assert.throws(() => execFileSync(process.execPath, [script, '--context-typo', 'shared'], { cwd: root, stdio: 'pipe' }), /unknown CI setup mode/);
    assert.equal(existsSync(path.join(root, 'setup.log')), false, 'an unknown mode cannot start any configured Make target');
    execFileSync(process.execPath, [script, '--setup', 'shared'], { cwd: root, stdio: 'pipe' });
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'shared', 'the explicit setup mode preserves the existing group selection');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: the real kit-ci-setup Make target forwards the explicit CLI mode', () => {
  const root = fixture();
  try {
    const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    writeFileSync(path.join(root, 'Makefile'), [
      `KIT := ${path.join(kitRoot, 'scripts/kit')}`,
      'KIT_EXT := mts',
      `include ${path.join(kitRoot, 'scripts/kit/kit.mk')}`,
      '.PHONY: shared-setup parity-setup go-setup parity-api-check',
      'shared-setup:', '\t@printf shared >> setup.log',
      'parity-setup:', '\t@printf parity >> setup.log',
      'go-setup:', '\t@printf go >> setup.log',
      'parity-api-check:', '\t$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api',
      'parity-bindings-go-client-check:', '\t$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation go-client',
      '',
    ].join('\n'));
    execFileSync('git', ['add', 'Makefile'], { cwd: root });
    execFileSync('make', ['kit-ci-setup', 'GROUP=shared', `NODE=${process.execPath}`], { cwd: root, stdio: 'pipe' });
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'shared');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: unknown targets fail before any setup runs', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.setup.runtimes.go = ['missing-setup'];
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciSetupInvocations(root, 'runtime', 'go'), /config\/ci\.json: setup\.runtimes\.go names missing-setup, which is not a Make target/);
    assert.throws(() => runCISetup(root, 'runtime', 'go'), /missing-setup, which is not a Make target/);
    assert.equal(existsSync(path.join(root, 'setup.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: contexts require a complete pair of existing Make targets', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(ciSetupInvocations(root, 'shared'), [{ target: 'shared-setup', args: [] }]);

    config.contexts = { shared: { prepare: 'context-prepare' } };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /contexts\/shared must have required property 'cleanup'/);

    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'missing-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /contexts\.shared\.cleanup names missing-cleanup, which is not a Make target/);

    writeFileSync(file, JSON.stringify({ ...fixtureConfig(root), contexts: { unknown: { prepare: 'context-prepare', cleanup: 'context-cleanup' } } }));
    assert.throws(() => ciPlan(root), /contexts must NOT have additional properties/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: selected context targets run through Make and missing contexts are a no-op', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    assert.doesNotThrow(() => runCIContext(root, 'prepare', 'shared'));
    assert.equal(existsSync(path.join(root, 'setup.log')), false, 'no context declaration preserves default setup behavior');
    const config = fixtureConfig(root);
    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    runCIContext(root, 'prepare', 'shared');
    runCIContext(root, 'cleanup', 'shared');
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'preparecleanup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: a failed context target is reported as a failed CI phase', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, `${readFileSync(makefile, 'utf8').replace('context-prepare:\n\t@printf prepare >> setup.log', 'context-prepare:\n\t@false')}`);
    assert.throws(() => runCIContext(root, 'prepare', 'shared'), /make context-prepare failed in the CI context prepare for shared/);
    runCIContext(root, 'cleanup', 'shared');
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'cleanup', 'cleanup remains independently executable after prepare fails');
    writeFileSync(makefile, readFileSync(makefile, 'utf8').replace('context-cleanup:\n\t@printf cleanup >> setup.log', 'context-cleanup:\n\t@false'));
    assert.throws(() => runCIContext(root, 'cleanup', 'shared'), /make context-cleanup failed in the CI context cleanup for shared/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: missing consumer setup config names its required declaration and schema', () => {
  const root = fixture();
  try {
    unlinkSync(path.join(root, 'config/ci.json'));
    assert.throws(() => ciSetupInvocations(root, 'shared'), /config\/ci\.json is missing\. Fix: declare shared, parity and runtime setup targets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K859: kit wraps no package install; the default setup of a runtime is the repository's own deps-<runtime> target, a thin call of its
// package manager, and a missing one names the target to define.
test('K859: the default setup of a runtime is the deps target of the repository, a missing one is named, and an absent runtime needs none', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, 'packages/go/go.mod'), 'module example.invalid/fixture\n\nrequire example.com/library v1.2.3\n');
    mkdirSync(path.join(root, 'packages/php'), { recursive: true });
    writeFileSync(path.join(root, 'packages/php/composer.json'), '{}');
    writeFileSync(path.join(root, 'packages/php/composer.lock'), '{}');
    writeFileSync(path.join(root, 'packages/php/A.php'), '<?php\n');
    const config = fixtureConfig(root);
    config.setup.runtimes.go = [];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'packages', 'config/ci.json'], { cwd: root });
    assert.throws(() => ciSetupInvocations(root, 'runtime', 'go'), /the default setup target deps-go is not present in this Makefile\. Fix: define deps-go in the Makefile as the locked install of the package manager, or declare setup\.runtimes\.go/);
    writeFileSync(path.join(root, 'Makefile'), `${readFileSync(path.join(root, 'Makefile'), 'utf8')}.PHONY: deps-go deps-php\ndeps-go:\n\t@true\ndeps-php:\n\t@true\n`);
    execFileSync('git', ['add', 'Makefile'], { cwd: root });
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go'), [{ target: 'deps-go', args: [] }]);
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php'), [{ target: 'deps-php', args: [] }], 'no install wrapper of each locked folder');
    // A runtime with no tracked source is not set up, so a repository defines no deps target for it: deps-node, deps-rust and
    // deps-python stay undefined here and the parity setup still passes.
    assert.deepEqual(ciSetupInvocations(root, 'parity').map(({ target }) => target), ['deps-go', 'deps-php', 'parity-setup']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: the plan discovers tracked runtime packages and separates configured shared and parity setup', () => {
  const root = fixture();
  try {
    const result = ciPlan(root);
    assert.deepEqual(result.runtimes.map(job => job.runtime), ['go']);
    assert.equal(result.parityMode, 'full');
    assert.deepEqual(result.parityImplementations, ['go-client']);
    assert.deepEqual(result.parityMatrix, [{ implementation: 'go-client' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K734: phase mode plans one API job and the exact implementation matrix from parity.json', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    writeFileSync(file, JSON.stringify(config));
    const result = ciPlan(root);
    assert.equal(result.parityMode, 'phases');
    assert.deepEqual(result.parityImplementations, ['go-client']);
    assert.deepEqual(result.parityMatrix, [{ implementation: 'go-client' }]);
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    const actionOutputs = readFileSync(output, 'utf8');
    assert.match(actionOutputs, /^parity_mode=phases$/m);
    assert.match(actionOutputs, /^parity_matrix=\[{"implementation":"go-client"}\]$/m);
    assert.deepEqual(parityBindingMatrix(['go', 'php-extension']), [{ implementation: 'go' }, { implementation: 'php-extension' }]);
    assert.throws(() => parityBindingMatrix([]), /declares no implementations/);
    assert.throws(() => parityBindingMatrix(['go', 'go']), /duplicate implementation names/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K734: phase mode rejects duplicate declaration selectors', () => {
  const root = fixture();
  try {
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    writeFileSync(configFile, JSON.stringify(config));
    const parityFile = path.join(root, 'config/parity.json');
    const parity = readConfig<{ implementations: { name: string; runner: string; roots: string[] }[] }>(root, 'config/parity.json', 'parity.schema.json');
    const first = parity.implementations[0];
    assert.ok(first, 'the fixture declares one implementation');
    parity.implementations.push({ ...first });
    writeFileSync(parityFile, JSON.stringify(parity));
    assert.throws(() => ciPlan(root), /duplicate implementation names/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K745: one discovered implementation without parity declaration selects no parity phase', () => {
  const root = fixture();
  try {
    execFileSync('git', ['rm', '-q', '-f', 'config/parity.json'], { cwd: root });
    const noParity = ciPlan(root);
    assert.equal(noParity.parityMode, 'none');
    assert.deepEqual(noParity.parityImplementations, []);
    assert.deepEqual(noParity.parityMatrix, []);
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.match(readFileSync(output, 'utf8'), /^parity_mode=none$/m);
    assert.equal(gateResultsPass('none', { discover: 'success', shared: 'success', parity: 'skipped', api: 'skipped', bindings: 'skipped', runtime: 'success' }, true), true);
    assert.equal(gateResultsPass('none', { discover: 'success', shared: 'success', parity: 'success', api: 'skipped', bindings: 'skipped', runtime: 'success' }, true), false);
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

test('K734: final gate results require the selected parity branch and every provider job', () => {
  assert.deepEqual(GATE_REQUIRED_NEEDS, ['discover', 'shared', 'parity', 'parity-api', 'parity-bindings', 'runtime']);
  assert.equal(gateResultsPass('full', { discover: 'success', shared: 'success', parity: 'success', api: 'skipped', bindings: 'skipped', runtime: 'success' }, true), true);
  assert.equal(gateResultsPass('phases', { discover: 'success', shared: 'success', parity: 'skipped', api: 'success', bindings: 'success', runtime: 'skipped' }, false), true);
  assert.equal(gateResultsPass('phases', { discover: 'success', shared: 'success', parity: 'success', api: 'success', bindings: 'success', runtime: 'success' }, true), false);
  assert.equal(gateResultsPass('phases', { discover: 'success', shared: 'success', parity: 'skipped', api: 'success', bindings: 'skipped', runtime: 'success' }, true), false);
  assert.equal(gateResultsPass('full', { discover: 'success', shared: 'success', parity: 'success', api: 'skipped', bindings: 'skipped', runtime: 'skipped' }, true), false);
});

test('K734: the final gate command returns failure for a missing selected phase job', () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
  const env = {
    ...process.env,
    KIT_CI_DISCOVER_RESULT: 'success',
    KIT_CI_SHARED_RESULT: 'success',
    KIT_CI_PARITY_MODE: 'phases',
    KIT_CI_PARITY_RESULT: 'skipped',
    KIT_CI_PARITY_API_RESULT: 'success',
    KIT_CI_PARITY_BINDINGS_RESULT: 'success',
    KIT_CI_RUNTIME_RESULT: 'skipped',
    KIT_CI_HAS_RUNTIMES: 'false',
  };
  assert.doesNotThrow(() => execFileSync(process.execPath, [script, '--verify-gates'], { env, stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [script, '--verify-gates'], { env: { ...env, KIT_CI_PARITY_BINDINGS_RESULT: 'skipped' }, stdio: 'pipe' }), /gate result aggregation failed/);
  const noParity = { ...env, KIT_CI_PARITY_MODE: 'none', KIT_CI_PARITY_RESULT: 'skipped', KIT_CI_PARITY_API_RESULT: 'skipped', KIT_CI_PARITY_BINDINGS_RESULT: 'skipped' };
  assert.doesNotThrow(() => execFileSync(process.execPath, [script, '--verify-gates'], { env: noParity, stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [script, '--verify-gates'], { env: { ...noParity, KIT_CI_PARITY_API_RESULT: 'success' }, stdio: 'pipe' }), /gate result aggregation failed/);
});

test('K731: PHP extension jobs install their declared PHP and Composer tools and generate arginfo locally', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'packages/php-ext'));
    writeFileSync(path.join(root, 'packages/php-ext/composer.json'), '{}');
    writeFileSync(path.join(root, 'packages/php-ext/composer.lock'), '{}');
    writeFileSync(path.join(root, '.php-version'), '8.4\n');
    writeFileSync(path.join(root, 'mise.toml'), '[tools]\n"http:composer" = { version = "2.9.0", url = "https://example.invalid/composer.phar" }\n');
    writeFileSync(path.join(root, 'Makefile'), [
      '.PHONY: shared-setup parity-setup go-setup extension-setup kit-install-php-arginfo',
      'shared-setup:', '\t@printf shared >> setup.log',
      'parity-setup:', '\t@printf parity >> setup.log',
      'go-setup:', '\t@printf go >> setup.log',
      'extension-setup:', '\t@printf extension >> setup.log',
      'kit-install-php-arginfo:', '\t@printf arginfo >> setup.log',
      '',
    ].join('\n'));
    const config = fixtureConfig(root);
    config.setup.runtimes['php-ext'] = ['extension-setup'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'Makefile', 'config/ci.json', '.php-version', 'mise.toml', 'packages/php-ext'], { cwd: root });

    const plan = ciPlan(root);
    const extension = plan.runtimes.find(job => job.runtime === 'php-ext');
    assert.ok(extension, 'tracked PHP extension files select a PHP extension job');
    assert.deepEqual(extension.installTools, ['php', 'composer']);
    assert.equal(plan.parityTools.includes('phpunit'), false, 'the repository does not need Kit private PHPUnit when it provides its own Composer project');
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php-ext'), [
      { target: 'extension-setup', args: [] },
      { target: 'kit-install-php-arginfo', args: [] },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: extra pinned tools follow the setup target that needs them and parity receives runtime setup tools', () => {
  const root = fixture();
  try {
    execFileSync('git', ['rm', '-q', '-f', '-r', 'packages/go'], { cwd: root });
    mkdirSync(path.join(root, 'packages/ts'), { recursive: true });
    writeFileSync(path.join(root, 'packages/ts/index.ts'), 'export const value = 1;\n');
    writeFileSync(path.join(root, 'config/parity.json'), JSON.stringify({
      schema: 1,
      implementations: [{ name: 'ts-client', runner: 'node', roots: ['packages/ts'] }],
      requirements: { pattern: 'REQ-[0-9]+' },
      units: [],
    }));
    writeFileSync(path.join(root, 'mise.toml'), '[tools]\ngo = "1.26.0"\n');
    writeFileSync(path.join(root, 'Makefile'), [
      '.PHONY: shared-setup parity-setup deps-node',
      'shared-setup:', '\t@true',
      'parity-setup:', '\t@true',
      'deps-node:', '\t@true',
      '',
    ].join('\n'));
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.setup.runtimes.go = [];
    config.tools = { ts: ['go'] };
    writeFileSync(configFile, JSON.stringify(config));
    execFileSync('git', ['add', 'Makefile', 'config/ci.json', 'config/parity.json', 'packages/ts', 'mise.toml'], { cwd: root });

    const plan = ciPlan(root);
    const ts = plan.runtimes.find(job => job.runtime === 'ts');
    assert.ok(ts);
    assert.deepEqual(ts.installTools, ['go']);
    assert.deepEqual(plan.commonTools, ['go'], 'the shared toolchain parser still receives Go although the TypeScript job also needs it');
    assert.deepEqual(plan.parityTools, ['go'], 'parity installs tools needed by runtime setup it repeats');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K896: the shared job receives PHP and Composer for the PHP symbol extractor that divergence-check reads guards with', () => {
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
    execFileSync('git', ['add', 'Makefile', '.php-version', 'mise.toml', 'config/toolchain.json', 'packages/php'], { cwd: root });
    const plan = ciPlan(root);
    assert.ok(plan.runtimes.some(job => job.runtime === 'php'), 'the PHP package selects a PHP runtime job, which owns PHP and Composer');
    assert.deepEqual(plan.extractors, ['php']);
    assert.ok(plan.commonTools.includes('php') && plan.commonTools.includes('composer'), `the shared job installs PHP and Composer: ${plan.commonTools.join(' ')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K860: ci-setup plans and runs the declared setup; it refuses no declaration that a package manager, a target or parity-check
// judges itself, so a tool selector, a context, a parity recipe and an undeclared parity pass to the tool that runs them.
test('K860: ci-setup refuses no tool selector, context scope, parity recipe or missing parity declaration of its own, and stops a recursive dispatch', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.tools = { go: ['rust', 'node'] };
    config.contexts = { rust: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    config.parityMode = 'phases';
    config.setup.runtimes.php = ['shared-setup'];
    writeFileSync(file, JSON.stringify(config));
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, readFileSync(makefile, 'utf8').replace('$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api', '@true'));
    const phases = ciPlan(root);
    assert.equal(phases.parityMode, 'phases', 'the replaced recipe is the repository\'s');
    assert.deepEqual(phases.runtimes.find(job => job.runtime === 'go')?.installTools.includes('rust'), true, 'the selector reaches install-tools, which judges it');
    assert.equal(phases.runtimes.find(job => job.runtime === 'go')?.installTools.includes('node'), true, 'a configured node passes as written too; only kit defaults are filtered');
    execFileSync('git', ['rm', '-q', '-f', 'config/parity.json'], { cwd: root });
    mkdirSync(path.join(root, 'packages/php'), { recursive: true });
    writeFileSync(path.join(root, 'packages/php/Client.php'), '<?php\n');
    execFileSync('git', ['add', 'packages/php/Client.php'], { cwd: root });
    const plan = ciPlan(root);
    assert.equal(plan.parityMode, 'none', 'parity-check reports the missing declaration');
    assert.equal('phpDirs' in plan || 'pythonDirs' in plan, false, 'no output that no workflow reads');
    // A setup target that runs ci-setup again is stopped at the second dispatch rather than spawning without end.
    const saved = process.env.KIT_CI_DISPATCH;
    process.env.KIT_CI_DISPATCH = '1';
    try {
      assert.throws(() => runCISetup(root, 'shared'), /runs inside a target that ci-setup started/);
    } finally {
      if (saved === undefined) delete process.env.KIT_CI_DISPATCH;
      else process.env.KIT_CI_DISPATCH = saved;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
