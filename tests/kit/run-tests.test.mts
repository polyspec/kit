// Tests of scripts/kit/run-tests.mts and its progress reporters: the progress lines, the per-test timeout, the failing run
// without a test, the file that registers no test or registers it late, and the parsers of the output of go, cargo and
// PHPUnit. The runs use fixture test files in a temporary checkout and stubs of the tools on PATH; nothing needs a network.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { parseArguments, PYTHON_START, run, toolCommand } from '../../scripts/kit/run-tests.mts';
import { libraryTestRun } from '../../scripts/kit/php-library-autoload.mts';
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
// The tests of the runner's mechanics run whole directories, which only a CI run may do (ci-only.mts).
const CI = { GITHUB_ACTIONS: 'true' };
const runner = (root: string, args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...CI, ...env } });
const output = (result: { stdout: string; stderr: string }) => result.stdout + result.stderr;
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
  assert.match(result.stdout, /▶ node \. tests\/a\.test\.mjs \(each test 30s\)/);
  assert.match(result.stdout, /▶ tests\/a\.test\.mjs › adds/);
  assert.match(result.stdout, /✔ tests\/a\.test\.mjs › adds \(\d+\.\ds\)/);
  assert.match(result.stdout, /✔ tests\/a\.test\.mjs › group › inner/);
  assert.match(result.stdout, /✔ node --test: 3 passed, 0 failed, 0 timed out, 0 skipped/);
});

test('a directory runs the test files below it', (t) => {
  const root = checkout(t, { 'tests/one/a.test.mjs': `${SPEC}test('a', () => {});\n`, 'tests/one/b.test.mjs': `${SPEC}test('b', () => {});\n` });
  const result = runner(root, ['node', 'tests/one']);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /2 passed/);
});

