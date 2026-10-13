// The dependencies of a wheel with the real Python of this checkout (var/tools/mise/shims/python3) and its pip. The fixture wheel
// kit-app depends on a registry package (kit-reg, from a local index) and on a polyspec archive (kit-lib, given as a file:// URL in
// place of its GitHub release: the install step checks no host, and this process cannot answer pip while spawnSync blocks it). The lock of kit-app is read by lockRequirements
// and installed by installWheelFiles: --require-hashes --no-deps --only-binary, then the wheel with --no-deps, then pip check.
// Nothing is stubbed and no test reaches a network; a missing install fails the case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fileDigest } from '../../scripts/kit/bootstrap/digest.mts';
import { installWheelFiles } from '../../scripts/kit/release-consumer.mts';
import { lockRequirements } from '../../scripts/kit/wheel-dependencies.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PYTHON = path.join(ROOT, 'var/tools/mise/shims/python3');
const WHEELS = path.join(ROOT, 'var/tools/wheels');
const LOCK = 'packages/fixture-python/pylock.wheel.toml';
const APP = 'kit-app';

/** A pure Python source tree of `name` at `version` with the given dependency strings, written under `folder`. */
function source(folder: string, name: string, version: string, dependencies: string[] = []) {
  const dir = path.join(folder, `src-${name}`);
  mkdirSync(path.join(dir, name.replaceAll('-', '_')), { recursive: true });
  writeFileSync(path.join(dir, name.replaceAll('-', '_'), '__init__.py'), '');
  const list = dependencies.map(line => `"${line}"`).join(', ');
  writeFileSync(path.join(dir, 'pyproject.toml'), `[build-system]\nrequires = ["setuptools==84.0.0"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "${name}"\nversion = "${version}"\ndependencies = [${list}]\n`);
  return dir;
}

