// The real TypeScript lint: lint-ts.mts runs the oxlint (with oxlint-tsgolint), knip and API Extractor of the node_modules of
// this checkout on a TypeScript 7 package that holds the .oxlintrc.json and knip.json of this checkout as its own (K1050) and an api-extractor.json that
// extends its config/api-extractor.kit.json. The package is built with tsc 7 and its API report is written first, as a repository
// commits it. A package whose exports are documented and used passes; each violation planted into a copy fails with the
// rule or the message that names it, including the undocumented export of the plan's verification. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint, lintSteps } from '../../scripts/kit/lint-ts.mts';
import { runLint } from '../../scripts/kit/lint-steps.mts';
import { readFixture } from '../kit/json-fixture.mts';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { known } from '../kit/known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(ROOT, 'node_modules/.bin');

const INDEX = 'src/index.ts';
const DOUBLE = '/**\n * Doubles a value.\n */\nexport function double(value: number): number {\n  return value * 2;\n}\n';

// The test file: top-level registrations of node:test, which return a promise that the runner itself awaits (K138).
const TESTS = "import assert from 'node:assert/strict';\nimport test, { describe, it, suite } from 'node:test';\nimport { double } from '../src/index.ts';\n\ntest('double', () => {\n  assert.equal(double(2), 4);\n});\n\ndescribe('double', () => {\n  it('doubles zero', () => {\n    assert.equal(double(0), 0);\n  });\n});\n\nsuite('double', () => {\n  test.skip('of a string', () => {});\n});\n";

// The package.json of the package.
const MANIFEST = { name: 'demo', version: '0.0.1', type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './src/index.ts' } }, devDependencies: { '@polyspec/kit': '0.0.42' } };

// The tsconfig of the checks of the package and the tsconfig of its build, which emits the declarations of src to dist.
const TSCONFIG = { compilerOptions: { strict: true, target: 'esnext', module: 'nodenext', noEmit: true, allowImportingTsExtensions: true, types: ['node'] }, include: ['src', 'tests', 'scripts', 'benchmarks'], exclude: ['scripts/kit'] };
const TSCONFIG_BUILD = { extends: './tsconfig.json', compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] };

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
  // build emits only src.
  'tsconfig.json': JSON.stringify(TSCONFIG, null, 2),
  'tsconfig.build.json': JSON.stringify(TSCONFIG_BUILD, null, 2),
  'api-extractor.json': '',
  [INDEX]: DOUBLE,
  'tests/index.test.ts': TESTS,
};