test('a failing test prints its failure and exits 1', (t) => {
  const root = checkout(t, { 'tests/a.test.mjs': `${SPEC}test('breaks', () => { throw new Error('expected 1, actual 2'); });\ntest('fine', () => {});\n` });
  const result = runner(root, ['node', '--', 'tests/a.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout, /✖ tests\/a\.test\.mjs › breaks/);
  assert.match(result.stdout, /expected 1, actual 2/);
  assert.match(result.stdout, /✔ tests\/a\.test\.mjs › fine/);
});

// The test never resolves, so only the runner's timeout ends it. The deadline of this test is far above the expected stop.
test('a test that outlives --timeout fails, and the run has no other limit', { timeout: 100_000 }, (t) => {
  const root = checkout(t, { 'tests/a.test.mjs': `${SPEC}test('slow', async () => { await new Promise(() => {}); });\n` });
  const result = runner(root, ['node', '--timeout', '1', '--', 'tests/a.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout, /\(each test 1s\)/);
  assert.match(result.stdout, /✖ tests\/a\.test\.mjs › slow/);
  assert.match(result.stdout, /timed out after 1000ms/);
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
  assert.match(none.stdout, /no test ran: expected at least 1 test that passes, fails or runs out of time, actual 0/);
  const skipped = runner(root, ['node', '--', 'tests/skip.test.mjs']);
  assert.equal(skipped.status, 1, output(skipped));
  assert.match(skipped.stdout, /no test ran: expected at least 1 test that passes, fails or runs out of time, actual 0 \(1 skipped\)/);
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
  assert.match(result.stdout, /✔ node --test: 2 passed, 0 failed, 0 timed out, 0 skipped/);
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

// A test that leaves a handle open keeps its file's process alive after its last test. The file fails after the deadline
// and names what holds it, instead of hanging the run (K72).
test('a file whose process outlives its last test fails after the deadline and names its open handles', (t) => {
  const root = checkout(t, { 'tests/leak.test.mjs': `${SPEC}test('leaks a timer', () => { setInterval(() => {}, 1000); });\n` });
  const started = Date.now();
  const result = runner(root, ['node', '--timeout', '2', '--', 'tests/leak.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /did not exit 2000 ms after its last test; it holds [^\n]*Timeout/);
  assert.ok(Date.now() - started < 30_000, 'the deadline ended the file');
});

// K437: a test that awaits a promise that never settles is ended at the deadline, and the failure names it.
test('a node test that awaits a promise that never settles is ended past the deadline and named (K437)', (t) => {
  const root = checkout(t, { 'tests/stuck.test.mjs': `${SPEC}test('never settles', async () => { await new Promise(() => {}); });\n` });
  const result = runner(root, ['node', '--timeout', '1', '--', 'tests/stuck.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout, /✖ tests\/stuck\.test\.mjs › never settles/);
  assert.match(result.stdout, /timed out after 1000ms/);
});

// K437: the file's own code awaits a promise that never settles while a handle keeps its process alive. No test ever starts,
// so the deadline that starts after the last test never does. The run ends the file at its deadline with one of two messages:
// the gap watch of run-tests (K371-1), which runs at the same deadline and reports it first, or the file-side watch of
// test-exit-deadline, which names the deadline in milliseconds (K437-1).
test('a node file whose top-level await never settles, with a live handle, is ended past the deadline (K437-1)', { timeout: 60_000 }, (t) => {
  const root = checkout(t, { 'tests/pending.test.mjs': `${SPEC}setInterval(() => {}, 1000);\nawait new Promise(() => {});\ntest('late', () => {});\n` });
  const began = Date.now();
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '2', '--', 'tests/pending.test.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, ...CI }, timeout: 30_000 });
  const elapsed = Date.now() - began;
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /⏱ node \. tests\/pending\.test\.mjs: no test started (within 2 s after the start of the run|or ended within 2000 ms of the process start)/);
  assert.match(output(result), /✖ tests\/pending\.test\.mjs/);
  assert.ok(elapsed < 15_000, `the run took ${elapsed} ms, expected the end at the 2 s deadline`);
});

// K437: a handle that a test leaves open is still ended at the deadline, and the failure names it (K72 covers it).
test('a node test that leaves a socket open is ended past the deadline and the socket is named (K437)', (t) => {
  const root = checkout(t, { 'tests/leak.test.mjs': `${SPEC}test('leaks a socket', async () => { const { createServer } = await import('node:net'); createServer().listen(0); });\n` });
  const result = runner(root, ['node', '--timeout', '1', '--', 'tests/leak.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /did not exit 1000 ms after its last test; it holds [^\n]*TCPServerWrap/);
});

test('the arguments of the runner are read before the arguments of the tool', () => {
  const options = parseArguments(['node', '--timeout', '5', '--cwd', 'sub', '--', 'a.test.mjs', '--x'], '/repo');
  assert.deepEqual([options.tool, options.timeoutSeconds, options.cwd, options.args], ['node', 5, '/repo/sub', ['a.test.mjs', '--x']]);
  assert.deepEqual(parseArguments(['phpunit', '--php-extension', 'ext.so'], '/repo').phpExtensions, ['/repo/ext.so']);
  assert.deepEqual(parseArguments(['phpunit', '--php-extension', 'base.so', '--php-extension', 'ext.so', 't'], '/repo').phpExtensions, ['/repo/base.so', '/repo/ext.so']);
  assert.equal(parseArguments(['go', './...'], '/repo').args[0], './...');
  assert.deepEqual(parseArguments(['python', '--cwd', 'pkg', 'tests'], '/repo').args, ['tests']);
  const recorded = parseArguments(['go', '--results', '.results/go.json', '--inputs', 'pkg', '--inputs', 'schema/a.dbs', './...'], '/repo');
  assert.deepEqual([recorded.results, recorded.inputs, recorded.args], ['/repo/.results/go.json', ['pkg', 'schema/a.dbs'], ['./...']]);
  assert.deepEqual(parseArguments(['go', '--results', 'r.json', '--cwd', 'pkg'], '/repo').inputs, ['pkg']);
  assert.throws(() => parseArguments(['go', '--inputs', 'pkg'], '/repo'), /--inputs needs --results/);
  for (const bad of [[], ['ruby'], ['go', '--results'], ['node', '--timeout', '0'], ['node', '--timeout', 'x'], ['node', '--php-extension', 'x'], ['node', '--cwd']]) {
    assert.throws(() => parseArguments(bad, '/repo'), /Usage: node scripts\/kit\/run-tests\.mts <node\|vitest\|go\|cargo\|phpunit\|python>/, JSON.stringify(bad));
  }
});

test('each tool starts with its progress and timeout arguments and no limit on a whole run', (t) => {
  const shims = tree(t, { 'var/tools/mise/shims/go': '', 'var/tools/mise/shims/python3': '' });
  const node = toolCommand({ tool: 'node', timeoutSeconds: 7, cwd: '/r', args: ['a'] }, '/r');
  assert.ok(node.args.includes('--test-timeout=7000') && !node.args.includes('--test-force-exit') && node.args.at(-1) === 'a');
  assert.ok(node.args.some(arg => arg.startsWith('--test-reporter=') && arg.endsWith('scripts/kit/node-reporter.mts')));
  assert.ok(node.args.some(arg => arg.startsWith('--import=file://') && arg.endsWith('scripts/kit/test-exit-deadline.mts?ms=7000')));
  const vitest = toolCommand({ tool: 'vitest', timeoutSeconds: 7, cwd: '/r', args: [] }, '/r');
  assert.deepEqual(vitest.args.slice(0, 4), ['/r/node_modules/vitest/vitest.mjs', 'run', '--testTimeout=7000', '--hookTimeout=7000']);
  assert.deepEqual(toolCommand({ tool: 'go', timeoutSeconds: 7, cwd: '/r', args: ['./...'] }, shims), { command: path.join(shims, 'var/tools/mise/shims/go'), args: ['test', '-json', '-count=1', '-timeout=0', './...'] });
  assert.deepEqual(toolCommand({ tool: 'cargo', timeoutSeconds: 7, cwd: '/r', args: ['-p', 'x', '--', '--nocapture'] }, '/r').args, ['test', '-p', 'x', '--', '--test-threads=1', '--nocapture']);
  assert.deepEqual(toolCommand({ tool: 'python', timeoutSeconds: 7, cwd: '/r', args: ['discover', '-s', 'tests'] }, shims), { command: path.join(shims, 'var/tools/mise/shims/python3'), args: ['-c', PYTHON_START, tool(import.meta.resolve('../../scripts/kit/runners/python.py')), '--timeout', '7', 'discover', '-s', 'tests', '-v'] });
});

// Composer gives the vendor directory of the PHPUnit (K184): its folder `vendor`, COMPOSER_VENDOR_DIR, or config.vendor-dir.
test('phpunit runs the PHPUnit of the vendor directory that Composer gives the project of --cwd', (t) => {
  const root = tree(t, { 'p/composer.json': '{}\n', 'q/composer.json': '{"config":{"vendor-dir":"lib/vendor"}}\n', 'var/tools/bin/php': '#!/bin/sh\n' });
  const p = path.join(root, 'p');
  assert.deepEqual(toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: p, args: ['t'] }, root), { command: path.join(p, 'vendor/bin/phpunit'), args: ['--teamcity', 't'] });
  assert.deepEqual(toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: p, args: [], phpExtensions: ['/r/e.so'] }, root).args.slice(0, 3), ['-d', 'extension=/r/e.so', path.join(p, 'vendor/bin/phpunit')]);
  // K165: each extension is loaded with its own -d extension=, in the given order, so one can depend on an earlier one.
  assert.deepEqual(toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: p, args: ['t'], phpExtensions: ['/r/base.so', '/r/e.so'] }, root), { command: path.join(root, 'var/tools/bin/php'), args: ['-d', 'extension=/r/base.so', '-d', 'extension=/r/e.so', path.join(p, 'vendor/bin/phpunit'), '--teamcity', 't'] });
  assert.equal(toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: path.join(root, 'q'), args: [] }, root).command, path.join(root, 'q/lib/vendor/bin/phpunit'));
  t.after(() => { delete process.env.COMPOSER_VENDOR_DIR; });
  process.env.COMPOSER_VENDOR_DIR = '/elsewhere';
  assert.equal(toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: p, args: [] }, root).command, '/elsewhere/bin/phpunit');
});

// A PHP extension run starts the PHP of the checkout, the wrapper of var/tools/bin that install-tools writes, never the php of PATH (K393).
test('a phpunit run with a PHP extension starts the php of the checkout, and fails without it (K393)', (t) => {
  const root = tree(t, { 'p/composer.json': '{}\n', 'var/tools/bin/php': '#!/bin/sh\n' });
  const p = path.join(root, 'p');
  assert.deepEqual(toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: p, args: [], phpExtensions: ['/r/e.so'] }, root).command, path.join(root, 'var/tools/bin/php'));
  const bare = tree(t, { 'p/composer.json': '{}\n' });
  assert.throws(() => toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: path.join(bare, 'p'), args: [], phpExtensions: ['/r/e.so'] }, bare), /\/var\/tools\/bin\/php does not exist; run make install/);
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
  assert.deepEqual({ ...result, cases: undefined }, { passed: 1, failed: 0, skipped: 1, timedOut: 0, ran: 1, ok: false, cases: undefined });
  assert.match(lines.join('\n'), /skipped cases: b/, 'the run names the skipped case (K460)');
  assert.deepEqual(result.cases.map(({ id, status }) => [id, status]), [['a', 'pass'], ['b', 'skip']]);
  assert.equal(known(result.cases[0], 'result.cases[0]').elapsedMs, 10); // The cases are asserted above.
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), result);
  assert.match(known(lines.at(-1), 'lines.at(-1)'), /✖ suite: 1 passed, 0 failed, 0 timed out, 1 skipped; skipped cases: b/); // close wrote its summary line, which names the skip (K460).

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
  assert.equal(exiting.close('suite', { exitCode: 2, errors: ['error: link failed'] }).ok, false);
  assert.match(known(lines.at(-1), 'lines.at(-1)'), /the tool exited with 2: error: link failed/); // close wrote its summary line.

  const empty = counts();
  empty.start('t'); empty.skip('t');
  assert.deepEqual([empty.close('suite').ok, known(lines.at(-1), 'lines.at(-1)').includes('no test ran')], [false, true]); // close wrote its summary line.

  const unfinished = counts();
  unfinished.start('hang');
  assert.equal(unfinished.close('suite').ok, false);
  assert.ok(lines.some(line => line.includes('the test did not finish')));
});