/** Builds the wheel of the source tree into `output` with the checkout Python and the pinned backend, with no index; its path. */
function build(folder: string, dir: string, output: string, env: NodeJS.ProcessEnv) {
  mkdirSync(output, { recursive: true });
  const result = spawnSync(PYTHON, ['-m', 'pip', 'wheel', '--no-deps', '--no-index', '--find-links', WHEELS, '--no-input', '--disable-pip-version-check', '-w', output, dir], { cwd: folder, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `pip wheel ${dir} failed: ${result.stderr}`);
  const wheel = readdirSync(output).find(file => file.endsWith('.whl'));
  assert.ok(wheel, `pip wheel ${dir} wrote no wheel into ${output}`);
  return path.join(output, wheel);
}

/** The environment of the installs: an empty cache and a local index only, so no install reaches PyPI. */
const environment = (folder: string, index: string) => ({ ...process.env, PIP_CACHE_DIR: path.join(folder, 'pip-cache'), PIP_NO_INDEX: '1', PIP_FIND_LINKS: index });

/**
 * The fixture of the tests: kit-reg 1.0.0 in a local index, kit-lib 0.0.1 as a file that its URL names, and kit-app 0.0.1 built
 * with both as dependencies. The lock of kit-app names both with their sha256.
 */
function fixture(t: TestContext) {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-wheel-deps-real-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const index = path.join(folder, 'index');
  const served = path.join(folder, 'served');
  const env = environment(folder, index);
  const reg = build(folder, source(folder, 'kit-reg', '1.0.0'), index, env);
  const lib = build(folder, source(folder, 'kit-lib', '0.0.1'), served, env);
  const libUrl = pathToFileURL(lib).href;
  const app = source(folder, APP, '0.0.1', ['kit-reg==1.0.0', `kit-lib @ ${libUrl}#sha256=${fileDigest(lib)}`]);
  build(folder, app, path.join(folder, 'wheels'), env);
  const lock = `lock-version = "1.0"\ncreated-by = "uv"\n\n[[packages]]\nname = "kit-reg"\nversion = "1.0.0"\nwheels = [{ name = "${path.basename(reg)}", url = "https://files.example.invalid/${path.basename(reg)}", hashes = { sha256 = "${fileDigest(reg)}" } }]\n\n[[packages]]\nname = "kit-lib"\nversion = "0.0.1"\narchive = { url = "${libUrl}", hashes = { sha256 = "${fileDigest(lib)}" } }\n`;
  return { folder, env, reg, lib, libUrl, lock, wheels: path.join(folder, 'wheels') };
}

/** Installs kit-app with `requirements` into a clean venv of the checkout Python; the count and the steps. */
function install(fx: ReturnType<typeof fixture>, requirements: string) {
  const steps: string[] = [];
  const count = installWheelFiles({ root: ROOT, env: fx.env, folder: fx.folder, version: '0.0.1', directory: fx.wheels, names: [APP], smoke: { [APP]: ['python', '-c', 'import kit_app, kit_lib, kit_reg'] }, requirements, step: (text: string) => steps.push(text) });
  return { count, steps };
}

test('the locked dependencies install with --require-hashes, the wheel with --no-deps, and pip check passes', { timeout: 900000 }, (t) => {
  const fx = fixture(t);
  assert.ok(existsSync(PYTHON), 'var/tools/mise/shims/python3 is installed by make install-tools');
  const requirements = lockRequirements(fx.lock, LOCK);
  assert.equal(requirements, `kit-reg==1.0.0 --hash=sha256:${fileDigest(fx.reg)}\nkit-lib @ ${fx.libUrl} --hash=sha256:${fileDigest(fx.lib)}\n`);
  const { count, steps } = install(fx, requirements);
  assert.equal(count, 1);
  assert.deepEqual(steps, ['wheel dependencies pip install of 2 requirements', 'wheel pip install of 1 packages', 'wheel pip check passed', `wheel ${APP} 0.0.1: python -c import kit_app, kit_lib, kit_reg`]);
});

test('an incomplete lock fails pip check and names the missing dependency', { timeout: 900000 }, (t) => {
  const fx = fixture(t);
  const requirements = `kit-lib @ ${fx.libUrl} --hash=sha256:${fileDigest(fx.lib)}\n`;
  assert.throws(() => install(fx, requirements), (error) => {
    assert.ok(error instanceof Error, 'the install throws an Error');
    assert.match(error.message, /-m pip --python .* check exited with 1: .*kit-app 0\.0\.1 requires kit-reg, which is not installed/s);
    return true;
  });
});

test('dependencies installed from local copies with the same bytes pass pip check with the wheel installed --no-deps', { timeout: 900000 }, (t) => {
  const fx = fixture(t);
  const requirements = `${fx.reg} --hash=sha256:${fileDigest(fx.reg)}\n${fx.lib} --hash=sha256:${fileDigest(fx.lib)}\n`;
  const { steps } = install(fx, requirements);
  assert.deepEqual(steps.slice(0, 3), ['wheel dependencies pip install of 2 requirements', 'wheel pip install of 1 packages', 'wheel pip check passed']);
});

test('the resolver of pip reads a direct-URL requirement and accepts an installed copy of the same version', { timeout: 900000 }, (t) => {
  const fx = fixture(t);
  const requirements = `${fx.reg} --hash=sha256:${fileDigest(fx.reg)}\n${fx.lib} --hash=sha256:${fileDigest(fx.lib)}\n`;
  install(fx, requirements);
  const venv = path.join(fx.folder, 'wheel', 'venv');
  const resolved = spawnSync(PYTHON, ['-m', 'pip', '--python', path.join(venv, 'bin', 'python'), 'install', '--dry-run', '--no-input', '--disable-pip-version-check', path.join(fx.wheels, 'kit_app-0.0.1-py3-none-any.whl')], { cwd: fx.folder, env: fx.env, encoding: 'utf8' });
  // The resolver reads the direct URL before it accepts the installed copy; a remote URL is fetched the same way.
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.match(resolved.stdout, /Processing .*kit_lib-0\.0\.1-py3-none-any\.whl/);
  assert.match(resolved.stdout, /kit-lib is already installed with the same version as the provided wheel/);
});
