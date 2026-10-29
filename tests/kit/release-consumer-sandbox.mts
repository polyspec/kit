// Helpers of the consumer and proof tests: the release sandbox (release-sandbox.mts) with the archives of its tag built
// and PATH stubs of the tools that install and prove a release. Each stub is a Node script that appends its call to
// .stubs/tools.json and reads its behavior from the same file:
//   npm       `install --package-lock-only` writes a lock that pins every `file:` tarball with an integrity and one
//             registry package; `ci` installs the tarballs of the lock into node_modules
//   composer  `update --no-install` writes a lock of the artifact zips with a shasum; `install` writes vendor/composer/installed.json
//   gh        `api .../releases` lists state.release (its tag, draft and names); `api .../releases/assets/<id>` writes the archive
//   uv        `venv --python PY DIR` (var/tools/mise/shims/uv) writes DIR/bin/python with its home in var/tools/mise;
//             `pip install --python PY -r LOCK` installs a wheel lock
//   python3   var/tools/mise/shims/python3 answers its version and runs `-m pip --python DIR/bin/python`; DIR/bin/python answers the
//             smoke command
//   cargo, go answer from the state
// No test reaches a registry, GitHub or a network.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';
import * as release from '../../scripts/kit/release.mts';
import * as consumer from '../../scripts/kit/release-consumer.mts';
import { fileDigest } from '../../scripts/kit/bootstrap/digest.mts';
import { releaseSandbox } from './release-sandbox.mts';
import type { ReleaseSandboxOptions } from './release-sandbox.mts';
import { PIP_FUNCTIONS } from './wheel-stubs.mts';
import { readFixture } from './json-fixture.mts';
import { readStub, TEXTS } from './stub-json.mts';
import type { JSONSchemaType } from 'ajv/dist/2020.js';

/** A call that a tool stub logged: the tool, its arguments, its directory, the variables it saw and what it read. */
type ConsumerCall = { tool: string; args: string[]; cwd: string; env: Record<string, string | null>; requirements?: string | null; manifest?: string | null };
/** The state of the tool stubs in the fields that the tests read and change. */
type ConsumerState = {
  calls: ConsumerCall[];
  modes: Record<string, string>;
  release: { tag: string; draft: boolean; names: string[]; source: string; published?: Record<string, { url: string; digest: string }>; listed?: boolean };
};
const STRING = { type: 'string' } as const;
const CONSUMER_STATE: JSONSchemaType<ConsumerState> = {
  type: 'object',
  required: ['calls', 'modes', 'release'],
  properties: {
    calls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tool', 'args', 'cwd', 'env'],
        properties: {
          tool: STRING,
          args: TEXTS,
          cwd: STRING,
          env: { type: 'object', required: [], additionalProperties: { type: 'string', nullable: true } },
          requirements: { type: 'string', nullable: true },
          manifest: { type: 'string', nullable: true },
        },
      },
    },
    modes: { type: 'object', required: [], additionalProperties: STRING },
    release: {
      type: 'object',
      required: ['tag', 'draft', 'names', 'source'],
      properties: {
        tag: STRING,
        draft: { type: 'boolean' },
        names: TEXTS,
        source: STRING,
        published: { type: 'object', nullable: true, required: [], additionalProperties: { type: 'object', required: ['url', 'digest'], properties: { url: STRING, digest: STRING } } },
        listed: { type: 'boolean', nullable: true },
      },
    },
  },
};

