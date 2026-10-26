// Tests of the TypeScript lint: oxlint type-aware with the root .oxlintrc.json and knip run from the root, API Extractor in
// each package with an api-extractor.json, but not for the base configuration of kit; every step runs after an earlier one
// failed, and a missing tool or configuration fails with the fix. In a consumer oxlint leaves out the copies of kit, the files
// of kit.copies of the installed package (K157); kit itself lints them. oxlint also leaves out the files that the ignore of
// config/knip-entries.json declares (K172). knip reads var/lint-ts/knip.json, which holds only those ignored dependencies of
// knip.json that knip needs: the ignores that the first run of knip, with the reporter knip-ignore-hints, does not name as
// matching no issue (K176, K188). The tools are stubs; the knip stub prints knip-hints.json of the checkout for that reporter.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, renameSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-ts.mts';
import { kitFile, kitPackageRoot } from '../../scripts/kit/kit-files.mts';
import { isJsonObject, readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { initRepository } from './sandbox-repository.mts';

const FILES: Record<string, string> = {
  'config/api-extractor.kit.json': '{}\n',
  'packages/ts/api-extractor.json': '{}\n',
  'packages/ts/src/index.ts': '',
};

// The installed @polyspec/kit of a consumer: the version that package-lock.json resolves and the copies that it declares.
const KIT = { name: '@polyspec/kit', version: '1.2.3', kit: { copies: { 'scripts/kit/bootstrap/files.mts': 'scripts/kit/bootstrap/files.mts', '.oxlintrc.json': '.oxlintrc.json' } } };
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
    // The knip stub answers the reporter of the first run with knip-hints.json of the checkout, or no hint.
    const hints = tool === 'knip' ? `case "$*" in *--reporter*) cat "${root}/knip-hints.json" 2>/dev/null || echo '[]';; esac\n` : '';
    writeFileSync(path.join(root, 'node_modules/.bin', tool), `#!/bin/sh\necho "${tool} $* [$(basename "$PWD")]" >> "${log}"\n${hints}${tool === failing ? 'exit 1' : ''}\n`);
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

const OXLINT = `oxlint --type-aware --deny-warnings --format unix -c ${kitFile('.oxlintrc.json')}`;
// The knip.json of the kit package that runs (K514), the base of the configuration that knip reads.
type Knip = { node: { entry: string[] }; ignoreDependencies: string[] };
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
function knipOf(value: Record<string, unknown>): Knip {
  const { node, ignoreDependencies } = value;
  if (!isJsonObject(node) || !strings(node.entry) || !strings(ignoreDependencies)) throw new Error(`the knip.json of kit has no node.entry or ignoreDependencies: ${JSON.stringify(value)}`);
  return { node: { entry: node.entry }, ignoreDependencies };
}
const KIT_KNIP = knipOf(readJsonObject(kitFile('knip.json')));
// The first run of knip names the ignores of kit's knip.json that matched no issue (K176, K188), before the steps run.
const HINTS = `knip --no-progress --config var/lint-ts/knip.json --reporter ${path.join(kitPackageRoot(), 'scripts/kit/knip-ignore-hints.mts')} [root]`;
const ALL = [HINTS, `${OXLINT} --ignore-pattern=/scripts/kit/bootstrap/files.mts --ignore-pattern=/.oxlintrc.json [root]`, 'knip --no-progress --config var/lint-ts/knip.json [root]', 'api-extractor run [ts]'];

test('oxlint and knip run from the root, and API Extractor in each package but not for the base configuration', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), ALL);
});

test('oxlint leaves out no file in kit itself, the source of the copies (K157)', (t) => {
  const { root, calls } = checkout(t);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@polyspec/kit', version: KIT.version, kit: KIT.kit }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.equal(calls()[1], `${OXLINT} [root]`);
});