// One violation for each rule: the files it adds or replaces, and the text that the failing step prints for it.
const VIOLATIONS: { name: string; files: Record<string, string>; finding: RegExp; step: string }[] = [
  { name: 'a floating promise', files: { [INDEX]: `${DOUBLE}\n/**\n * Waits for nothing.\n */\nexport async function settle(): Promise<void> {\n  Promise.resolve(1);\n}\n` }, finding: /typescript\(no-floating-promises\)/, step: 'oxlint' },
  // A real floating promise among the node:test registrations, which the rule allows (K138), is still one.
  { name: 'a floating promise in a test file', files: { 'tests/index.test.ts': `${TESTS}\nfetch('https://example.com/');\n` }, finding: new RegExp(`tests/index\\.test\\.ts:${TESTS.split('\n').length + 1}:1: .*\\[Error/typescript\\(no-floating-promises\\)\\]`), step: 'oxlint' },
  // The escape hatches from the types of TypeScript (K155).
  { name: 'an explicit any', files: { [INDEX]: `${DOUBLE}\n/**\n * Returns its value.\n */\nexport function same(value: any): number {\n  return value;\n}\n` }, finding: /typescript\(no-explicit-any\)/, step: 'oxlint' },
  { name: 'a @ts-ignore', files: { [INDEX]: `${DOUBLE}\n/**\n * Halves a value.\n */\nexport function half(value: number): number {\n  // @ts-ignore\n  return value / 2;\n}\n` }, finding: /typescript\(ban-ts-comment\)/, step: 'oxlint' },
  { name: 'a @ts-expect-error without a description', files: { 'tests/index.test.ts': `${TESTS}\ntest('double of a string', () => {\n  // @ts-expect-error\n  assert.equal(double('2'), 4);\n});\n` }, finding: /typescript\(ban-ts-comment\)/, step: 'oxlint' },
  { name: 'a type assertion that changes nothing', files: { [INDEX]: `${DOUBLE}\n/**\n * Halves a value.\n */\nexport function half(value: number): number {\n  return (value as number) / 2;\n}\n` }, finding: /typescript\(no-unnecessary-type-assertion\)/, step: 'oxlint' },
  // The unsafe flows of any (K157): JSON.parse returns any, which no value of a type may take on.
  ...([
    ['no-unsafe-argument', 'export function size(text: string): number {\n  return measure(JSON.parse(text));\n}\n\nfunction measure(value: string): number {\n  return value.length;\n}\n'],
    ['no-unsafe-assignment', 'export function size(text: string): number {\n  const value: string = JSON.parse(text);\n  return value.length;\n}\n'],
    ['no-unsafe-call', 'export function size(text: string): void {\n  JSON.parse(text)();\n}\n'],
    ['no-unsafe-member-access', 'export function size(text: string): unknown {\n  const value: unknown = JSON.parse(text).length;\n  return value;\n}\n'],
    ['no-unsafe-return', 'export function size(text: string): number {\n  return JSON.parse(text);\n}\n'],
    ['no-unsafe-type-assertion', 'export function size(value: unknown): number {\n  return (value as string).length;\n}\n'],
  ] as const).map(([rule, code]) => ({ name: `a violation of ${rule}`, files: { [INDEX]: `${DOUBLE}\n/**\n * Measures a value.\n */\n${code}` }, finding: new RegExp(`typescript\\(${rule}\\)`), step: 'oxlint' })),
  // A value whose type admits undefined is read with a check, not asserted away (K156).
  { name: 'a non-null assertion', files: { [INDEX]: `${DOUBLE}\n/**\n * Reads the first value.\n */\nexport function first(values: number[]): number {\n  return values[0]!;\n}\n` }, finding: /typescript\(no-non-null-assertion\)/, step: 'oxlint' },
  { name: 'a debugger statement', files: { [INDEX]: `${DOUBLE}\n/**\n * Stops in a debugger.\n */\nexport function pause(): void {\n  debugger;\n}\n` }, finding: /eslint\(no-debugger\)/, step: 'oxlint' },
  { name: 'a file that nothing imports', files: { 'src/orphan.ts': 'export const orphan = 1;\n' }, finding: /Unused files \(1\)\nsrc\/orphan\.ts/, step: 'knip' },
  { name: 'an export that nothing imports', files: { 'src/values.ts': '/** One. */\nexport const one = 1;\n/** Two. */\nexport const two = 2;\n', [INDEX]: `${DOUBLE}\nexport { one } from './values.ts';\n` }, finding: /Unused exports \(1\)\ntwo +src\/values\.ts/, step: 'knip' },
  // The false green of the verification: ae-undocumented fires only through the API report, which the base configuration enables.
  { name: 'an undocumented export', files: { [INDEX]: `${DOUBLE}\nexport function triple(value: number): number {\n  return value * 3;\n}\n` }, finding: /\(ae-undocumented\) Missing documentation for "triple"/, step: 'api-extractor .' },
  { name: 'a forgotten export', files: { [INDEX]: `${DOUBLE}\ninterface Options {\n  factor: number;\n}\n\n/**\n * Scales a value.\n */\nexport function scale(value: number, options: Options): number {\n  return value * options.factor;\n}\n` }, finding: /\(ae-forgotten-export\) The symbol "Options" needs to be exported by the entry point index\.d\.ts/, step: 'api-extractor .' },
  // No swallowed error (K256).
  { name: 'an empty catch', files: { [INDEX]: `${DOUBLE}\n/**\n * Doubles one, or nothing.\n */\nexport function tryDouble(): void {\n  try {\n    double(1);\n  } catch {}\n}\n` }, finding: /eslint\(no-empty\)/, step: 'oxlint' },
  // P8 (K334): an error thrown from a catch carries the caught one as its cause.
  { name: 'a thrown error that drops its cause', files: { [INDEX]: `${DOUBLE}\n/**\n * Doubles one.\n */\nexport function wrap(): number {\n  try {\n    return double(1);\n  } catch (error) {\n    throw new Error('doubling failed');\n  }\n}\n` }, finding: /eslint\(preserve-caught-error\)/, step: 'oxlint' },
  { name: 'a catch that only rethrows', files: { [INDEX]: `${DOUBLE}\n/**\n * Doubles one.\n */\nexport function rethrow(): number {\n  try {\n    return double(1);\n  } catch (error) {\n    throw error;\n  }\n}\n` }, finding: /eslint\(no-useless-catch\)/, step: 'oxlint' },
];

