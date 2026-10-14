// The real TypeScript lint: lint-ts.mts runs the oxlint (with oxlint-tsgolint), knip and API Extractor of the node_modules of
// this checkout on a TypeScript 7 package that holds the .oxlintrc.json of this checkout and an api-extractor.json that
// extends its config/api-extractor.kit.json. The package is built with tsc 7 and its API report is written first, as a repository
// commits it. A package whose exports are documented and used passes; each violation planted into a copy fails with the
// rule or the message that names it, including the undocumented export of the plan's verification. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint, lintSteps } from '../../scripts/kit/lint-ts.mts';
import { readFixture } from '../kit/json-fixture.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(ROOT, 'node_modules/.bin');

const INDEX = 'src/index.ts';
const DOUBLE = '/**\n * Doubles a value.\n */\nexport function double(value: number): number {\n  return value * 2;\n}\n';

// The test file: top-level registrations of node:test, which return a promise that the runner itself awaits (K138).
const TESTS = "import assert from 'node:assert/strict';\nimport test, { describe, it, suite } from 'node:test';\nimport { double } from '../src/index.ts';\n\ntest('double', () => {\n  assert.equal(double(2), 4);\n});\n\ndescribe('double', () => {\n  it('doubles zero', () => {\n    assert.equal(double(0), 0);\n  });\n});\n\nsuite('double', () => {\n  test.skip('of a string', () => {});\n});\n";

// The package.json of the package.
const MANIFEST = { name: 'demo', version: '0.0.1', type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './src/index.ts' } }, devDependencies: { '@polyspec/kit': '0.0.42' } };

// A package whose one export is documented, reached from its entry point, and tested. No export carries a release tag (@public),
// as in every polyspec repository: the base configuration turns ae-missing-release-tag off (K139).
const GOOD: Record<string, string> = {
  '.gitignore': 'node_modules/\ndist/\nvar/\n',
  // kit comes in through the include of its Makefile and its copies, which knip does not read (K142).
  'package.json': JSON.stringify(MANIFEST, null, 2),
  // make runs a script of S9, a copy of kit and a benchmark program, which nothing imports (K142).
  'Makefile': 'include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\n\nbuild:\n\tnode scripts/build.mts\n\tnode scripts/kit/bootstrap/bootstrap.mts\n\tnode benchmarks/run.mts\n',
  'scripts/build.mts': "console.log('build');\n",
  'benchmarks/run.mts': "console.log('run');\n",
  // The project covers every TypeScript file that lint-ts lints, the tests and the scripts too, so oxlint-tsgolint checks
  // their types: a file outside it has no types, and each call of an import is an unsafe call of an error type (K157). The
  // build emits only src. The project leaves out the copies of kit in scripts/kit (KIT_COPIES), which lint-ts leaves out of
  // oxlint (K157).
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'esnext', module: 'nodenext', noEmit: true, allowImportingTsExtensions: true, types: ['node'] }, include: ['src', 'tests', 'scripts', 'benchmarks'], exclude: ['scripts/kit'] }, null, 2),
  'tsconfig.build.json': JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] }, null, 2),
  'api-extractor.json': '',
  [INDEX]: DOUBLE,
  'tests/index.test.ts': TESTS,
};