// The heartbeat and the clock are driven by the test: the heartbeat at 20 ms prints the still-running line, and the
// heartbeat at 60 ms, past the 50 ms timeout, stops the test. A real timer made the outcome depend on the load of the machine.
test('the progress reports a test that outlives its timeout', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = 0;
  const lines: string[] = [];
  const stopped: string[] = [];
  const progress = createProgress({ write: (text: string) => lines.push(text), heartbeatMs: 20, timeoutMs: 50, onTimeout: (id: string) => stopped.push(id), command: 'tool run', now: () => clock });
  progress.start('slow');
  clock = 20;
  t.mock.timers.tick(20);
  assert.ok(lines.some(line => line.includes('… slow still running')), lines.join(''));
  clock = 60;
  t.mock.timers.tick(40);
  assert.deepEqual(stopped, ['slow']);
  progress.fail('slow', undefined, 'stopped');
  assert.ok(lines.some(line => /⏱ slow ran \d\.\ds and exceeded its 0\.1s timeout; stopping `tool run`/.test(line)), lines.join(''));
  assert.ok(lines.some(line => line.includes('… slow still running')));
  const closed = progress.close('suite');
  assert.equal(closed.timedOut, 1);
  assert.deepEqual(closed.cases.map(({ id, status }) => [id, status]), [['slow', 'timeout']]);
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
  assert.match(text, /○ empty skipped/);
  assert.match(text, /○ empty: ran no test case/);
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
  pythonEvents(sink)('test_known (tests.test_x.T.test_known) ... expected failure\ntest_ok (tests.test_x.T.test_ok) ... ok\n');
  assert.deepEqual(calls, ['start test_known (tests.test_x.T.test_known)', 'todo test_known (tests.test_x.T.test_known)', 'start test_ok (tests.test_x.T.test_ok)', 'pass test_ok (tests.test_x.T.test_ok)']);
});

test('the phpunit events of a skipped test pass it as skipped only, as PHPUnit reports it (K47)', () => {
  const { calls, sink } = recording();
  const feed = phpunitEvents(sink);
  // The TeamCity messages of PHPUnit 11.5 for a test that markTestSkipped: testIgnored, then testFinished.
  feed("##teamcity[testStarted name='test_skipped' locationHint='php_qn://php/tests/codec.php::\\\\Codec::test_skipped' flowId='1']");
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
  assert.match(text, /✔ FooTest::testOk/);
  assert.match(text, /✖ FooTest::testBad/);
  assert.match(text, /Failed asserting\n\s+1 is 2/);
  assert.match(text, /Tests: 2, Warnings: 1\./);
  assert.equal(progress.close('phpunit').ok, false);
});

