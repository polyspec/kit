// Tests of scripts/kit/run-tests.mts and its progress reporters: the progress lines, the failing run
// without a test, the file that registers no test or registers it late, and the parsers of the output of go, cargo and
// PHPUnit. The runs use fixture test files in a temporary checkout and stubs of the tools on PATH; nothing needs a network.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listedTests, parseArguments, probeExtensions, PYTHON_START, run, toolCommand } from '../../scripts/kit/run-tests.mts';
import { cargoEvents, goEvents, phpunitEvents, pythonEvents, toProgress } from '../../scripts/kit/test-output.mts';
import { inputsDigest } from '../../scripts/kit/tracked-files.mts';
import { createProgress } from '../../scripts/kit/test-progress.mts';
import { put, tree } from './tree.mts';
import { KIT, tool } from './kit-tools.mts';
import type { JSONSchemaType } from 'ajv/dist/2020.js';
import { readStub, TEXTS } from './stub-json.mts';
import { known } from './known.mts';
import { toolCommand as checkoutTool } from '../../scripts/kit/mise-tools.mts';

/** The record that run-tests --results writes: the tool, the inputs, the time and each case. */
type Results = { tool: string; ok?: boolean; elapsedMs?: number; inputs?: { paths: string[]; digest: string }; cases: { id: string; status: string; elapsedMs?: number }[] };
const RESULTS: JSONSchemaType<Results> = {
  type: 'object',
  required: ['tool', 'cases'],
  properties: {
    tool: { type: 'string' },
    ok: { type: 'boolean', nullable: true },
    elapsedMs: { type: 'number', nullable: true },
    inputs: { type: 'object', nullable: true, required: ['paths', 'digest'], properties: { paths: TEXTS, digest: { type: 'string' } } },
    cases: { type: 'array', items: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string' }, status: { type: 'string' }, elapsedMs: { type: 'number', nullable: true } } } },
  },
};

const SPEC = "import test from 'node:test';\n";

const checkout = (t: TestContext, files: Record<string, string>) => tree(t, files);
// The runs start without NODE_TEST_CONTEXT, so a nested node --test does not join the run of this file (K1094).
const { NODE_TEST_CONTEXT: _joined, ...OUTSIDE } = process.env;
const runner = (root: string, args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), ...args], { cwd: root, encoding: 'utf8', env: { ...OUTSIDE, ...env } });
// A run of a whole directory runs in-process (K954).
async function runInProcess(root: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  let stdout = '';
  // The runner names each case relative to the working directory, which the spawned run had as its checkout.
  const previous = process.cwd();
  const real = realpathSync(root);
  process.chdir(real);
  try {
    const status = await run(args, { root: real, write: (text: string) => { stdout += text; }, callerEnv: OUTSIDE });
    return { status, stdout, stderr: '' };
  } finally {
    process.chdir(previous);
  }
}
const output = (result: { stdout: string; stderr: string }) => result.stdout + result.stderr;
// The events of runners/python.py that a python3 stub writes to the descriptor 3 (K1194), from [event, id] pairs.
const writeEvents = (events: [string, string][]) => `require('node:fs').writeSync(3, ${JSON.stringify(events.map(([event, id]) => JSON.stringify({ event, id })).join('\n') + '\n')});`;
const passA = writeEvents([['start', 'test_a (t.T.test_a)'], ['pass', 'test_a (t.T.test_a)']]);

// The Python of a checkout is var/tools/mise/shims/python3, the shim of mise: a test writes its stub there.
function pythonStub(root: string, script: string) {
  const file = path.join(root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(file, 0o755);
  return root;
}
const pythonRoot = (t: TestContext, script: string) => pythonStub(tree(t), script);

test('a passing file prints the start and the result of each test and a summary, and exits 0', (t) => {
  const root = checkout(t, { 'tests/a.test.mjs': `${SPEC}test('adds', () => {});\ntest('group', async (t) => { await t.test('inner', () => {}); });\n` });
  const result = runner(root, ['node', '--', 'tests/a.test.mjs']);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /^▶ node \. tests\/a\.test\.mjs$/m);
  assert.match(result.stdout, /▶ tests\/a\.test\.mjs › adds/);
  assert.match(result.stdout, /✔ tests\/a\.test\.mjs › adds \(\d+\.\ds\)/);
  assert.match(result.stdout, /✔ tests\/a\.test\.mjs › group › inner/);
  assert.match(result.stdout, /✔ node --test: 3 passed, 0 failed, 0 skipped/);
});

// A diagnostic of node --test that no failure carries, as one that a test writes with t.diagnostic, is printed (K1146).
test('the reporter prints a diagnostic of node --test other than its summary counts (K1146)', (t) => {
  const root = checkout(t, { 'tests/a.test.mjs': `${SPEC}test('notes', (t) => { t.diagnostic('a diagnostic of ' + 'the test'); });\n` });
  const result = runner(root, ['node', '--', 'tests/a.test.mjs']);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /a diagnostic of the test/);
  assert.doesNotMatch(output(result), /^duration_ms /m, 'the counts of the summary stay out');
});

test('a directory runs the test files below it', async (t) => {
  const root = checkout(t, { 'tests/one/a.test.mjs': `${SPEC}test('a', () => {});\n`, 'tests/one/b.test.mjs': `${SPEC}test('b', () => {});\n` });
  // The child reporter writes to the process, so the recorded results count the files that ran. The files run one at a time, as
  // the recipes of kit pass --test-concurrency=1 (K1094).
  const result = await runInProcess(root, ['node', '--results', 'var/report/one.json', '--', '--test-concurrency=1', 'tests/one']);
  assert.equal(result.status, 0, output(result));
  const record = readStub(path.join(root, 'var/report/one.json'), RESULTS);
  assert.deepEqual(record.cases.map(({ id, status }) => [id, status]), [['tests/one/a.test.mjs › a', 'pass'], ['tests/one/b.test.mjs › b', 'pass']]);
});

