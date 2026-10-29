// A sibling of a release with the real Python of this checkout (var/tools/mise/shims/python3) and its pip. The fixture wheel
// kit-gen requires kit-val, a wheel of the same release, by a direct reference without a hash, as a release names it; the
// reference points at a file that does not exist in this process, so no case reaches a network. The install of the release's
// wheels in one command with --no-deps takes both from their files and pip check passes. Given the reference and the local
// file of the same distribution with the dependencies resolved, pip reads the reference and does not take the local file.
// Nothing is stubbed; a missing install fails the case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installWheelFiles } from '../../scripts/kit/release-consumer.mts';
import { makeVenv } from '../../scripts/kit/python-venv.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PYTHON = path.join(ROOT, 'var/tools/mise/shims/python3');
const UV = path.join(ROOT, 'var/tools/mise/shims/uv');
const GEN = 'kit-gen';
const VAL = 'kit-val';
const VERSION = '0.0.1';

/** A pure Python source tree of `name` with the given dependency strings, written under `folder`. */
function source(folder: string, name: string, dependencies: string[] = []) {
  const dir = path.join(folder, `src-${name}`);
  const module = name.replaceAll('-', '_');
  mkdirSync(path.join(dir, module), { recursive: true });
  writeFileSync(path.join(dir, module, '__init__.py'), '');
  const list = dependencies.map(line => `"${line}"`).join(', ');
  writeFileSync(path.join(dir, 'pyproject.toml'), `[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "${name}"\nversion = "${VERSION}"\ndependencies = [${list}]\n`);
  return dir;
}

/** Builds the wheel of the source tree `dir` into `output` with the checkout Python and uv build, which installs its build-system.requires. */
function build(folder: string, dir: string, output: string, env: NodeJS.ProcessEnv) {
  mkdirSync(output, { recursive: true });
  const result = spawnSync(UV, ['build', '--wheel', '--python', PYTHON, '--out-dir', output, dir], { cwd: folder, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `uv build ${dir} failed: ${result.stderr}`);
}

/**
 * The fixture: kit-val and kit-gen built as wheels in `folder/wheels`. kit-gen requires kit-val by a direct reference to
 * `folder/served`, where the file is not: the reference names the release asset of kit-val, which this process does not serve.
 */
function fixture(t: TestContext) {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-wheel-sibling-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const env = { ...process.env, PIP_CACHE_DIR: path.join(folder, 'pip-cache'), PIP_NO_INDEX: '1' };
  const wheels = path.join(folder, 'wheels');
  const val = `${VAL.replaceAll('-', '_')}-${VERSION}-py3-none-any.whl`;
  const reference = pathToFileURL(path.join(folder, 'served', val)).href;
  build(folder, source(folder, VAL), wheels, env);
  build(folder, source(folder, GEN, [`${VAL} @ ${reference}`]), wheels, env);
  return { folder, env, wheels, reference, val, gen: `${GEN.replaceAll('-', '_')}-${VERSION}-py3-none-any.whl` };
}

test('the wheels of a release install in one --no-deps command from their files, and pip check passes', { timeout: 900000 }, (t) => {
  const fx = fixture(t);
  assert.ok(existsSync(PYTHON), 'var/tools/mise/shims/python3 is installed by make install-tools');
  const steps: string[] = [];
  const count = installWheelFiles({ root: ROOT, env: fx.env, folder: fx.folder, version: VERSION, directory: fx.wheels, names: [GEN, VAL], smoke: { [GEN]: ['python', '-c', 'import kit_gen, kit_val'], [VAL]: ['python', '-c', 'import kit_val'] }, step: (text: string) => steps.push(text) });
  assert.equal(count, 2);
  assert.deepEqual(steps, ['wheel pip install of 2 packages', 'wheel pip check passed', `wheel ${GEN} ${VERSION}: python -c import kit_gen, kit_val`, `wheel ${VAL} ${VERSION}: python -c import kit_val`]);
});

test('with the dependencies resolved, pip reads the sibling reference and does not take the local wheel of the same distribution', { timeout: 900000 }, (t) => {
  const fx = fixture(t);
  // The checkout Python is managed by uv and marked externally managed (PEP 668), so pip resolves for a venv of it.
  const venv = path.join(fx.folder, 'venv');
  makeVenv({ root: ROOT, directory: venv, env: fx.env });
  const result = spawnSync(PYTHON, ['-m', 'pip', '--python', path.join(venv, 'bin/python'), 'install', '--dry-run', '--no-index', '--no-input', '--disable-pip-version-check', '--no-cache-dir', path.join(fx.wheels, fx.gen), path.join(fx.wheels, fx.val)], { cwd: fx.folder, env: fx.env, encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, output);
  // The requirement of kit-gen is read from the reference: pip goes for the file that the reference names, though the local wheel
  // of the same name is given in the same command. pip names that file in either form it prints: `Processing <file> (from ...)`
  // (macOS) or `No such file or directory: '<file>'` (Linux, pip 26.2.1).
  assert.ok(output.includes(fileURLToPath(fx.reference)), output);
});
