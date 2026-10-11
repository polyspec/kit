// Tests of scripts/kit/install-python.mjs and its install-tools step: the Python of pythonBuild is downloaded from its
// release, verified by its declared sha256, unpacked into var/tools/python-build, wrapped as var/tools/bin/python3, and
// kept by a second run. curl is a PATH stub that copies the archive of the test; no test reaches the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { installPython, PYTHON_TRIPLES } from '../../scripts/kit/install-python.mjs';
import { toolchainCheckout } from './toolchain-checkout.mjs';
import { pythonBuild, toolchainStubs } from './toolchain-stubs.mjs';

const config = value => JSON.stringify({ schema: 1, ...value });
const install = (root, env, ...tools) => spawnSync(process.execPath, ['scripts/kit/install-tools.mjs', ...tools], { cwd: root, env, encoding: 'utf8' });
const run = (file, env) => spawnSync(file, ['--version'], { encoding: 'utf8', env }).stdout.trim();

test('the declared Python is downloaded, verified, unpacked and wrapped as var/tools/bin/python3, and a second run keeps it', (t) => {
  const py = pythonBuild(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ python: '3.14', pythonBuild: py.declared }) });
  const stubs = toolchainStubs(t, { downloads: { [py.url]: py.archive } });
  const first = install(root, stubs.env, 'python');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /\[install-tools\] Python: none is installed in var\/tools\/python-build; installing 3\.14\.8/);
  assert.match(first.stdout, /\[install-tools\] Python: installed 3\.14\.8 in var\/tools\/python-build/);
  assert.deepEqual(stubs.calls().map(line => line.split(' ')[0]), ['curl', 'python3.14'], 'the download, then the version probe of the installed release');
  assert.equal(run(path.join(root, 'var/tools/bin/python3'), stubs.env), 'Python 3.14.8');
  assert.deepEqual(readdirSync(path.join(root, 'var/tools/python-build')).sort(), ['python']);
  assert.equal(install(root, stubs.env, 'python').status, 0);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'a second run downloads nothing');
});

test('an archive with another digest is refused, nothing is installed, and the error names both digests', (t) => {
  const py = pythonBuild(t);
  const declared = { ...py.declared, sha256: { [py.key]: 'a'.repeat(64) } };
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ python: '3.14', pythonBuild: declared }) });
  const stubs = toolchainStubs(t, { downloads: { [py.url]: py.archive } });
  const result = install(root, stubs.env, 'python');
  assert.equal(result.status, 1);
  const actual = createHash('sha256').update(readFileSync(py.archive)).digest('hex');
  assert.match(result.stderr, new RegExp(`${py.url.replaceAll('.', '\\.').replaceAll('+', '\\+')} has the sha256 ${actual}; config/toolchain\\.json pythonBuild declares ${'a'.repeat(64)} for ${py.key}`));
  assert.deepEqual(readdirSync(path.join(root, 'var/tools')), []);
});

test('a platform without a verified build or without a declared digest fails with the platforms and the fix', (t) => {
  const py = pythonBuild(t);
  const root = toolchainCheckout(t);
  assert.throws(() => installPython({ root, declared: py.declared, platform: 'win32-x64' }), /no Python build is verified for win32-x64; the verified platforms are darwin-arm64, darwin-x64, linux-x64, linux-arm64/);
  const other = Object.keys(PYTHON_TRIPLES).find(key => key !== py.key);
  assert.throws(() => installPython({ root, declared: py.declared, platform: other }), new RegExp(`config/toolchain\\.json pythonBuild declares no sha256 for ${other}; declare the digest of cpython-3\\.14\\.8\\+20261009-${PYTHON_TRIPLES[other].replaceAll('.', '\\.')}-install_only\\.tar\\.gz`));
});

test('pythonBuild of another minor release or a malformed digest is refused before any install', (t) => {
  const py = pythonBuild(t);
  const other = toolchainCheckout(t, { 'config/toolchain.json': config({ python: '3.14', pythonBuild: { ...py.declared, version: '3.13.2' } }) });
  const otherResult = install(other, toolchainStubs(t).env, 'python');
  assert.equal(otherResult.status, 1);
  assert.match(otherResult.stderr, /config\/toolchain\.json pythonBuild declares 3\.13\.2, but python declares 3\.14; declare a release of 3\.14/);
  const malformed = toolchainCheckout(t, { 'config/toolchain.json': config({ python: '3.14', pythonBuild: { ...py.declared, sha256: { [py.key]: 'ABC' } } }) });
  const malformedResult = install(malformed, toolchainStubs(t).env, 'python');
  assert.equal(malformedResult.status, 1);
  assert.match(malformedResult.stderr, /must record the sha256 of .* as 64 lowercase hexadecimal digits; it records "ABC"/);
  const noMinor = toolchainCheckout(t, { 'config/toolchain.json': config({ pythonBuild: py.declared }) });
  const noMinorResult = install(noMinor, toolchainStubs(t).env, 'python');
  assert.equal(noMinorResult.status, 1);
  assert.match(noMinorResult.stderr, /config\/toolchain\.json pythonBuild needs python, the minor release of the checks/);
});

test('ruff without pythonBuild names the declaration and the install of the Python', (t) => {
  const root = toolchainCheckout(t, {
    'config/toolchain.json': config({ python: '3.14', ruff: { version: '0.16.10', sha256: { 'linux-x64': 'f33f43a864a8483eebd160e713336c8bab02c934feaff0a33cf5ccb41546d09a' } } }),
  });
  const result = install(root, toolchainStubs(t).env, 'ruff');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ruff needs var\/tools\/bin\/python3, the Python that config\/toolchain\.json pythonBuild declares; declare pythonBuild and run make install-tools TOOLS=python/);
});