test('a failing test prints its failure and exits 1', (t) => {
  const root = checkout(t, { 'tests/a.test.mjs': `${SPEC}test('breaks', () => { throw new Error('expected 1, actual 2'); });\ntest('fine', () => {});\n` });
  const result = runner(root, ['node', '--', 'tests/a.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout, /✖ tests\/a\.test\.mjs › breaks/);
  assert.match(result.stdout, /expected 1, actual 2/);
  assert.match(result.stdout, /✔ tests\/a\.test\.mjs › fine/);
});

test('a run in which no test ran fails: a file without a test case, only skipped tests, no matching file', (t) => {
  const root = checkout(t, {
    'tests/none.test.mjs': SPEC,
    'tests/skip.test.mjs': `${SPEC}test('later', { skip: true }, () => {});\n`,
    'tests/ok.test.mjs': `${SPEC}test('ok', () => {});\n`,
  });
  const none = runner(root, ['node', '--', 'tests/none.test.mjs']);
  assert.equal(none.status, 1, output(none));
  assert.match(none.stdout, /the file ran no test case/);
  assert.match(none.stdout, /no test ran: expected at least 1 test that passes or fails, actual 0/);
  const skipped = runner(root, ['node', '--', 'tests/skip.test.mjs']);
  assert.equal(skipped.status, 1, output(skipped));
  assert.match(skipped.stdout, /no test ran: expected at least 1 test that passes or fails, actual 0 \(1 skipped\)/);
  const absent = runner(root, ['node', '--', 'tests/absent.test.mjs']);
  assert.equal(absent.status, 1, output(absent));
  assert.equal(runner(root, ['node', '--', 'tests/ok.test.mjs']).status, 0);
});

// A case that a helper module registers (a case function that calls test()) is reported with the helper as its file; the
// case still belongs to the test file that node --test runs, so the file counts it (K218).
test('a node file whose cases a helper module registers counts them for the file that runs', (t) => {
  const root = checkout(t, {
    'tests/testcase.mjs': `${SPEC}export function caseTest(name, fn) {\n  test(name, fn);\n}\n`,
    'tests/select.test.mjs': "import { caseTest } from './testcase.mjs';\ncaseTest('adds', () => {});\ncaseTest('subtracts', () => {});\n",
  });
  const result = runner(root, ['node', '--', 'tests/select.test.mjs']);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /✔ node --test: 2 passed, 0 failed, 0 skipped/);
  assert.match(result.stdout, /✔ tests\/testcase\.mjs › adds/);
});

// The top-level await never settles: node ends the process with no live handle and fails the file for the unsettled await.
test('a file whose top-level await never settles fails', (t) => {
  const root = checkout(t, { 'tests/late.test.mjs': `${SPEC}test('early', () => {});\nawait new Promise(() => {});\ntest('late', () => {});\n` });
  const result = runner(root, ['node', '--', 'tests/late.test.mjs']);
  assert.equal(result.status, 1, output(result));
});

// --test-force-exit ended a file's process when its known tests ended, so a test registered after a top-level await never
// ran and the file passed (K72).
test('a test registered after a top-level await runs', (t) => {
  const root = checkout(t, { 'tests/late.test.mjs': `${SPEC}test('early', () => {});\nawait new Promise(resolve => setTimeout(resolve, 50));\ntest('late', () => { throw new Error('late ran'); });\n` });
  const result = runner(root, ['node', '--', 'tests/late.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /late ran/);
});

test('the arguments of the runner are read before the arguments of the tool', () => {
  const options = parseArguments(['node', '--cwd', 'sub', '--', 'a.test.mjs', '--x'], '/repo');
  assert.deepEqual([options.tool, options.cwd, options.args], ['node', '/repo/sub', ['a.test.mjs', '--x']]);
  // kit has no time option (K1175): --timeout is an argument of the tool.
  assert.deepEqual(parseArguments(['node', '--timeout', '5', 'a.test.mjs'], '/repo').args, ['--timeout', '5', 'a.test.mjs']);
  assert.deepEqual(parseArguments(['phpunit', '--php-extension', 'ext.so'], '/repo').phpExtensions, ['/repo/ext.so']);
  assert.deepEqual(parseArguments(['phpunit', '--php-extension', 'base.so', '--php-extension', 'ext.so', 't'], '/repo').phpExtensions, ['/repo/base.so', '/repo/ext.so']);
  assert.equal(parseArguments(['go', './...'], '/repo').args[0], './...');
  assert.deepEqual(parseArguments(['python', '--cwd', 'pkg', 'tests'], '/repo').args, ['tests']);
  assert.deepEqual(parseArguments(['playwright', '--cwd', 'pkg', '--', 'tests/e2e/login.spec.ts'], '/repo').args, ['tests/e2e/login.spec.ts']);
  const recorded = parseArguments(['go', '--results', '.results/go.json', '--inputs', 'pkg', '--inputs', 'schema/a.dbs', './...'], '/repo');
  assert.deepEqual([recorded.results, recorded.inputs, recorded.args], ['/repo/.results/go.json', ['pkg', 'schema/a.dbs'], ['./...']]);
  assert.deepEqual(parseArguments(['go', '--results', 'r.json', '--cwd', 'pkg'], '/repo').inputs, ['pkg']);
  assert.throws(() => parseArguments(['go', '--inputs', 'pkg'], '/repo'), /--inputs needs --results/);
  for (const bad of [[], ['ruby'], ['go', '--results'], ['node', '--php-extension', 'x'], ['node', '--cwd']]) {
    assert.throws(() => parseArguments(bad, '/repo'), /Usage: node scripts\/kit\/run-tests\.mts <node\|vitest\|playwright\|go\|cargo\|phpunit\|python>/, JSON.stringify(bad));
  }
});

test('each tool starts with its progress arguments and no time limit of kit (K1175)', (t) => {
  const shims = tree(t, { 'var/tools/mise/shims/go': '', 'var/tools/mise/shims/python3': '' });
  const node = toolCommand({ tool: 'node', cwd: '/r', args: ['a'] }, '/r');
  assert.deepEqual(node.args.filter(arg => /timeout|force-exit|--import/i.test(arg)), [], node.args.join(' '));
  assert.equal(node.args.at(-1), 'a');
  const reporter = node.args.find(arg => arg.startsWith('--test-reporter='));
  assert.ok(reporter);
  const reporterUrl = reporter.slice('--test-reporter='.length);
  assert.equal(new URL(reporterUrl).protocol, 'file:');
  assert.equal(fileURLToPath(reporterUrl), path.join(path.dirname(tool(import.meta.resolve('../../scripts/kit/run-tests.mts'))), 'node-reporter.mts'));
  const vitest = toolCommand({ tool: 'vitest', cwd: '/r', args: [] }, '/r');
  assert.deepEqual(vitest.args.slice(0, 3), ['/r/node_modules/vitest/vitest.mjs', 'run', `--reporter=${path.join(path.dirname(tool(import.meta.resolve('../../scripts/kit/run-tests.mts'))), 'vitest-reporter.mts')}`]);
  const playwrightRoot = tree(t, { 'node_modules/@playwright/test/cli.js': '' });
  const playwright = toolCommand({ tool: 'playwright', cwd: playwrightRoot, args: ['--config', 'tests/e2e/playwright.config.ts', 'tests/e2e/login.spec.ts'] }, playwrightRoot);
  assert.equal(playwright.command, process.execPath);
  assert.deepEqual(playwright.args, [path.join(playwrightRoot, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'tests/e2e/playwright.config.ts', 'tests/e2e/login.spec.ts', `--reporter=${path.join(path.dirname(tool(import.meta.resolve('../../scripts/kit/run-tests.mts'))), 'playwright-reporter.mts')}`]);
  const packageRoot = tree(t, { 'node_modules/playwright/cli.js': '', 'app/node_modules/@playwright/test/cli.js': '' });
  assert.equal(toolCommand({ tool: 'playwright', cwd: path.join(packageRoot, 'app'), args: [] }, packageRoot).args[0], path.join(packageRoot, 'app/node_modules/@playwright/test/cli.js'));
  assert.throws(() => toolCommand({ tool: 'playwright', cwd: '/r', args: [] }, '/r'), /project-local Playwright CLI does not exist; run make install/);
  assert.deepEqual(toolCommand({ tool: 'go', cwd: '/r', args: ['./...'] }, shims), { command: path.join(shims, 'var/tools/mise/shims/go'), args: ['test', '-json', './...'], build: ['test', '-exec=true', './...'] });
  assert.deepEqual(toolCommand({ tool: 'cargo', cwd: '/r', args: ['-p', 'x', '--', '--nocapture'] }, '/r').build, ['test', '--no-run', '-p', 'x']);
  assert.deepEqual(toolCommand({ tool: 'python', cwd: '/r', args: ['discover', '-s', 'tests'] }, shims), { command: path.join(shims, 'var/tools/mise/shims/python3'), args: ['-c', PYTHON_START, fileURLToPath(new URL('../../scripts/kit/runners/python.py', import.meta.url)), 'unittest', 'discover', '-s', 'tests', '-v'] });
});

// Composer gives the vendor directory of the PHPUnit (K184): its folder `vendor`, COMPOSER_VENDOR_DIR, or config.vendor-dir.
test('phpunit runs the PHPUnit of the vendor directory that Composer gives the project of --cwd', (t) => {
  const root = tree(t, { 'p/composer.json': '{}\n', 'q/composer.json': '{"config":{"vendor-dir":"lib/vendor"}}\n', 'var/tools/bin/php': '#!/bin/sh\n' });
  const p = path.join(root, 'p');
  assert.deepEqual(toolCommand({ tool: 'phpunit', cwd: p, args: ['t'] }, root), { command: path.join(p, 'vendor/bin/phpunit'), args: ['--teamcity', 't'] });
  assert.deepEqual(toolCommand({ tool: 'phpunit', cwd: p, args: [], phpExtensions: ['/r/e.so'] }, root).args.slice(0, 1), [path.join(p, 'vendor/bin/phpunit')]);
  // K900: the extensions load from the ini file of PHP_INI_SCAN_DIR, in the given order (K165), so no -d extension= is passed.
  assert.deepEqual(toolCommand({ tool: 'phpunit', cwd: p, args: ['t'], phpExtensions: ['/r/base.so', '/r/e.so'] }, root), { command: path.join(root, 'var/tools/bin/php'), args: [path.join(p, 'vendor/bin/phpunit'), '--teamcity', 't'] });
  assert.equal(toolCommand({ tool: 'phpunit', cwd: path.join(root, 'q'), args: [] }, root).command, path.join(root, 'q/lib/vendor/bin/phpunit'));
  t.after(() => { delete process.env.COMPOSER_VENDOR_DIR; });
  process.env.COMPOSER_VENDOR_DIR = '/elsewhere';
  assert.equal(toolCommand({ tool: 'phpunit', cwd: p, args: [] }, root).command, '/elsewhere/bin/phpunit');
});

// PHPUnit writes an error of its configuration to standard output, so a failed listing names it with its stderr and signal (K1149).
test('a failed PHPUnit listing names its standard output (K1149)', (t) => {
  const phpunit = '#!/bin/sh\necho \'PHPUnit 12: the XML configuration file has errors\'\necho \'see the line 3\' >&2\nexit 2\n';
  const root = tree(t, { 'composer.json': '{"config":{"vendor-dir":"vendor"}}\n', 'p/composer.json': '{}\n', 'vendor/bin/phpunit': phpunit, 'vendor/autoload.php': '' });
  chmodSync(path.join(root, 'vendor/bin/phpunit'), 0o755);
  composerStub(root);
  assert.throws(() => listedTests(['phpunit', '--cwd', path.join(root, 'p'), '--', 'tests/SmallTest.php'], root, { ...OUTSIDE }),
    (error: unknown) => error instanceof Error && error.message.includes('the XML configuration file has errors') && error.message.includes('see the line 3'));
});

// A probe that cannot start, or whose version run fails, names why (K1148).
test('probeExtensions names the error of the probe and the status of its version run (K1148)', (t) => {
  const root = tree(t, { 'php': '#!/bin/sh\ncase "$*" in *extension=*) echo \'Unable to load the module\' >&2; exit 1;; esac\necho \'the version run broke\' >&2\nexit 2\n' });
  chmodSync(path.join(root, 'php'), 0o755);
  const problem = probeExtensions([path.join(root, 'bad.so')], path.join(root, 'php')) ?? '';
  assert.match(problem, /Unable to load the module/);
  assert.match(problem, /the version run broke/);
  assert.match(problem, /exit status 2/);
  assert.match(probeExtensions([path.join(root, 'bad.so')], path.join(root, 'missing-php')) ?? '', /ENOENT/);
});

// A PHP extension run starts the PHP of the checkout, the wrapper of var/tools/bin that install-tools writes, else the php of PATH (K393, K947).
test('a phpunit run with a PHP extension starts the php of the checkout, else the php of PATH (K393, K947)', (t) => {
  const root = tree(t, { 'p/composer.json': '{}\n', 'var/tools/bin/php': '#!/bin/sh\n' });
  const p = path.join(root, 'p');
  assert.deepEqual(toolCommand({ tool: 'phpunit', cwd: p, args: [], phpExtensions: ['/r/e.so'] }, root).command, path.join(root, 'var/tools/bin/php'));
  const bare = tree(t, { 'p/composer.json': '{}\n' });
  assert.equal(toolCommand({ tool: 'phpunit', cwd: path.join(bare, 'p'), args: [], phpExtensions: ['/r/e.so'] }, bare).command, 'php');
});

function recorder() {
  const lines: string[] = [];
  const counts = (resultFile?: string) => createProgress({ write: (text: string) => lines.push(text), heartbeatMs: 10_000, resultFile });
  return { lines, counts };
}

test('the progress closes a run as failed when a test failed, a group failed, the tool failed, or nothing ran', (t) => {
  const { lines, counts } = recorder();
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'kit-progress-')), 'result.json');
  t.after(() => rmSync(path.dirname(file), { recursive: true, force: true }));
  const progress = counts(file);
  progress.start('a'); progress.pass('a', 10);
  progress.start('b'); progress.skip('b');
  const result = progress.close('suite');
  assert.deepEqual({ ...result, cases: undefined }, { passed: 1, failed: 0, skipped: 1, ran: 1, ok: false, cases: undefined });
  assert.match(lines.join('\n'), /skipped cases: b/, 'the run names the skipped case (K460)');
  assert.deepEqual(result.cases.map(({ id, status }) => [id, status]), [['a', 'pass'], ['b', 'skip']]);
  assert.equal(known(result.cases[0], 'result.cases[0]').elapsedMs, 10); // The cases are asserted above.
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), result);
  assert.match(known(lines.at(-1), 'lines.at(-1)'), /✖ suite: 1 passed, 0 failed, 1 skipped; skipped cases: b/); // close wrote its summary line, which names the skip (K460).

  const failing = counts();
  failing.start('x'); failing.fail('x', 5, 'boom\nmore');
  assert.equal(failing.close('suite').ok, false);
  assert.ok(lines.some(line => line.includes('           boom')));

  const group = counts();
  group.start('file', { group: true }); group.start('t'); group.pass('t', 1); group.fail('file', 1, 'hook failed');
  assert.equal(group.close('suite').ok, false);
  assert.match(known(lines.at(-1), 'lines.at(-1)'), /1 group failed/); // close wrote its summary line.

  const exiting = counts();
  exiting.start('t'); exiting.pass('t', 1);
  assert.equal(exiting.close('suite', { exitCode: 2 }).ok, false);
  assert.match(known(lines.at(-1), 'lines.at(-1)'), /the tool exited with 2 \(/); // close wrote its summary line.

  const empty = counts();
  empty.start('t'); empty.skip('t');
  assert.deepEqual([empty.close('suite').ok, known(lines.at(-1), 'lines.at(-1)').includes('no test ran')], [false, true]); // close wrote its summary line.

  const unfinished = counts();
  unfinished.start('hang');
  assert.equal(unfinished.close('suite').ok, false);
  assert.ok(lines.some(line => line.includes('the test did not finish')));
});

