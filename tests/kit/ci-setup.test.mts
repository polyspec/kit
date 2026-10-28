import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ciPlan, ciSetupInvocations, runCISetup } from '../../scripts/kit/ci-setup.mts';
import { readConfig } from '../../scripts/kit/schema-validate.mts';

const runtimes = ['go', 'php', 'php-ext', 'python', 'rust', 'ts'] as const;
type FixtureConfig = { setup: { shared: string[]; parity: string[]; runtimes: Record<string, string[]> }; tools?: Record<string, string[]> };
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
    '.PHONY: shared-setup parity-setup go-setup',
    'shared-setup:',
    '\t@printf shared >> setup.log',
    'parity-setup:',
    '\t@printf parity >> setup.log',
    'go-setup:',
    '\t@printf go >> setup.log',
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
  execFileSync('git', ['init', '-q'], { cwd: root });
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
