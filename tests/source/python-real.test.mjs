// The real Python of this checkout: var/tools/bin/python3, installed by `make install-tools` from the pythonBuild of
// config/toolchain.json, and the build backend that install-tools fetches from its pythonBackend declaration. The fixture
// wheel is built with that Python and that backend, installed into a clean virtual environment with --no-index
// --require-hashes --no-deps, and its smoke import runs. Nothing here is stubbed; a missing install fails the case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { declaredToolchain } from '../../scripts/kit/toolchain-declared.mjs';
import { buildWheel, wheelName } from '../../scripts/kit/release-wheel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = 'tests/kit/fixture/packages/fixture-python';
const declaration = () => JSON.parse(readFileSync(path.join(ROOT, 'config/toolchain.json'), 'utf8'));

/** The symbolic links under `directory`; a link found here fails the case. */
function linksUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [file];
    return entry.isDirectory() ? linksUnder(file) : [];
  });
}

test('config/toolchain.json declares the pythonBuild of the kit and the pinned build backend of its wheels', () => {
  const declared = declaredToolchain(ROOT);
  assert.ok(declared.pythonBuild, 'config/toolchain.json declares pythonBuild, so make install-tools installs the Python');
  assert.equal(declared.pythonBuild.version, '3.14.8');
  assert.equal(declared.pythonBuild.release, '20261009');
  assert.deepEqual(Object.keys(declared.pythonBuild.sha256).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
  assert.deepEqual(declaration().pythonBackend, {
    requirement: 'setuptools==84.0.0',
    sha256: '51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670',
  });
});

test('the fixture wheel is built with the real Python and the pinned setuptools, and installs into a clean venv with --require-hashes', async (t) => {
  const { installWheelFiles } = await import('../../scripts/kit/release-consumer.mjs');
  const python = path.join(ROOT, 'var/tools/bin/python3');
  assert.ok(existsSync(python), `${path.relative(ROOT, python)} is missing; make install-tools installs the Python of pythonBuild`);
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert.match(commit, /^[0-9a-f]{40}$/);
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-python-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const env = { ...process.env, PIP_CACHE_DIR: path.join(folder, 'pip-cache') };
  const output = path.join(folder, 'wheels');
  mkdirSync(output);
  buildWheel({ root: ROOT, env, commit, directory: FIXTURE, output, buildBackend: declaration().pythonBackend });
  assert.deepEqual(readdirSync(output), [wheelName('kit-fixture', '0.0.0')]);
  const steps = [];
  const count = installWheelFiles({ root: ROOT, env, folder, version: '0.0.0', directory: output, names: ['kit-fixture'], smoke: { 'kit-fixture': ['python', '-c', 'import kit_fixture'] }, step: text => steps.push(text) });
  assert.equal(count, 1);
  assert.deepEqual(steps, ['wheel pip install of 1 packages', 'wheel pip check passed', 'wheel kit-fixture 0.0.0: python -c import kit_fixture']);
  assert.deepEqual(linksUnder(path.join(ROOT, 'var/tools')), [], 'var/tools holds no symbolic link after the install');
}, { timeout: 900000 });