test('the go events print tests, show the output of a failing test, name build errors and skip a package without a test', () => {
  const lines: string[] = [];
  const progress = createProgress({ write: (text: string) => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const build: string[] = [];
  const feed = goEvents(toProgress(progress), build);
  for (const event of [
    { Action: 'start', Package: 'p' }, { Action: 'run', Package: 'p', Test: 'TestA' }, { Action: 'pass', Package: 'p', Test: 'TestA', Elapsed: 0.5 },
    { Action: 'run', Package: 'p', Test: 'TestB' }, { Action: 'output', Package: 'p', Test: 'TestB', Output: '    b_test.go:9: want 1 got 2\n' }, { Action: 'output', Package: 'p', Test: 'TestB', Output: '--- FAIL: TestB (0.00s)\n' }, { Action: 'fail', Package: 'p', Test: 'TestB', Elapsed: 0.1 },
    { Action: 'pass', Package: 'p', Elapsed: 0.6 },
    { Action: 'start', Package: 'empty' }, { Action: 'pass', Package: 'empty', Elapsed: 0 },
    { Action: 'build-output', ImportPath: 'bad', Output: '# bad\nbad.go:3:1: syntax error\n' }, { Action: 'build-fail', ImportPath: 'bad' },
  ]) feed(JSON.stringify(event));
  feed('not json');
  const text = lines.join('');
  assert.match(text, /✔ p › TestA \(0\.5s\)/);
  assert.match(text, /✖ p › TestB/);
  assert.match(text, /b_test\.go:9: want 1 got 2/);
  assert.doesNotMatch(text, /--- FAIL/);
  assert.match(text, /○ empty: package ran no test case/);
  assert.doesNotMatch(text, /empty skipped/);
  assert.match(text, /✖ build of bad failed/);
  assert.deepEqual(build, ['bad.go:3:1: syntax error']);
  assert.match(text, /not json/);
});

test('the cargo events pair each test with its result and name the binary', () => {
  const lines: string[] = [];
  const progress = createProgress({ write: (text: string) => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const events = cargoEvents(toProgress(progress));
  events.stderr('     Running unittests src/lib.rs (target/debug/deps/lib-1)');
  events.stdout('running 3 tests\ntest a ... ok\ntest b ... FAILED\ntest c ... ');
  events.stdout('ignored\n');
  const text = lines.join('');
  assert.match(text, /✔ src\/lib\.rs › a/);
  assert.match(text, /✖ src\/lib\.rs › b/);
  assert.match(text, /○ src\/lib\.rs › c skipped/);
  assert.equal(progress.close('cargo').ok, false);
});

// A sink that writes each call as `<method> <test id>`, so a test can read the outcome that a parser reports.
function recording() {
  const calls: string[] = [];
  const note = (method: string) => (test?: { id: string }) => calls.push(`${method} ${test?.id ?? ''}`.trim());
  return { calls, sink: { start: note('start'), pass: note('pass'), fail: note('fail'), skip: note('skip'), todo: note('todo'), line: () => {}, raw: () => {} } };
}

test('the cargo events read a should_panic test by its name and result (K47)', () => {
  const { calls, sink } = recording();
  const events = cargoEvents(sink);
  events.stderr('     Running tests/t.rs (target/debug/deps/t-1)');
  events.stdout('running 2 tests\ntest sym::panics - should panic ... ok\ntest sym::fails - should panic ... FAILED\n');
  assert.deepEqual(calls, ['start tests/t.rs › sym::panics', 'pass tests/t.rs › sym::panics', 'start tests/t.rs › sym::fails', 'fail tests/t.rs › sym::fails']);
});

test('the cargo events read the names that libtest-mimic pads to the longest one (K136)', () => {
  const { calls, sink } = recording();
  const events = cargoEvents(sink);
  events.stderr('     Running tests/cases.rs (target/debug/deps/cases-1)');
  // The output of libtest-mimic 0.8.2, the harness of a data-driven test (harness = false), which pads each name.
  events.stdout('\nrunning 2 tests\ntest tokens::a/b          ... ok\ntest tokens::longer/name    ');
  events.stdout('... FAILED\n');
  assert.deepEqual(calls, ['start tests/cases.rs › tokens::a/b', 'pass tests/cases.rs › tokens::a/b', 'start tests/cases.rs › tokens::longer/name', 'fail tests/cases.rs › tokens::longer/name']);
});

test('the python events report an expected failure as todo, which is no pass (K47)', () => {
  const { calls, sink } = recording();
  const feed = pythonEvents(sink);
  for (const [event, id] of [['start', 'test_known (tests.test_x.T.test_known)'], ['todo', 'test_known (tests.test_x.T.test_known)'], ['start', 'test_ok (tests.test_x.T.test_ok)'], ['pass', 'test_ok (tests.test_x.T.test_ok)']]) feed(JSON.stringify({ event, id }));
  assert.deepEqual(calls, ['start test_known (tests.test_x.T.test_known)', 'todo test_known (tests.test_x.T.test_known)', 'start test_ok (tests.test_x.T.test_ok)', 'pass test_ok (tests.test_x.T.test_ok)']);
});

test('the phpunit events of a skipped test pass it as skipped only, as PHPUnit reports it (K47)', () => {
  const { calls, sink } = recording();
  const feed = phpunitEvents(sink);
  // The TeamCity messages of PHPUnit 11.5 for a test that markTestSkipped: testIgnored, then testFinished.
  feed("##teamcity[testStarted name='test_skipped' locationHint='php_qn://php/tests/codec.php::\\Codec::test_skipped' flowId='1']");
  feed("##teamcity[testIgnored name='test_skipped' message='later' duration='1' flowId='1']");
  feed("##teamcity[testFinished name='test_skipped' duration='1' flowId='1']");
  assert.deepEqual(calls, ['start Codec::test_skipped', 'skip Codec::test_skipped']);
});

test('the phpunit events pair tests, join the failure messages and print other lines', () => {
  const lines: string[] = [];
  const progress = createProgress({ write: (text: string) => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const feed = phpunitEvents(toProgress(progress));
  const message = (name: string, attributes: Record<string, string>) => `##teamcity[${name} ${Object.entries(attributes).map(([key, value]) => `${key}='${value}'`).join(' ')}]`;
  feed(message('testSuiteStarted', { name: 'all' }));
  feed(message('testStarted', { name: 'testOk', locationHint: 'php_qn://x/FooTest.php::\\Pkg\\FooTest::testOk' }));
  feed(message('testFinished', { name: 'testOk', duration: '12' }));
  feed(message('testStarted', { name: 'testBad', locationHint: 'php_qn://x/FooTest.php::\\Pkg\\FooTest::testBad' }));
  feed(message('testFailed', { name: 'testBad', message: 'Failed asserting|n1 is 2', details: 'at FooTest.php:9' }));
  feed(message('testFinished', { name: 'testBad', duration: '3' }));
  feed(message('testSuiteFinished', { name: 'all' }));
  feed('Tests: 2, Warnings: 1.');
  const text = lines.join('');
  assert.match(text, /✔ Pkg\\FooTest::testOk/);
  assert.match(text, /✖ Pkg\\FooTest::testBad/);
  assert.match(text, /Failed asserting\n\s+1 is 2/);
  assert.match(text, /Tests: 2, Warnings: 1\./);
  assert.equal(progress.close('phpunit').ok, false);
});

test('the python events pair each test with its outcome and keep the text of a failure (K1194)', () => {
  const lines: string[] = [];
  const progress = createProgress({ write: (text: string) => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const feed = pythonEvents(toProgress(progress));
  const id = (name: string) => `${name} (tests.test_x.T.${name})`;
  const outcomes: [string, string, string?][] = [['test_a', 'pass'], ['test_b', 'fail', 'AssertionError: 1 != 2'], ['test_c', 'fail', 'ZeroDivisionError'], ['test_d', 'skip', 'later'], ['test_e', 'todo'], ['test_f', 'fail', 'unexpected success']];
  for (const [name, event, text] of outcomes) {
    feed(JSON.stringify({ event: 'start', id: id(name) }));
    feed(JSON.stringify({ event, id: id(name), ...(text === undefined ? {} : { text }) }));
  }
  const text = lines.join('');
  assert.match(text, /✔ test_a \(tests\.test_x\.T\.test_a\)/);
  assert.match(text, /✖ test_b \(tests\.test_x\.T\.test_b\)[^\n]*\n\s+AssertionError: 1 != 2/);
  assert.match(text, /✖ test_c \(tests\.test_x\.T\.test_c\)/);
  assert.match(text, /○ test_d \(tests\.test_x\.T\.test_d\) skipped/);
  assert.match(text, /✔ test_e \(tests\.test_x\.T\.test_e\)/);
  assert.match(text, /✖ test_f \(tests\.test_x\.T\.test_f\)/);
  assert.deepEqual(progress.counts, { passed: 2, failed: 3, skipped: 1 });
});

async function inProcess(t: TestContext, args: string[], { path: extraPath, root = tree(t) }: { path?: string; root?: string } = {}) {
  const lines: string[] = [];
  const previous = process.env.PATH;
  if (extraPath !== undefined) process.env.PATH = extraPath;
  try {
    return { status: await run(args, { root, write: (text: string) => lines.push(text) }), text: lines.join('') };
  } finally {
    process.env.PATH = previous;
  }
}

// The go of the checkout is the shim of mise in var/tools/mise/shims, which comes before the go of PATH (K393, K947), so a stub of go is written there.
// The shim builds nothing: run-tests calls it with -exec=true to build the tests before it runs them (K549-1).
function goShim(root: string, script: string) {
  const file = path.join(root, 'var/tools/mise/shims/go');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/usr/bin/env node\nif (process.argv.includes('-exec=true')) process.exit(0);\n${script}\n`);
  chmodSync(file, 0o755);
}

test('go tests run through the go shim of the checkout and pass', async (t) => {
  const events = [{ Action: 'start', Package: 'p' }, { Action: 'run', Package: 'p', Test: 'TestA' }, { Action: 'pass', Package: 'p', Test: 'TestA', Elapsed: 0 }, { Action: 'pass', Package: 'p', Elapsed: 0 }];
  const root = tree(t);
  goShim(root, `for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e));`);
  const result = await inProcess(t, ['go', './...'], { root });
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /✔ go \. \.\/\.\.\.: 1 passed/);
});

// A test whose binary ends without an outcome, as after os.Exit, fails with the output that it wrote (K1141).
test('a go test that never finished fails with its output, not only with the text that it did not finish (K1141)', async (t) => {
  const root = tree(t);
  goShim(root, `for (const e of [{ Action: 'start', Package: 'p' }, { Action: 'run', Package: 'p', Test: 'TestExit' }, { Action: 'output', Package: 'p', Test: 'TestExit', Output: '    exit_test.go:4: PROBE before os.Exit\\n' }]) console.log(JSON.stringify(e)); process.exit(1);`);
  const result = await inProcess(t, ['go', './...'], { root });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /✖ p › TestExit[^\n]*\n\s+the test did not finish before the output of go test ended\n\s+exit_test\.go:4: PROBE before os\.Exit/, result.text);
});

test('a go tool that reports no test fails the run', async (t) => {
  const root = tree(t);
  goShim(root, `console.log(JSON.stringify({ Action: 'start', Package: 'p' })); console.log(JSON.stringify({ Action: 'pass', Package: 'p', Elapsed: 0 }));`);
  const result = await inProcess(t, ['go', './...'], { root });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /no test ran/);
});

// A Composer project, whose vendor directory Composer gives run-tests for PHPUnit.
const COMPOSER_PROJECT = { 'composer.json': '{}\n', 'var/tools/bin/php': '#!/bin/sh\n' };

// A package of a Composer monorepo has no vendor directory of its own; the root project requires it through a path
// repository and installs one vendor directory, as for lint-php (K178, K186).
test('phpunit with --cwd of a package of a Composer monorepo runs the PHPUnit of the root project (K186)', async (t) => {
  const pass = "console.log(\"##teamcity[testStarted name='test_a' flowId='1']\"); console.log(\"##teamcity[testFinished name='test_a' duration='1' flowId='1']\");";
  const root = tree(t, { 'composer.json': '{}\n', 'vendor/bin/phpunit': `#!/usr/bin/env node\n${pass}\n`, 'packages/a/composer.json': '{}\n' });
  chmodSync(path.join(root, 'vendor/bin/phpunit'), 0o755);
  assert.equal(toolCommand({ tool: 'phpunit', cwd: path.join(root, 'packages/a'), args: [] }, root).command, path.join(root, 'vendor/bin/phpunit'));
  const result = await inProcess(t, ['phpunit', '--cwd', 'packages/a'], { root });
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /✔ phpunit packages\/a: 1 passed/);
});

// A Composer of the checkout that answers `config vendor-dir` from the composer.json of its folder and installs nothing (K367).
function composerStub(root: string) {
  const file = path.join(root, 'var/tools/mise/shims/composer');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "#!/usr/bin/env node\nconst fs = require('node:fs');\nif (process.argv.includes('vendor-dir')) console.log(JSON.parse(fs.readFileSync('composer.json', 'utf8')).config?.['vendor-dir'] ?? 'vendor');\n");
  chmodSync(file, 0o755);
}

test('a tool that cannot start fails with its command', async (t) => {
  // The go of the checkout cannot start: the run stops before it starts and names the command.
  const root = tree(t);
  const go = path.join(root, 'var/tools/mise/shims/go');
  mkdirSync(path.dirname(go), { recursive: true });
  writeFileSync(go, '#!/bin/sh\n');
  const started = await inProcess(t, ['go', './...'], { root });
  assert.notEqual(started.status, 0, started.text);
  assert.match(started.text, /var\/tools\/mise\/shims\/go/);
  // PHPUnit starts by its path in the vendor directory, so PATH does not matter for it.
  const phpunit = await inProcess(t, ['phpunit'], { root: tree(t, COMPOSER_PROJECT) });
  assert.match(phpunit.text, /cannot start .*vendor\/bin\/phpunit: .*; run composer install in \./);
});

test('a PHP extension that is not built fails before the tool starts', async (t) => {
  const result = await inProcess(t, ['phpunit', '--php-extension', 'build/ext.so'], { root: tree(t, COMPOSER_PROJECT) });
  assert.equal(result.status, 1);
  assert.match(result.text, /the PHP extension build\/ext\.so is not built; build it before the run/);
});

test('each PHP extension, the second as the first, that is not built fails before the tool starts (K165)', async (t) => {
  const root = tree(t, COMPOSER_PROJECT);
  mkdirSync(path.join(root, 'build'));
  writeFileSync(path.join(root, 'build/base.so'), '');
  const result = await inProcess(t, ['phpunit', '--php-extension', 'build/base.so', '--php-extension', 'build/ext.so'], { root });
  assert.equal(result.status, 1);
  assert.match(result.text, /the PHP extension build\/ext\.so is not built; build it before the run/);
  assert.doesNotMatch(result.text, /base\.so is not built|cannot start/);
  const first = await inProcess(t, ['phpunit', '--php-extension', 'build/missing.so', '--php-extension', 'build/base.so'], { root });
  assert.equal(first.status, 1);
  assert.match(first.text, /the PHP extension build\/missing\.so is not built; build it before the run/);
});

// K900: PHPUnit gives a child of #[RunTestsInSeparateProcesses] its own ini overrides only, so an extension of -d reaches the parent
// alone; an ini file of PHP_INI_SCAN_DIR, which a child inherits with the environment, loads it in both.
test('a phpunit run loads its PHP extensions in order through an ini file of PHP_INI_SCAN_DIR after PHP\'s own scan, without -d (K900)', async (t) => {
  const pass = "echo \"##teamcity[testStarted name='test_a' flowId='1']\"; echo \"##teamcity[testFinished name='test_a' duration='1' flowId='1']\"";
  const php = [
    '#!/bin/sh',
    'case "$*" in *" -r "*) exit 0;; esac',
    'case "$*" in *"extension="*) exit 3;; esac',
    'case "$PHP_INI_SCAN_DIR" in :*) ;; *) exit 4;; esac',
    'case "$(cat "${PHP_INI_SCAN_DIR#:}"/*.ini)" in *"extension="*"/build/base.so"*"extension="*"/build/ext.so"*) ;; *) exit 5;; esac',
    pass,
    '',
  ].join('\n');
  const root = tree(t, { ...COMPOSER_PROJECT, 'var/tools/bin/php': php, 'build/base.so': '', 'build/ext.so': '' });
  chmodSync(path.join(root, 'var/tools/bin/php'), 0o755);
  const result = await inProcess(t, ['phpunit', '--php-extension', 'build/base.so', '--php-extension', 'build/ext.so', 'tests/ATest.php'], { root });
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /1 passed/);
});

test('python tests run through var/tools/mise/shims/python3, pass and fail', async (t) => {
  const passing = pythonRoot(t, `process.stderr.write('Ran 1 test in 0.001s\\n\\nOK\\n'); ${passA}`);
  const passed = await inProcess(t, ['python', 'tests'], { root: passing });
  assert.equal(passed.status, 0, passed.text);
  assert.match(passed.text, /✔ python \. tests: 1 passed/);

  const failing = pythonRoot(t, `${writeEvents([['start', 'test_a (t.T.test_a)'], ['fail', 'test_a (t.T.test_a)']])} process.exitCode = 1;`);
  const failed = await inProcess(t, ['python', 'tests'], { root: failing });
  assert.equal(failed.status, 1, failed.text);
  assert.match(failed.text, /✖ test_a \(t\.T\.test_a\)/);

  const empty = pythonRoot(t, `process.stderr.write('\\n' + '-'.repeat(70) + '\\nRan 0 tests in 0.000s\\n\\nNO TESTS RAN\\n'); process.exitCode = 5;`);
  const none = await inProcess(t, ['python', 'tests'], { root: empty });
  assert.equal(none.status, 1, none.text);
  assert.match(none.text, /no test ran/);
});

// K1175: the python tool is python3 -m unittest -v, with no runner of kit. The stub is the python3 of the checkout that runs the
// real interpreter of PATH, so the fixture is a real unittest run.
test('a python run is unittest of the checkout Python, read as unittest prints it (K1175)', async (t) => {
  const root = checkout(t, { 'tests/__init__.py': '', 'tests/test_two.py': 'import unittest\n\n\nclass Two(unittest.TestCase):\n    def test_bad(self):\n        self.assertEqual(1, 2)\n\n    def test_fine(self):\n        pass\n' });
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const stub = path.join(root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(stub), { recursive: true });
  writeFileSync(stub, `#!/bin/sh\nexec '${python}' "$@"\n`);
  chmodSync(stub, 0o755);
  const result = await inProcess(t, ['python', 'discover'], { root });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /✖ test_bad \(tests\.test_two\.Two\.test_bad\)/);
  assert.match(result.text, /✔ test_fine \(tests\.test_two\.Two\.test_fine\)/);
  assert.match(result.text, /✖ python \. discover: 1 passed, 1 failed, 0 skipped/);
});

// K1194: the counts come from the result events of unittest, not from its verbose lines. A test that writes to standard error
// without a line end, as the message of a Rust panic in a binding test does, joins its line to the outcome of the test; the run
// still counts that test, as unittest does.
test('a python test that writes to standard error without a line end is counted as unittest counts it (K1194)', async (t) => {
  const root = checkout(t, { 'tests/__init__.py': '', 'tests/test_panic.py': 'import sys\nimport unittest\n\n\nclass Panic(unittest.TestCase):\n    def test_panic(self):\n        sys.stderr.write("thread panicked at src/lib.rs:1:1: boom")\n\n    def test_quiet(self):\n        pass\n' });
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const stub = path.join(root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(stub), { recursive: true });
  writeFileSync(stub, `#!/bin/sh\nexec '${python}' "$@"\n`);
  chmodSync(stub, 0o755);
  const result = await inProcess(t, ['python', 'discover'], { root });
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /✔ python \. discover: 2 passed, 0 failed, 0 skipped/);
  assert.match(result.text, /thread panicked at src\/lib\.rs:1:1: boom/, 'the standard error of the test is printed as it is');
});

