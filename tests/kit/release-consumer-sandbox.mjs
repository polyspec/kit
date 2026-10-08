// Helpers of the consumer tests: the release sandbox (release-sandbox.mjs) with the archives of its tag built and PATH
// stubs of the tools that install a release. Each stub is a Node script that appends its call to
// .stubs/tools.json and reads its behavior from the same file:
//   npm       `install --package-lock-only` writes a lock that pins every `file:` tarball with an integrity and one
//             registry package; `ci` installs the tarballs of the lock into node_modules
//   composer  `update --no-install` writes a lock of the artifact zips with a shasum; `install` writes vendor/composer/installed.json
// No test reaches a registry or a network.
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as release from '../../scripts/kit/release.mjs';
import * as consumer from '../../scripts/kit/release-consumer.mjs';
import { releaseSandbox } from './release-sandbox.mjs';

// The start of every stub: the state, the call log and a function that saves both and exits.
const PRELUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const stateFile = process.env.STUB_STATE_FILE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
const call = { tool, args, cwd: process.cwd(), env: {} };
for (const name of ['npm_config_offline', 'npm_config_cache', 'COMPOSER_DISABLE_NETWORK', 'COMPOSER_HOME', 'COMPOSER_CACHE_DIR']) call.env[name] = process.env[name] ?? null;
state.calls.push(call);
const finish = (status = 0, message = '') => {
  if (message) console.error(message);
  fs.writeFileSync(stateFile, JSON.stringify(state));
  process.exit(status);
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const mode = state.modes[tool] ?? '';
`;

const NPM = `${PRELUDE}
if (mode === 'fail') finish(1, 'npm stub: ' + args[0] + ' failed');
const manifest = readJson('package.json');
const tarballs = Object.entries(manifest.dependencies ?? {}).filter(([, spec]) => spec.startsWith('file:'));
const inspect = file => {
  const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'stub-npm-'));
  execFileSync('tar', ['-xzf', file, '-C', folder]);
  return { folder, manifest: readJson(path.join(folder, 'package', 'package.json')) };
};
if (args[0] === 'install' && args.includes('--package-lock-only')) {
  const packages = { '': { name: manifest.name, dependencies: manifest.dependencies } };
  for (const [name, spec] of tarballs) packages['node_modules/' + name] = { version: inspect(spec.slice(5)).manifest.version, resolved: spec, integrity: 'sha512-own-' + name };
  packages['node_modules/semver'] = { version: '7.6.0', resolved: 'https://registry.npmjs.org/semver/-/semver-7.6.0.tgz', integrity: 'sha512-third-party' };
  fs.writeFileSync('package-lock.json', JSON.stringify({ name: manifest.name, lockfileVersion: 3, requires: true, packages }, null, 2));
  finish();
} else if (args[0] === 'ci') {
  if (!fs.existsSync('package-lock.json')) finish(1, 'npm stub: npm ci needs a package-lock.json');
  const lock = readJson('package-lock.json');
  for (const [name, spec] of tarballs) {
    const entry = lock.packages['node_modules/' + name];
    if (!entry || entry.resolved !== spec) finish(1, 'npm stub: the lock does not pin ' + name + ' as ' + spec);
    const { folder } = inspect(spec.slice(5));
    const target = path.join('node_modules', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(folder, 'package'), target, { recursive: true });
    if (mode === 'wrong-version') fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ ...readJson(path.join(target, 'package.json')), version: '9.9.9' }));
  }
  finish();
} else finish(1, 'npm stub: unexpected arguments ' + JSON.stringify(args));
`;

const COMPOSER = `${PRELUDE}
if (mode === 'fail') finish(1, 'composer stub: ' + args[0] + ' failed');
const manifest = readJson('composer.json');
if (args[0] === 'update' && args.includes('--no-install')) {
  const packages = Object.entries(manifest.require ?? {}).map(([name, version]) => {
    const archive = fs.readdirSync('artifacts').find(file => file.startsWith(name.replace('/', '-') + '-php-'));
    if (!archive) finish(1, 'composer stub: no zip of ' + name + ' in artifacts');
    return { name, version, dist: { type: 'zip', url: 'artifacts/' + archive, shasum: 'sha1-own' } };
  });
  fs.writeFileSync('composer.lock', JSON.stringify({ packages, 'packages-dev': [], 'plugin-api-version': '2.9.0' }, null, 4));
  finish();
} else if (args[0] === 'install') {
  if (!fs.existsSync('composer.lock')) finish(1, 'composer stub: composer install needs a composer.lock');
  const lock = readJson('composer.lock');
  fs.mkdirSync('vendor/composer', { recursive: true });
  const version = mode === 'wrong-version' ? '9.9.9' : null;
  fs.writeFileSync('vendor/composer/installed.json', JSON.stringify({ packages: lock.packages.map(entry => ({ name: entry.name, version: version ?? entry.version })) }));
  finish();
} else finish(1, 'composer stub: unexpected arguments ' + JSON.stringify(args));
`;

const STUBS = { npm: NPM, composer: COMPOSER };

/** The sandbox at `version` with its release tags, the archives of the tag in var/release/assets and the stubs of the tools. */
export function consumerSandbox(t, { version = '0.0.1', ...options } = {}) {
  const box = releaseSandbox(t, { version, ...options });
  const tag = box.release(version);
  const ctx = (extra = {}) => release.context(box.root, { env: { ...box.env, GITHUB_REPOSITORY: 'example/kit-fixture' }, ...extra });
  const names = release.assets(ctx(), tag);
  const bin = path.join(box.root, '.stubs/bin');
  const stateFile = path.join(box.root, '.stubs/tools.json');
  for (const [name, source] of Object.entries(STUBS)) {
    writeFileSync(path.join(bin, name), source);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(stateFile, JSON.stringify({ calls: [], modes: {} }));
  const env = {
    ...box.env,
    STUB_STATE_FILE: stateFile,
    // The offline settings of a build recipe, which the consumer install must not pass on.
    npm_config_offline: 'true',
    COMPOSER_DISABLE_NETWORK: '1',
  };
  const sandbox = {
    ...box,
    released: tag,
    version,
    names,
    env,
    ctx: (extra = {}) => release.context(box.root, { env, ...extra }),
    state: () => JSON.parse(readFileSync(stateFile, 'utf8')),
    /** Sets the stub behavior (`modes`: tool to mode). */
    stub(change) {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      writeFileSync(stateFile, JSON.stringify({ ...state, ...change, modes: { ...state.modes, ...change.modes } }));
    },
    calls: (tool) => JSON.parse(readFileSync(stateFile, 'utf8')).calls.filter(call => call.tool === tool),
    /** Writes the manifests and locks of the consumer projects for the tag. */
    lock: () => consumer.lockConsumers(sandbox.ctx(), tag),
    /** Runs a command of the sandbox with the stub environment. */
    exec: (command, args) => spawnSync(command, args, { cwd: box.root, env, encoding: 'utf8' }),
  };
  return sandbox;
}