// The package.json of this checkout: the version of kit that the lock of the repository resolves.
const KIT = readFixture<{ version: string }>(ROOT, 'package.json');

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
  // node_modules holds the packages of this checkout and, as @polyspec/kit, this checkout, the version that package-lock.json
  // resolves, as make install-packages installs it in a consumer.
  const lock = { lockfileVersion: 3, packages: { 'node_modules/@polyspec/kit': { version: KIT.version } } };
  write(root, { ...GOOD, 'api-extractor.json': JSON.stringify(extractor, null, 2), 'package-lock.json': JSON.stringify(lock), ...files });
  mkdirSync(path.join(root, 'config'), { recursive: true });
  for (const file of ['.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json']) copyFileSync(path.join(ROOT, file), path.join(root, file));
  // The consumer runs @polyspec/kit only through the include of its Makefile, which knip does not read, so its own knip.json
  // names it among the dependencies that knip ignores (K1050).
  const knip = readJsonObject(root, 'knip.json');
  const ignored: unknown[] = Array.isArray(knip.ignoreDependencies) ? knip.ignoreDependencies.filter((name: unknown) => typeof name === 'string') : [];
  writeFileSync(path.join(root, 'knip.json'), `${JSON.stringify({ ...knip, ignoreDependencies: [...ignored, '@polyspec/kit'] }, null, 2)}\n`);
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

/** Runs one explicitly selected step for an isolated violation fixture. */
function lintStepOf(root: string, label: string): { failed: string[]; output: string } {
  const matches = lintSteps(root).filter(candidate => candidate.label === label);
  assert.equal(matches.length, 1, `the fixture has exactly one owner step named ${label}`);
  const step = known(matches[0], `lint step ${label}`);
  let output = '';
  const failed = runLint('lint-ts', [step], root, text => { output += text; });
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
  for (const { name, files, finding, step } of VIOLATIONS) {
    const { failed, output } = lintStepOf(repository(t, files), step);
    assert.notDeepEqual(failed, [], `${name}: the violation passed:\n${output}`);
    assert.match(output, finding, `${name} is not named:\n${output}`);
  }
});

// P8 (K334, K537, K561): a catch states why every failure means its named outcome; a wrapped error retains its cause.
test('the TypeScript lint passes on a catch with a stated need and on an error that keeps its cause', (t) => {
  const stated = `${DOUBLE}\n/**\n * Doubles one, or nothing.\n */\nexport function tryDouble(): void {\n  try {\n    double(1);\n  // catch-any -- every doubling failure means that this optional attempt produces no value\n  } catch {\n    return;\n  }\n}\n\n/**\n * Doubles one.\n */\nexport function wrap(): number {\n  try {\n    return double(1);\n  } catch (error) {\n    throw new Error('doubling failed', { cause: error });\n  }\n}\n`;
  const { failed, output } = lintOf(repository(t, { [INDEX]: stated, 'tests/index.test.ts': `${TESTS.replace('{ double }', '{ double, tryDouble, wrap }')}\ntest('wrap', () => {\n  tryDouble();\n  assert.equal(wrap(), 2);\n});\n` }));
  assert.deepEqual(failed, [], output);
});

// ES2018 raised the limit of the fraction digits of toExponential and toFixed, and of the precision of toPrecision, to 100
// (ECMA-262 Number.prototype.toExponential); oxlint's oxc/number-arg-out-of-range still allows only 20, so it is off (K161).
test('the TypeScript lint passes on toExponential(25), which ES2018 allows', (t) => {
  const exponent = `${DOUBLE}\n/**\n * Writes a value with 25 fraction digits.\n */\nexport function exponent(value: number): string {\n  return value.toExponential(25);\n}\n`;
  const { failed, output } = lintOf(repository(t, { [INDEX]: exponent, 'tests/index.test.ts': `${TESTS.replace('{ double }', '{ double, exponent }')}\ntest('exponent', () => {\n  assert.equal(exponent(1), '1.0000000000000000000000000e+0');\n});\n` }));
  assert.deepEqual(failed, [], output);
});