// One violation for each rule: the files it adds or replaces, and the text that the failing step prints for it.
const VIOLATIONS: { name: string; files: Record<string, string>; finding: RegExp }[] = [
  { name: 'a floating promise', files: { [INDEX]: `${DOUBLE}\n/**\n * Waits for nothing.\n */\nexport async function settle(): Promise<void> {\n  Promise.resolve(1);\n}\n` }, finding: /typescript\(no-floating-promises\)/ },
  // A real floating promise among the node:test registrations, which the rule allows (K138), is still one.
  { name: 'a floating promise in a test file', files: { 'tests/index.test.ts': `${TESTS}\nfetch('https://example.com/');\n` }, finding: new RegExp(`tests/index\\.test\\.ts:${TESTS.split('\n').length + 1}:1: .*\\[Error/typescript\\(no-floating-promises\\)\\]`) },
  // The escape hatches from the types of TypeScript (K155).
  { name: 'an explicit any', files: { [INDEX]: `${DOUBLE}\n/**\n * Returns its value.\n */\nexport function same(value: any): number {\n  return value;\n}\n` }, finding: /typescript\(no-explicit-any\)/ },
  { name: 'a @ts-ignore', files: { [INDEX]: `${DOUBLE}\n/**\n * Halves a value.\n */\nexport function half(value: number): number {\n  // @ts-ignore\n  return value / 2;\n}\n` }, finding: /typescript\(ban-ts-comment\)/ },
  { name: 'a @ts-expect-error without a description', files: { 'tests/index.test.ts': `${TESTS}\ntest('double of a string', () => {\n  // @ts-expect-error\n  assert.equal(double('2'), 4);\n});\n` }, finding: /typescript\(ban-ts-comment\)/ },
  { name: 'a type assertion that changes nothing', files: { [INDEX]: `${DOUBLE}\n/**\n * Halves a value.\n */\nexport function half(value: number): number {\n  return (value as number) / 2;\n}\n` }, finding: /typescript\(no-unnecessary-type-assertion\)/ },
  // The unsafe flows of any (K157): JSON.parse returns any, which no value of a type may take on.
  ...([
    ['no-unsafe-argument', 'export function size(text: string): number {\n  return measure(JSON.parse(text));\n}\n\nfunction measure(value: string): number {\n  return value.length;\n}\n'],
    ['no-unsafe-assignment', 'export function size(text: string): number {\n  const value: string = JSON.parse(text);\n  return value.length;\n}\n'],
    ['no-unsafe-call', 'export function size(text: string): void {\n  JSON.parse(text)();\n}\n'],
    ['no-unsafe-member-access', 'export function size(text: string): unknown {\n  const value: unknown = JSON.parse(text).length;\n  return value;\n}\n'],
    ['no-unsafe-return', 'export function size(text: string): number {\n  return JSON.parse(text);\n}\n'],
    ['no-unsafe-type-assertion', 'export function size(value: unknown): number {\n  return (value as string).length;\n}\n'],
  ] as const).map(([rule, code]) => ({ name: `a violation of ${rule}`, files: { [INDEX]: `${DOUBLE}\n/**\n * Measures a value.\n */\n${code}` }, finding: new RegExp(`typescript\\(${rule}\\)`) })),
  { name: 'a debugger statement', files: { [INDEX]: `${DOUBLE}\n/**\n * Stops in a debugger.\n */\nexport function pause(): void {\n  debugger;\n}\n` }, finding: /eslint\(no-debugger\)/ },
  { name: 'a file that nothing imports', files: { 'src/orphan.ts': 'export const orphan = 1;\n' }, finding: /Unused files \(1\)\nsrc\/orphan\.ts/ },
  { name: 'an export that nothing imports', files: { 'src/values.ts': '/** One. */\nexport const one = 1;\n/** Two. */\nexport const two = 2;\n', [INDEX]: `${DOUBLE}\nexport { one } from './values.ts';\n` }, finding: /Unused exports \(1\)\ntwo +src\/values\.ts/ },
  // The false green of the verification: ae-undocumented fires only through the API report, which the base configuration enables.
  { name: 'an undocumented export', files: { [INDEX]: `${DOUBLE}\nexport function triple(value: number): number {\n  return value * 3;\n}\n` }, finding: /\(ae-undocumented\) Missing documentation for "triple"/ },
  { name: 'a forgotten export', files: { [INDEX]: `${DOUBLE}\ninterface Options {\n  factor: number;\n}\n\n/**\n * Scales a value.\n */\nexport function scale(value: number, options: Options): number {\n  return value * options.factor;\n}\n` }, finding: /\(ae-forgotten-export\) The symbol "Options" needs to be exported by the entry point index\.d\.ts/ },
];