test('the python events pair each test with its outcome, keep the description id over a docstring line and print other lines', () => {
  const lines: string[] = [];
  const progress = createProgress({ write: (text: string) => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const feed = pythonEvents(toProgress(progress));
  feed('test_a (tests.test_x.T.test_a) ... ok\n');
  feed('test_b (tests.test_x.T.test_b) ... ');
  feed('FAIL\n');
  feed('test_c (tests.test_x.T.test_c) ... ERROR\ntest_d (tests.test_x.T.test_d) ... skipped \'later\'\n');
  feed('test_e (tests.test_x.T.test_e) ... expected failure\ntest_f (tests.test_x.T.test_f) ... unexpected success\n');
  feed('test_g (tests.test_x.T.test_g)\nChecks the docstring. ... ok\n');
  feed('======================================================================\nFAIL: test_b (tests.test_x.T.test_b)\nAssertionError: 1 != 2\n');
  const text = lines.join('');
  assert.match(text, /✔ test_a \(tests\.test_x\.T\.test_a\)/);
  assert.match(text, /✖ test_b \(tests\.test_x\.T\.test_b\)/);
  assert.match(text, /✖ test_c \(tests\.test_x\.T\.test_c\)/);
  assert.match(text, /○ test_d \(tests\.test_x\.T\.test_d\) skipped/);
  assert.match(text, /✔ test_e \(tests\.test_x\.T\.test_e\)/);
  assert.match(text, /✖ test_f \(tests\.test_x\.T\.test_f\)/);
  assert.match(text, /✔ test_g \(tests\.test_x\.T\.test_g\)/);
  assert.doesNotMatch(text, /✔ Checks the docstring/);
  assert.match(text, /AssertionError: 1 != 2/);
  assert.deepEqual(progress.counts, { passed: 3, failed: 3, skipped: 1, timedOut: 0 });
});

async function inProcess(t: TestContext, args: string[], { path: extraPath, root = tree(t) }: { path?: string; root?: string } = {}) {
  const lines: string[] = [];
  const previous = process.env.PATH;
  if (extraPath !== undefined) process.env.PATH = extraPath;
  try {
    return { status: await run(args, { root, write: (text: string) => lines.push(text), callerEnv: CI }), text: lines.join('') };
  } finally {
    process.env.PATH = previous;
  }
}

// The go of the checkout is the shim of mise in var/tools/mise/shims, never the go of PATH (K393), so a stub of go is written there.
function goShim(root: string, script: string) {
  const file = path.join(root, 'var/tools/mise/shims/go');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/usr/bin/env node\n${script}\n`);
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

test('a go tool that reports no test fails the run', async (t) => {
  const root = tree(t);
  goShim(root, `console.log(JSON.stringify({ Action: 'start', Package: 'p' })); console.log(JSON.stringify({ Action: 'pass', Package: 'p', Elapsed: 0 }));`);
  const result = await inProcess(t, ['go', './...'], { root });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /no test ran/);
});

test('a go test that outlives the timeout stops the tool and fails the run', async (t) => {
  const root = tree(t);
  goShim(root, `console.log(JSON.stringify({ Action: 'start', Package: 'p' })); console.log(JSON.stringify({ Action: 'run', Package: 'p', Test: 'TestHang' })); setInterval(() => {}, 1000);`);
  const result = await inProcess(t, ['go', '--timeout', '1', './...'], { root });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /⏱ p › TestHang ran \d\.\ds and exceeded its 1\.0s timeout; stopping `[^`]*var\/tools\/mise\/shims\/go test -json`/);
});

// A Composer project, whose vendor directory Composer gives run-tests for PHPUnit.
const COMPOSER_PROJECT = { 'composer.json': '{}\n', 'var/tools/bin/php': '#!/bin/sh\n' };

// A package of a Composer monorepo has no vendor directory of its own; the root project requires it through a path
// repository and installs one vendor directory, as for parity and lint-php (K178, K186).
test('phpunit with --cwd of a package of a Composer monorepo runs the PHPUnit of the root project (K186)', async (t) => {
  const pass = "console.log(\"##teamcity[testStarted name='test_a' flowId='1']\"); console.log(\"##teamcity[testFinished name='test_a' duration='1' flowId='1']\");";
  const root = tree(t, { 'composer.json': '{}\n', 'vendor/bin/phpunit': `#!/usr/bin/env node\n${pass}\n`, 'packages/a/composer.json': '{}\n' });
  chmodSync(path.join(root, 'vendor/bin/phpunit'), 0o755);
  assert.equal(toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: path.join(root, 'packages/a'), args: [] }, root).command, path.join(root, 'vendor/bin/phpunit'));
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

// The library of a Composer monorepo has no vendor directory; its root project installs one at its vendor-dir (K367).
test('the library run of test-php-ext takes PHPUnit from the vendor-dir of the root project that installs the library (K367)', (t) => {
  const root = tree(t, {
    'composer.json': '{"repositories":[{"type":"path","url":"packages/php"}],"config":{"vendor-dir":"vendor-php"}}\n',
    'packages/php/composer.json': '{}\n',
    'vendor-php/phpunit/phpunit/phpunit': '#!/usr/bin/env node\n',
    'vendor-php/composer/installed.json': '{"packages":[]}\n',
  });
  composerStub(root);
  const library = libraryTestRun(root, 'packages/php');
  assert.equal(library.phpunit, path.join(root, 'vendor-php/phpunit/phpunit/phpunit'));
});

test('a tool that cannot start fails with its command and the fix', async (t) => {
  // The go of the checkout is missing from var/tools/mise/shims: the run stops before it starts, and PATH is not searched (K393).
  await assert.rejects(inProcess(t, ['go', './...']), /go of the checkout is missing \(var\/tools\/bin\/go, var\/tools\/mise\/shims\/go\); run make install/);
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

// The hanging stub keeps a live timer and never ends on its own, so only the runner's timeout stops it. The deadline of this
// test is far above the expected stop.
test('python tests run through var/tools/mise/shims/python3, pass, fail and stop at their timeout', { timeout: 100_000 }, async (t) => {
  const passing = pythonRoot(t, `process.stderr.write('test_a (t.T.test_a) ... ok\\n\\n' + '-'.repeat(70) + '\\nRan 1 test in 0.001s\\n\\nOK\\n');`);
  const passed = await inProcess(t, ['python', 'tests'], { root: passing });
  assert.equal(passed.status, 0, passed.text);
  assert.match(passed.text, /✔ python \. tests: 1 passed/);

  const failing = pythonRoot(t, `process.stderr.write('test_a (t.T.test_a) ... FAIL\\n'); process.exitCode = 1;`);
  const failed = await inProcess(t, ['python', 'tests'], { root: failing });
  assert.equal(failed.status, 1, failed.text);
  assert.match(failed.text, /✖ test_a \(t\.T\.test_a\)/);

  const hanging = pythonRoot(t, `process.stderr.write('test_hang (t.T.test_hang) ... '); setInterval(() => {}, 1000);`);
  const hung = await inProcess(t, ['python', '--timeout', '1', 'tests'], { root: hanging });
  assert.equal(hung.status, 1, hung.text);
  assert.match(hung.text, /⏱ test_hang \(t\.T\.test_hang\) ran [\d.]+s and exceeded its 1\.0s timeout; stopping `[^`]*var\/tools\/mise\/shims\/python3 -c import runpy[^`]*`/);

  const empty = pythonRoot(t, `process.stderr.write('\\n' + '-'.repeat(70) + '\\nRan 0 tests in 0.000s\\n\\nNO TESTS RAN\\n'); process.exitCode = 5;`);
  const none = await inProcess(t, ['python', 'tests'], { root: empty });
  assert.equal(none.status, 1, none.text);
  assert.match(none.text, /no test ran/);
});

// The timeout of a unittest test is the runner's own (runners/python.py, K371): the slow test fails with its timeout well before its
// sleep ends, the test that passes prints its elapsed time, and the run counts one failure and one pass. The stub is the python3
// of the checkout; it runs the real interpreter of PATH, so the fixture is a real unittest run.
test('a python test that outlives its timeout fails with its timeout, and each test prints its elapsed time (K371)', { timeout: 60_000 }, async (t) => {
  const root = checkout(t, { 'tests/__init__.py': '', 'tests/test_clock.py': 'import time\nimport unittest\n\n\nclass Clock(unittest.TestCase):\n    def test_slow(self):\n        time.sleep(5)\n\n    def test_fast(self):\n        pass\n' });
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const stub = path.join(root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(stub), { recursive: true });
  writeFileSync(stub, `#!/bin/sh\nexec '${python}' "$@"\n`);
  chmodSync(stub, 0o755);
  const began = Date.now();
  const result = await inProcess(t, ['python', '--timeout', '1', 'discover'], { root });
  const elapsed = Date.now() - began;
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /✖ test_slow \(tests\.test_clock\.Clock\.test_slow\)/);
  assert.match(result.text, /the test outlived its timeout of 1s/);
  assert.match(result.text, /✔ test_fast \(tests\.test_clock\.Clock\.test_fast\) \(\d+\.\d+s\)/);
  assert.match(result.text, /✖ python \. discover: 1 passed, 1 failed/);
  assert.ok(elapsed < 4000, `the run took ${elapsed} ms, expected the timeout before the 5 s sleep`);
});

// K371-1: every interval without a test event is bounded by the per-test timeout, not only a running test. The stub is the python3
// of the checkout that runs the real interpreter of PATH, so each fixture is a real unittest run.
function realPython(root: string) {
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const stub = path.join(root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(stub), { recursive: true });
  writeFileSync(stub, `#!/bin/sh\nexec '${python}' "$@"\n`);
  chmodSync(stub, 0o755);
  return root;
}

// The import of the module sleeps past the timeout, before the first test starts: the run stops the tool at the timeout.
test('a python bootstrap that outlives the timeout stops the tool and names the start of the run (K371-1)', { timeout: 60_000 }, async (t) => {
  const root = realPython(checkout(t, { 'tests/__init__.py': '', 'tests/test_boot.py': 'import time\nimport unittest\n\ntime.sleep(5)\n\n\nclass Boot(unittest.TestCase):\n    def test_pass(self):\n        pass\n' }));
  const began = Date.now();
  const result = await inProcess(t, ['python', '--timeout', '1', 'discover'], { root });
  const elapsed = Date.now() - began;
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /⏱ no test started within 1 s after the start of the run; the run elapsed [\d.]+s; stopping `[^`]*var\/tools\/mise\/shims\/python3 -c import runpy/);
  assert.match(result.text, /✖ python \. discover: 0 passed, 0 failed, 1 timed out/);
  assert.ok(elapsed < 4000, `the run took ${elapsed} ms, expected the timeout before the 5 s sleep`);
});