// A stopped tool leaves no process (K141): the runner starts the tool in its own process group and stops the whole group when
// the runner itself is interrupted or loses its parent. The hanging stub starts a grandchild, as the mise shim starts the
// interpreter, and records both pids in a file of its own directory; t.after kills every recorded pid that is still alive, so a
// failing case leaves no orphan.
function hangingPython(t: TestContext) {
  const log = mkdtempSync(path.join(tmpdir(), 'kit-pids-'));
  const pids = path.join(log, 'pids');
  t.after(() => {
    for (const pid of recorded(pids)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        // A process that has ended is gone (ESRCH); any other failure of the kill fails the test.
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    }
    rmSync(log, { recursive: true, force: true });
  });
  const root = pythonRoot(t, [
    "const { spawn } = process.getBuiltinModule('node:child_process');",
    "const { appendFileSync } = process.getBuiltinModule('node:fs');",
    "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'inherit' });",
    `appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n' + grandchild.pid + '\\n');`,
    `${writeEvents([['start', 'test_hang (t.T.test_hang)']])} setInterval(() => {}, 1000);`,
  ].join('\n'));
  return { root, pids };
}
const recorded = (pids: string) => (existsSync(pids) ? readFileSync(pids, 'utf8').split('\n').filter(Boolean).map(Number) : []);
// A process is alive while ps lists it and it is not a zombie that its new parent has yet to reap.
const alive = (pid: number) => {
  const listed = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return listed.status === 0 && !listed.stdout.trim().startsWith('Z');
};