// The package.json of this checkout: the version of kit that the lock of the repository resolves, and the copies of kit in
// TypeScript that a consumer holds (kit.copies, which kit-sync writes): the path in the consumer and the file of kit.
const KIT = readFixture<{ version: string; kit: { copies: Record<string, string> } }>(ROOT, 'package.json');
const KIT_COPIES = Object.entries(KIT.kit.copies).filter(([file]) => file.endsWith('.mts'));
const COPY = 'scripts/kit/bootstrap/digest.mts';

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

const run = (root: string, command: string, ...args: string[]) => spawnSync(path.join(BIN, command), args, { cwd: root, encoding: 'utf8' });

/**
 * A repository in a temporary folder: GOOD with `files` over it, the .oxlintrc.json, knip.json and config/api-extractor.kit.json of this
 * checkout and its node_modules; the package is built and its API report written, as a repository commits it. `report`
 * false makes the api-extractor.json of the package turn the report off.
 */
function repository(t: TestContext, files: Record<string, string> = {}, { report = true } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-ts-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const extractor = { extends: path.join(root, 'config/api-extractor.kit.json'), mainEntryPointFilePath: '<projectFolder>/dist/index.d.ts', ...(report ? {} : { apiReport: { enabled: false } }) };
  // The copies of kit come first, so that `files` can plant a violation into one. node_modules holds the packages of this
  // checkout and, as @polyspec/kit, this checkout, the version that package-lock.json resolves, as make install-packages
  // installs it in a consumer.
  for (const [file, from] of KIT_COPIES) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(ROOT, from), path.join(root, file));
  }
  const lock = { lockfileVersion: 3, packages: { 'node_modules/@polyspec/kit': { version: KIT.version } } };
  write(root, { ...GOOD, 'api-extractor.json': JSON.stringify(extractor, null, 2), 'package-lock.json': JSON.stringify(lock), ...files });
  mkdirSync(path.join(root, 'config'), { recursive: true });
  for (const file of ['.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json']) copyFileSync(path.join(ROOT, file), path.join(root, file));
  mkdirSync(path.join(root, 'node_modules/@polyspec'), { recursive: true });
  for (const entry of readdirSync(path.join(ROOT, 'node_modules'))) symlinkSync(path.join(ROOT, 'node_modules', entry), path.join(root, 'node_modules', entry));
  symlinkSync(ROOT, path.join(root, 'node_modules/@polyspec/kit'));
  const build = run(root, 'tsc', '-p', 'tsconfig.build.json');
  assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
  // The API report that a repository commits in etc/: --local writes it, also for a planted violation, whose error still fails.
  mkdirSync(path.join(root, 'etc'));
  run(root, 'api-extractor', 'run', '--local');
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

/** The labels of the failed steps of the lint of `root` and everything the steps printed. */
function lintOf(root: string): { failed: string[]; output: string } {
  let output = '';
  const failed = lint(root, text => { output += text; });
  return { failed, output };
}

test('the TypeScript lint passes on a package whose exports are documented, reached and tested', (t) => {
  for (const tool of ['oxlint', 'tsgolint', 'knip', 'api-extractor', 'tsc']) assert.ok(existsSync(path.join(BIN, tool)), `node_modules/.bin/${tool} is missing; run npm ci`);
  const { failed, output } = lintOf(repository(t));
  assert.deepEqual(failed, [], output);
});

// A @ts-expect-error that names the error it expects is no escape hatch: tsc fails it once nothing errs (K155).
test('the TypeScript lint passes on a @ts-expect-error with its description', (t) => {
  const described = `${TESTS}\ntest('double of a string', () => {\n  // @ts-expect-error: double takes a number, and the multiplication converts the string\n  assert.equal(double('2'), 4);\n});\n`;
  const { failed, output } = lintOf(repository(t, { 'tests/index.test.ts': described }));
  assert.deepEqual(failed, [], output);
});

