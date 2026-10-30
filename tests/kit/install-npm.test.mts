// Tests of scripts/kit/bootstrap/install-npm.mts, the npm of packageManager that the bootstrap installs into var/tools/npm
// before any package, with a stub curl on PATH: wrappers are executable files and no symbolic link is written, the digest
// marker alone judges an installation (K933), a declaration without a digest is refused, a changed declaration replaces
// the npm, and a failure names the expected and the actual value.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { toolchainStubs } from './toolchain-stubs.mts';
import { KIT } from './kit-tools.mts';
import { readFixture } from './json-fixture.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';
import { known } from './known.mts';

// installNpm of the checkout `root` with the declaration of its package.json and the node of this test as the node of the
// wrappers, run in a process with the stubs of `env`; each
// line that it prints goes to the standard output, and an error to the standard error with the exit status 1.
const install = (root: string, env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ['--input-type=module', '-e', `
import { installNpm } from ${JSON.stringify(path.join(KIT, 'bootstrap/install-npm.mts'))};
import { declaredToolchain } from ${JSON.stringify(path.join(KIT, 'bootstrap/toolchain-declared.mts'))};
try { installNpm({ root: process.cwd(), declared: declaredToolchain(process.cwd()).npm, node: process.execPath, print: text => console.log(text) }); }
catch (error) { console.error(error.message); process.exitCode = 1; }`], { cwd: root, env, encoding: 'utf8' });
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
const noSymlinks = (root: string) => {
  for (const file of [root, ...walk(root)]) assert.equal(lstatSync(file).isSymbolicLink(), false, `${file} is a symbolic link`);
};
const run = (file: string, env: NodeJS.ProcessEnv) => spawnSync(file, ['--version'], { encoding: 'utf8', env }).stdout.trim();

test('npm with a declared digest is installed with wrappers, and a second run installs nothing', (t) => {
  const root = toolchainCheckout(t);
  const tarball = npmTarball(t, root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${tarball.sha512}` }));
  const stubs = toolchainStubs(t, { downloads: { [tarball.url]: tarball.file } });
  const first = install(root, stubs.env);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /npm: no install with a digest marker in var\/tools\/npm; installing 12\.2\.0/);
  assert.match(first.stdout, /npm: installed 12\.2\.0 in var\/tools\/npm/);
  for (const name of ['npm', 'npx']) {
    const wrapper = path.join(root, 'var/tools/bin', name);
    assert.equal(lstatSync(wrapper).isFile(), true);
    assert.notEqual(statSync(wrapper).mode & 0o111, 0, `${name} is not executable`);
    assert.match(readFileSync(wrapper, 'utf8'), new RegExp(`^#!/bin/sh\\n# ${name} 12\\.2\\.0 of this checkout .*\\nexec '${process.execPath.replaceAll('.', '\\.')}' '${path.join(root, 'var/tools/npm/node_modules/npm/bin', `${name}-cli.js`).replaceAll('.', '\\.')}' "\\$@"\\n$`));
  }
  noSymlinks(path.join(root, 'var/tools'));

  const second = install(root, stubs.env);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /npm: 12\.2\.0 with the declared digest is installed in var\/tools\/npm/);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'a second run downloads nothing');
  assert.doesNotMatch(second.stdout, /wrote /);
});

test('a changed npm declaration replaces the installed release', (t) => {
  const root = toolchainCheckout(t);
  const older = npmTarball(t, root);
  const newer = npmTarball(t, root, { version: '12.3.1' });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${older.sha512}` }));
  const stubs = toolchainStubs(t, { downloads: { [older.url]: older.file, [newer.url]: newer.file } });
  assert.equal(install(root, stubs.env).status, 0);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.3.1+sha512.${newer.sha512}` }));
  const result = install(root, stubs.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm: the install has another digest in var\/tools\/npm; installing 12\.3\.1/);
  assert.equal(readFixture<NpmManifest>(root, 'var/tools/npm/node_modules/npm/package.json').version, '12.3.1');
  assert.equal(run(path.join(root, 'var/tools/bin/npm'), stubs.env), '12.3.1');
  assert.deepEqual(readdirSync(path.join(root, 'var/tools')).sort(), ['bin', 'npm'], 'no temporary or old directory is left');
});

test('a download whose digest is not the declared one installs nothing', (t) => {
  const root = toolchainCheckout(t);
  const tarball = npmTarball(t, root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${'d'.repeat(128)}` }));
  const stubs = toolchainStubs(t, { downloads: { [tarball.url]: tarball.file } });
  const result = install(root, stubs.env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has the sha512 [0-9a-f]{128}; packageManager of package\.json declares d{128}/);
  assert.equal(readdirSync(path.join(root, 'var/tools')).filter(name => name !== 'bin').length, 0, 'a failed install leaves nothing');
});

test('the npm bootstrap runs without var/tools/bin on PATH', (t) => {
  const root = toolchainCheckout(t);
  const tarball = npmTarball(t, root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${tarball.sha512}` }));
  const stubs = toolchainStubs(t, { downloads: { [tarball.url]: tarball.file } });
  const log = path.join(stubs.directory, 'path.log');
  const bin = path.join(root, 'var/tools/bin');
  const env = { ...stubs.env, PATH: `${bin}${path.delimiter}${stubs.env.PATH}`, STUB_PATH_LOG: log };
  assert.equal(install(root, env).status, 0);
  // split returns at least one part.
  assert.equal(known(readFileSync(log, 'utf8').split('\n')[0], 'readFileSync(log, …).split(…)[0]').split(path.delimiter).includes(bin), false);
});