test('an interrupted runner stops the whole process group of the tool and ends on its signal (K141)', { timeout: 30_000 }, async (t) => {
  const { root, pids } = hangingPython(t);
  const child = spawn(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'python', 'tests'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], env: { ...OUTSIDE } });
  t.after(() => child.kill('SIGKILL'));
  // The runner prints the start of the test after the stub recorded its pids.
  child.stdout.setEncoding('utf8').on('data', (text: string) => { if (text.includes('▶ test_hang')) child.kill('SIGTERM'); });
  const [status, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => child.once('close', (code: number | null, closed: NodeJS.Signals | null) => resolve([code, closed])));
  assert.deepEqual({ status, signal }, { status: null, signal: 'SIGTERM' });
  const started = recorded(pids);
  assert.equal(started.length, 2, `expected the stub and its grandchild, actual pids ${started.join(' ')}`);
  assert.deepEqual(started.filter(alive), [], 'expected no process of the stopped group alive');
});

// K437: the runner whose parent is killed stops its process group. Only the lost parent can stop the stub, and the group must be
// gone within 2 s and the grace of the stop (5 s).
test('run-tests stops its process group when its parent is killed (K437)', { timeout: 60_000 }, async (t) => {
  const { root, pids } = hangingPython(t);
  const parentFile = path.join(root, 'parent.mjs');
  writeFileSync(parentFile, `const { spawn } = process.getBuiltinModule('node:child_process');\nspawn(process.execPath, [${JSON.stringify(tool(import.meta.resolve('../../scripts/kit/run-tests.mts')))}, 'python', 'tests'], { cwd: ${JSON.stringify(root)}, stdio: 'inherit' });\nsetInterval(() => {}, 1000);\n`);
  const parent = spawn(process.execPath, [parentFile], { cwd: root, env: { ...OUTSIDE }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => parent.kill('SIGKILL'));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the runner never started the test')), 20_000);
    parent.stdout.setEncoding('utf8').on('data', (text: string) => { if (text.includes('▶ test_hang')) { clearTimeout(timer); resolve(); } });
  });
  parent.kill('SIGKILL');
  const started = recorded(pids);
  assert.equal(started.length, 2, `expected the stub and its grandchild, actual pids ${started.join(' ')}`);
  const until = Date.now() + 2000 + 5000;
  while (started.some(alive) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(started.filter(alive), [], 'expected no process of the group alive after 2 s and the grace');
});

