// The stub registries of the dependency tests (tests/kit/registry.mts). The composer and go stubs run the real composer and go,
// which REAL_COMPOSER and REAL_GO name, for the commands they do not answer: the pinned tools of the checkout under test, or
// none while they are not installed. A stub never forwards to a stub.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SHIMS, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';
import { stubRegistries } from './registry.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('a checkout without its pinned tools gives no REAL_COMPOSER or REAL_GO, and each stub names the install', (t) => {
  // The checkout has no var/tools: neither mise nor its tools are installed.
  const root = mkdtempSync(path.join(tmpdir(), 'kit-registry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stub = stubRegistries(t, { root });
  assert.equal('REAL_COMPOSER' in stub.env, false, `REAL_COMPOSER is ${JSON.stringify(stub.env.REAL_COMPOSER)}`);
  assert.equal('REAL_GO' in stub.env, false, `REAL_GO is ${JSON.stringify(stub.env.REAL_GO)}`);
  const bin = stub.env.PATH?.split(path.delimiter)[0];
  assert.ok(bin, 'the stub environment has no PATH');
  const composer = spawnSync(process.execPath, [path.join(bin, 'composer'), 'validate'], { cwd: root, env: stub.env, encoding: 'utf8' });
  assert.equal(composer.status, 1);
  assert.equal(composer.stderr, 'composer is not installed; run make install-tools (the stub cannot forward `composer validate`)\n');
  const go = spawnSync(process.execPath, [path.join(bin, 'go'), 'mod', 'edit', '-json', 'go.mod'], { cwd: root, env: stub.env, encoding: 'utf8' });
  assert.equal(go.status, 1);
  assert.equal(go.stderr, 'go is not installed; run make install-tools (the stub cannot forward `go mod edit -json go.mod`)\n');
});

test('a stub refuses a REAL_GO or REAL_COMPOSER that reaches the stub again, and ends', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-registry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stub = stubRegistries(t, { root });
  const bin = stub.env.PATH?.split(path.delimiter)[0];
  assert.ok(bin, 'the stub environment has no PATH');
  for (const [name, args] of [['go', ['mod', 'edit', '-json', 'go.mod']], ['composer', ['validate']]] as const) {
    const variable = name === 'go' ? 'REAL_GO' : 'REAL_COMPOSER';
    const itself: { status: number | null; stderr: string } = spawnSync(process.execPath, [path.join(bin, name), ...args], { cwd: root, env: { ...stub.env, [variable]: path.join(bin, name) }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(itself.status, 1, `${name}: ${itself.stderr}`);
    assert.equal(itself.stderr, `the ${name} stub reached itself through ${variable} ${path.join(bin, name)}; ${variable} must name a ${name} that is no stub\n`);
  }
});

// The go stub forwards go mod edit to the real go of REAL_GO. Under kit.mk the shims of mise come first on PATH, and a shim of
// go run outside the checkout, as the stub runs in a fixture, finds no version of mise and runs the next go of PATH: the stub
// itself, which forwards again without end (K127). The run is bounded: the stub starts in a process group of its own, which
// the case ends after 5 s, and the case counts its processes.
test('the go stub forwards go mod edit to the go of the checkout, which is no stub and no shim, and ends (K127)', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-registry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'go.mod'), 'module example.com/a\n\ngo 1.27.2\n');
  const saved = { ...process.env };
  Object.assign(process.env, toolsEnvironment(ROOT));
  let stub;
  try {
    stub = stubRegistries(t);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  const bin = stub.env.PATH?.split(path.delimiter)[0];
  assert.ok(bin, 'the stub environment has no PATH');
  const child = spawn(process.execPath, [path.join(bin, 'go'), 'mod', 'edit', '-json', path.join(directory, 'go.mod')], { cwd: directory, env: stub.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
  const ended = await Promise.race([
    new Promise<number | null>(resolve => child.once('exit', code => resolve(code))),
    new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 5000)),
  ]);
  const members = spawnSync('ps', ['-A', '-o', 'pgid='], { encoding: 'utf8' }).stdout.split('\n').filter(line => Number(line.trim()) === child.pid).length;
  if (ended === 'timeout') process.kill(-child.pid!, 'SIGKILL');
  assert.notEqual(ended, 'timeout', `go mod edit through the stub did not end within 5 s; its process group held ${members} processes (REAL_GO ${stub.env.REAL_GO})`);
  assert.equal(ended, 0);
  assert.equal(JSON.parse(stdout).Go, '1.27.2');
  for (const [name, value] of [['REAL_GO', stub.env.REAL_GO], ['REAL_COMPOSER', stub.env.REAL_COMPOSER]]) {
    assert.ok(value === undefined || !(value.includes('kit-dependency-registry-') || value.startsWith(path.join(ROOT, SHIMS))), `${name} is ${value}, a stub or a shim`);
  }
});
