// run-tests builds the tests of go and cargo before it runs them, under a build bound of its own, so the gap watch of the run
// measures no compiling: a build longer than the test timeout runs its tests; a build that outlives its bound or fails stops the
// run with its own message and output (K549-1, follows K549).
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
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
function goCheckout(t: TestContext, { build = '', script = `for (const e of ${JSON.stringify(GO_EVENTS)}) console.log(JSON.stringify(e));` }: { build?: string; script?: string }) {
  const root = tree(t);
  const file = path.join(root, 'var/tools/mise/shims/go');
  stub(file, `${compiling(file)}\nif (process.argv.includes('-exec=true')) { ${build} } else { ${script} }`);
  return root;
}

async function runTool(root: string, args: string[], options: { buildMs?: number; path?: string } = {}) {
  const lines: string[] = [];
  const previous = process.env.PATH;
  if (options.path !== undefined) process.env.PATH = options.path;
  try {
    const status = await run(args, { root, write: (text: string) => lines.push(text), callerEnv: CI, ...(options.buildMs === undefined ? {} : { buildMs: options.buildMs }) });
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

test('a build that outlives the build bound stops the run and names the bound (K549-1)', { timeout: 60_000 }, async (t) => {
  const root = goCheckout(t, { build: 'setInterval(() => {}, 1000);' });
  const { status, text } = await runTool(root, ['go', '--timeout', '2', './...'], { buildMs: 5000 });
  assert.equal(status, 1, text);
  assert.match(text, /⏱ go \. \.\/\.\.\.: the build of the tests did not end within 5 s; stopped `[^`]*go test -exec=true \.\/\.\.\.`/);
});

test('a build that fails stops the run with its output and its exit code (K549-1)', { timeout: 60_000 }, async (t) => {
  const root = goCheckout(t, { build: "process.stderr.write('p/bad.go:3:9: syntax error: unexpected {\\n'); process.exitCode = 1;" });
  const { status, text } = await runTool(root, ['go', '--timeout', '2', './...']);
  assert.equal(status, 1, text);
  assert.match(text, /p\/bad\.go:3:9: syntax error/);
  assert.match(text, /✖ go \. \.\/\.\.\.: the build of the tests `[^`]*go test -exec=true \.\/\.\.\.` ended with exit code 1/);
});