test('a packageManager without a sha512 digest is refused before anything is downloaded or installed (K933)', (t) => {
  const root = toolchainCheckout(t, { 'package.json': '{ "packageManager": "npm@12.2.0" }' });
  const stubs = toolchainStubs(t);
  const result = install(root, stubs.env);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), 'packageManager of package.json declares npm@12.2.0 without a sha512 digest; add it: run `npm pack npm@12.2.0` and `shasum -a 512 npm-12.2.0.tgz`, then write npm@12.2.0+sha512.<hex> in packageManager');
  assert.deepEqual(stubs.calls(), [], 'nothing is downloaded and no npm runs');
  assert.equal(existsSync(path.join(root, 'var/tools/npm')), false, 'nothing is installed');
});

test('an npm whose marker holds the declared digest is kept, whatever version it records (K933)', (t) => {
  const root = toolchainCheckout(t);
  const tarball = npmTarball(t, root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${tarball.sha512}` }));
  const stubs = toolchainStubs(t, { downloads: { [tarball.url]: tarball.file } });
  assert.equal(install(root, stubs.env).status, 0);
  writeFileSync(path.join(root, 'var/tools/npm/node_modules/npm/package.json'), JSON.stringify({ name: 'npm', version: '12.1.0' }));
  const second = install(root, stubs.env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 1, 'the marker alone keeps the install');
});

test('an npm whose marker holds another digest is installed again (K933)', (t) => {
  const root = toolchainCheckout(t);
  const tarball = npmTarball(t, root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${tarball.sha512}` }));
  const stubs = toolchainStubs(t, { downloads: { [tarball.url]: tarball.file } });
  assert.equal(install(root, stubs.env).status, 0);
  writeFileSync(path.join(root, 'var/tools/npm/node_modules/npm/.sha512'), `${'c'.repeat(128)}\n`);
  const second = install(root, stubs.env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(stubs.calls().filter(line => line.startsWith('curl')).length, 2);
  assert.equal(readFileSync(path.join(root, 'var/tools/npm/node_modules/npm/.sha512'), 'utf8'), `${tarball.sha512}\n`);
});

// A tarball of an npm release: package/package.json and package/bin/npm-cli.js, as the registry serves it.
function npmTarball(t: TestContext, root: string, { version = '12.2.0', link = false }: { version?: string; link?: boolean } = {}) {
  const source = path.join(root, `tarball-source-${version}${link ? '-link' : ''}`);
  mkdirSync(path.join(source, 'package/bin'), { recursive: true });
  writeFileSync(path.join(source, 'package/package.json'), JSON.stringify({ name: 'npm', version }));
  writeFileSync(path.join(source, 'package/bin/npm-cli.js'), `console.log(${JSON.stringify(version)});\n`);
  writeFileSync(path.join(source, 'package/bin/npx-cli.js'), 'console.log("npx");\n');
  if (link) symlinkSync('/etc/hosts', path.join(source, 'package/bin/link'));
  const file = path.join(root, `npm-${version}${link ? '-link' : ''}.tgz`);
  assert.equal(spawnSync('tar', ['-czf', file, '-C', source, 'package']).status, 0);
  return { file, sha512: createHash('sha512').update(readFileSync(file)).digest('hex'), url: `https://registry.npmjs.org/npm/-/npm-${version}.tgz` };
}

test('npm with a declared digest is downloaded, verified and unpacked', (t) => {
  const root = toolchainCheckout(t);
  const tarball = npmTarball(t, root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${tarball.sha512}` }));
  const stubs = toolchainStubs(t, { downloads: { [tarball.url]: tarball.file } });
  const first = install(root, stubs.env);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(stubs.calls().map(line => line.split(' ')[0]), ['curl']);
  assert.equal(readFileSync(path.join(root, 'var/tools/npm/node_modules/npm/.sha512'), 'utf8'), `${tarball.sha512}\n`);
  assert.equal(run(path.join(root, 'var/tools/bin/npm'), stubs.env), '12.2.0');
  noSymlinks(path.join(root, 'var/tools'));
  assert.equal(install(root, stubs.env).status, 0);
  assert.equal(stubs.calls().length, 1, 'a second run downloads nothing');
});

test('a tarball with another digest or with a link is refused', (t) => {
  const root = toolchainCheckout(t);
  const tarball = npmTarball(t, root);
  const wrong = 'b'.repeat(128);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${wrong}` }));
  const stubs = toolchainStubs(t, { downloads: { [tarball.url]: tarball.file } });
  const mismatch = install(root, stubs.env);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, new RegExp(`npm 12\\.2\\.0 tarball https://registry\\.npmjs\\.org/npm/-/npm-12\\.2\\.0\\.tgz has the sha512 ${tarball.sha512}; packageManager of package\\.json declares ${wrong}`));

  const linked = npmTarball(t, root, { link: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `npm@12.2.0+sha512.${linked.sha512}` }));
  const withLink = toolchainStubs(t, { downloads: { [tarball.url]: linked.file } });
  const refused = install(root, withLink.env);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /the npm 12\.2\.0 tarball holds a link or a special file; expected files and directories only: l/);
});
