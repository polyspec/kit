import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initRepository } from './sandbox-repository.mts';
import { ciPlan, ciSetupInvocations, gateResultsPass, GATE_REQUIRED_NEEDS, parityBindingMatrix, parityMatrixFindings, runCIContext, runCISetup } from '../../scripts/kit/ci-setup.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';

const runtimes = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
type FixtureConfig = { parityMode?: 'full' | 'phases'; setup: { shared: string[]; parity: string[]; runtimes: Record<string, string[]> }; tools?: Record<string, string[]>; contexts?: Record<string, { prepare?: string; cleanup?: string }> };
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

test('K731: unknown targets and full-install aggregates fail before any setup runs', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.setup.runtimes.go = ['missing-setup'];
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciSetupInvocations(root, 'runtime', 'go'), /config\/ci\.json: setup\.runtimes\.go names missing-setup, which is not a Make target/);
    config.setup.runtimes.go = ['install'];
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => runCISetup(root, 'runtime', 'go'), /the full install aggregate/);
    assert.equal(existsSync(path.join(root, 'setup.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731-1: contexts require a complete pair of existing, non-recursive Make targets', () => {
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

    config.contexts = { shared: { prepare: 'kit-ci-setup', cleanup: 'context-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /names recursive Kit CI target kit-ci-setup/);

    config.contexts = { parity: { prepare: 'parity-check', cleanup: 'context-cleanup' } };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /names recursive Kit CI target parity-check/);

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

test('K731: a Go module with external requirements cannot silently use build-only defaults', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, 'packages/go/go.mod'), 'module example.invalid/fixture\n\nrequire example.com/library v1.2.3\n');
    execFileSync('git', ['add', 'packages/go/go.mod'], { cwd: root });
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.setup.runtimes.go = [];
    writeFileSync(configFile, JSON.stringify(config));
    assert.throws(() => ciSetupInvocations(root, 'runtime', 'go'), /declares Go module requirements, but build-go alone does not fetch them\. Fix: declare an existing locked Go setup target under setup\.runtimes\.go/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: the plan discovers tracked runtime packages and separates configured shared and parity setup', () => {
  const root = fixture();
  try {
    const result = ciPlan(root);
    assert.deepEqual(result.runtimes.map(job => job.runtime), ['go']);
    assert.deepEqual(result.sharedTargets, ['shared-setup']);
    assert.deepEqual(result.parityTargets, ['parity-setup']);
    assert.deepEqual(result.parityRuntimes, ['go']);
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
    assert.match(actionOutputs, /^parity_mode="phases"$/m);
    assert.match(actionOutputs, /^parity_matrix=\[{"implementation":"go-client"}\]$/m);
    assert.deepEqual(parityMatrixFindings(result.parityImplementations, result.parityMatrix), []);
    assert.ok(parityMatrixFindings(result.parityImplementations, [{ implementation: 'other' }]).some(finding => finding.includes('go-client 0 times; config/parity.json requires 1')));
    assert.deepEqual(parityBindingMatrix(['go', 'php-extension']), [{ implementation: 'go' }, { implementation: 'php-extension' }]);
    assert.throws(() => parityBindingMatrix([]), /declares no implementations/);
    assert.throws(() => parityBindingMatrix(['go', 'go']), /duplicate implementation names/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K734: phase mode rejects missing provider recipes and duplicate declaration selectors', () => {
  const root = fixture();
  try {
    const configFile = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.parityMode = 'phases';
    writeFileSync(configFile, JSON.stringify(config));
    const makefile = path.join(root, 'Makefile');
    const originalMakefile = readFileSync(makefile, 'utf8');
    writeFileSync(makefile, originalMakefile.replace('$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api', '@true'));
    assert.throws(() => ciPlan(root), /parity-api-check does not use the provider API recipe/);
    writeFileSync(makefile, originalMakefile);
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
      '.PHONY: shared-setup parity-setup go-setup extension-setup kit-install-php-arginfo composer-install',
      'shared-setup:', '\t@printf shared >> setup.log',
      'parity-setup:', '\t@printf parity >> setup.log',
      'go-setup:', '\t@printf go >> setup.log',
      'extension-setup:', '\t@printf extension >> setup.log',
      'kit-install-php-arginfo:', '\t@printf arginfo >> setup.log',
      'composer-install:', '\t@printf composer >> setup.log',
      '',
    ].join('\n'));
    const config = fixtureConfig(root);
    config.setup.runtimes['php-ext'] = ['extension-setup'];
    writeFileSync(path.join(root, 'config/ci.json'), JSON.stringify(config));
    execFileSync('git', ['add', 'Makefile', 'config/ci.json', '.php-version', 'mise.toml', 'packages/php-ext'], { cwd: root });

    const plan = ciPlan(root);
    const extension = plan.runtimes.find(job => job.runtime === 'php-ext');
    assert.ok(extension, 'tracked PHP extension files select a PHP extension job');
    assert.deepEqual(extension.checkTools, ['php', 'composer']);
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
      '.PHONY: shared-setup parity-setup build-ts',
      'shared-setup:', '\t@true',
      'parity-setup:', '\t@true',
      'build-ts:', '\t@true',
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
    assert.deepEqual(ts.checkTools, ['go']);
    assert.deepEqual(ts.installTools, ['go']);
    assert.deepEqual(plan.commonTools, [], 'a tool owned by the TypeScript setup is not installed redundantly in shared gates');
    assert.deepEqual(plan.parityTools, ['go'], 'parity installs tools needed by runtime setup it repeats');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K731: extra tool selectors must exist and be declared by the checkout', () => {
  const root = fixture();
  try {
    const file = path.join(root, 'config/ci.json');
    const config = fixtureConfig(root);
    config.tools = { go: ['notASelector'] };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /names unknown Kit tool notASelector/);
    config.tools = { go: ['rust'] };
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => ciPlan(root), /names rust, which this checkout does not declare/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