test('a consumer without package-lock.json fails as kit-check does; another installed version passes (K157, K267)', (t) => {
  const { root } = checkout(t);
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@polyspec/kit': { version: '0.0.1' } } }));
  assert.doesNotThrow(() => lintSteps(root));
  assert.throws(() => lintSteps(checkout(t, { omit: 'package-lock.json' }).root), /package-lock\.json is missing; it locks @polyspec\/kit/);
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

test('knip reads knip.json with the entries of config/knip-entries.json after its own, from var/lint-ts/knip.json (K145)', (t) => {
  const { root, calls } = checkout(t);
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, entries: { 'packages/js/test/probe.mjs': 'make test-js runs it' } }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.equal(calls()[2], 'knip --no-progress --config var/lint-ts/knip.json [root]');
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8')), { ...KIT_KNIP, node: { entry: [...KIT_KNIP.node.entry, 'packages/js/test/probe.mjs'] } });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, entries: { '../outside.mjs': 'leaves the repository' } }));
  assert.throws(() => lintSteps(root), /config\/knip-entries\.json: \/entries/);
});

test('knip ignores the binaries of config/knip-entries.json after those of knip.json, and entries are optional (K152)', (t) => {
  const { root, calls } = checkout(t);
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, binaries: { container: 'the virtiofs tests run Apple container' } }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.equal(calls()[2], 'knip --no-progress --config var/lint-ts/knip.json [root]');
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8')), { ...KIT_KNIP, ignoreBinaries: ['container'] });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, binaries: { 'bin/tool': 'a path, not a binary' } }));
  assert.throws(() => lintSteps(root), /config\/knip-entries\.json: \/binaries/);
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1 }));
  assert.throws(() => lintSteps(root), /config\/knip-entries\.json/);
});

test('knip reads each nested project of config/knip-entries.json as a workspace with its entries and ignored dependencies (K154)', (t) => {
  const { root } = checkout(t);
  mkdirSync(path.join(root, 'config'), { recursive: true });
  const fixtures = { reason: 'the npm project that the build tests compile', entries: { 'src/*.{jsx,svelte}': 'the build tests compile each component' }, ignoreDependencies: { 'web-streams-polyfill': 'only the Rust tests load it' } };
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, workspaces: { 'packages/build/tests/fixtures': fixtures, 'tests/minimal': { reason: 'a project of the defaults of knip' } } }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8')), {
    ...KIT_KNIP,
    workspaces: { 'packages/build/tests/fixtures': { entry: ['src/*.{jsx,svelte}'], ignoreDependencies: ['web-streams-polyfill'] }, 'tests/minimal': {} },
  });
  for (const workspaces of [{ '.': { reason: 'the root is knip.json' } }, { '../outside': { reason: 'leaves the repository' } }, { 'tests/minimal': {} }]) {
    writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, workspaces }));
    assert.throws(() => lintSteps(root), /config\/knip-entries\.json: \/workspaces/, JSON.stringify(workspaces));
  }
});