// The setUpClass of the second class sleeps past the timeout after the first test has ended: the gap names that test.
test('a python gap between two tests that outlives the timeout names the end of the test before it (K371-1)', { timeout: 60_000 }, async (t) => {
  const root = realPython(checkout(t, { 'tests/__init__.py': '', 'tests/test_gap.py': 'import time\nimport unittest\n\n\nclass First(unittest.TestCase):\n    def test_a(self):\n        pass\n\n\nclass Second(unittest.TestCase):\n    @classmethod\n    def setUpClass(cls):\n        time.sleep(5)\n\n    def test_b(self):\n        pass\n' }));
  const began = Date.now();
  const result = await inProcess(t, ['python', '--timeout', '1', 'discover'], { root });
  const elapsed = Date.now() - began;
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /✔ test_a \(tests\.test_gap\.First\.test_a\)/);
  assert.match(result.text, /⏱ no test started within 1 s after the end of test_a \(tests\.test_gap\.First\.test_a\); the run elapsed [\d.]+s; stopping `/);
  assert.match(result.text, /✖ python \. discover: 1 passed, 0 failed, 1 timed out/);
  assert.ok(elapsed < 4000, `the run took ${elapsed} ms, expected the timeout before the 5 s sleep`);
});

// A go package whose build or bootstrap outlives the timeout emits its first event after the sleep: the gap stops go before it.
test('a go bootstrap that outlives the timeout stops the tool before its first event (K371-1)', { timeout: 60_000 }, async (t) => {
  const root = tree(t);
  const events = [{ Action: 'start', Package: 'p' }, { Action: 'run', Package: 'p', Test: 'TestA' }, { Action: 'pass', Package: 'p', Test: 'TestA', Elapsed: 0 }, { Action: 'pass', Package: 'p', Elapsed: 0 }];
  goShim(root, `setTimeout(() => { for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e)); }, 5000);`);
  const began = Date.now();
  const result = await inProcess(t, ['go', '--timeout', '1', './...'], { root });
  const elapsed = Date.now() - began;
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /⏱ no test started within 1 s after the start of the run; the run elapsed [\d.]+s; stopping `[^`]*var\/tools\/mise\/shims\/go test -json`/);
  assert.match(result.text, /✖ go \. \.\/\.\.\.: 0 passed, 0 failed, 1 timed out/);
  assert.ok(elapsed < 4000, `the run took ${elapsed} ms, expected the timeout before the 5 s sleep`);
});

// The gap watch is armed at the start of the run and after each test ends, and a test start disarms it: a running test has the
// per-test timeout instead. The module is imported in the test, so only this test fails before the module exists.
test('the gap watch arms at the start of the run and after a test ends, and a test start disarms it (K371-1)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return import('../../scripts/kit/test-gap.mts').then(({ createGap, parseTestEvent }) => {
    const expired: string[] = [];
    const gap = createGap({ timeoutMs: 1000, onExpire: last => expired.push(last) });
    t.mock.timers.tick(999);
    assert.deepEqual<string[]>(expired, []);
    t.mock.timers.tick(1);
    assert.deepEqual<string[]>(expired, ['the start of the run']);
    const second = createGap({ timeoutMs: 1000, onExpire: last => expired.push(last) });
    second.event({ kind: 'start', id: 'a' });
    t.mock.timers.tick(5000);
    assert.deepEqual<string[]>(expired, ['the start of the run'], 'a running test is bounded by its own timeout');
    second.event({ kind: 'end', id: 'a' });
    t.mock.timers.tick(999);
    assert.deepEqual<string[]>(expired, ['the start of the run']);
    t.mock.timers.tick(1);
    assert.deepEqual<string[]>(expired, ['the start of the run', 'the end of a']);
    gap.close();
    second.close();
    assert.deepEqual(parseTestEvent('{"kind":"end","id":"a"}'), { kind: 'end', id: 'a' });
    assert.throws(() => parseTestEvent('{"kind":"pass","id":"a"}'), /test event/);
  });
});

