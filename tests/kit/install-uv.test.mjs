// Tests of the uv of install-tools (scripts/kit/install-uv.mjs): uv 0.12.11 is downloaded as a wheel with its sha256 checked,
// installed into a virtual environment of var/tools/bin/python3 under var/tools/uv, wrapped by var/tools/bin/uv, which sets
// the uv state under var/tools; a second run installs nothing; a wrong digest or release fails with the names of both.
// The Python and pip are stubs (toolchain-stubs.mjs), so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { toolchainCheckout } from './toolchain-checkout.mjs';
import { pythonBuild, toolchainStubs, uvWheel } from './toolchain-stubs.mjs';

const install = (root, env, ...tools) => spawnSync(process.execPath, ['scripts/kit/install-tools.mjs', ...tools], { cwd: root, env, encoding: 'utf8' });
const config = value => JSON.stringify({ schema: 1, ...value });
const run = (file, env) => spawnSync(file, ['--version'], { encoding: 'utf8', env }).stdout.trim();
const installCalls = stubs => stubs.calls().filter(line => !line.includes('--version'));
const UV_WHEEL = version => path.join('var/tools/wheels', `uv-${version}-py3-none-any.whl`);

// The uv of the declaration: its exact version and the sha256 of its wheel, under the platform key of this machine.
const uvDigest = version => createHash('sha256').update(uvWheel(version)).digest('hex');
const uvConfig = (version = '0.12.11', digest = uvDigest(version)) => ({ version, sha256: { [`${process.platform}-${process.arch}`]: digest } });
const uvFiles = py => ({ 'config/toolchain.json': config({ python: '3.14', pythonBuild: py.declared, uv: uvConfig() }) });

test('uv is downloaded with its sha256 checked, installed into var/tools/uv from the Python of pythonBuild, and kept by a second run', (t) => {
  const py = pythonBuild(t);
  const root = toolchainCheckout(t, uvFiles(py));
  const stubs = toolchainStubs(t, { downloads: { [py.url]: py.archive } });
  const first = install(root, stubs.env, 'python', 'uv');
  assert.equal(first.status, 0, first.stderr);
  const calls = installCalls(stubs);
  assert.match(calls.find(line => line.includes(' pip download ')), /^python3\.14 -m pip download --no-deps .*--only-binary :all: --require-hashes -r .* -d .*var\/tools\/wheels$/);
  assert.equal(calls.find(line => line.startsWith('venv-python')), `venv-python -m pip install --quiet --no-index --no-deps --no-cache-dir ${path.join(root, UV_WHEEL('0.12.11'))}`);
  assert.equal(run(path.join(root, 'var/tools/bin/uv'), stubs.env), 'uv 0.12.11 (stub 2026-01-01)');
  noSymlinks(path.join(root, 'var/tools'));

  const wrapper = readFileSync(path.join(root, 'var/tools/bin/uv'), 'utf8');
  assert.match(wrapper, /^#!\/bin\/sh\n# uv 0\.12\.11 of this checkout/);
  assert.match(wrapper, new RegExp(`UV_CACHE_DIR='${escape(path.join(root, 'var/tools/uv-cache'))}'`));
  assert.match(wrapper, new RegExp(`UV_PYTHON_INSTALL_DIR='${escape(path.join(root, 'var/tools/uv-python'))}'`));
  assert.match(wrapper, /UV_NO_CONFIG=1/);
  assert.match(wrapper, /UV_PYTHON_DOWNLOADS=never/);
  assert.match(wrapper, new RegExp(`exec '${escape(path.join(root, 'var/tools/uv/bin/uv'))}' "\\$@"\\n$`));
  assert.equal(wrapper.includes(homedir()), false, 'the wrapper names no directory of the home');
  assert.notEqual(statSync(path.join(root, 'var/tools/bin/uv')).mode & 0o111, 0, 'the wrapper is executable');

  const second = install(root, stubs.env, 'python', 'uv');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /uv: 0\.12\.11 is installed in var\/tools\/uv/);
  assert.equal(installCalls(stubs).length, calls.length, 'a second run starts no install');

  writeFileSync(path.join(root, 'config/toolchain.json'), config({ python: '3.14', pythonBuild: py.declared, uv: uvConfig('0.12.12', uvDigest('0.12.12')) }));
  assert.equal(install(root, stubs.env, 'python', 'uv').status, 0);
  assert.equal(run(path.join(root, 'var/tools/bin/uv'), stubs.env), 'uv 0.12.12 (stub 2026-01-01)');
});

test('a uv wheel whose sha256 is not declared is removed, and the failure names both digests', (t) => {
  const py = pythonBuild(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ python: '3.14', pythonBuild: py.declared, uv: uvConfig('0.12.11', '0'.repeat(64)) }) });
  const result = install(root, toolchainStubs(t, { downloads: { [py.url]: py.archive } }).env, 'python', 'uv');
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`${escape(UV_WHEEL('0.12.11'))} has the sha256 ${uvDigest('0.12.11')}, config/toolchain\\.json uv declares ${'0'.repeat(64)}; the file is removed`));
  assert.equal(existsSync(path.join(root, UV_WHEEL('0.12.11'))), false);
  assert.equal(existsSync(path.join(root, 'var/tools/uv')), false, 'no environment is made');
});

test('uv of another release than its installation prints fails with the expected and the actual release', (t) => {
  const py = pythonBuild(t);
  const root = toolchainCheckout(t, uvFiles(py));
  const wrong = install(root, toolchainStubs(t, { downloads: { [py.url]: py.archive }, extra: { STUB_UV_SHOWS: '0.12.10' } }).env, 'python', 'uv');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /the installation of uv 0\.12\.11 into .* prints 0\.12\.10; expected 0\.12\.11/);
});

test('uv without pythonBuild names the declaration and the install of the Python', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ python: '3.14', uv: uvConfig() }) });
  const result = install(root, toolchainStubs(t).env, 'uv');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /uv needs var\/tools\/bin\/python3, the Python that config\/toolchain\.json pythonBuild declares; declare pythonBuild and run make install-tools TOOLS=python/);
});

test('uv with a digest of the wrong form is refused with the rule of the declaration', (t) => {
  const py = pythonBuild(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ python: '3.14', pythonBuild: py.declared, uv: { version: '0.12.11', sha256: { 'linux-x64': 'ABC' } } }) });
  const result = install(root, toolchainStubs(t).env, 'uv');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\/toolchain\.json uv must record the sha256 of linux-x64 as 64 lowercase hexadecimal digits; it records "ABC"/);
});

function noSymlinks(root) {
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    assert.equal(lstatSync(path.join(entry.parentPath ?? entry.path, entry.name)).isSymbolicLink(), false, `${entry.name} is a symbolic link`);
  }
  assert.equal(lstatSync(root).isSymbolicLink(), false);
}

const escape = text => text.replaceAll('.', '\\.').replaceAll('/', '\\/');