test('knip ignores the files of config/knip-entries.json after the ignore of knip.json (K162), and oxlint leaves them out (K172)', (t) => {
  const { root, calls } = checkout(t);
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, ignore: { 'site/samples/*.mjs': 'the site shows the samples and nothing runs them' } }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8')), { ...KIT_KNIP, ignore: ['site/samples/*.mjs'] });
  assert.equal(calls()[1], `${OXLINT} --ignore-pattern=/scripts/kit/bootstrap/files.mts --ignore-pattern=/.oxlintrc.json --ignore-pattern=/site/samples/*.mjs [root]`);
  for (const ignore of [{}, { '/site/*.mjs': 'an absolute glob' }, { '../site/*.mjs': 'a glob outside the root' }, { '!site/*.mjs': 'a negated glob' }, { 'site/*.mjs': '' }]) {
    writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, ignore }));
    assert.throws(() => lintSteps(root), /config\/knip-entries\.json: \/ignore/, JSON.stringify(ignore));
  }
});

test('knip ignores the root dependencies of config/knip-entries.json after those of knip.json (K159)', (t) => {
  const { root } = checkout(t);
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, ignoreDependencies: { '@example/recipe-tool': 'only the recipes of the Makefile run it' } }));
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8')), { ...KIT_KNIP, ignoreDependencies: [...KIT_KNIP.ignoreDependencies, '@example/recipe-tool'] });
  for (const ignoreDependencies of [{}, { 'Not A Package': 'not an npm name' }, { 'left-pad': '' }]) {
    writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, ignoreDependencies }));
    assert.throws(() => lintSteps(root), /config\/knip-entries\.json: \/ignoreDependencies/, JSON.stringify(ignoreDependencies));
  }
});

// knip names an ignored dependency that matched no issue in a configuration hint, which a consumer cannot fix in the copy of
// knip.json: a package that the repository does not declare (K176), or @polyspec/kit where a script imports it (K188). The
// first run of knip, with the reporter knip-ignore-hints, names them, and lint-ts leaves them out of var/lint-ts/knip.json.
test('knip ignores only the dependencies of knip.json that knip needs: those its first run does not name as unused (K176, K188)', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(KIT_KNIP.ignoreDependencies, ['@polyspec/kit', 'oxlint', 'oxlint-tsgolint', 'jscpd'], 'the ignores of the knip.json of kit');
  const hints = (names: string[], workspace = '.') => writeFileSync(path.join(root, 'knip-hints.json'), JSON.stringify(names.map(name => ({ workspace, name }))));
  const merged = (): unknown => JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8'));
  hints(['oxlint', 'oxlint-tsgolint', 'jscpd']);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(merged(), { node: KIT_KNIP.node, ignoreDependencies: ['@polyspec/kit'] });
  assert.ok(calls().some(call => /^knip --no-progress --config var\/lint-ts\/knip\.json --reporter \S+knip-ignore-hints\.mts \[root\]$/.test(call)), calls().join('\n'));
  // A script of the repository imports @polyspec/kit, so knip names its ignore as unused (K188).
  hints(['@polyspec/kit', 'oxlint-tsgolint']);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(merged(), { node: KIT_KNIP.node, ignoreDependencies: ['oxlint', 'jscpd'] });
  // An ignore of the repository itself stays, so knip names it when it matched no issue; a hint of another workspace is not one
  // of the root.
  mkdirSync(path.join(root, 'config'), { recursive: true });
  writeFileSync(path.join(root, 'config/knip-entries.json'), JSON.stringify({ schema: 1, ignoreDependencies: { '@example/recipe-tool': 'only the recipes of the Makefile run it' } }));
  hints(['@example/recipe-tool', '@polyspec/kit']);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(merged(), { node: KIT_KNIP.node, ignoreDependencies: ['oxlint', 'oxlint-tsgolint', 'jscpd', '@example/recipe-tool'] });
  hints(['jscpd'], 'packages/lint');
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(merged(), { node: KIT_KNIP.node, ignoreDependencies: ['@polyspec/kit', 'oxlint', 'oxlint-tsgolint', 'jscpd', '@example/recipe-tool'] });
});

test('a first run of knip that fails or prints no list of hints fails the lint with the command (K188)', (t) => {
  const { root } = checkout(t);
  writeFileSync(path.join(root, 'knip-hints.json'), '[{ "name": "@polyspec/kit" }]');
  assert.throws(() => lintSteps(root), /knip --no-progress --config var\/lint-ts\/knip\.json --reporter \S+knip-ignore-hints\.mts/);
});

// K514: oxlint and knip read the .oxlintrc.json and knip.json of the kit package that runs, never a copy of the repository.
test('oxlint and knip read the configurations of the kit package, and a checkout without them lints (K514)', (t) => {
  const { root } = checkout(t);
  const steps = lintSteps(root);
  const oxlint = steps.find(step => step.label.startsWith('oxlint'));
  assert.ok(oxlint, JSON.stringify(steps));
  assert.deepEqual(oxlint.args.slice(oxlint.args.indexOf('-c'), oxlint.args.indexOf('-c') + 2), ['-c', kitFile('.oxlintrc.json')]);
  const kit: unknown = JSON.parse(readFileSync(kitFile('knip.json'), 'utf8'));
  const merged: unknown = JSON.parse(readFileSync(path.join(root, 'var/lint-ts/knip.json'), 'utf8'));
  assert.ok(typeof kit === 'object' && kit !== null && typeof merged === 'object' && merged !== null);
  assert.deepEqual(Object.keys(merged).sort(), Object.keys(kit).sort(), 'the knip configuration is that of the kit package');
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
  assert.deepEqual(calls(), [HINTS, ...ALL]);
});
