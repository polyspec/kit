// The real Python of this checkout: the python3 of mise.toml (its shim var/tools/mise/shims/python3), which `make install-tools`
// installs with mise at the python-build-standalone build of mise.lock, and the uv of mise.toml, whose build installs the
// build-system.requires of the fixture's pyproject.toml. The fixture wheel is built with that Python, installed into a clean virtual environment with --no-index
// --require-hashes --no-deps, and its smoke import runs. Nothing here is stubbed; a missing install fails the case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { declaredMiseTools } from '../../scripts/kit/toolchain-mise.mts';
import { buildWheel, wheelName } from '../../scripts/kit/release-wheel.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = 'tests/kit/fixture/packages/fixture-python';

test('mise.toml declares the Python of the kit', () => {
  assert.deepEqual(declaredMiseTools(ROOT).python, { version: '3.14.8', source: 'mise.toml tools.python' });
});

test('the fixture wheel is built with the real Python and uv build', { timeout: 900000 }, (t) => {
  const python = path.join(ROOT, 'var/tools/mise/shims/python3');
  assert.ok(existsSync(python), `${path.relative(ROOT, python)} is missing; make install-tools installs the python of mise.toml`);
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert.match(commit, /^[0-9a-f]{40}$/);
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const env = { ...process.env, PIP_CACHE_DIR: path.join(folder, 'pip-cache') };
  const output = path.join(folder, 'wheels');
  mkdirSync(output);
  buildWheel({ root: ROOT, env, commit, directory: FIXTURE, output });
  assert.deepEqual(readdirSync(output), [wheelName('kit-fixture', '0.0.0')]);
});