// K371-1-1: a node file that never reports a test and never yields to its event loop. The file-side watch of test-exit-deadline runs in
// that file's own thread, so it cannot end it; only the gap watch of the runner can. The file's own 20 s loop bounds the fixture: on a
// base without the gap watch the run ends after 20 s, so the deadline of this test is far above the expected stop.
test('a node file that never reports a test and never yields is stopped by the gap watch (K371-1-1)', { timeout: 60_000 }, (t) => {
  const root = checkout(t, { 'tests/busy.test.mjs': 'const end = Date.now() + 20000;\nwhile (Date.now() < end) {}\n' });
  const began = Date.now();
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '2', '--', 'tests/busy.test.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, ...CI }, timeout: 40_000 });
  const elapsed = Date.now() - began;
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /⏱ node \. tests\/busy\.test\.mjs: no test started within 2 s after the start of the run; the run elapsed [\d.]+s; stopping `[^`]*node --test/);
  assert.ok(elapsed < 10_000, `the run took ${elapsed} ms, expected the gap stop at 2 s, not the file's 20 s loop`);
});

// A file that holds a handle and never reports a test is ended by the gap watch at its timeout, with or without a name pattern that
// matches no test. The preload of the file and the gap watch both expire at the same time, so either message may name the stop.
test('a node file that holds a handle and never reports a test is ended at its timeout (K371-1-1)', { timeout: 60_000 }, (t) => {
  const root = checkout(t, { 'tests/hold.test.mjs': "import net from 'node:net';\nnet.createServer().listen(0);\n", 'tests/idle.test.mjs': 'setInterval(() => {}, 1000);\n' });
  const stop = /no test started (?:within 2 s after the start of the run|or ended within 2000 ms of the process start)/;
  for (const args of [['--', 'tests/hold.test.mjs'], ['--', '--test-name-pattern', 'nomatch', 'tests/idle.test.mjs']]) {
    const began = Date.now();
    const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--timeout', '2', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...CI }, timeout: 40_000 });
    const elapsed = Date.now() - began;
    assert.equal(result.status, 1, output(result));
    assert.match(output(result), stop, output(result));
    assert.ok(elapsed < 10_000, `${args.join(' ')} took ${elapsed} ms, expected the stop at 2 s`);
  }
});

// A stopped tool leaves no process (K141): the runner starts the tool in its own process group and stops the whole group, at a
// timeout and when the runner itself is interrupted. The hanging stub starts a grandchild, as the mise shim starts the
// interpreter, and records both pids in a file of its own directory; t.after kills every recorded pid that is still alive, so a
// failing case leaves no orphan.
function hangingPython(t: TestContext, { ignoreTerm = false } = {}) {
  const log = mkdtempSync(path.join(tmpdir(), 'kit-pids-'));
  const pids = path.join(log, 'pids');
  t.after(() => {
    for (const pid of recorded(pids)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* the process has ended */ }
    }
    rmSync(log, { recursive: true, force: true });
  });
  const ignore = ignoreTerm ? "process.on('SIGTERM', () => {});" : '';
  const root = pythonRoot(t, [
    "const { spawn } = process.getBuiltinModule('node:child_process');",
    "const { appendFileSync } = process.getBuiltinModule('node:fs');",
    `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(`${ignore} setInterval(() => {}, 1000);`)}], { stdio: 'inherit' });`,
    `appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n' + grandchild.pid + '\\n');`,
    ignore,
    "process.stderr.write('test_hang (t.T.test_hang) ... '); setInterval(() => {}, 1000);",
  ].join('\n'));
  return { root, pids };
}
const recorded = (pids: string) => (existsSync(pids) ? readFileSync(pids, 'utf8').split('\n').filter(Boolean).map(Number) : []);
// A process is alive while ps lists it and it is not a zombie that its new parent has yet to reap.
const alive = (pid: number) => {
  const listed = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return listed.status === 0 && !listed.stdout.trim().startsWith('Z');
};

test('a timeout stops the whole process group of the tool, with SIGKILL after the grace period (K141)', { timeout: 30_000 }, async (t) => {
  const { root, pids } = hangingPython(t, { ignoreTerm: true });
  const hung = await run(['python', '--timeout', '1', 'tests'], { root, write: () => {}, graceMs: 200, callerEnv: CI });
  assert.equal(hung, 1);
  const started = recorded(pids);
  assert.equal(started.length, 2, `expected the stub and its grandchild, actual pids ${started.join(' ')}`);
  assert.deepEqual(started.filter(alive), [], 'expected no process of the stopped group alive');
});

test('an interrupted runner stops the whole process group of the tool and ends on its signal (K141)', { timeout: 30_000 }, async (t) => {
  const { root, pids } = hangingPython(t);
  const child = spawn(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'python', '--timeout', '60', 'tests'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...CI } });
  t.after(() => child.kill('SIGKILL'));
  // The runner prints the start of the test after the stub recorded its pids.
  child.stdout.setEncoding('utf8').on('data', (text: string) => { if (text.includes('▶ test_hang')) child.kill('SIGTERM'); });
  const [status, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => child.once('close', (code: number | null, closed: NodeJS.Signals | null) => resolve([code, closed])));
  assert.deepEqual({ status, signal }, { status: null, signal: 'SIGTERM' });
  const started = recorded(pids);
  assert.equal(started.length, 2, `expected the stub and its grandchild, actual pids ${started.join(' ')}`);
  assert.deepEqual(started.filter(alive), [], 'expected no process of the stopped group alive');
});

// K437: the runner whose parent is killed stops its process group. The timeout is long, so only the lost parent can stop the
// stub before the assertion; the group must be gone within the deadline (2 s) and the grace of the stop (5 s).
test('run-tests stops its process group when its parent is killed (K437)', { timeout: 60_000 }, async (t) => {
  const { root, pids } = hangingPython(t);
  const parentFile = path.join(root, 'parent.mjs');
  writeFileSync(parentFile, `const { spawn } = process.getBuiltinModule('node:child_process');\nspawn(process.execPath, [${JSON.stringify(tool(import.meta.resolve('../../scripts/kit/run-tests.mts')))}, 'python', '--timeout', '60', 'tests'], { cwd: ${JSON.stringify(root)}, stdio: 'inherit' });\nsetInterval(() => {}, 1000);\n`);
  const parent = spawn(process.execPath, [parentFile], { cwd: root, env: { ...process.env, ...CI }, stdio: ['ignore', 'pipe', 'inherit'] });
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
  assert.deepEqual(started.filter(alive), [], 'expected no process of the group alive after the deadline and the grace');
});

