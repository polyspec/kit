// The stub registries of the dependency tests (tests/kit/registry.mts). The go and composer stubs answer go mod edit and
// composer validate from the records of the real tools (tests/kit/tool-records.json), never by running a tool, so a vendored
// test needs neither go nor Composer; tests/source/tool-records-real.test.mts proves the records against the pinned tools.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fixtureCheckout, gate } from './checkout.mts';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mts';
import { readStubLines } from './stub-json.mts';
import { TOOL_REQUEST } from './record-tools.mts';
import { parseJson } from '../../scripts/kit/schema-validate.mts';

const FIXTURE = path.resolve(import.meta.dirname, 'fixture');

test('a go mod edit or composer validate without a record fails with the request, never runs a tool, and is noted as a miss', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-registry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'go.mod'), 'module example.com/unrecorded\n\ngo 1.27.2\n');
  writeFileSync(path.join(directory, 'composer.json'), '{ "name": "example/unrecorded" }\n');
  const misses = path.join(directory, 'misses.jsonl');
  const stub = stubRegistries(t);
  const bin = stub.env.PATH?.split(path.delimiter)[0];
  assert.ok(bin, 'the stub environment has no PATH');
  // No go and no composer but the stubs: a stub that ran a tool would fail to start it.
  const env = { ...stub.env, STUB_TOOL_MISSES: misses, PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
  const go = spawnSync(path.join(bin, 'go'), ['mod', 'edit', '-json', path.join(directory, 'go.mod')], { cwd: directory, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(go.status, 1);
  assert.equal(go.stderr, `go stub: no record for go mod edit -json ${path.join(directory, 'go.mod')}\n`);
  const composer = spawnSync(path.join(bin, 'composer'), ['validate', '--no-check-publish'], { cwd: directory, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(composer.status, 1);
  assert.equal(composer.stderr, 'composer stub: no record for composer validate --no-check-publish\n');
  assert.deepEqual(readStubLines(misses, TOOL_REQUEST), [
    { tool: 'go', args: ['mod', 'edit', '-json'], files: { 'go.mod': 'module example.com/unrecorded\n\ngo 1.27.2\n' } },
    { tool: 'composer', args: ['validate', '--no-check-publish'], files: { 'composer.json': '{ "name": "example/unrecorded" }\n', 'composer.lock': null } },
  ]);
});

test('the go stub answers go mod edit of the fixture from the record of the real go', (t) => {
  const stub = stubRegistries(t);
  const bin = stub.env.PATH?.split(path.delimiter)[0];
  assert.ok(bin, 'the stub environment has no PATH');
  const file = path.join(FIXTURE, 'packages/fixture-go/go.mod');
  const go = spawnSync(path.join(bin, 'go'), ['mod', 'edit', '-json', file], { env: stub.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(go.status, 0, go.stderr);
  assert.equal(parseJson<{ Module: { Path: string } }>(go.stdout, 'go-mod.schema.json', 'go mod edit -json').Module.Path, 'example.com/kit-fixture-go');
});

// A vendored test runs in every consumer, and a consumer may install no Go and no Composer: the stubs stand in for them, so
// the gate of the fixture, which reads its go.mod with go mod edit and checks its Composer manifest with composer validate,
// passes with neither on PATH (K127).
test('the gate of the fixture passes with the stubs and no go and no composer on PATH', (t) => {
  const root = fixtureCheckout(t);
  const stub = stubRegistries(t);
  stub.registry(FIXTURE_REGISTRY);
  const bin = stub.env.PATH?.split(path.delimiter)[0];
  assert.ok(bin, 'the stub environment has no PATH');
  const env = { ...stub.env, PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
  for (const command of ['go', 'composer']) assert.equal(spawnSync('sh', ['-c', `command -v ${command}`], { env, encoding: 'utf8' }).stdout.trim(), path.join(bin, command), `${command} of PATH is the stub alone`);
  const result = gate(root, env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
