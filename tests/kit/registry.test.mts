// The stub registries of the dependency tests (tests/kit/registry.mts). The composer stub runs the real composer, which
// REAL_COMPOSER names, for the commands it does not answer; without a composer on PATH the environment names none.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stubRegistries } from './registry.mts';

test('without a composer on PATH the stub environment has no REAL_COMPOSER, and the composer stub names the command it cannot forward', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kit-registry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // PATH holds only this directory: its sh finds no command, and its null records that it ran.
  const marker = path.join(directory, 'null-ran');
  writeFileSync(path.join(directory, 'sh'), '#!/bin/sh\nexit 1\n');
  writeFileSync(path.join(directory, 'null'), `#!/bin/sh\necho ran > '${marker}'\n`);
  chmodSync(path.join(directory, 'sh'), 0o755);
  chmodSync(path.join(directory, 'null'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = directory;
  let stub;
  try {
    stub = stubRegistries(t);
  } finally {
    process.env.PATH = saved;
  }
  assert.equal('REAL_COMPOSER' in stub.env, false, `REAL_COMPOSER is ${JSON.stringify(stub.env.REAL_COMPOSER)}`);
  const bin = stub.env.PATH?.split(path.delimiter)[0];
  assert.ok(bin, 'the stub environment has no PATH');
  const forwarded = spawnSync(process.execPath, [path.join(bin, 'composer'), 'validate'], { cwd: directory, env: stub.env, encoding: 'utf8' });
  assert.equal(existsSync(marker), false, 'the composer stub ran a program named null');
  assert.notEqual(forwarded.status, 0, 'the composer stub forwarded validate without a composer');
  assert.equal(forwarded.stderr, 'composer is not installed; the stub cannot forward `composer validate`\n');
});