// K460: a skipped test is not a verification. The run with one passing and one skipped test fails and names the skipped case, and
// the run with only skipped tests fails too.
test('a run with a skipped test fails and names each skipped case (K460)', { timeout: 60_000 }, (t) => {
  const root = checkout(t, { 'tests/skip.test.mjs': `${SPEC}test('runs and passes', () => {});\ntest('is skipped for now', { skip: 'not yet' }, () => {});\n` });
  const result = runner(root, ['node', '--', 'tests/skip.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /1 passed, 0 failed, 1 skipped; skipped cases: [^\n]*is skipped for now/);
});

// A virtual environment of the checkout's Python (K37): pyvenv.cfg names the bin of a Python under var/tools/mise as its home and
// bin/python is a stub that prints unittest output; `home` overrides the named home.
function venvRoot(t: TestContext, { home }: { home?: string } = {}) {
  const root = tree(t);
  mkdirSync(path.join(root, 'var/tools/mise/installs/python/3.14.8/bin'), { recursive: true });
  const venv = path.join(root, 'pkg/.venv');
  mkdirSync(path.join(venv, 'bin'), { recursive: true });
  writeFileSync(path.join(venv, 'pyvenv.cfg'), `home = ${home ?? path.join(root, 'var/tools/mise/installs/python/3.14.8/bin')}\nversion = 3.14.8\n`);
  writeFileSync(path.join(venv, 'bin/python'), `#!/usr/bin/env node\n${passA}\n`);
  chmodSync(path.join(venv, 'bin/python'), 0o755);
  return root;
}

// A harness module (`python -m <module> discover ...`) runs the tests through unittest's own verbose output, which the python
// reader counts; run-tests runs it in place of `-m unittest` (K219).
test('python tests run through a harness module named by --module, and its cases are counted (K219)', async (t) => {
  assert.equal(parseArguments(['python', '--module', 'pkg.harness', 'discover'], '/repo').module, 'pkg.harness');
  assert.deepEqual(toolCommand({ tool: 'python', cwd: '/r', args: ['discover'], module: 'pkg.harness' }, tree(t, { 'var/tools/mise/shims/python3': '' })).args.slice(3), ['pkg.harness', 'discover', '-v']);
  assert.throws(() => parseArguments(['node', '--module', 'pkg.harness'], '/repo'), /Usage: node/);
  // The stub answers only the harness command; any other command of python3 ends with no case, so the run fails.
  const root = pythonRoot(t, `if (process.argv[5] !== 'pkg.harness') { process.exitCode = 2; } else { ${writeEvents([['start', 'test_a (pkg.t.T.test_a)'], ['pass', 'test_a (pkg.t.T.test_a)'], ['start', 'test_b (pkg.t.T.test_b)'], ['pass', 'test_b (pkg.t.T.test_b)']])} }`);
  const harness = await inProcess(t, ['python', '--module', 'pkg.harness', 'discover', 'tests'], { root });
  assert.equal(harness.status, 0, harness.text);
  assert.match(harness.text, /✔ python \. discover tests: 2 passed, 0 failed/);
  const plain = await inProcess(t, ['python', 'discover', 'tests'], { root });
  assert.equal(plain.status, 1, plain.text);
  assert.match(plain.text, /no test ran/);
});

test('--venv runs the python tests with the interpreter of a virtual environment of the checkout Python (K37)', async (t) => {
  assert.equal(parseArguments(['python', '--venv', 'pkg/.venv', 'discover'], '/repo').venv, '/repo/pkg/.venv');
  assert.throws(() => parseArguments(['node', '--venv', 'pkg/.venv'], '/repo'), /Usage:/);
  assert.equal(toolCommand({ tool: 'python', cwd: '/r', args: [], venv: '/r/pkg/.venv' }, '/r').command, '/r/pkg/.venv/bin/python');
  const root = venvRoot(t);
  const passed = await inProcess(t, ['python', '--venv', 'pkg/.venv', 'tests'], { root });
  assert.equal(passed.status, 0, passed.text);
  assert.match(passed.text, /✔ python \. tests: 1 passed/);
});

// The links of an environment are the behavior of the tool that made it, such as uv's bin/python3 -> python (K63): run-tests
// accepts them and leaves them as they are.
test('--venv accepts an environment with the symbolic links of the tool that made it, and keeps them (K63)', async (t) => {
  const linked = venvRoot(t);
  symlinkSync('python', path.join(linked, 'pkg/.venv/bin/python3'));
  const withLink = await inProcess(t, ['python', '--venv', 'pkg/.venv', 'tests'], { root: linked });
  assert.equal(withLink.status, 0, withLink.text);
  assert.match(withLink.text, /✔ python \. tests: 1 passed/);
  assert.equal(readlinkSync(path.join(linked, 'pkg/.venv/bin/python3')), 'python', 'the link is kept as it was made');
});

test('inputsDigest hashes the tracked and new non-ignored files under the paths and fails on a path without files', (t) => {
  const root = tree(t, { 'pkg/a.txt': 'a', 'pkg/out/ignored.txt': 'x', 'schema/s.dbs': 's', 'other.txt': 'o', '.gitignore': 'pkg/out/\n' });
  const first = inputsDigest(root, ['pkg', 'schema/s.dbs']);
  assert.match(first, /^[0-9a-f]{64}$/);
  put(root, { 'pkg/out/ignored.txt': 'y', 'other.txt': 'p' });
  assert.equal(inputsDigest(root, ['pkg', 'schema/s.dbs']), first, 'ignored files and files outside the paths do not count');
  put(root, { 'pkg/a.txt': 'b' });
  assert.notEqual(inputsDigest(root, ['pkg', 'schema/s.dbs']), first);
  put(root, { 'pkg/new.txt': 'n' });
  const withNew = inputsDigest(root, ['pkg', 'schema/s.dbs']);
  put(root, { 'pkg/new.txt': null });
  assert.notEqual(inputsDigest(root, ['pkg', 'schema/s.dbs']), withNew);
  assert.throws(() => inputsDigest(root, ['missing']), /--inputs missing names no tracked or new file/);
});

test('inputsDigest treats the root selector as all tracked and new non-ignored files (K687)', (t) => {
  const root = checkout(t, { '.gitignore': 'var/\n', 'tracked.txt': 'tracked\n', 'new.txt': 'new\n' });
  const staged = spawnSync('git', ['add', 'tracked.txt'], { cwd: root, encoding: 'utf8' });
  assert.equal(staged.status, 0, staged.stderr);
  const first = inputsDigest(root, ['.']);
  assert.equal(first, inputsDigest(root, ['.gitignore', 'tracked.txt', 'new.txt']));
  assert.equal(inputsDigest(root, ['./']), first);
  mkdirSync(path.join(root, 'var'));
  writeFileSync(path.join(root, 'var/ignored.txt'), 'ignored output');
  assert.equal(inputsDigest(root, ['.']), first, 'ignored outputs are excluded');
  writeFileSync(path.join(root, 'new.txt'), 'changed new input');
  assert.notEqual(inputsDigest(root, ['.']), first, 'new non-ignored inputs are included');
  assert.throws(() => inputsDigest(root, ['missing']), /--inputs missing names no tracked or new file/);
});

test('selected CLI --results defaults to root inputs and writes a passing report (K687)', (t) => {
  const root = checkout(t, { '.gitignore': 'var/\n', 'tests/selected.test.mjs': `${SPEC}test('selected', () => {});\n` });
  const result = runner(root, ['node', '--results', 'var/report/selected.json', '--', 'tests/selected.test.mjs']);
  assert.equal(result.status, 0, output(result));
  const report = readStub(path.join(root, 'var/report/selected.json'), RESULTS);
  assert.equal(report.ok, true);
  assert.equal(report.tool, 'node');
  assert.deepEqual(report.inputs, { paths: ['.'], digest: inputsDigest(root, ['.']) });
  assert.deepEqual(report.cases.map(({ id, status }) => [id, status]), [['tests/selected.test.mjs › selected', 'pass']]);
});

test('--results writes the cases, the tool, the inputs and the elapsed time of a passing and of a failing run', async (t) => {
  const root = tree(t, { 'pkg/a_test.go': 'package a' });
  const events = [{ Action: 'start', Package: 'p' }, { Action: 'run', Package: 'p', Test: 'TestA' }, { Action: 'pass', Package: 'p', Test: 'TestA', Elapsed: 0.25 },
    { Action: 'run', Package: 'p', Test: 'TestB' }, { Action: 'fail', Package: 'p', Test: 'TestB', Elapsed: 0.5 }, { Action: 'fail', Package: 'p', Elapsed: 1 }];
  goShim(root, `for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e)); process.exitCode = 1;`);
  const result = await inProcess(t, ['go', '--results', '.results/go.json', '--cwd', 'pkg', './...'], { root });
  assert.equal(result.status, 1, result.text);
  const record = readStub(path.join(root, '.results/go.json'), RESULTS);
  assert.deepEqual(record.cases, [{ id: 'p › TestA', status: 'pass', elapsedMs: 250 }, { id: 'p › TestB', status: 'fail', elapsedMs: 500 }]);
  assert.deepEqual([record.tool, record.inputs?.paths, record.inputs?.digest, record.ok], ['go', ['pkg'], inputsDigest(root, ['pkg']), false]);
  assert.equal(typeof record.elapsedMs, 'number');
});

test('--results records the cases of node tests, which the reporter counts in its own process', (t) => {
  const root = checkout(t, { 'tests/a.test.mjs': `${SPEC}test('adds', () => {});\ntest('later', { skip: true }, () => {});\n` });
  const result = runner(root, ['node', '--results', '.results/node.json', '--inputs', 'tests', '--', 'tests/a.test.mjs']);
  // A skipped case fails the run (K460); the record still holds each case with its status.
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /skipped cases: tests\/a\.test\.mjs › later/);
  const record = readStub(path.join(root, '.results/node.json'), RESULTS);
  assert.deepEqual(record.cases.map(({ id, status }) => [id, status]), [['tests/a.test.mjs › adds', 'pass'], ['tests/a.test.mjs › later', 'skip']]);
  assert.equal(record.tool, 'node');
});

test('under --cwd a node file group is not a test case, and its ids name the file from the checkout root', async (t) => {
  const root = checkout(t, { 'pkg/tests/a.test.mjs': `${SPEC}test('adds', () => {});\ntest('subtracts', () => {});\n` });
  const result = await runInProcess(root, ['node', '--cwd', 'pkg', '--results', '.results/node.json', '--', 'tests']);
  assert.equal(result.status, 0, output(result));
  const record = readStub(path.join(root, '.results/node.json'), RESULTS);
  assert.deepEqual(record.cases.map(({ id, status }) => [id, status]), [['pkg/tests/a.test.mjs › adds', 'pass'], ['pkg/tests/a.test.mjs › subtracts', 'pass']]);
});

test('a node file of 89 tests reports every test when the reporter reads its events late', (t) => {
  const tests = Array.from({ length: 89 }, (_, index) => `test('case ${index}', () => {});`).join('\n');
  const root = checkout(t, { 'tests/many.test.mjs': `${SPEC}${tests}\n` });
  // The reporter spends 5 ms on each event, so the reports queue up while the file's process ends. The runner takes the
  // reporter beside its own module, so this test runs a copy of the tools whose reporter it slows down. The copy lies in
  // var/ of this checkout (ignored by Git), where Node.js finds the dependencies of kit in its node_modules.
  const tools = path.join(KIT, `../../var/test-slow-reporter-${process.pid}`);
  t.after(() => rmSync(tools, { recursive: true, force: true }));
  cpSync(KIT, path.join(tools, 'scripts/kit'), { recursive: true });
  const reporter = path.join(tools, 'scripts/kit/node-reporter.mts');
  const source = readFileSync(reporter, 'utf8');
  const lagged = source.replace('const { type, data } = event;', 'const { type, data } = event;\n    for (const end = Date.now() + 5; Date.now() < end;);');
  assert.notEqual(lagged, source);
  writeFileSync(reporter, lagged);
  const result = spawnSync(process.execPath, [path.join(tools, 'scripts/kit/run-tests.mts'), 'node', '--', 'tests/many.test.mjs'], { cwd: root, encoding: 'utf8', env: OUTSIDE });
  assert.equal(result.status, 0, output(result));
  assert.equal(result.stdout.match(/✔ tests\/many\.test\.mjs › case \d+ /g)?.length, 89, output(result));
  assert.match(result.stdout, /✔ node --test: 89 passed, 0 failed, 0 skipped/);
});

test('python tests are counted from their events whatever the color of the verbose lines (K1194)', (t) => {
  // A stub of python3 that colors its verbose lines as Python 3.14 does under FORCE_COLOR, unless PYTHON_COLORS is 0.
  const root = checkout(t, { 'tests/t.py': '' });
  pythonStub(root, `
const colored = process.env.FORCE_COLOR && process.env.PYTHON_COLORS !== '0';
const ok = colored ? '\\x1b[32mok\\x1b[0m' : 'ok';
process.stderr.write('test_a (t.T.test_a) ... ' + ok + '\\n');
${passA}`);
  const colored = runner(root, ['python', 'tests'], { FORCE_COLOR: '3', PYTHON_COLORS: '0' });
  assert.equal(colored.status, 0, output(colored));
  assert.match(colored.stdout, /✔ test_a \(t\.T\.test_a\)/);
  assert.match(colored.stdout, /1 passed, 0 failed/);
});

// K1053: kit refuses no run; a run without a selection runs the whole directory wherever it starts.
test('a run without a selection runs its tool outside CI (K1053)', async (t) => {
  const root = tree(t, { 'tests/one.test.mjs': "import test from 'node:test';\ntest('one', () => {});\n" });
  // The child reporter writes to the process, so the recorded results show that the file ran.
  const result = await runInProcess(root, ['node', '--results', 'var/report/all.json', '--', 'tests']);
  assert.equal(result.status, 0, output(result));
  const record = readStub(path.join(root, 'var/report/all.json'), RESULTS);
  assert.deepEqual(record.cases.map(({ id, status }) => [id, status]), [['tests/one.test.mjs › one', 'pass']]);
});

// K411 started the tools with the mise environment of the checkout; since K1093 and K1094 the run passes the environment of its
// caller through, also in a shell that runs no make and has no MISE_* variable.
test('run-tests passes the environment of its caller through, also outside make (K411, K1093, K1094)', (t) => {
  // The fixture writes the state dir, the global config file and the first PATH entry, one per line.
  const fixture = "import { writeFileSync } from 'node:fs';\ntest('env', () => { writeFileSync('seen.txt', [process.env.MISE_STATE_DIR, process.env.MISE_GLOBAL_CONFIG_FILE, process.env.PATH.split(':')[0]].join('\\n')); });\n";
  const root = checkout(t, { 'tests/env.test.mjs': `${SPEC}${fixture}` });
  const env: NodeJS.ProcessEnv = { ...OUTSIDE };
  for (const name of Object.keys(env)) if (name.startsWith('MISE_')) delete env[name];
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--', 'tests/env.test.mjs'], { cwd: root, encoding: 'utf8', env });
  assert.equal(result.status, 0, output(result));
  const real = realpathSync(root);
  const [state, config, first] = readFileSync(path.join(real, 'seen.txt'), 'utf8').split('\n');
  assert.equal(state, '', 'no MISE_STATE_DIR of its own');
  assert.equal(config, '', 'no MISE_GLOBAL_CONFIG_FILE of its own');
  assert.equal(first, (env.PATH ?? '').split(':')[0], 'the PATH of the caller, with nothing put before it');
});

// The tools of the checkout are the wrapper of var/tools/bin or the shim of mise, else the tool of PATH by its name (K947).
test('the tools of kit are taken from the checkout, else from PATH (K393-1, K947)', (t) => {
  const root = tree(t);
  const wrapper = path.join(root, 'var/tools/bin/npm');
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, '#!/bin/sh\n');
  assert.equal(checkoutTool(root, 'npm'), wrapper);
  const shim = path.join(root, 'var/tools/mise/shims/go');
  mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(shim, '#!/bin/sh\n');
  assert.equal(checkoutTool(root, 'go'), shim);
  // A tool that the checkout lacks is the one on PATH, by its bare name (K947).
  const other = tree(t);
  const onPath = mkdtempSync(path.join(tmpdir(), 'kit-path-'));
  t.after(() => rmSync(onPath, { recursive: true, force: true }));
  writeFileSync(path.join(onPath, 'uv'), '#!/bin/sh\n');
  chmodSync(path.join(onPath, 'uv'), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${onPath}${path.delimiter}${previous ?? ''}`;
  try {
    assert.equal(checkoutTool(other, 'uv'), 'uv');
  } finally {
    process.env.PATH = previous;
  }
});

// K452: an extension run gives PHPUnit the configuration of the package, so the bootstrap that it names is loaded as in the library run.
test('an extension run gives PHPUnit the package configuration so its bootstrap loads (K452)', (t) => {
const withConfig = tree(t, { 'p/composer.json': '{}\n', 'p/phpunit.xml.dist': '<phpunit bootstrap="tests/bootstrap.php"/>\n', 'var/tools/bin/php': '#!/bin/sh\n' });
const configured = toolCommand({ tool: 'phpunit', cwd: path.join(withConfig, 'p'), args: [], phpExtensions: ['/r/e.so'] }, withConfig);
assert.ok(configured.args.includes('--configuration'), `the extension run passes no configuration: ${configured.args.join(' ')}`);
});

// K452-1: each --php-extension is probed before PHPUnit starts; one built for another PHP names its .so path, the API it was built
// for, and the running PHP, instead of testing the library silently on the wrong PHP.
test('a PHP extension built for another PHP fails the probe naming its path, its build and the running PHP (K452-1)', (t) => {
  const root = tree(t, {
    'php': '#!/bin/sh\ncase "$*" in\n  *bad.so*) echo "PHP Warning: Module compiled with module API=20230831" >&2; echo "PHP    compiled with module API=20240924" >&2; exit 1 ;;\nesac\necho "8.4.1 20240924"\n',
  });
  const php = path.join(root, 'php');
  chmodSync(php, 0o755);
  assert.equal(probeExtensions([path.join(root, 'good.so')], php), undefined);
  const problem = probeExtensions([path.join(root, 'bad.so')], php);
  assert.ok(problem, 'a mismatched extension must fail the probe');
  assert.match(problem, /bad\.so/);
  assert.match(problem, /20230831/);
  assert.match(problem, /8\.4\.1/);
  assert.match(problem, /20240924/);
});

test('Cargo build and test keep the CARGO_TARGET_DIR of the environment and the native CLI arguments (K1049)', async (t) => {
  const root = tree(t);
  const binary = path.join(root, 'bin/cargo');
  const log = path.join(root, 'cargo-environments.jsonl');
  const explicit = path.join(root, 'explicit-target');
  put(root, { 'bin/cargo': `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, target: process.env.CARGO_TARGET_DIR ?? null }) + '\\n');\nif (!args.includes('--no-run')) {\n  process.stderr.write('     Running unittests src/lib.rs (target/debug/deps/lib-1)\\n');\n  process.stdout.write('running 1 test\\ntest selected_case ... ok\\n\\ntest result: ok. 1 passed; 0 failed; 0 ignored\\n');\n}\n` });
  chmodSync(binary, 0o755);
  const inherited = process.env.CARGO_TARGET_DIR;
  process.env.CARGO_TARGET_DIR = path.join(root, '../other/target');
  try {
    const result = await inProcess(t, ['cargo', '--', '--target-dir', explicit, 'selected_case'], { root, path: `${path.dirname(binary)}${path.delimiter}${process.env.PATH ?? ''}` });
    assert.equal(result.status, 0, result.text);
    const calls: unknown[] = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as unknown);
    assert.equal(calls.length, 2, 'the compile step and requested test both run');
    for (const call of calls) {
      assert.ok(typeof call === 'object' && call !== null && 'args' in call && Array.isArray(call.args) && 'target' in call);
      assert.equal(call.target, path.join(root, '../other/target'));
      assert.equal(call.args[call.args.indexOf('--target-dir') + 1], explicit);
    }
  } finally {
    if (inherited === undefined) delete process.env.CARGO_TARGET_DIR;
    else process.env.CARGO_TARGET_DIR = inherited;
  }
});

// K1094: the runner adds no runner flag and no environment of its own; the caller passes them.
test('K1094: run-tests sets the runner flags and the environment of a run only as the caller passes them', (t) => {
  const shims = tree(t, { 'var/tools/mise/shims/go': '' });
  const node = toolCommand({ tool: 'node', cwd: '/r', args: ['a'] }, '/r');
  assert.ok(!node.args.some(arg => arg.startsWith('--test-timeout') || arg.startsWith('--test-concurrency')), node.args.join(' '));
  assert.ok(!toolCommand({ tool: 'vitest', cwd: '/r', args: [] }, '/r').args.some(arg => /Timeout/.test(arg)));
  const playwrightRoot = tree(t, { 'node_modules/@playwright/test/cli.js': '' });
  assert.ok(!toolCommand({ tool: 'playwright', cwd: playwrightRoot, args: [] }, playwrightRoot).args.some(arg => arg.startsWith('--timeout')));
  assert.deepEqual(toolCommand({ tool: 'go', cwd: '/r', args: ['./...'] }, shims).args, ['test', '-json', './...']);
  assert.deepEqual(toolCommand({ tool: 'cargo', cwd: '/r', args: ['-p', 'x', '--', '--nocapture'] }, '/r').args, ['test', '-p', 'x', '--', '--nocapture']);
  // A stub of python3 that records the variables of its environment and reports one passing test.
  const root = checkout(t, { 'tests/t.py': '' });
  const seen = path.join(root, 'seen.json');
  pythonStub(root, `