// The release of the checkout Python (var/tools/mise/shims/python3) that the stubs report.
const CHECKOUT_VERSION = '3.14.8';

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
for (const name of ['npm_config_offline', 'npm_config_cache', 'COMPOSER_DISABLE_NETWORK', 'COMPOSER_HOME', 'COMPOSER_CACHE_DIR', 'GOFLAGS', 'GOPROXY', 'GOPATH', 'CARGO_TARGET_DIR', 'VIRTUAL_ENV']) call.env[name] = process.env[name] ?? null;
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
const drop = folder => fs.rmSync(folder, { recursive: true, force: true });
if (args[0] === 'install' && args.includes('--package-lock-only')) {
  const packages = { '': { name: manifest.name, dependencies: manifest.dependencies } };
  for (const [name, spec] of tarballs) {
    const { folder, manifest: packed } = inspect(spec.slice(5));
    drop(folder);
    packages['node_modules/' + name] = { version: packed.version, resolved: spec, integrity: 'sha512-own-' + name };
  }
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
    drop(folder);
  }
  finish();
} else finish(1, 'npm stub: unexpected arguments ' + JSON.stringify(args));
`;

const COMPOSER = `${PRELUDE}
if (mode === 'fail') finish(1, 'composer stub: ' + args[0] + ' failed');
const manifest = readJson('composer.json');
if (args[0] === 'update' && args.includes('--no-install')) {
  const packages = Object.entries(manifest.require ?? {}).map(([name, version]) => {
    const entry = (manifest.repositories ?? []).find(repository => repository.type === 'package' && repository.package?.name === name)?.package;
    if (!entry || entry.version !== version || !entry.dist?.url || !fs.existsSync(entry.dist.url)) finish(1, 'composer stub: no exact package metadata and zip for ' + name);
    return { name, version: entry.version, dist: { type: entry.dist.type, url: entry.dist.url, shasum: 'sha1-own' } };
  });
  fs.writeFileSync('composer.lock', JSON.stringify({ packages, 'packages-dev': [], 'plugin-api-version': '2.9.0' }, null, 4));
  finish();
} else if (args[0] === 'install') {
  if (!fs.existsSync('composer.lock')) finish(1, 'composer stub: composer install needs a composer.lock');
  const lock = readJson('composer.lock');
  if (mode === 'no-installed') finish();
  fs.mkdirSync('vendor/composer', { recursive: true });
  const version = mode === 'wrong-version' ? '9.9.9' : null;
  fs.writeFileSync('vendor/composer/installed.json', JSON.stringify({ packages: lock.packages.map(entry => ({ name: entry.name, version: version ?? entry.version })) }));
  finish();
} else finish(1, 'composer stub: unexpected arguments ' + JSON.stringify(args));
`;

const GH = `${PRELUDE}
if (mode === 'fail') finish(1, 'gh stub: api failed');
// The release of the tag, a draft included, as the API returns it by its id: its assets carry the ids that the download names.
const own = () => ({ id: 7, tag_name: state.release.tag, draft: state.release.draft, assets: state.release.names.map((name, index) => ({ id: index + 1, name, url: state.release.published?.[name]?.url ?? 'https://example.com/polyspec/kit-fixture/releases/download/' + state.release.tag + '/' + name, digest: state.release.published?.[name]?.digest ?? null })) });
if (args[0] === 'api' && args.some(arg => /^repos\\/[^/]+\\/[^/]+\\/releases\\/\\d+$/.test(arg))) {
  const id = Number(args.find(arg => /\\/releases\\/\\d+$/.test(arg)).split('/').pop());
  if (id !== 7) finish(1, 'gh: Not Found (HTTP 404)');
  console.log(JSON.stringify(own()));
  finish();
} else if (args[0] === 'api' && args.some(arg => arg.endsWith('/releases'))) {
  // A draft that was just created may be missing from the list for a while (listed: false).
  if (state.release.listed !== false) console.log(JSON.stringify(own()));
  finish();
} else if (args[0] === 'api' && args.some(arg => arg.includes('/releases/assets/'))) {
  const id = Number(args.at(-1).split('/').pop());
  const name = state.release.names[id - 1];
  fs.writeSync(1, fs.readFileSync(path.join(state.release.source, name)));
  finish();
} else finish(1, 'gh stub: unexpected arguments ' + JSON.stringify(args));
`;

// The interpreter of a virtual environment: it answers the interpreter facts and the smoke command from the state.
const VENV_PYTHON = `${PRELUDE}
if (args[0] === '-c' && args[1].includes('python_version')) {
  console.log(${JSON.stringify(CHECKOUT_VERSION)});
  finish();
}
finish(mode === 'smoke-fail' ? 1 : 0, mode === 'smoke-fail' ? 'python stub: ModuleNotFoundError' : '');
`;

// The uv of the checkout, var/tools/mise/shims/uv: it makes the venv with its home in var/tools/mise, as uv venv makes it from
// the Python that uv installed, and answers `pip install --python PY -r LOCK`, the install of a wheel lock.
const UV = `${PRELUDE}
const CHECKOUT_BIN = path.join(process.cwd(), 'var/tools/mise/installs/python/${CHECKOUT_VERSION}/bin');
if (args[0] === 'venv' && args[2] === '--python') {
  const directory = args.at(-1);
  fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'bin', 'python'), state.venvPython, { mode: 0o755 });
  fs.writeFileSync(path.join(directory, 'pyvenv.cfg'), 'home = ' + CHECKOUT_BIN + '\\n');
  finish(mode === 'venv-fail' ? 1 : 0, mode === 'venv-fail' ? 'uv stub: venv failed' : '');
} else if (args[0] === 'pip' && args[1] === 'install' && args[2] === '--python' && args[4] === '-r') finish();
else finish(1, 'uv stub: unexpected arguments ' + JSON.stringify(args));
`;

// The checkout Python, var/tools/mise/shims/python3: it answers its version and runs pip with --python into a venv. The venv's pip
// calls are logged with the call.
const PYTHON3 = `${PRELUDE}
${PIP_FUNCTIONS}
if (args[0] === '-c' && args[1].includes('python_version')) {
  console.log(${JSON.stringify(CHECKOUT_VERSION)});
  finish();
} else if (args[0] === '-m' && args[1] === 'pip' && args[2] === '--python') {
  if (args[4] === 'show') {
    console.log('Name: ' + args[5] + '\\nVersion: ' + state.version);
    finish();
  }
  call.requirements = args.includes('-r') ? fs.readFileSync(args[args.indexOf('-r') + 1], 'utf8') : null;
  finish(mode === 'pip-fail' ? 1 : 0, mode === 'pip-fail' ? 'pip stub: no matching distribution' : '');
} else if (args[0] === '-m' && args[1] === 'pip') finish(pipStub(args));
else finish(1, 'python3 stub: unexpected arguments ' + JSON.stringify(args));
`;

// The python3 on PATH: the checkout's Python never reaches it, so any call here is a failure of the release tools.
const PATH_PYTHON3 = `${PRELUDE}
finish(1, 'python3 stub: a python3 of PATH ran with ' + JSON.stringify(args) + '; the release uses var/tools/mise/shims/python3');
`;

const CARGO = `${PRELUDE}
call.manifest = fs.existsSync('Cargo.toml') ? fs.readFileSync('Cargo.toml', 'utf8') : null;
finish(mode === 'fail' ? 101 : 0, mode === 'fail' ? 'cargo stub: failed to find tag' : '');
`;

const GO = `${PRELUDE}
if (args[0] === 'list' && args[1] === '-m') {
  const [module, version] = args[2].split('@');
  if (mode === 'fail') finish(1, 'go stub: ' + args[2] + ': reading failed');
  console.log(mode === 'other' ? module + ' v9.9.9' : module + ' ' + version);
  finish();
} else finish(1, 'go stub: unexpected arguments ' + JSON.stringify(args));
`;

const STUBS = { npm: NPM, composer: COMPOSER, gh: GH, python3: PATH_PYTHON3, 'checkout-python3': PYTHON3, 'checkout-uv': UV, cargo: CARGO, go: GO };

/** The sandbox at `version` with its release tags, the archives of the tag in var/release/assets and the stubs of the tools. */
export function consumerSandbox(t: Pick<TestContext, 'after'>, { version = '0.0.1', ...options }: ReleaseSandboxOptions = {}) {
  const box = releaseSandbox(t, { version, ...options });
  const tag = box.release(version);
  const ctx = (extra = {}) => release.context(box.root, { env: { ...box.env, GITHUB_REPOSITORY: 'example/kit-fixture' }, ...extra });
  const names = release.assets(ctx(), tag);
  const bin = path.join(box.root, '.stubs/bin');
  const stateFile = path.join(box.root, '.stubs/tools.json');
  // npm, composer and go are selected from the checkout tool directory; the other stubs are on PATH.
  const checkoutBin = path.join(box.root, 'var/tools/bin');
  const checkoutShims = path.join(box.root, 'var/tools/mise/shims');
  mkdirSync(checkoutBin, { recursive: true });
  mkdirSync(checkoutShims, { recursive: true });
  for (const [name, source] of Object.entries(STUBS)) {
    const folder = name === 'npm' || name === 'composer' || name === 'go' ? checkoutBin : bin;
    writeFileSync(path.join(folder, name), source);
    chmodSync(path.join(folder, name), 0o755);
  }
  // The Python of the checkout is var/tools/mise/shims/python3, the shim of mise: it runs the stub.
  const python = path.join(box.root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(python), { recursive: true });
  // The Python that mise installed exists as a directory, so the venv's home compares by its real path, as on macOS (/var is
  // /private/var). var/tools/mise/shims/uv is the shim of mise: it runs the uv stub.
  mkdirSync(path.join(box.root, `var/tools/mise/installs/python/${CHECKOUT_VERSION}/bin`), { recursive: true });
  writeFileSync(python, `#!/bin/sh\nexec '${path.join(bin, 'checkout-python3')}' "$@"\n`);
  chmodSync(python, 0o755);
  writeFileSync(path.join(box.root, 'var/tools/mise/shims/uv'), `#!/bin/sh\nexec '${path.join(bin, 'checkout-uv')}' "$@"\n`);
  chmodSync(path.join(box.root, 'var/tools/mise/shims/uv'), 0o755);
  // The published assets: each asset of the release at its URL in the repository and with the sha256 of its file, as GitHub lists them.
  const config = readFixture<release.ReleaseConfig>(box.root, 'config/release.json');
  const source = path.join(box.root, release.ASSETS);
  const published = Object.fromEntries(names.map((name: string) => [name, { url: `${config.repositoryUrl}/releases/download/${tag}/${name}`, digest: `sha256:${fileDigest(path.join(source, name))}` }]));
  writeFileSync(stateFile, JSON.stringify({ calls: [], modes: {}, release: { tag: 'v0.0.1', draft: true, names, source, published }, venvPython: VENV_PYTHON, version }));
  // The record that make release-publish writes: the id of the draft release of the tag.
  mkdirSync(path.join(box.root, 'var/release'), { recursive: true });
  writeFileSync(path.join(box.root, 'var/release/v0.0.1.json'), JSON.stringify({ id: 7 }));
  // The remote of the repository URL is the sandbox itself, so git ls-remote reads real tags.
  const env = {
    ...box.env,
    STUB_STATE_FILE: stateFile,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${box.root}.insteadOf`,
    GIT_CONFIG_VALUE_0: config.repositoryUrl,
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
    state: () => readStub(stateFile, CONSUMER_STATE),
    /** Sets the stub behavior (`modes`: tool to mode) and the names that the release lists. */
    stub(change: { modes?: Record<string, string>; [field: string]: unknown }) {
      const state = readStub(stateFile, CONSUMER_STATE);
      writeFileSync(stateFile, JSON.stringify({ ...state, ...change, modes: { ...state.modes, ...change.modes } }));
    },
    calls: (tool: string) => readStub(stateFile, CONSUMER_STATE).calls.filter(call => call.tool === tool),
    /** Writes the manifests and locks of the consumer projects for the tag. */
    lock: () => consumer.lockConsumers(sandbox.ctx(), tag),
    /** Runs a command of the sandbox with the stub environment. */
    exec: (command: string, args: string[]) => spawnSync(command, args, { cwd: box.root, env, encoding: 'utf8' }),
  };
  return sandbox;
}