test('the TypeScript lint fails on each planted violation with the rule or the message that names it', (t) => {
  for (const { name, files, finding } of VIOLATIONS) {
    const { failed, output } = lintOf(repository(t, files));
    assert.notDeepEqual(failed, [], `${name}: the violation passed:\n${output}`);
    assert.match(output, finding, `${name} is not named:\n${output}`);
  }
});

// ES2018 raised the limit of the fraction digits of toExponential and toFixed, and of the precision of toPrecision, to 100
// (ECMA-262 Number.prototype.toExponential); oxlint's oxc/number-arg-out-of-range still allows only 20, so it is off (K161).
test('the TypeScript lint passes on toExponential(25), which ES2018 allows', (t) => {
  const exponent = `${DOUBLE}\n/**\n * Writes a value with 25 fraction digits.\n */\nexport function exponent(value: number): string {\n  return value.toExponential(25);\n}\n`;
  const { failed, output } = lintOf(repository(t, { [INDEX]: exponent, 'tests/index.test.ts': `${TESTS.replace('{ double }', '{ double, exponent }')}\ntest('exponent', () => {\n  assert.equal(exponent(1), '1.0000000000000000000000000e+0');\n});\n` }));
  assert.deepEqual(failed, [], output);
});

// The copies of kit are kit's to lint, with its tsconfig and the types of node; kit-check proves that they are its bytes. A
// violation in a copy passes the lint of the consumer, and the same violation in a file of the consumer fails (K157).
test('the TypeScript lint of a consumer leaves out the copies of kit and lints its own files (K157)', (t) => {
  // kit.copies maps the copy to the same path in kit.
  const copy = lintOf(repository(t, { [COPY]: `${readFileSync(path.join(ROOT, COPY), 'utf8')}\ndebugger;\n` }));
  assert.deepEqual(copy.failed, [], copy.output);
  const own = lintOf(repository(t, { 'scripts/build.mts': "console.log('build');\ndebugger;\n" }));
  assert.deepEqual(own.failed, ['oxlint'], own.output);
  assert.match(own.output, /scripts\/build\.mts:.*eslint\(no-debugger\)/);
});