const names = ['PYTHONUNBUFFERED', 'NO_COLOR', 'PYTHON_COLORS', 'NODE_TEST_CONTEXT'];
require('node:fs').writeFileSync(process.env.SEEN, JSON.stringify(Object.fromEntries(names.map(name => [name, process.env[name] ?? null]))));
${passA}`);
  const { PYTHONUNBUFFERED: _unbuffered, NO_COLOR: _noColor, PYTHON_COLORS: _colors, ...inherited } = process.env;
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'python', 'tests'], { cwd: root, encoding: 'utf8', env: { ...inherited, SEEN: seen, NODE_TEST_CONTEXT: 'child-v8' } });
  assert.equal(result.status, 0, output(result));
  assert.deepEqual(JSON.parse(readFileSync(seen, 'utf8')), { PYTHONUNBUFFERED: null, NO_COLOR: null, PYTHON_COLORS: null, NODE_TEST_CONTEXT: 'child-v8' });
});

// An error inside PHPUnit, here a test file that does not parse, ends PHPUnit with 255 after its Message: and Location:
// lines; the summary states that exit status and no guess at the output above it (K1172).
test('K1172: the summary of a run that exits non-zero states the exit status and no guess at the lines of the tool', { skip: process.platform === 'win32' ? 'the PHPUnit of the fixture runs through a POSIX symlink' : false, timeout: 60_000 }, (t) => {
  const vendor = path.resolve(KIT, '../../var/tools/phpunit/vendor');
  assert.ok(existsSync(path.join(vendor, 'bin/phpunit')), `${vendor}/bin/phpunit is missing; make install-tools installs PHPUnit`);
  const root = checkout(t, {
    'composer.json': '{"name": "fixture/internal-error"}\n',
    'phpunit.xml': '<phpunit><testsuites><testsuite name="t"><directory>tests</directory></testsuite></testsuites></phpunit>\n',
    'tests/ATest.php': '<?php\nfinal class ATest extends PHPUnit\\Framework\\TestCase {\n    public function testA(): void { $x = ; }\n}\n',
  });
  symlinkSync(vendor, path.join(root, 'vendor'));
  const result = runner(root, ['phpunit', '--cwd', root]);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout, /\bMessage: +syntax error/, output(result));
  const summary = known(result.stdout.trimEnd().split('\n').findLast((line) => line.includes('the tool exited with')), 'the summary line');
  assert.match(summary, /the tool exited with 255 \(\d/, output(result));
});

// K1175: kit sets no time limit on a run. A go test that runs past the old default of 30 s per test runs to its end, and the
// run passes or fails by the exit status of the tool alone.
test('a test that runs past 30 s, to 40 s, runs to its end, and the exit status of the tool decides the run (K1175)', async (t) => {
  const events = [{ Action: 'start', Package: 'p' }, { Action: 'run', Package: 'p', Test: 'TestSlow' }];
  const end = [{ Action: 'pass', Package: 'p', Test: 'TestSlow', Elapsed: 40 }, { Action: 'pass', Package: 'p', Elapsed: 40 }];
  const slow = (exit: number) => {
    const root = tree(t);
    goShim(root, `for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e));\nsetTimeout(() => { for (const e of ${JSON.stringify(end)}) console.log(JSON.stringify(e)); process.exitCode = ${exit}; }, 40_000);`);
    return inProcess(t, ['go', './...'], { root });
  };
  const [passed, failed] = await Promise.all([slow(0), slow(1)]);
  assert.equal(passed.status, 0, passed.text);
  assert.match(passed.text, /✔ p › TestSlow/);
  assert.match(passed.text, /✔ go \. \.\/\.\.\.: 1 passed, 0 failed/);
  assert.doesNotMatch(passed.text, /⏱|timeout/);
  assert.equal(failed.status, 1, failed.text);
  assert.match(failed.text, /✔ p › TestSlow/);
  assert.match(failed.text, /✖ go \. \.\/\.\.\.: 1 passed, 0 failed, .*the tool exited with 1/);
  assert.doesNotMatch(failed.text, /⏱|timeout/);
});
