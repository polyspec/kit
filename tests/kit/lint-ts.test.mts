// Tests of the TypeScript lint: oxlint type-aware and knip run from the root with the configuration of the repository
// (K1050), API Extractor in each package with an api-extractor.json, but not for the base configuration of kit; every step
// runs after an earlier one failed, and a missing tool fails with the fix. oxlint lints every file of the repository, which
// owns each one (K1052). The tools are stubs.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, renameSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-ts.mts';
import { initRepository } from './sandbox-repository.mts';

const FILES: Record<string, string> = {
  'config/api-extractor.kit.json': '{}\n',
  'packages/ts/api-extractor.json': '{}\n',
  'packages/ts/src/index.ts': '',
};

// The installed @polyspec/kit of a consumer: the version that package-lock.json resolves.
const KIT = { name: '@polyspec/kit', version: '1.2.3' };
const MANIFEST = { name: 'consumer', devDependencies: { '@polyspec/kit': KIT.version } };
const LOCK = { lockfileVersion: 3, packages: { 'node_modules/@polyspec/kit': { version: KIT.version } } };

/** A consumer checkout with stub tools, the lock of KIT and KIT installed; `omit` leaves out one file, the lock among them. */
function checkout(t: TestContext, { installed = ['oxlint', 'knip', 'api-extractor'], failing = '', omit = '' }: { installed?: string[]; failing?: string; omit?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-ts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = { ...FILES, 'package.json': JSON.stringify(MANIFEST), 'package-lock.json': JSON.stringify(LOCK), 'node_modules/@polyspec/kit/package.json': JSON.stringify(KIT) };
  for (const [file, text] of Object.entries(files)) {
    if (file === omit) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n*.log\n');
  const log = path.join(root, 'calls.log');
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  for (const tool of installed) {
    writeFileSync(path.join(root, 'node_modules/.bin', tool), `#!/bin/sh\necho "${tool} $* [$(basename "$PWD")]" >> "${log}"\n${tool === failing ? 'exit 1' : ''}\n`);
    chmodSync(path.join(root, 'node_modules/.bin', tool), 0o755);
  }
  for (const [name, binary] of Object.entries({ oxlint: 'oxlint', knip: 'knip', '@microsoft/api-extractor': 'api-extractor', 'oxlint-tsgolint': 'tsgolint' })) {
    const directory = path.join(root, 'node_modules', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, bin: { [binary]: path.relative(directory, path.join(root, 'node_modules/.bin', binary)) } }));
  }
  writeFileSync(path.join(root, 'node_modules/.bin/tsgolint'), '#!/bin/sh\nexit 0\n');
  chmodSync(path.join(root, 'node_modules/.bin/tsgolint'), 0o755);
  initRepository(root);
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.replace(/ \[kit-lint-ts-[^\]]*\]$/, ' [root]')) };
}

const OXLINT = 'oxlint --format unix';
const ALL = [`${OXLINT} [root]`, 'knip --no-progress [root]', 'api-extractor run [ts]'];

test('oxlint and knip run from the root, and API Extractor in each package but not for the base configuration', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), ALL);
});

test('oxlint leaves out no file of a consumer, and a consumer without package-lock.json lints too (K1052)', (t) => {
  const { root, calls } = checkout(t, { omit: 'package-lock.json' });
  assert.deepEqual(lint(root, () => {}), []);
  assert.equal(calls()[0], `${OXLINT} [root]`);
});

// K309: vitest and node transpile without checking the types, so the gate runs tsc --noEmit in each project.
test('tsc --noEmit runs in the folder of each tsconfig.json that holds TypeScript, and its failure fails the gate (K309)', (t) => {
  const { root, calls } = checkout(t, { installed: ['oxlint', 'knip', 'api-extractor', 'tsc'] });
  writeFileSync(path.join(root, 'packages/ts/tsconfig.json'), '{}\n');
  mkdirSync(path.join(root, 'tools'), { recursive: true });
  writeFileSync(path.join(root, 'tools/tsconfig.json'), '{}\n');
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls().filter(call => call.startsWith('tsc')), ['tsc --noEmit -p tsconfig.json [ts]'], 'a tsconfig.json with no TypeScript below it has no project');
  const failing = checkout(t, { installed: ['oxlint', 'knip', 'api-extractor', 'tsc'], failing: 'tsc' });
  writeFileSync(path.join(failing.root, 'packages/ts/tsconfig.json'), '{}\n');
  assert.deepEqual(lint(failing.root, () => {}), ['tsc packages/ts']);
});

test('a checkout with a TypeScript project and no tsc fails with the fix (K309)', (t) => {
  const { root } = checkout(t);
  writeFileSync(path.join(root, 'packages/ts/tsconfig.json'), '{}\n');
  assert.throws(() => lintSteps(root), /node_modules\/\.bin\/tsc is missing; run npm ci/);
});

test('every step runs after an earlier one failed, and each failure is named', (t) => {
  const { root, calls } = checkout(t, { failing: 'oxlint' });
  assert.deepEqual(lint(root, () => {}), ['oxlint']);
  assert.deepEqual(calls(), ALL);
  assert.deepEqual(lint(checkout(t, { failing: 'api-extractor' }).root, () => {}), ['api-extractor packages/ts']);
});

test('a missing tool fails with its fix', (t) => {
  assert.throws(() => lintSteps(checkout(t, { installed: ['oxlint', 'knip'] }).root), /node_modules\/\.bin\/api-extractor is missing; run npm ci/);
});

// K1050: oxlint and knip read the .oxlintrc.json and knip.json of the repository by their own discovery; the lint names none.
test('oxlint and knip run with no configuration or rule of kit (K1050)', (t) => {
  const steps = lintSteps(checkout(t).root);
  const oxlint = steps.find(step => step.label === 'oxlint');
  const knip = steps.find(step => step.label === 'knip');
  assert.ok(oxlint && knip, JSON.stringify(steps));
  assert.ok(!oxlint.args.some(arg => ['-c', '--config', '--deny-warnings', '--type-aware'].includes(arg)), oxlint.args.join(' '));
  assert.ok(!steps.some(step => step.label === 'catch-check'), 'lint-ts runs no rule of kit');
  assert.deepEqual(knip.args, ['--no-progress']);
});

for (const linked of [false, true]) test(`K698 resolves ${linked ? 'linked' : 'nested'} provider tools and backend without consumer root bins`, (t) => {
  const { root, calls } = checkout(t);
  const provider = path.join(root, 'node_modules/@polyspec/kit/node_modules');
  mkdirSync(provider, { recursive: true });
  for (const entry of ['.bin', 'oxlint', 'knip', '@microsoft', 'oxlint-tsgolint']) {
    renameSync(path.join(root, 'node_modules', entry), path.join(provider, entry));
  }
  let resolvedProvider = provider;
  if (linked) {
    const installed = path.dirname(provider);
    const source = path.join(root, 'provider-source');
    renameSync(installed, source);
    symlinkSync(source, installed, 'dir');
    resolvedProvider = path.join(source, 'node_modules');
  }
  resolvedProvider = realpathSync(resolvedProvider);
  const steps = lintSteps(root);
  assert.equal(steps[0]?.command, path.join(resolvedProvider, '.bin/oxlint'));
  assert.ok(steps[0]?.env?.PATH?.split(path.delimiter).includes(path.join(resolvedProvider, '.bin')));
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), ALL);
});