// K460: a skipped test is not a verification. The run with one passing and one skipped test fails and names the skipped case, and
// the run with only skipped tests fails too.
test('a run with a skipped test fails and names each skipped case (K460)', { timeout: 60_000 }, (t) => {
  const root = checkout(t, { 'tests/skip.test.mjs': `${SPEC}test('runs and passes', () => {});\ntest('is skipped for now', { skip: 'not yet' }, () => {});\n` });
  const result = runner(root, ['node', '--', 'tests/skip.test.mjs']);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /1 passed, 0 failed, 0 timed out, 1 skipped; skipped cases: [^\n]*is skipped for now/);
});

// K454: a test that starts child processes and never ends. The deadline ends its file, and that exit stops the children the test started,
// a plain one and one that leads a process group of its own, so no child of the finished run remains.
test('a file ended at its deadline stops the child processes that its tests started (K454)', { timeout: 60_000 }, (t) => {
  const body = [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "test('starts children and never ends', () => {",
    "  const sleeper = ['-e', 'setInterval(() => {}, 1000)'];",
    "  const plain = spawn(process.execPath, sleeper, { stdio: 'ignore' });",
    "  const grouped = spawn(process.execPath, sleeper, { stdio: 'ignore', detached: true });",
    '  writeFileSync("pids.txt", `${plain.pid}\\n${grouped.pid}\\n`);',
    '  return new Promise(() => {});',
    '});',
  ].join('\n') + '\n';
  const root = checkout(t, { 'tests/children.test.mjs': `${SPEC}${body}` });
  const result = runner(root, ['node', '--timeout', '2', '--', 'tests/children.test.mjs']);
  assert.equal(result.status, 1, output(result));
  const pids = readFileSync(path.join(root, 'pids.txt'), 'utf8').trim().split('\n').map(Number);
  assert.equal(pids.length, 2, output(result));
  assert.deepEqual(pids.filter(alive), [], 'the deadline exit left a child process of the file running');
});

// A virtual environment of the checkout's Python (K37): pyvenv.cfg names the bin of a Python under var/tools/mise as its home and
// bin/python is a stub that prints unittest output; `home` overrides the named home.
function venvRoot(t: TestContext, { home }: { home?: string } = {}) {
  const root = tree(t);
  mkdirSync(path.join(root, 'var/tools/mise/installs/python/3.14.8/bin'), { recursive: true });
  const venv = path.join(root, 'pkg/.venv');
  mkdirSync(path.join(venv, 'bin'), { recursive: true });
  writeFileSync(path.join(venv, 'pyvenv.cfg'), `home = ${home ?? path.join(root, 'var/tools/mise/installs/python/3.14.8/bin')}\nversion = 3.14.8\n`);
  writeFileSync(path.join(venv, 'bin/python'), `#!/usr/bin/env node\nprocess.stderr.write('test_a (t.T.test_a) ... ok\\n\\n' + '-'.repeat(70) + '\\nRan 1 test in 0.001s\\n\\nOK\\n');\n`);
  chmodSync(path.join(venv, 'bin/python'), 0o755);
  return root;
}

// A harness module (`python -m <module> discover ...`) runs the tests through unittest's own verbose output, which the python
// reader counts; run-tests runs it in place of `-m unittest` (K219).
test('python tests run through a harness module named by --module, and its cases are counted (K219)', async (t) => {
  assert.equal(parseArguments(['python', '--module', 'pkg.harness', 'discover'], '/repo').module, 'pkg.harness');
  assert.deepEqual(toolCommand({ tool: 'python', timeoutSeconds: 7, cwd: '/r', args: ['discover'], module: 'pkg.harness' }, tree(t, { 'var/tools/mise/shims/python3': '' })).args, ['-m', 'pkg.harness', 'discover', '-v']);
  assert.throws(() => parseArguments(['node', '--module', 'pkg.harness'], '/repo'), /Usage: node/);
  // The stub answers only the harness command; any other command of python3 ends with no case, so the run fails.
  const root = pythonRoot(t, `if (process.argv.slice(2, 4).join(' ') !== '-m pkg.harness') { process.exitCode = 2; } else { process.stderr.write('test_a (pkg.t.T.test_a) ... ok\\ntest_b (pkg.t.T.test_b) ... ok\\n\\n' + '-'.repeat(70) + '\\nRan 2 tests in 0.001s\\n\\nOK\\n'); }`);
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
  assert.equal(toolCommand({ tool: 'python', timeoutSeconds: 7, cwd: '/r', args: [], venv: '/r/pkg/.venv' }, '/r').command, '/r/pkg/.venv/bin/python');
  const root = venvRoot(t);
  const passed = await inProcess(t, ['python', '--venv', 'pkg/.venv', 'tests'], { root });
  assert.equal(passed.status, 0, passed.text);
  assert.match(passed.text, /✔ python \. tests: 1 passed/);
});

