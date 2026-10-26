// Go and Cargo pre-test builds are operations without deadlines. Their output streams while they run;
// actual tests retain their own timeout, and build failures stop the run before any test starts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { signalGroup } from '../../scripts/kit/process-group.mts';
import { chmodSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { run } from '../../scripts/kit/run-tests.mts';
import { tree } from './tree.mts';

// The tests of the runner's mechanics run whole directories, which only a CI run may do (ci-only.mts).
const CI = { GITHUB_ACTIONS: 'true' };

// A pause of the process that runs the line, as compiling takes.
const pause = (ms: number) => `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});`;

// A tool that compiles on its first call and finds the build in its cache afterwards, as go and cargo do: the first call pauses for
// 3 s and leaves a mark beside the stub.
const compiling = (stub: string) => [
  "const { existsSync, writeFileSync } = process.getBuiltinModule('node:fs');",
  `const mark = ${JSON.stringify(`${stub}.built`)};`,
  `if (!existsSync(mark)) { ${pause(3000)} writeFileSync(mark, ''); }`,
].join('\n');

function stub(file: string, script: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

const GO_EVENTS = [{ Action: 'start', Package: 'p' }, { Action: 'run', Package: 'p', Test: 'TestA' }, { Action: 'pass', Package: 'p', Test: 'TestA', Elapsed: 0 }, { Action: 'pass', Package: 'p', Elapsed: 0 }];

/** A checkout whose go shim runs `build` when it is called to build (-exec=true) and `script` otherwise. */
function goCheckout(t: TestContext, { build = '', script = `for (const e of ${JSON.stringify(GO_EVENTS)}) console.log(JSON.stringify(e));`, cold = true }: { build?: string; script?: string; cold?: boolean }) {
  const root = tree(t);
  const file = path.join(root, 'var/tools/mise/shims/go');
  stub(file, `${cold ? compiling(file) : ''}\nif (process.argv.includes('-exec=true')) { ${build} } else { ${script} }`);
  return root;
}

async function runTool(root: string, args: string[], options: { path?: string } = {}) {
  const lines: string[] = [];
  const previous = process.env.PATH;
  if (options.path !== undefined) process.env.PATH = options.path;
  try {
    const status = await run(args, { root, write: (text: string) => lines.push(text), callerEnv: CI });
    return { status, text: lines.join('') };
  } finally {
    process.env.PATH = previous;
  }
}

test('go tests whose build takes longer than the timeout run, since the build is no test time (K549-1)', { timeout: 60_000 }, async (t) => {
  const { status, text } = await runTool(goCheckout(t, {}), ['go', '--timeout', '2', './...']);
  assert.equal(status, 0, text);
  assert.match(text, /1 passed, 0 failed, 0 timed out/);
});

test('cargo tests whose build takes longer than the timeout run, since the build is no test time (K549-1)', { timeout: 60_000 }, async (t) => {
  const root = tree(t);
  const bin = path.join(root, 'bin');
  const file = path.join(bin, 'cargo');
  stub(file, `${compiling(file)}\nif (!process.argv.includes('--no-run')) { process.stderr.write('     Running unittests src/lib.rs (target/debug/deps/x-1)\\n'); process.stdout.write('\\nrunning 1 test\\ntest a ... ok\\n\\ntest result: ok. 1 passed; 0 failed\\n'); }`);
  const { status, text } = await runTool(root, ['cargo', '--timeout', '2', 'a'], { path: `${bin}${path.delimiter}${process.env.PATH ?? ''}` });
  assert.equal(status, 0, text);
  assert.match(text, /1 passed, 0 failed, 0 timed out/);
});

test('pre-test builds survive arbitrary clock advances and stream progress before completion (K682)', async (t) => {
  let release = () => {};
  t.after(() => release());
  const root = goCheckout(t, { cold: false, build: `
    const { existsSync, watch, writeFileSync } = process.getBuiltinModule('node:fs');
    const observed = 'build-output-observed';
    const advanced = 'build-clock-advanced';
    const watcher = watch('.', () => {
      if (existsSync(observed) && existsSync(advanced)) watcher.close();
    });
    process.stdout.write('compiling workspace step\\n');
    writeFileSync('build-ready', '');
  ` });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lines: string[] = [];
  const ready = new Promise<void>(resolve => {
    const observer = watch(root, () => {
      if (existsSync(path.join(root, 'build-ready'))) { observer.close(); resolve(); }
    });
    t.after(() => observer.close());
  });
  release = () => {
    for (const file of ['build-clock-advanced', 'build-output-observed']) writeFileSync(path.join(root, file), '');
  };
  const running = run(['go', '--timeout', '2', './...'], { root, callerEnv: CI, write: text => {
    lines.push(text);
    if (text.includes('compiling workspace step')) writeFileSync(path.join(root, 'build-output-observed'), '');
  } });
  await ready;
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  writeFileSync(path.join(root, 'build-clock-advanced'), '');
  const status = await running;
  assert.equal(status, 0, lines.join(''));
  assert.match(lines.join(''), /\[build\] [^\n]+: started/);
  assert.match(lines.join(''), /\[build\] [^\n]+: ended with exit code 0 \([^)]+\)/);
  assert.match(lines.join(''), /1 passed, 0 failed, 0 timed out/);
});

test('a build that fails stops the run with its output and its exit code (K549-1)', { timeout: 60_000 }, async (t) => {
  const root = goCheckout(t, { build: "process.stderr.write('p/bad.go:3:9: syntax error: unexpected {\\n'); process.exitCode = 1;" });
  const { status, text } = await runTool(root, ['go', '--timeout', '2', './...']);
  assert.equal(status, 1, text);
  assert.match(text, /p\/bad\.go:3:9: syntax error/);
  assert.match(text, /✖ go \. \.\/\.\.\.: the build of the tests `[^`]*go test -exec=true \.\/\.\.\.` ended with exit code 1/);
});


/** A leader exits after its child has inherited both output pipes and announced readiness through IPC. */
function orphanCheckout(t: TestContext, stage: 'build' | 'tool') {
  let pids: string | undefined;
  t.after(() => {
    if (pids && existsSync(pids)) {
      const [group] = readFileSync(pids, 'utf8').split(',').map(Number);
      if (group) signalGroup(group, 'SIGKILL');
    }
  });
  const line = stage === 'build' ? 'descendant final output\n' : `${JSON.stringify({ Action: 'output', Package: 'p', Output: 'descendant final output\n' })}\n`;
  const descendant = `process.stdout.write(${JSON.stringify(line)}); process.send('ready'); setInterval(() => {}, 1000);`;
  const script = `
    const { spawn } = process.getBuiltinModule('node:child_process');
    const { writeFileSync } = process.getBuiltinModule('node:fs');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.once('message', () => {
      writeFileSync('operation-pids', process.pid + ',' + child.pid);
      for (const event of ${JSON.stringify(stage === 'tool' ? GO_EVENTS : [])}) console.log(JSON.stringify(event));
      process.exit(0);
    });
  `;
  const root = goCheckout(t, { cold: false, ...(stage === 'build' ? { build: script } : { script }) });
  pids = path.join(root, 'operation-pids');
  return { root, pids };
}

function assertOrphanRun(result: { status: number; text: string }, pids: string) {
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /1 passed, 0 failed, 0 timed out/);
  const recorded = readFileSync(pids, 'utf8').split(',').map(Number);
  assert.equal(recorded.length, 2);
  for (const pid of recorded) {
    const process = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    assert.ok(process.status !== 0 || process.stdout.trim().startsWith('Z'), `operation process ${pid} remains active`);
  }
}

test('an exited builder cannot leave a descendant holding its output pipes (K682-1)', { timeout: 5000 }, async (t) => {
  const { root, pids } = orphanCheckout(t, 'build');
  const result = await runTool(root, ['go', '--timeout', '2', './...']);
  assertOrphanRun(result, pids);
  assert.match(result.text, /descendant final output/);
  assert.match(result.text, /\[build\] [^\n]+: ended with exit code 0/);
});

test('an exited test tool drains output and keeps passing counts without leaving pipe-holding descendants (K682-2)', { timeout: 5000 }, async (t) => {
  const { root, pids } = orphanCheckout(t, 'tool');
  const stdout = t.mock.method(process.stdout, 'write');
  assertOrphanRun(await runTool(root, ['go', '--timeout', '2', './...']), pids);
  assert.match(stdout.mock.calls.map(call => String(call.arguments[0])).join(''), /descendant final output/);
});