// Every file of a consumer is its own, one under scripts/kit too: a violation there fails the lint (K1052).
test('the TypeScript lint of a consumer lints every file of the consumer (K1052)', (t) => {
  const kit = lintOf(repository(t, { 'scripts/kit/helper.mts': 'export const helper = 1;\ndebugger;\n' }));
  assert.ok(kit.failed.includes('oxlint'), kit.output);
  assert.match(kit.output, /scripts\/kit\/helper\.mts:.*eslint\(no-debugger\)/);
  const own = lintOf(repository(t, { 'scripts/build.mts': "console.log('build');\ndebugger;\n" }));
  assert.deepEqual(own.failed, ['oxlint'], own.output);
  assert.match(own.output, /scripts\/build\.mts:.*eslint\(no-debugger\)/);
});

test('the TypeScript lint of a consumer reads the installed kit of any version, as a local link of kit is (K267)', (t) => {
  const root = repository(t, { 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@polyspec/kit': { version: '0.0.1' } } }) });
  assert.doesNotThrow(() => lintSteps(root), 'npm ci enforces the lock at install time; the lint reads what is installed');
});

test('an undocumented export passes API Extractor once the API report is off, which is why the base configuration enables it', (t) => {
  const violation = known(VIOLATIONS.find(({ name }) => name === 'an undocumented export'), 'VIOLATIONS.find(({ name }) => name === …)');
  const rejected = lintOf(repository(t, violation.files));
  assert.ok(rejected.failed.includes('api-extractor .'), rejected.output);
  assert.match(rejected.output, violation.finding);

  const { failed, output } = lintOf(repository(t, violation.files, { report: false }));
  assert.deepEqual(failed, [], output);
});

// The type-aware rules apply to TypeScript only, as typescript-eslint's disableTypeChecked does for JavaScript: in a plain
// .mjs file the value of JSON.parse is any, so no-unsafe-member-access would report its member access. The same code in a
// .mts file still fails, and so does a non-type-aware rule in the .mjs file (K170). The code has no untyped parameter, which
// strict tsc rejects in a .mts file (TS7006) and so would fail the tsc of the project, not only oxlint.
const UNTYPED = 'export function size() {\n  return JSON.parse(process.argv[2]).length;\n}\n';

test('the type-aware rules leave a plain JavaScript file alone and still fail the same code in TypeScript (K170)', (t) => {
  const javascript = lintOf(repository(t, { 'scripts/size.mjs': UNTYPED }));
  assert.deepEqual(javascript.failed, [], javascript.output);
  const typescript = lintOf(repository(t, { 'scripts/size.mts': UNTYPED }));
  assert.deepEqual(typescript.failed, ['oxlint'], typescript.output);
  assert.match(typescript.output, /scripts\/size\.mts:.*typescript\(no-unsafe-member-access\)/);
  const debug = lintOf(repository(t, { 'scripts/size.mjs': `${UNTYPED}debugger;\n` }));
  assert.deepEqual(debug.failed, ['oxlint'], debug.output);
  assert.match(debug.output, /scripts\/size\.mjs:.*eslint\(no-debugger\)/);
});

// A test that imports the build output of its package (`../dist/values.js`) uses the exports of the source that tsc
// emits there; knip maps the outDir of a tsconfig to its rootDir only for the tsconfig.json of the workspace or a project
// that it references (TypeScript project references). With the build in a tsconfig of its own that tsconfig.json does not
// reference, the export is unused; once tsconfig.json references the build project, which project references require to
// be composite, knip reads the test's import as one of src and tsc still checks the tests (K175).
const VALUES = '/** One. */\nexport const one = 1;\n/** Two. */\nexport const two = 2;\n';
const DIST = {
  'src/values.ts': VALUES,
  [INDEX]: `${DOUBLE}\nexport { one } from './values.ts';\n`,
  'tests/values.test.ts': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { two } from '../dist/values.js';\n\ntest('two', () => {\n  assert.equal(two, 2);\n});\n",
};

test('a test that imports the build output passes once tsconfig.json references the build project, and fails without (K175)', (t) => {
  const plain = lintOf(repository(t, DIST));
  assert.deepEqual(plain.failed, ['knip'], plain.output);
  assert.match(plain.output, /Unused exports \(1\)\ntwo +src\/values\.ts/);
  const root = repository(t, {
    ...DIST,
    'tsconfig.json': JSON.stringify({ ...TSCONFIG, references: [{ path: './tsconfig.build.json' }] }),
    'tsconfig.build.json': JSON.stringify({ ...TSCONFIG_BUILD, compilerOptions: { ...TSCONFIG_BUILD.compilerOptions, composite: true } }),
  });
  const check = run(root, 'tsc', '-p', 'tsconfig.json');
  assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
  const referenced = lintOf(root);
  assert.deepEqual(referenced.failed, [], referenced.output);
});
