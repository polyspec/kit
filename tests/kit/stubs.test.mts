// The stubs of the toolchain and dependency tests stand in for tools: they answer from records and never start a process
// (K127). A stub that ran "the real tool" of PATH ran a shim of mise, which outside a checkout with that tool runs the next
// command of PATH: the stub again, a chain without end that reached the process limit of the machine twice.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { toolchainEnvironment } from '../../scripts/kit/check-toolchain.mts';
import { toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { versionStubs } from './toolchain-stubs.mts';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../..');

// The files that write the stubs of tools that a checkout pins or provides.
const STUB_SOURCES = ['registry.mts', 'toolchain-stubs.mts'];

test('no stub source starts a process', () => {
  for (const file of STUB_SOURCES) {
    const text = readFileSync(path.join(HERE, file), 'utf8');
    const found = text.split('\n').map((line, index) => [index + 1, line] as const).filter(([, line]) => /child_process|\bspawn|(?<!\.)\bexec(File)?(Sync)?\(/.test(line));
    assert.deepEqual(found, [], `${file} starts a process`);
  }
});

// The run of a version stub of go in a checkout of the toolchain tests, under the environment of kit.mk: the stubs are made
// with the shims of this checkout first on PATH, as kit-test makes them, and the stub runs in a checkout with no tools of
// mise. It starts in a process group of its own, which the case ends after 5 s, and the case counts its processes.
test('a version stub answers go mod edit and ends under the environment of kit.mk (K127)', async (t) => {
  const saved = { ...process.env };
  Object.assign(process.env, toolsEnvironment(ROOT));
  let stubs;
  try {
    stubs = versionStubs(t, { go: 'go1.27.2' });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  const checkout = mkdtempSync(path.join(tmpdir(), 'kit-stubs-'));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  const env = toolchainEnvironment(checkout, stubs.env);
  const child = spawn(path.join(stubs.directory, 'bin/go'), ['mod', 'edit', '-json', path.join(HERE, 'fixture/packages/fixture-go/go.mod')], { cwd: checkout, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
  const ended = await Promise.race([
    new Promise<number | null>(resolve => child.once('exit', code => resolve(code))),
    new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 5000)),
  ]);
  const members = spawnSync('ps', ['-A', '-o', 'pgid=,command='], { encoding: 'utf8' }).stdout.split('\n').map(line => line.trim().split(/\s+/)).filter(([pgid]) => Number(pgid) === child.pid).map(([, ...command]) => command.join(' '));
  if (ended === 'timeout') process.kill(-child.pid!, 'SIGKILL');
  assert.notEqual(ended, 'timeout', `go mod edit through the version stub did not end within 5 s; its process group held ${members.length} processes: ${[...new Set(members)].join('; ')}`);
  assert.equal(ended, 0);
  assert.equal(JSON.parse(stdout).Module.Path, 'example.com/kit-fixture-go');
});
