// Tests of the alint of install-tools (scripts/kit/install-alint.mts): the archive alint-v<version>-<target>.tar.gz of the
// declared release is downloaded with its sha256 checked, unpacked into var/tools/alint as it is and wrapped by
// var/tools/bin/alint; a second run installs nothing; a wrong digest or release fails with the names of both. curl is a PATH
// stub that copies the archive of the test, so no test reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ALINT_TARGETS, alintArchive, installAlint } from '../../scripts/kit/install-alint.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { tool } from './kit-tools.mts';
import { alintRelease, toolchainStubs } from './toolchain-stubs.mts';

const install = (root: string, env: NodeJS.ProcessEnv, ...tools: string[]) => spawnSync(process.execPath, [tool('install-tools'), ...tools], { cwd: root, env, encoding: 'utf8' });
const config = (value: object) => JSON.stringify({ schema: 1, ...value });
const run = (file: string, env: NodeJS.ProcessEnv) => spawnSync(file, ['--version'], { encoding: 'utf8', env }).stdout.trim();
const escape = (text: string) => text.replaceAll('.', '\\.').replaceAll('/', '\\/').replaceAll('+', '\\+');

test('alint is downloaded with its sha256 checked, unpacked into var/tools/alint, wrapped, and kept by a second run', (t) => {
  const alint = alintRelease(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ alint: alint.declared }) });
  const next = alintRelease(t, '0.18.3');
  const stubs = toolchainStubs(t, { downloads: { [alint.url]: alint.archive, [next.url]: next.archive } });
  const first = install(root, stubs.env, 'alint');
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(stubs.calls().filter(line => line.startsWith('curl')).map(line => line.split(' ').at(-1)), [alint.url]);
  assert.equal(alint.url, `https://github.com/asamarts/alint/releases/download/v0.18.2/alint-v0.18.2-${alint.target}.tar.gz`);
  assert.equal(run(path.join(root, 'var/tools/bin/alint'), stubs.env), 'alint 0.18.2 (stub, built 2026-01-01)');
  assert.deepEqual(readdirSync(path.join(root, 'var/tools/alint')), [alint.folder], 'the archive is unpacked as it is, and removed');

  const wrapper = readFileSync(path.join(root, 'var/tools/bin/alint'), 'utf8');
  assert.match(wrapper, /^#!\/bin\/sh\n# alint 0\.18\.2 of this checkout/);
  assert.match(wrapper, new RegExp(`exec '${escape(path.join(root, 'var/tools/alint', alint.folder, 'alint'))}' "\\$@"\\n$`));
  assert.notEqual(statSync(path.join(root, 'var/tools/bin/alint')).mode & 0o111, 0, 'the wrapper is executable');

  const second = install(root, stubs.env, 'alint');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /alint: 0\.18\.2 is installed in var\/tools\/alint/);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'a second run downloads nothing');

  writeFileSync(path.join(root, 'config/toolchain.json'), config({ alint: next.declared }));
  const third = install(root, stubs.env, 'alint');
  assert.equal(third.status, 0, third.stderr);
  assert.equal(run(path.join(root, 'var/tools/bin/alint'), stubs.env), 'alint 0.18.3 (stub, built 2026-01-01)');
});

test('an alint archive with another digest is refused, nothing is installed, and the error names both digests', (t) => {
  const alint = alintRelease(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ alint: { ...alint.declared, sha256: { [alint.key]: '0'.repeat(64) } } }) });
  const result = install(root, toolchainStubs(t, { downloads: { [alint.url]: alint.archive } }).env, 'alint');
  assert.equal(result.status, 1);
  const actual = createHash('sha256').update(readFileSync(alint.archive)).digest('hex');
  assert.match(result.stderr, new RegExp(`${escape(alint.url)} has the sha256 ${actual}; config/toolchain\\.json alint declares ${'0'.repeat(64)} for ${alint.key}`));
  assert.equal(existsSync(path.join(root, 'var/tools/alint')), false);
});

test('an alint that prints another release than the declared one fails with the expected and the actual release', (t) => {
  const alint = alintRelease(t);
  const root = toolchainCheckout(t, { 'config/toolchain.json': config({ alint: alint.declared }) });
  const wrong = install(root, toolchainStubs(t, { downloads: { [alint.url]: alint.archive }, extra: { STUB_ALINT_SHOWS: '0.17.0' } }).env, 'alint');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /the installation of alint 0\.18\.2 into .* prints 0\.17\.0; expected 0\.18\.2/);
});

test('a platform without a verified alint archive or without a declared digest fails with the platforms and the fix', (t) => {
  const alint = alintRelease(t);
  const root = toolchainCheckout(t);
  assert.throws(() => installAlint({ root, declared: alint.declared, platform: 'win32-x64' }), /no alint archive is verified for win32-x64; the verified platforms are darwin-arm64, darwin-x64, linux-x64, linux-arm64/);
  // ALINT_TARGETS has four platforms, so another than alint.key exists.
  const other = Object.keys(ALINT_TARGETS).find(key => key !== alint.key)!;
  // other is a key of ALINT_TARGETS.
  const archive = alintArchive('0.18.2', ALINT_TARGETS[other]!);
  assert.throws(() => installAlint({ root, declared: alint.declared, platform: other }), new RegExp(`config/toolchain\\.json alint declares no sha256 for ${other}; declare the digest of ${escape(archive)}\\.tar\\.gz of the alint release 0\\.18\\.2`));
});

test('alint with a digest of the wrong form or no digest is refused with the rule of the declaration', (t) => {
  const wrongForm = toolchainCheckout(t, { 'config/toolchain.json': config({ alint: { version: '0.18.2', sha256: { 'linux-x64': 'ABC' } } }) });
  const result = install(wrongForm, toolchainStubs(t).env, 'alint');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config\/toolchain\.json alint must record the sha256 of linux-x64 as 64 lowercase hexadecimal digits; it records "ABC"/);
  const none = toolchainCheckout(t, { 'config/toolchain.json': config({ alint: { version: '0.18.2', sha256: {} } }) });
  assert.match(install(none, toolchainStubs(t).env, 'alint').stderr, /config\/toolchain\.json alint must record the sha256 of the alint archive of each platform, for example linux-x64; it records none/);
});
