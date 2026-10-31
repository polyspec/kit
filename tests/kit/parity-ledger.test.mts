// The silence limit of a binding run in the parity ledger (K936): a binding that prints nothing for it is stopped with its process
// group. The tests take a limit of 4 s, so that no test waits the real 120 s; one test asserts the real limit. A test that waits
// prints its start and its elapsed time, so that a slow run shows what it waits for.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { SILENCE_MS } from '../../scripts/kit/parity-ledger.mts';
import { ENV, NODE_CODEC, check, checkParity, feature, itemWhere, known, repository, vitestRepository, type Declaration } from './parity-support.mts';

// The silence limit of the tests: 4 s, so that no test waits the real one.
const FAST = 4_000;
const KILL_AFTER_MS = 420_000;
const PARITY = new URL('../../scripts/kit/parity.mts', import.meta.url).href;

/** Prints the start of a wait and, when the returned function is called, its elapsed time (the test progress of K936). */
function waiting(t: TestContext, what: string): () => void {
  const began = Date.now();
  t.diagnostic(`${what}: started`);
  return () => t.diagnostic(`${what}: finished after ${((Date.now() - began) / 1000).toFixed(1)} s`);
}

/** Runs checkParity of `root` in a child process with the silence limit `silenceMs`; the child is killed after `limitMs`. */
function checkInChild(root: string, limitMs: number, silenceMs: number): Promise<{ stdout: string; stderr: string; timedOut: boolean; status: number | null }> {
  const driver = `const { checkParity } = await import(${JSON.stringify(PARITY)}); const { findings } = await checkParity(${JSON.stringify(root)}, { execute: true, env: ${JSON.stringify(ENV)}, say: () => {}, silenceMs: ${silenceMs} }); console.log(findings.map(finding => finding.rule + ' ' + finding.implementation + ' ' + finding.message).join('\\n'));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, limitMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); resolve({ stdout, stderr, timedOut, status }); });
  });
}

/** The ts codec binding of the fixture, whose command the test replaces. */
function tsCodecBinding(config: Declaration) {
  const unit = itemWhere(config.units, entry => (entry.bindings ?? []).some(binding => binding.implementation === 'ts' && binding.test === 'ts/tests/codec.mjs'));
  return itemWhere(known(unit.bindings, 'the bindings of a unit'), entry => entry.implementation === 'ts' && entry.test === 'ts/tests/codec.mjs');
}

test('a binding silent forever is stopped with its process group and named by one R3 finding (K936)', { timeout: KILL_AFTER_MS + 30_000 }, async (t) => {
  const done = waiting(t, 'the silent binding');
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-silent-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, 'pid');
  // The binding writes its pid, prints one line to standard error, and then stays silent with no test.
  const script = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); console.error('started'); setInterval(() => {}, 1000);`;
  const root = repository(t, { edit: (config: Declaration) => { tsCodecBinding(config).command = ['node', '-e', script]; return config; } });
  try {
    const run = await checkInChild(root, KILL_AFTER_MS, FAST);
    assert.equal(run.timedOut, false, `the check did not end within ${KILL_AFTER_MS / 1000} s; stderr: ${run.stderr}`);
    // One line per finding: its rule, its implementation and its message.
    const silent = run.stdout.split('\n').filter(line => line.startsWith('R3 ts ') && /printed nothing/.test(line));
    assert.equal(silent.length, 1, `one silence finding per run; output: ${run.stdout}; stderr: ${run.stderr}`);
    assert.match(silent[0] ?? '', /binding ts\/tests\/codec\.mjs printed nothing for 4 s/);
    assert.match(silent[0] ?? '', /stopped its process group/);
    assert.ok(existsSync(pidFile), 'the binding did not start');
    assert.equal(signalGroup(Number(readFileSync(pidFile, 'utf8')), 0), 'ended', 'the process group of the binding is still running');
  } finally {
    // A check that was killed leaves the binding running in its own group: stop it here so that no process outlives the test.
    if (existsSync(pidFile)) signalGroup(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
    done();
  }
});

test('the real silence limit is the start-up bound of run-tests, 120 s (K936)', () => {
  assert.equal(SILENCE_MS, 120_000);
});

