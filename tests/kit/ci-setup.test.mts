import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initRepository } from './sandbox-repository.mts';
import { ciPlan, ciSetupInvocations, runCIContext, runCISetup } from '../../scripts/kit/ci-setup.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';

const runtimes = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
// The parity declaration that the calls of the cases pass with --parity (K1114).
const PARITY = 'config/parity.json';
type FixtureConfig = { runtimes?: string[]; parityBindings?: Record<string, { setup: string[]; tools: string[] }>; parityMode?: 'full' | 'phases' | 'none'; runner?: 'ubuntu-24.04' | 'ubuntu-26.04-arm'; setup: { shared: string[]; parity: string[]; runtimes: Record<string, string[]> }; tools?: Record<string, string[]>; contexts?: Record<string, { prepare?: string; cleanup?: string }>; targets?: { shared?: string[]; parity?: string[]; runtimes?: Record<string, string[]> } };
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
    runtimes: ['go'],
    parityBindings: { 'go-client': { setup: [], tools: [] } },
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
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go', PARITY), [{ target: 'go-setup', args: [] }]);
    runCISetup(root, 'runtime', 'go', PARITY);
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'go');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: setup CLI is explicit and unknown modes cannot execute a valid group', () => {
  const root = fixture();
  try {
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    assert.throws(() => execFileSync(process.execPath, [script, '--parity', 'config/parity.json', '--context-typo', 'shared'], { cwd: root, stdio: 'pipe' }), /unknown CI setup mode/);
    assert.equal(existsSync(path.join(root, 'setup.log')), false, 'an unknown mode cannot start any configured Make target');
    execFileSync(process.execPath, [script, '--parity', 'config/parity.json', '--setup', 'shared'], { cwd: root, stdio: 'pipe' });
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

// K1068: a declared target is planned as declared; make reports a target that does not exist when the setup runs it.
test('K1068: a declared setup target that does not exist is planned and make reports it when it runs', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.setup.runtimes.go = ['missing-setup'];
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go', PARITY), [{ target: 'missing-setup', args: [] }]);
    assert.throws(() => runCISetup(root, 'runtime', 'go', PARITY), /make missing-setup failed in the CI setup runtime\/go/);
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
    assert.deepEqual(ciSetupInvocations(root, 'shared', undefined, PARITY), [{ target: 'shared-setup', args: [] }]);

    config.contexts = { shared: { prepare: 'context-prepare' } };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root, PARITY), /contexts\/shared must have required property 'cleanup'/);

    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'missing-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    assert.equal(ciPlan(root, PARITY).parityMode, 'full', 'K1068: a declared context target is not pre-checked against the Makefile');

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: selected context targets run through Make and missing contexts are a no-op', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    assert.doesNotThrow(() => runCIContext(root, 'prepare', 'shared', undefined, PARITY));
    assert.equal(existsSync(path.join(root, 'setup.log')), false, 'no context declaration preserves default setup behavior');
    const config = fixtureConfig(root);
    config.contexts = { shared: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    runCIContext(root, 'prepare', 'shared', undefined, PARITY);
    runCIContext(root, 'cleanup', 'shared', undefined, PARITY);
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
    assert.throws(() => runCIContext(root, 'prepare', 'shared', undefined, PARITY), /make context-prepare failed in the CI context prepare for shared/);
    runCIContext(root, 'cleanup', 'shared', undefined, PARITY);
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'cleanup', 'cleanup remains independently executable after prepare fails');
    writeFileSync(makefile, readFileSync(makefile, 'utf8').replace('context-cleanup:\n\t@printf cleanup >> setup.log', 'context-cleanup:\n\t@false'));
    assert.throws(() => runCIContext(root, 'cleanup', 'shared', undefined, PARITY), /make context-cleanup failed in the CI context cleanup for shared/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: missing consumer setup config names its required declaration and schema', () => {
  const root = fixture();
  try {
    unlinkSync(path.join(root, 'config/ci.json'));
    assert.throws(() => ciSetupInvocations(root, 'shared', undefined, PARITY), /config\/ci\.json is missing\. Fix: declare shared, parity and runtime setup targets/);
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
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go', PARITY), [{ target: 'deps-go', args: [] }], 'K1068: planned before the Makefile defines it');
    writeFileSync(path.join(root, 'Makefile'), `${readFileSync(path.join(root, 'Makefile'), 'utf8')}.PHONY: deps-go deps-php\ndeps-go:\n\t@true\ndeps-php:\n\t@true\n`);
    execFileSync('git', ['add', 'Makefile'], { cwd: root });
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'go', PARITY), [{ target: 'deps-go', args: [] }]);
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php', PARITY), [{ target: 'deps-php', args: [] }], 'no install wrapper of each locked folder');
    // A runtime that config/ci.json does not declare is not set up, so a repository defines no deps target for it: deps-node, deps-rust and
    // deps-python stay undefined here and the parity setup still passes.
    assert.deepEqual(ciSetupInvocations(root, 'parity', undefined, PARITY).map(({ target }) => target), ['deps-go', 'deps-php', 'parity-setup']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: the plan takes the declared runtimes and separates configured shared and parity setup', () => {
  const root = fixture();
  try {
    const result = ciPlan(root, PARITY);
    assert.deepEqual(result.runtimes.map(job => job.runtime), ['go']);
    assert.equal(result.parityMode, 'full');
    assert.deepEqual(result.parityMatrix, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K734: phase mode plans one API job and one binding job for each declared binding', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    writeFileSync(file, JSON.stringify(config));
    const result = ciPlan(root, PARITY);
    assert.equal(result.parityMode, 'phases');
    assert.deepEqual(result.parityMatrix, [{ implementation: 'go-client', installTools: [] }]);
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--parity', 'config/parity.json', '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    const actionOutputs = readFileSync(output, 'utf8');
    assert.match(actionOutputs, /^parity_mode=phases$/m);
    assert.match(actionOutputs, /^parity_matrix=\[{"implementation":"go-client","installTools":\[\]}\]$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K745: one discovered implementation without parity declaration selects no parity phase', () => {
  const root = fixture();
  try {
    execFileSync('git', ['rm', '-q', '-f', 'config/parity.json'], { cwd: root });
    const declared = fixtureConfig(root);
    declared.parityMode = 'none';
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(declared));
    // A repository without a parity declaration passes no --parity (K1114).
    const noParity = ciPlan(root);
    assert.equal(noParity.parityMode, 'none');
    assert.deepEqual(noParity.parityMatrix, []);
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.match(readFileSync(output, 'utf8'), /^parity_mode=none$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K1068: ci-setup plans what config/ci.json declares. A binding job exists for each declared binding only; the implementations of
// the parity declaration without a binding get no job, and whether that is acceptable is the repository's own rule.
test('K1068: phases mode with parity implementations and no parityBindings plans no binding job', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    delete config.parityBindings;
    writeFileSync(file, JSON.stringify(config));
    const result = ciPlan(root, PARITY);
    assert.equal(result.parityMode, 'phases');
    assert.deepEqual(result.parityMatrix, []);
    config.parityBindings = { other: { setup: [], tools: ['rust'] } };
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(ciPlan(root, PARITY).parityMatrix, [{ implementation: 'other', installTools: ['rust'] }]);
    assert.deepEqual(ciSetupInvocations(root, 'parity-binding', 'other', PARITY), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K1068, K1114: a parityMode that config/ci.json declares wins; without one it is full with the declaration that --parity names and
// none without --parity. A declaration that --parity names and that is missing, and a parity mode without a declaration, fail with the fix.
test('K1068, K1114: parityMode is declared, or full with --parity and none without it; a named declaration must exist', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    assert.equal(ciPlan(root, PARITY).parityMode, 'full');
    assert.equal(ciPlan(root).parityMode, 'none', 'without --parity there is no parity phase');
    execFileSync('git', ['rm', '-q', '-f', 'config/parity.json'], { cwd: root });
    assert.throws(() => ciPlan(root, PARITY), /config\/parity\.json is missing: the parity declaration that --parity names/);
    const config = fixtureConfig(root);
    config.parityMode = 'full';
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /parityMode is full, which needs the parity declaration\. Fix: pass --parity <path>/);
    config.parityMode = 'none';
    writeFileSync(file, JSON.stringify(config));
    assert.equal(ciPlan(root).parityMode, 'none');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K745: runner selection defaults to Ubuntu 24.04 and can select the supported ARM runner', () => {
  const root = fixture();
  try {
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    assert.equal(ciPlan(root, PARITY).runner, 'ubuntu-24.04');
    config.runner = 'ubuntu-26.04-arm';
    writeFileSync(configFile, JSON.stringify(config));
    const selected = ciPlan(root, PARITY);
    assert.equal(selected.runner, 'ubuntu-26.04-arm');
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--parity', 'config/parity.json', '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.match(readFileSync(output, 'utf8'), /^runner=ubuntu-26\.04-arm$/m);
    writeFileSync(configFile, JSON.stringify({ ...config, runner: 'ubuntu-26.04-x64' }));
    assert.throws(() => ciPlan(root, PARITY), /must be equal to one of the allowed values/);
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
    assert.deepEqual(ciPlan(root, PARITY).commonTools, ['go', 'python']);
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
    const empty = ciPlan(root, PARITY);
    assert.deepEqual([empty.sharedTargets, empty.parityTargets, empty.runtimes], [[], [], [{ runtime: 'go', installTools: [], targets: [] }]]);
    const config = fixtureConfig(root);
    config.targets = { shared: ['shared-check'], parity: ['parity-extra'], runtimes: { go: ['test-go'], python: ['test-python'] } };
    config.setup.runtimes.python = ['shared-setup'];
    config.contexts = { python: { prepare: 'context-prepare', cleanup: 'context-cleanup' } };
    writeFileSync(configFile, JSON.stringify(config));
    const plan = ciPlan(root, PARITY);
    assert.deepEqual(plan.sharedTargets, ['shared-check']);
    assert.deepEqual(plan.parityTargets, ['parity-extra']);
    assert.deepEqual(plan.runtimes.map(({ runtime, targets }) => [runtime, targets]), [['go', ['test-go']], ['python', ['test-python']]]);
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'python', PARITY), [{ target: 'shared-setup', args: [] }]);
    runCIContext(root, 'prepare', 'runtime', 'python', PARITY);
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'prepare');
    const output = path.join(root, 'github-output');
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--parity', 'config/parity.json', '--plan'], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } });
    const written = readFileSync(output, 'utf8');
    assert.match(written, /^shared_targets=\["shared-check"\]$/m);
    assert.match(written, /^parity_targets=\["parity-extra"\]$/m);
    assert.match(written, /"runtime":"python","installTools":\[\],"targets":\["test-python"\]/);
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
      '.PHONY: shared-setup parity-setup go-setup extension-setup',
      'shared-setup:', '\t@printf shared >> setup.log',
      'parity-setup:', '\t@printf parity >> setup.log',
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

    const plan = ciPlan(root, PARITY);
    const extension = plan.runtimes.find(job => job.runtime === 'php-ext');
    assert.ok(extension, 'the declared php-ext runtime selects a PHP extension job');
    assert.deepEqual(extension.installTools, ['php', 'composer']);
    assert.equal(plan.parityTools.includes('phpunit'), false, 'the repository does not need Kit private PHPUnit when it provides its own Composer project');
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php-ext', PARITY), [
      { target: 'extension-setup', args: [] },
    ]);
    // K914: the parity job builds the extension too, so its setup runs the setup of php-ext, once
    // also when setup.parity names it.
    const parity = [
      { target: 'go-setup', args: [] },
      { target: 'extension-setup', args: [] },
      { target: 'parity-setup', args: [] },
    ];
    assert.deepEqual(ciSetupInvocations(root, 'parity', undefined, PARITY), parity);
    config.setup.parity = ['parity-setup'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.deepEqual(ciSetupInvocations(root, 'parity', undefined, PARITY), parity);
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
    config.runtimes = ['ts'];
    config.setup.runtimes.go = [];
    config.tools = { ts: ['go'] };
    writeFileSync(configFile, JSON.stringify(config));
    execFileSync('git', ['add', 'Makefile', 'config/ci.json', 'config/parity.json', 'packages/ts', 'mise.toml'], { cwd: root });

    const plan = ciPlan(root, PARITY);
    const ts = plan.runtimes.find(job => job.runtime === 'ts');
    assert.ok(ts);
    assert.deepEqual(ts.installTools, ['go']);
    assert.deepEqual(plan.commonTools, ['go'], 'the shared toolchain parser still receives Go although the TypeScript job also needs it');
    assert.deepEqual(plan.parityTools, ['go'], 'parity installs tools needed by runtime setup it repeats');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K896, K1018: the shared and the php runtime setup install the PHP symbol extractor, with PHP and Composer for the shared job', () => {
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
    const plan = ciPlan(root, PARITY);
    assert.ok(plan.runtimes.some(job => job.runtime === 'php'), 'the declared php runtime has a PHP runtime job, which owns PHP and Composer');
    assert.deepEqual(plan.extractors, ['php']);
    assert.ok(plan.commonTools.includes('php') && plan.commonTools.includes('composer'), `the shared job installs PHP and Composer: ${plan.commonTools.join(' ')}`);
    // K1018: the setup of the shared job and of the php runtime job installs the extractor, so the pipeline names no language.
    const extractor = { target: 'kit-install-symbols', args: ['EXTRACTORS=php'] };
    assert.deepEqual(ciSetupInvocations(root, 'shared', undefined, PARITY)[0], extractor, 'the shared setup installs the PHP extractor before its targets');
    assert.deepEqual(ciSetupInvocations(root, 'runtime', 'php', PARITY).at(-1), extractor, 'the php runtime setup installs the PHP extractor');
    assert.ok(!ciSetupInvocations(root, 'runtime', 'go', PARITY).some(invocation => invocation.target === 'kit-install-symbols'), 'a go runtime setup installs no PHP extractor');
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
    const phases = ciPlan(root, PARITY);
    assert.equal(phases.parityMode, 'phases', 'the replaced recipe is the repository\'s');
    assert.deepEqual(phases.runtimes.find(job => job.runtime === 'go')?.installTools.includes('rust'), true, 'the selector reaches install-tools, which judges it');
    assert.equal(phases.runtimes.find(job => job.runtime === 'go')?.installTools.includes('node'), true, 'a configured node passes as written too; only kit defaults are filtered');
    execFileSync('git', ['rm', '-q', '-f', 'config/parity.json'], { cwd: root });
    mkdirSync(path.join(root, 'packages/php'), { recursive: true });
    writeFileSync(path.join(root, 'packages/php/Client.php'), '<?php\n');
    execFileSync('git', ['add', 'packages/php/Client.php'], { cwd: root });
    assert.throws(() => ciPlan(root, PARITY), /config\/parity\.json is missing/, 'the plan refuses the missing declaration with the fix');
    // A repository without a parity declaration declares parityMode none (K951), so the setup below reads a valid plan.
    config.parityMode = 'none';
    writeFileSync(file, JSON.stringify(config));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('K1026: binding jobs execute only explicit setup and pass tool selectors without language inference', () => {
  const root = fixture();
  try {
    const makefile = path.join(root, 'Makefile');
    writeFileSync(makefile, readFileSync(makefile, 'utf8') + 'binding-only-setup:\n\t@printf binding >> setup.log\n');
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    config.parityBindings = { 'go-client': { setup: ['binding-only-setup'], tools: ['rust'] } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.deepEqual(ciPlan(root, PARITY).parityMatrix, [{ implementation: 'go-client', installTools: ['rust'] }]);
    assert.deepEqual(ciSetupInvocations(root, 'parity-binding', 'go-client', PARITY), [{ target: 'binding-only-setup', args: [] }]);
    runCISetup(root, 'parity-binding', 'go-client', PARITY);
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'binding');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('K1026: empty binding declarations perform no runtime default setup', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    config.parityBindings = { 'go-client': { setup: [], tools: [] } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.deepEqual(ciPlan(root, PARITY).parityMatrix, [{ implementation: 'go-client', installTools: [] }]);
    assert.deepEqual(ciSetupInvocations(root, 'parity-binding', 'go-client', PARITY), []);
    runCISetup(root, 'parity-binding', 'go-client', PARITY);
    assert.equal(existsSync(path.join(root, 'setup.log')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('K1026: phased binding setup runs the declared targets of the selected binding', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    const file = path.join(root, 'config/ci.json');
    writeFileSync(file, JSON.stringify(config));
    config.parityBindings = { 'go-client': { setup: ['missing-setup'], tools: [] } };
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(ciSetupInvocations(root, 'parity-binding', 'go-client', PARITY), [{ target: 'missing-setup', args: [] }]);
    config.parityBindings = { 'go-client': { setup: [], tools: [] } };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciSetupInvocations(root, 'parity-binding', 'other', PARITY), /unknown.*other.*go-client/);
    assert.throws(() => ciSetupInvocations(root, 'parity-binding', undefined, PARITY), /needs.*IMPLEMENTATION/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('K1026, K1114: the CLI and a Make recipe that passes --parity reach the same planner with the binding implementation', () => {
  const root = fixture();
  try {
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    config.parityBindings = { 'go-client': { setup: ['shared-setup'], tools: [] } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    const script = path.resolve(import.meta.dirname, '../../scripts/kit/ci-setup.mts');
    execFileSync(process.execPath, [script, '--parity', 'config/parity.json', '--setup', 'parity-binding', 'go-client'], { cwd: root, stdio: 'pipe' });
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'shared');
    unlinkSync(path.join(root, 'setup.log'));
    const makefile = path.join(root, 'Makefile');
    const kit = path.resolve(import.meta.dirname, '../../scripts/kit');
    // K1114: the kit recipe passes no parity declaration, so phases asks for one; the consumer recipe names it.
    const consumer = 'consumer-ci-setup:\n\t$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --parity config/parity.json --setup $(GROUP) $(IMPLEMENTATION)\n';
    writeFileSync(makefile, `override NODE := ${process.execPath}\nKIT := ${kit}\nKIT_EXT := mts\ninclude ${kit}/kit.mk\n${readFileSync(makefile, 'utf8')}${consumer}`);
    execFileSync('git', ['add', 'Makefile'], { cwd: root });
    assert.throws(() => execFileSync('make', ['kit-ci-setup', 'GROUP=parity-binding', 'IMPLEMENTATION=go-client', `NODE=${process.execPath}`], { cwd: root, stdio: 'pipe' }), /pass --parity/);
    assert.equal(existsSync(path.join(root, 'setup.log')), false);
    execFileSync('make', ['consumer-ci-setup', 'GROUP=parity-binding', 'IMPLEMENTATION=go-client', `NODE=${process.execPath}`], { cwd: root, stdio: 'pipe' });
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'shared');
    assert.throws(() => execFileSync(process.execPath, [script, '--parity', 'config/parity.json', '--setup', 'parity-binding', 'other'], { cwd: root, stdio: 'pipe' }), /unknown binding implementation other/);
    assert.equal(readFileSync(path.join(root, 'setup.log'), 'utf8'), 'shared', 'unknown selectors execute nothing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// K1114: the runtimes of the plan are those that config/ci.json declares in runtimes and targets.runtimes; kit reads none from a
// folder name, a root of the parity declaration or a tracked file, and a config without runtimes fails with the fix.
test('K1114 the runtimes of the plan are those that config/ci.json declares, not folder names, parity roots or tracked files', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'packages/php-ext'), { recursive: true });
    writeFileSync(path.join(root, 'packages/php-ext/config.m4'), 'dnl\n');
    mkdirSync(path.join(root, 'lib/ts'), { recursive: true });
    writeFileSync(path.join(root, 'lib/ts/a.ts'), 'export const a = 1;\n');
    const declaration = readConfig<{ implementations: { name: string; runner: string; roots: string[] }[] }>(root, 'config/parity.json', 'parity.schema.json');
    declaration.implementations.push({ name: 'php-ext', runner: 'php', roots: ['packages/php-ext'] });
    writeFileSync(path.join(root, 'config/parity.json'), JSON.stringify(declaration));
    const config = fixtureConfig(root);
    config.setup.runtimes['php-ext'] = ['go-setup'];
    config.parityBindings = { 'go-client': { setup: [], tools: [] }, 'php-ext': { setup: [], tools: [] } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'config', 'packages/php-ext/config.m4', 'lib/ts/a.ts'], { cwd: root });
    assert.deepEqual(ciPlan(root, PARITY).runtimes.map(job => job.runtime), ['go'], 'a php-ext root and a .ts file name no runtime');
    config.runtimes = ['go', 'php-ext'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.deepEqual(ciPlan(root, PARITY).runtimes.map(job => job.runtime), ['go', 'php-ext']);
    // ci-setup opens no parity declaration that it is not given: a broken config/parity.json does not reach a call without --parity.
    writeFileSync(path.join(root, 'config/parity.json'), '{');
    assert.deepEqual(ciPlan(root).runtimes.map(job => job.runtime), ['go', 'php-ext']);
    assert.deepEqual(ciPlan(root).parityTools, [], 'the runner tools come only from the declaration that --parity names');
    delete config.runtimes;
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.throws(() => ciPlan(root), /config\/ci\.json declares no runtimes\. Fix: declare "runtimes"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K1114: the parity declaration is the file that the caller passes with --parity, and the messages about it name that path.
test('K1114 ci-setup reads the parity declaration that --parity names and names it in its messages', () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'spec'));
    execFileSync('git', ['mv', 'config/parity.json', 'spec/parity.json'], { cwd: root });
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    config.parityBindings = { other: { setup: [], tools: [] } };
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    assert.deepEqual(ciPlan(root, 'spec/parity.json').parityMatrix, [{ implementation: 'other', installTools: [] }]);
    assert.throws(() => ciPlan(root, 'config/parity.json'), /config\/parity\.json is missing: the parity declaration that --parity names/);
    assert.throws(() => ciPlan(root), /parityMode is phases, which needs the parity declaration/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