test('--venv refuses an environment that is not one or comes from another Python (K37)', async (t) => {
  const missing = tree(t);
  const none = await inProcess(t, ['python', '--venv', 'pkg/.venv', 'tests'], { root: missing });
  assert.equal(none.status, 1, none.text);
  assert.match(none.text, /pkg\/\.venv is not a virtual environment \(no pyvenv\.cfg\); make it from the checkout Python, with make python-venv DIR=pkg\/\.venv or var\/tools\/mise\/shims\/uv venv --python var\/tools\/mise\/shims\/python3 pkg\/\.venv/);
  const other = venvRoot(t, { home: '/usr/bin' });
  const foreign = await inProcess(t, ['python', '--venv', 'pkg/.venv', 'tests'], { root: other });
  assert.equal(foreign.status, 1, foreign.text);
  assert.match(foreign.text, /pkg\/\.venv was made from \/usr\/bin, not from a Python of this checkout \(var\/tools\/mise\)/);
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

test('a var/tools/mise/shims/python3 that does not exist fails before the run, with the fix (K393)', async (t) => {
  await assert.rejects(inProcess(t, ['python', 'tests'], { root: tree(t) }), /python3 of the checkout is missing \(var\/tools\/bin\/python3, var\/tools\/mise\/shims\/python3\); run make install/);
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

test('under --cwd a node file group is not a test case, and its ids name the file from the checkout root', (t) => {
  const root = checkout(t, { 'pkg/tests/a.test.mjs': `${SPEC}test('adds', () => {});\ntest('subtracts', () => {});\n` });
  const result = runner(root, ['node', '--cwd', 'pkg', '--results', '.results/node.json', '--', 'tests']);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /✔ node --test: 2 passed, 0 failed, 0 timed out, 0 skipped/);
  assert.match(result.stdout, /✔ pkg\/tests\/a\.test\.mjs › adds/);
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
  const result = spawnSync(process.execPath, [path.join(tools, 'scripts/kit/run-tests.mts'), 'node', '--', 'tests/many.test.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, output(result));
  assert.equal(result.stdout.match(/✔ tests\/many\.test\.mjs › case \d+ /g)?.length, 89, output(result));
  assert.match(result.stdout, /✔ node --test: 89 passed, 0 failed, 0 timed out, 0 skipped/);
});

test('python tests are read without color when FORCE_COLOR is set, since unittest colors its output then', (t) => {
  // A stub of python3 that colors its verbose lines as Python 3.14 does under FORCE_COLOR, unless PYTHON_COLORS is 0.
  const root = checkout(t, { 'tests/t.py': '' });
  pythonStub(root, `
const colored = process.env.FORCE_COLOR && process.env.PYTHON_COLORS !== '0';
const ok = colored ? '\\x1b[32mok\\x1b[0m' : 'ok';
process.stderr.write('test_a (t.T.test_a) ... ' + ok + '\\n\\n' + '-'.repeat(70) + '\\nRan 1 test in 0.001s\\n\\nOK\\n');`);
  const colored = runner(root, ['python', 'tests'], { FORCE_COLOR: '3' });
  assert.equal(colored.status, 0, output(colored));
  assert.match(colored.stdout, /✔ test_a \(t\.T\.test_a\)/);
  assert.match(colored.stdout, /1 passed, 0 failed/);
});

test('a run without a selection refuses outside CI and runs no tool; a run of a test file runs', async (t) => {
  const root = tree(t, { 'tests/one.test.mjs': "import test from 'node:test';\ntest('one', () => {});\n" });
  const lines: string[] = [];
  const refused = await run(['node', '--', 'tests'], { root, write: (text: string) => lines.push(text), callerEnv: {} });
  assert.equal(refused, 1);
  assert.match(lines.join(''), /a node run without a selection runs only in CI/);
  assert.doesNotMatch(lines.join(''), /✔ one/);
  const selected = await run(['node', '--', 'tests/one.test.mjs'], { root, write: () => {}, callerEnv: {} });
  assert.equal(selected, 0);
});

// A shell that runs no make has no MISE_* variable: the runner must still start its tools with the mise of the checkout (K411).
test('run-tests starts its runner with the environment of mise of the checkout, also outside make (K411)', (t) => {
  // The fixture writes the state dir, the global config file and the first PATH entry, one per line.
  const fixture = "import { writeFileSync } from 'node:fs';\ntest('env', () => { writeFileSync('seen.txt', [process.env.MISE_STATE_DIR, process.env.MISE_GLOBAL_CONFIG_FILE, process.env.PATH.split(':')[0]].join('\\n')); });\n";
  const root = checkout(t, { 'tests/env.test.mjs': `${SPEC}${fixture}` });
  const env: NodeJS.ProcessEnv = { ...process.env, ...CI };
  for (const name of Object.keys(env)) if (name.startsWith('MISE_')) delete env[name];
  const result = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/run-tests.mts')), 'node', '--', 'tests/env.test.mjs'], { cwd: root, encoding: 'utf8', env });
  assert.equal(result.status, 0, output(result));
  const real = realpathSync(root);
  const [state, config, first] = readFileSync(path.join(real, 'seen.txt'), 'utf8').split('\n');
  assert.equal(state, path.join(real, 'var/tools/mise/state'));
  assert.equal(config, path.join(real, 'mise.toml'));
  assert.equal(first, path.join(real, 'var/tools/bin'));
});

// The tools of the checkout are the wrapper of var/tools/bin or the shim of mise, never a tool of PATH.
test('the tools of kit are taken from the checkout, never from PATH (K393-1)', (t) => {
  const root = tree(t);
  const wrapper = path.join(root, 'var/tools/bin/npm');
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, '#!/bin/sh\n');
  assert.equal(checkoutTool(root, 'npm'), wrapper);
  const shim = path.join(root, 'var/tools/mise/shims/go');
  mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(shim, '#!/bin/sh\n');
  assert.equal(checkoutTool(root, 'go'), shim);
  // A tool of PATH does not stand in for a tool that the checkout lacks.
  const other = tree(t);
  const onPath = mkdtempSync(path.join(tmpdir(), 'kit-path-'));
  t.after(() => rmSync(onPath, { recursive: true, force: true }));
  writeFileSync(path.join(onPath, 'uv'), '#!/bin/sh\n');
  chmodSync(path.join(onPath, 'uv'), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${onPath}${path.delimiter}${previous ?? ''}`;
  try {
    assert.throws(() => checkoutTool(other, 'uv'), /uv of the checkout is missing .*; run make install/);
  } finally {
    process.env.PATH = previous;
  }
});

// K452: an extension run gives PHPUnit the configuration of the package, so the bootstrap that it names is loaded as in the library run.
test('an extension run gives PHPUnit the package configuration so its bootstrap loads (K452)', (t) => {
const withConfig = tree(t, { 'p/composer.json': '{}\n', 'p/phpunit.xml.dist': '<phpunit bootstrap="tests/bootstrap.php"/>\n', 'var/tools/bin/php': '#!/bin/sh\n' });
const configured = toolCommand({ tool: 'phpunit', timeoutSeconds: 7, cwd: path.join(withConfig, 'p'), args: [], phpExtensions: ['/r/e.so'] }, withConfig);
assert.ok(configured.args.includes('--configuration'), `the extension run passes no configuration: ${configured.args.join(' ')}`);
});