test('a go build that fails is reported as the build, with its exit status, and no test case is read from it (K936)', { timeout: 120_000 }, async (t) => {
  const done = waiting(t, 'the failing build');
  // The fixture's go stub compiles nothing, so the real go runs here: a wrapper of it comes first on PATH.
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-real-go-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const realGo = spawnSync('sh', ['-c', 'command -v go'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(path.join(dir, 'go'), `#!/bin/sh\nexec "${realGo}" "$@"\n`);
  chmodSync(path.join(dir, 'go'), 0o755);
  const { findings } = await checkParity(repository(t, { files: { 'go/codec_test.go': 'package codec\n\nfunc broken( {\n' } }), { execute: true, env: { ...ENV, PATH: `${dir}${path.delimiter}${ENV.PATH}` }, units: ['codec'], implementations: ['go'], say: () => {}, silenceMs: FAST });
  done();
  const messages = findings.map(finding => finding.message);
  assert.ok(messages.some(message => /the build of the tests exited with [1-9]/.test(message)), `no build finding; findings: ${JSON.stringify(messages)}`);
});

test('a built-in go binding whose go cannot start names the program and the cause, as before its build step (K936, K393-2)', { timeout: 120_000 }, async (t) => {
  // A PATH that holds no go on any machine, an empty folder of the test: a runner may have go in /usr/bin (K973).
  const empty = mkdtempSync(path.join(tmpdir(), 'kit-no-go-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const { findings } = await checkParity(repository(t), { execute: true, env: { ...ENV, PATH: empty }, units: ['codec'], implementations: ['go'], say: () => {}, silenceMs: FAST });
  const messages = findings.map(finding => finding.message);
  assert.ok(messages.some(message => /could not start: .*ENOENT/.test(message)), `no start finding; findings: ${JSON.stringify(messages)}`);
});

test('a vitest binding whose globalSetup hangs is stopped at the silence limit, with its process group (K936)', { timeout: 120_000 }, async (t) => {
  // The stub of the fixture hangs before its first event when the file vitest-hang exists in the checkout; a real globalSetup hangs the same way.
  const done = waiting(t, 'the hanging vitest run');
  const { findings } = await checkParity(vitestRepository(t, { 'vitest-hang': '' }), { execute: true, env: ENV, units: ['codec'], implementations: ['web'], say: () => {}, silenceMs: FAST });
  done();
  const messages = findings.map(finding => finding.message);
  assert.ok(messages.some(message => /printed nothing for 4 s/.test(message)), `no start-up finding; findings: ${JSON.stringify(messages)}`);
});

test('a silent run of a feature file with two ids is one R3 finding, not one per id (K936)', { timeout: 120_000 }, async (t) => {
  // The roundtrip feature binds the ts codec file twice, for two ids; the file prints nothing before its first test.
  const done = waiting(t, 'the silent feature file');
  const script = "setInterval(() => {}, 1000);\n";
  const root = repository(t, feature({ 'ts/tests/codec.mjs': script }, unit => {
    const first = itemWhere(known(unit.bindings, 'the bindings of roundtrip'), entry => entry.implementation === 'ts');
    first.test = 'ts/tests/codec.mjs';
    first.id = 'empty';
    unit.bindings?.push({ implementation: 'ts', test: 'ts/tests/codec.mjs', id: 'ascii' });
    return unit;
  }));
  const { findings } = await checkParity(root, { execute: true, env: ENV, units: ['roundtrip'], implementations: ['ts'], say: () => {}, silenceMs: FAST });
  done();
  const silent = findings.filter(finding => /printed nothing/.test(finding.message));
  assert.equal(silent.length, 1, `one finding per silent run; findings: ${JSON.stringify(findings.map(finding => finding.message))}`);
});

// Guards (K936): output re-arms the limit, a binding silent for less than it passes, and a cold build runs before it with no bound.

test('guard: a node binding silent for 3 s before its first test, then printing tests, passes (K936)', { timeout: 120_000 }, async (t) => {
  const done = waiting(t, 'the guarded wait');
  const { findings } = await check(t, { files: { 'ts/tests/codec.mjs': `await new Promise(resolve => setTimeout(resolve, 3_000));\n${NODE_CODEC}` } });
  done();
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.message}`), []);
});

test('guard: a binding that prints every 500 ms for 3 s before its first test, then runs its tests, passes (K936)', { timeout: 120_000 }, async (t) => {
  // The binding prints to standard error every 0.5 s, which is no silence, and then runs the node test of its file with the ledger's reporter.
  const done = waiting(t, 'the guarded output');
  const reporter = new URL('../../scripts/kit/parity-node-reporter.mts', import.meta.url).href;
  const script = `import { spawnSync } from 'node:child_process'; const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); for (let i = 0; i < 6; i++) { console.error('still compiling ' + i); await sleep(500); } const run = spawnSync(${JSON.stringify(process.execPath)}, ['--test', ${JSON.stringify(`--test-reporter=${reporter}`)}, 'tests/codec.mjs'], { stdio: 'inherit' }); process.exitCode = run.status ?? 1;\n`;
  const root = repository(t, { files: { 'ts/delay.mjs': script }, edit: (config: Declaration) => { tsCodecBinding(config).command = ['node', 'delay.mjs']; return config; } });
  const { findings } = await checkParity(root, { execute: true, env: ENV, units: ['codec'], implementations: ['ts'], say: () => {}, silenceMs: FAST });
  done();
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.message}`), []);
});

test('guard: a built-in go binding whose cold build is silent for 6 s, past the silence limit, passes: its build runs first, with no bound (K936)', { timeout: 120_000 }, async (t) => {
  // The first go call of the check sleeps 6 s with no output, as a cold build does. The build step is the first call, with no bound,
  // so the bounded run starts after it; a run without the build step would be the first call, and stopped.
  const done = waiting(t, 'the guarded cold build');
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-cold-go-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stub = path.join(ENV.PATH.split(path.delimiter)[0] ?? '', 'go');
  const mark = path.join(dir, 'built');
  writeFileSync(path.join(dir, 'go'), `#!/bin/sh\nif [ ! -f "${mark}" ]; then : > "${mark}"; sleep 6; fi\nexec "${stub}" "$@"\n`);
  chmodSync(path.join(dir, 'go'), 0o755);
  const { findings } = await checkParity(repository(t), { execute: true, env: { ...ENV, PATH: `${dir}${path.delimiter}${ENV.PATH}` }, units: ['codec'], implementations: ['go'], say: () => {}, silenceMs: FAST });
  done();
  assert.deepEqual(findings.map(finding => `${finding.rule} ${finding.message}`), []);
  assert.ok(existsSync(mark), 'the first go call did not run');
});
