// The real TypeScript lint: lint-ts.mts runs the oxlint (with oxlint-tsgolint), knip and API Extractor of the node_modules of
// this checkout on a TypeScript 7 package that holds the .oxlintrc.json of this checkout and an api-extractor.json that
// extends its config/api-extractor.kit.json. The package is built with tsc 7 and its API report is written first, as a repository
// commits it. A package whose exports are documented and used passes; each violation planted into a copy fails with the
// rule or the message that names it, including the undocumented export of the plan's verification. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint } from '../../scripts/kit/lint-ts.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(ROOT, 'node_modules/.bin');

const INDEX = 'src/index.ts';
const DOUBLE = '/**\n * Doubles a value.\n */\nexport function double(value: number): number {\n  return value * 2;\n}\n';

// The test file: top-level registrations of node:test, which return a promise that the runner itself awaits (K138).
const TESTS = "import assert from 'node:assert/strict';\nimport test, { describe, it, suite } from 'node:test';\nimport { double } from '../src/index.ts';\n\ntest('double', () => {\n  assert.equal(double(2), 4);\n});\n\ndescribe('double', () => {\n  it('doubles zero', () => {\n    assert.equal(double(0), 0);\n  });\n});\n\nsuite('double', () => {\n  test.skip('of a string', () => {});\n});\n";

// A package whose one export is documented, reached from its entry point, and tested. No export carries a release tag (@public),
// as in every polyspec repository: the base configuration turns ae-missing-release-tag off (K139).
const GOOD: Record<string, string> = {
  '.gitignore': 'node_modules/\ndist/\nvar/\n',
  // kit comes in through the include of its Makefile and its copies, which knip does not read (K142).
  'package.json': JSON.stringify({ name: 'demo', version: '0.0.1', type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './src/index.ts' } }, devDependencies: { '@polyspec/kit': '0.0.42' } }, null, 2),
  // make runs a script of S9, a copy of kit and a benchmark program, which nothing imports (K142).
  'Makefile': 'include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\n\nbuild:\n\tnode scripts/build.mts\n\tnode scripts/kit/bootstrap/bootstrap.mts\n\tnode benchmarks/run.mts\n',
  'scripts/build.mts': "console.log('build');\n",
  'scripts/kit/bootstrap/bootstrap.mts': "console.log('bootstrap');\n",
  'benchmarks/run.mts': "console.log('run');\n",
  // The project covers the tests too, as in a consumer, so oxlint-tsgolint checks their types; the build emits only src.
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'esnext', module: 'nodenext', noEmit: true, allowImportingTsExtensions: true, types: ['node'] }, include: ['src', 'tests'] }, null, 2),
  'tsconfig.build.json': JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] }, null, 2),
  'api-extractor.json': '',
  [INDEX]: DOUBLE,
  'tests/index.test.ts': TESTS,
};

// One violation for each rule: the files it adds or replaces, and the text that the failing step prints for it.
const VIOLATIONS: { name: string; files: Record<string, string>; finding: RegExp }[] = [
  { name: 'a floating promise', files: { [INDEX]: `${DOUBLE}\n/**\n * Waits for nothing.\n */\nexport async function settle(): Promise<void> {\n  Promise.resolve(1);\n}\n` }, finding: /typescript\(no-floating-promises\)/ },
  // A real floating promise among the node:test registrations, which the rule allows (K138), is still one.
  { name: 'a floating promise in a test file', files: { 'tests/index.test.ts': `${TESTS}\nfetch('https://example.com/');\n` }, finding: new RegExp(`tests/index\\.test\\.ts:${TESTS.split('\n').length + 1}:1: error typescript\\(no-floating-promises\\)`) },
  { name: 'a debugger statement', files: { [INDEX]: `${DOUBLE}\n/**\n * Stops in a debugger.\n */\nexport function pause(): void {\n  debugger;\n}\n` }, finding: /eslint\(no-debugger\)/ },
  { name: 'a file that nothing imports', files: { 'src/orphan.ts': 'export const orphan = 1;\n' }, finding: /Unused files \(1\)\nsrc\/orphan\.ts/ },
  { name: 'an export that nothing imports', files: { 'src/values.ts': '/** One. */\nexport const one = 1;\n/** Two. */\nexport const two = 2;\n', [INDEX]: `${DOUBLE}\nexport { one } from './values.ts';\n` }, finding: /Unused exports \(1\)\ntwo +src\/values\.ts/ },
  // The false green of the verification: ae-undocumented fires only through the API report, which the base configuration enables.
  { name: 'an undocumented export', files: { [INDEX]: `${DOUBLE}\nexport function triple(value: number): number {\n  return value * 3;\n}\n` }, finding: /\(ae-undocumented\) Missing documentation for "triple"/ },
  { name: 'a forgotten export', files: { [INDEX]: `${DOUBLE}\ninterface Options {\n  factor: number;\n}\n\n/**\n * Scales a value.\n */\nexport function scale(value: number, options: Options): number {\n  return value * options.factor;\n}\n` }, finding: /\(ae-forgotten-export\) The symbol "Options" needs to be exported by the entry point index\.d\.ts/ },
];

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

// The lint runs as it does outside CI: under GitHub Actions oxlint writes annotations, whose text leaves out the rule, so
// the environment of the test would decide what the assertions read.
const { GITHUB_ACTIONS: _ci, ...LOCAL } = process.env;
const run = (root: string, command: string, ...args: string[]) => spawnSync(path.join(BIN, command), args, { cwd: root, encoding: 'utf8', env: LOCAL });

/**
 * A repository in a temporary folder: GOOD with `files` over it, the .oxlintrc.json, knip.json and config/api-extractor.kit.json of this
 * checkout and its node_modules; the package is built and its API report written, as a repository commits it. `report`
 * false makes the api-extractor.json of the package turn the report off.
 */
function repository(t: TestContext, files: Record<string, string> = {}, { report = true } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-ts-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const extractor = { extends: path.join(root, 'config/api-extractor.kit.json'), mainEntryPointFilePath: '<projectFolder>/dist/index.d.ts', ...(report ? {} : { apiReport: { enabled: false } }) };
  write(root, { ...GOOD, 'api-extractor.json': JSON.stringify(extractor, null, 2), ...files });
  mkdirSync(path.join(root, 'config'));
  for (const file of ['.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json']) copyFileSync(path.join(ROOT, file), path.join(root, file));
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
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

test('the TypeScript lint fails on each planted violation with the rule or the message that names it', (t) => {
  for (const { name, files, finding } of VIOLATIONS) {
    const { failed, output } = lintOf(repository(t, files));
    assert.notDeepEqual(failed, [], `${name}: the violation passed:\n${output}`);
    assert.match(output, finding, `${name} is not named:\n${output}`);
  }
});

test('an undocumented export passes API Extractor once the API report is off, which is why the base configuration enables it', (t) => {
  const { failed, output } = lintOf(repository(t, VIOLATIONS.find(({ name }) => name === 'an undocumented export')!.files, { report: false }));
  assert.deepEqual(failed, [], output);
});