test('the TypeScript lint of a consumer fails when the installed kit is not the version that package-lock.json resolves (K157)', (t) => {
  const root = repository(t, { 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@polyspec/kit': { version: '0.0.1' } } }) });
  assert.throws(() => lintSteps(root), new RegExp(`node_modules/@polyspec/kit is ${KIT.version.replaceAll('.', '\\.')}, but package-lock\\.json resolves 0\\.0\\.1`));
});

// make runs a file that the layout entries of knip.json do not cover; the repository declares it in config/knip-entries.json, its
// own file, which lint-ts adds to the entries of the copy (K145).
const PROBE = { 'packages/js/test/probe.mjs': "console.log('probe');\n", 'config/knip-entries.json': JSON.stringify({ schema: 1, entries: { 'packages/js/test/probe.mjs': 'make test-js runs the probe of the built package' } }) };

test('a file that make runs outside the layout entries passes once config/knip-entries.json declares it, and an undeclared orphan still fails (K145)', (t) => {
  const declared = lintOf(repository(t, PROBE));
  assert.deepEqual(declared.failed, [], declared.output);
  const orphan = lintOf(repository(t, { ...PROBE, 'packages/js/test/orphan.mjs': "console.log('orphan');\n" }));
  assert.deepEqual(orphan.failed, ['knip'], orphan.output);
  assert.match(orphan.output, /Unused files \(1\)\npackages\/js\/test\/orphan\.mjs/);
  const undeclared = lintOf(repository(t, { 'packages/js/test/probe.mjs': PROBE['packages/js/test/probe.mjs'] }));
  assert.match(undeclared.output, /Unused files \(1\)\npackages\/js\/test\/probe\.mjs/);
});

// A script spawns system tools that no npm package provides: php, a runtime that polyspec pins, is in ignoreBinaries of
// knip.json, and container, a tool of one repository, is declared in config/knip-entries.json, its own file (K152).
const SPAWNS = (...tools: string[]) => ({ 'scripts/build.mts': `import { spawnSync } from 'node:child_process';\n\n${tools.map(tool => `spawnSync('${tool}', ['--version']);\n`).join('')}` });
const CONTAINER = { 'config/knip-entries.json': JSON.stringify({ schema: 1, binaries: { container: 'the virtiofs tests run Apple container' } }) };

test('a pinned runtime and a declared binary that a script spawns pass, and an undeclared binary still fails (K152)', (t) => {
  const declared = lintOf(repository(t, { ...SPAWNS('php', 'composer', 'python3', 'cargo', 'git', 'container'), ...CONTAINER }));
  assert.deepEqual(declared.failed, [], declared.output);
  const undeclared = lintOf(repository(t, { ...SPAWNS('php', 'container', 'gmake'), ...CONTAINER }));
  assert.deepEqual(undeclared.failed, ['knip'], undeclared.output);
  assert.match(undeclared.output, /Unlisted binaries \(1\)\ngmake +scripts\/build\.mts/);
});

// A nested npm project, such as the fixtures that the build tests of ssr compile, holds a package.json with dependencies
// that the root does not list; knip reads it as a workspace of its own only when config/knip-entries.json declares it, with its
// entries and the dependencies that only non-JS code uses. knip's Svelte plugin compiles its .svelte files (K154).
const NESTED = (directory: string) => ({
  [`${directory}/package.json`]: JSON.stringify({ private: true, type: 'module', dependencies: { react: '19.0.0', svelte: '5.0.0', 'web-streams-polyfill': '4.0.0' } }),
  // The project installs no react, so the component re-exports what it imports: a call of an unresolved import is an
  // unsafe call of an error type (K157).
  [`${directory}/src/react.jsx`]: "export { createElement } from 'react';\n",
  [`${directory}/src/App.svelte`]: "<script>\n  import { onMount } from 'svelte';\n\n  onMount(() => {});\n</script>\n\n<p>fixture</p>\n",
  [`${directory}/src/svelte.js`]: "import App from './App.svelte';\n\nexport { App };\n",
});
const FIXTURES = 'packages/build/tests/fixtures';
const knipEntries = (value: object) => ({ 'config/knip-entries.json': JSON.stringify({ schema: 1, ...value }) });
const WORKSPACE = { reason: 'the npm project that the build tests compile', entries: { 'src/*.{jsx,js}': 'the build tests compile each component' }, ignoreDependencies: { 'web-streams-polyfill': 'only the Rust tests load it' } };

test('a nested npm project passes once config/knip-entries.json declares it as a workspace, and an undeclared one still fails (K154)', (t) => {
  // As root entries, which was all that config/knip-entries.json could declare, its dependencies are unlisted at the root.
  const root = lintOf(repository(t, { ...NESTED(FIXTURES), ...knipEntries({ entries: { [`${FIXTURES}/src/*.{jsx,js}`]: 'the build tests compile each component' } }) }));
  assert.deepEqual(root.failed, ['knip'], root.output);
  assert.match(root.output, /Unlisted dependencies \(1\)\nreact +packages\/build\/tests\/fixtures\/src\/react\.jsx/);
  const declared = lintOf(repository(t, { ...NESTED(FIXTURES), ...knipEntries({ workspaces: { [FIXTURES]: WORKSPACE } }) }));
  assert.deepEqual(declared.failed, [], declared.output);
  // The Svelte plugin compiles the component: a dependency that it imports and the project does not list is unlisted.
  const vue = lintOf(repository(t, { ...NESTED(FIXTURES), [`${FIXTURES}/src/App.svelte`]: "<script>\n  import { ref } from 'vue';\n\n  ref(1);\n</script>\n", ...knipEntries({ workspaces: { [FIXTURES]: WORKSPACE } }) }));
  assert.match(vue.output, /Unlisted dependencies \(1\)\nvue +packages\/build\/tests\/fixtures\/src\/App\.svelte/);
  const { ignoreDependencies: _, ...unignored } = WORKSPACE;
  const unused = lintOf(repository(t, { ...NESTED(FIXTURES), ...knipEntries({ workspaces: { [FIXTURES]: unignored } }) }));
  assert.match(unused.output, /Unused dependencies \(1\)\nweb-streams-polyfill +packages\/build\/tests\/fixtures\/package\.json/);
  const undeclared = lintOf(repository(t, { ...NESTED(FIXTURES), ...NESTED('tests/other'), ...knipEntries({ entries: { 'tests/other/src/*.{jsx,js}': 'compiled' }, workspaces: { [FIXTURES]: WORKSPACE } }) }));
  assert.deepEqual(undeclared.failed, ['knip'], undeclared.output);
  assert.match(undeclared.output, /Unlisted dependencies \(1\)\nreact +tests\/other\/src\/react\.jsx/);
});

// The root depends on a package that only the recipes of the Makefile run, such as a compiler that a recipe runs
// by its URL; knip does not read the Makefile, so the repository declares it in config/knip-entries.json (K159).
const COMPILER = '@example/recipe-tool';
const RECIPE = {
  'package.json': JSON.stringify({ ...MANIFEST, dependencies: { [COMPILER]: 'https://example.com/recipe-tool-0.1.0.tgz' } }, null, 2),
  'Makefile': `${GOOD['Makefile']!}\ntemplates:\n\tnode node_modules/${COMPILER}/bin/compile.mjs templates\n`,
};

test('a root dependency that only the Makefile runs passes once config/knip-entries.json declares it, and an undeclared one still fails (K159)', (t) => {
  const undeclared = lintOf(repository(t, RECIPE));
  assert.deepEqual(undeclared.failed, ['knip'], undeclared.output);
  assert.match(undeclared.output, /Unused dependencies \(1\)\n@example\/recipe-tool +package\.json/);
  const declared = lintOf(repository(t, { ...RECIPE, ...knipEntries({ ignoreDependencies: { [COMPILER]: 'only the recipes of the Makefile run the compiler' } }) }));
  assert.deepEqual(declared.failed, [], declared.output);
});

// A sample source file that a site shows and nothing runs or imports is an unused file to knip; the repository declares it
// in the ignore of config/knip-entries.json with its reason, knip's documented option for such files (K162).
const SAMPLE = { 'site/samples/counter.mjs': "export const counter = () => 1;\n" };

test('an unused sample file passes once config/knip-entries.json ignores it, and an undeclared unused file still fails (K162)', (t) => {
  const undeclared = lintOf(repository(t, SAMPLE));
  assert.deepEqual(undeclared.failed, ['knip'], undeclared.output);
  assert.match(undeclared.output, /Unused files \(1\)\nsite\/samples\/counter\.mjs/);
  const ignore = knipEntries({ ignore: { 'site/samples/*.mjs': 'the site shows the samples and nothing runs them' } });
  const declared = lintOf(repository(t, { ...SAMPLE, ...ignore }));
  assert.deepEqual(declared.failed, [], declared.output);
  const orphan = lintOf(repository(t, { ...SAMPLE, ...ignore, 'site/orphan.mjs': "export const orphan = () => 1;\n" }));
  assert.deepEqual(orphan.failed, ['knip'], orphan.output);
  assert.match(orphan.output, /Unused files \(1\)\nsite\/orphan\.mjs/);
});

test('an undocumented export passes API Extractor once the API report is off, which is why the base configuration enables it', (t) => {
  const { failed, output } = lintOf(repository(t, VIOLATIONS.find(({ name }) => name === 'an undocumented export')!.files, { report: false }));
  assert.deepEqual(failed, [], output);
});
