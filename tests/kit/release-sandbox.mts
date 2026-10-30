// Helpers of the release tests: a Git repository in a temporary directory that holds the fixture at one version, a change
// log, origin/main and stubs of `gh` and `npm` first on PATH. The stub `gh` answers the releases of the GitHub API from a
// JSON state file and records each call and the notes of a release; the stub `npm` packs the package.json of its directory
// into the tarball that npm pack writes and records each call. No test reaches GitHub or a registry.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { fixtureCheckout } from './checkout.mts';
import { checkoutTools } from './checkout-stubs.mts';
import { toolStubs } from './registry.mts';
import { PYTHON3_WHEEL_STUB, UV_WHEEL_STUB } from './wheel-stubs.mts';
import type { WheelRequires } from './wheel-stubs.mts';
import { readFixture } from './json-fixture.mts';
import { readStub, readStubLines, STUB_CALL, TEXTS } from './stub-json.mts';
import type { JSONSchemaType } from 'ajv/dist/2020.js';
import type { ReleaseConfig } from '../../scripts/kit/release.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';

/** A release of the gh stub by its id, as the API returns it. */
type StubRelease = { id: number; tag_name: string; draft: boolean; assets: { id: number; name: string; url: string; digest?: string | null }[] };
/** The state of the gh stub in the fields that the tests read: its calls and what it created, uploaded, patched and deleted. */
type GhState = {
  calls: string[][];
  notes?: string | null;
  created?: { tag: string; name: string; draft: string };
  uploads?: { name: string; input: string; type: string }[];
  byId?: Record<string, StubRelease>;
  patched?: string[][];
  deleted?: string[];
};
const STRING = { type: 'string' } as const;
const GH_STATE: JSONSchemaType<GhState> = {
  type: 'object',
  required: ['calls'],
  properties: {
    calls: { type: 'array', items: TEXTS },
    notes: { type: 'string', nullable: true },
    created: { type: 'object', nullable: true, required: ['tag', 'name', 'draft'], properties: { tag: STRING, name: STRING, draft: STRING } },
    uploads: { type: 'array', nullable: true, items: { type: 'object', required: ['name', 'input', 'type'], properties: { name: STRING, input: STRING, type: STRING } } },
    byId: {
      type: 'object',
      nullable: true,
      required: [],
      additionalProperties: {
        type: 'object',
        required: ['id', 'tag_name', 'draft', 'assets'],
        properties: {
          id: { type: 'integer' },
          tag_name: STRING,
          draft: { type: 'boolean' },
          assets: { type: 'array', items: { type: 'object', required: ['id', 'name', 'url'], properties: { id: { type: 'integer' }, name: STRING, url: STRING, digest: { type: 'string', nullable: true } } } },
        },
      },
    },
    patched: { type: 'array', nullable: true, items: TEXTS },
    deleted: { type: 'array', nullable: true, items: STRING },
  },
};
/** A pip call of the Python stub: its arguments, its directory and the requirements of a -r argument. */
type PipCall = { args: string[]; cwd: string; requirements?: string | null };
const PIP_CALL: JSONSchemaType<PipCall> = { type: 'object', required: ['args', 'cwd'], properties: { args: TEXTS, cwd: STRING, requirements: { type: 'string', nullable: true } } };

const GH_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.STUB_STATE, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
let status = 0;
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const byId = args.map(arg => /^repos\\/[^/]+\\/[^/]+\\/releases\\/(\\d+)$/.exec(arg)).find(Boolean);
const upload = args.map(arg => /^https:\\/\\/uploads\\.[^/]+\\/repos\\/[^/]+\\/[^/]+\\/releases\\/(\\d+)\\/assets\\?name=(.+)$/.exec(arg)).find(Boolean);
state.byId = state.byId ?? {};
if (args[0] === 'api' && args.some(arg => /\\/git\\/ref\\/tags\\//.test(arg))) {
  if (state.missingTag) { console.error('gh: Not Found (HTTP 404)'); status = 1; }
  else console.log('refs/tags/x');
} else if (args[0] === 'api' && method === 'POST' && args.some(arg => /^repos\\/[^/]+\\/[^/]+\\/releases$/.test(arg))) {
  // A draft that was just created: the API returns its id, and the list does not show it yet.
  if (state.failRelease) { console.error('gh: release failed'); status = 1; }
  else {
    const field = name => args.find(arg => arg.startsWith(name + '='));
    const tag = field('tag_name').slice('tag_name='.length);
    state.notes = fs.readFileSync(field('body').slice('body=@'.length), 'utf8');
    state.created = { tag, name: field('name').slice('name='.length), draft: field('draft').slice('draft='.length) };
    state.byId['42'] = { id: 42, tag_name: tag, draft: true, assets: [] };
    console.log(JSON.stringify({ id: 42, upload_url: 'https://uploads.example.com/repos/polyspec/kit-fixture/releases/42/assets{?name,label}' }));
  }
} else if (args[0] === 'api' && upload) {
  const release = state.byId[upload[1]];
  release.assets.push({ id: release.assets.length + 1, name: decodeURIComponent(upload[2]), url: 'https://example.com/polyspec/kit-fixture/releases/download/' + release.tag_name + '/' + decodeURIComponent(upload[2]), digest: null });
  state.uploads = [...(state.uploads ?? []), { name: decodeURIComponent(upload[2]), input: args[args.indexOf('--input') + 1], type: args[args.indexOf('-H') + 1] }];
  console.log('1');
} else if (args[0] === 'api' && byId && method === 'PATCH') {
  state.byId[byId[1]].draft = false;
  state.patched = [...(state.patched ?? []), args];
} else if (args[0] === 'api' && byId && method === 'DELETE') {
  state.deleted = [...(state.deleted ?? []), byId[1]];
} else if (args[0] === 'api' && byId) {
  const release = state.byId[byId[1]];
  if (!release) { console.error('gh: Not Found (HTTP 404)'); status = 1; }
  else console.log(JSON.stringify(release));
} else if (args[0] === 'api' && args.some(arg => arg.endsWith('/releases'))) {
  for (const release of state.releases ?? []) console.log(JSON.stringify(release));
} else if (args[0] === 'release' && args[1] === 'create') {
  if (state.failRelease) { console.error('gh: release failed'); status = 1; }
  else state.notes = fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
} else if (args[0] === 'release' && (args[1] === 'delete' || args[1] === 'edit')) {
  if (args[1] === 'edit') state.edited = args;
} else {
  console.error('gh stub: unexpected arguments ' + JSON.stringify(args));
  status = 1;
}
fs.writeFileSync(process.env.STUB_STATE, JSON.stringify(state));
process.exit(status);
`;

// STUB_NPM_MODE: "two" writes a second file, "rewrite" packs a reformatted package.json, "none" writes nothing.
const NPM_STUB = `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_NPM_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
if (args[0] !== 'pack') process.exit(1);
const mode = process.env.STUB_NPM_MODE || '';
const destination = path.resolve(args[args.indexOf('--pack-destination') + 1]);
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const name = manifest.name.replace(/^@/, '').replace('/', '-');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-npm-'));
fs.mkdirSync(path.join(folder, 'package'));
if (mode === 'rewrite') fs.writeFileSync(path.join(folder, 'package', 'package.json'), JSON.stringify(manifest));
else fs.copyFileSync('package.json', path.join(folder, 'package', 'package.json'));
if (mode !== 'none') execFileSync('tar', ['-czf', path.join(destination, name + '-' + manifest.version + '.tgz'), '-C', folder, 'package']);
if (mode === 'two') fs.writeFileSync(path.join(destination, 'extra.txt'), 'extra');
fs.rmSync(folder, { recursive: true, force: true });
`;

const CHANGELOG = `# Changelog

## Unreleased

- A change after the release.

## 0.0.1

- The first entry of 0.0.1.
- The second entry of 0.0.1.
`;

// The time of every commit of the sandbox; the zip entries of an archive carry it.
const COMMIT_DATE = '2001-02-03T04:05:06Z';

export const git = (root: string, ...args: string[]) => {
  const env = { ...process.env, GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE };
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
};

/** The JSON file `file` of `root` as Data, read through its schema of kit (readFixture). */
export const readJson = <Data,>(root: string, file: string): Data => readFixture<Data>(root, file);
export const writeJson = (root: string, file: string, value: unknown) => writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);

/** Sets the version of a manifest file of the sandbox (package.json, composer.json, Cargo.toml, pyproject.toml). */
function setVersion(root: string, file: string, version: string) {
  if (file.endsWith('.json')) {
    writeJson(root, file, { ...readJson<object>(root, file), version });
  } else {
    const text = readFileSync(path.join(root, file), 'utf8');
    writeFileSync(path.join(root, file), text.replace(/^version = ".*"$/m, `version = "${version}"`));
  }
}

/** The options of releaseSandbox. */
export type ReleaseSandboxOptions = { version?: string; changelog?: string; mutate?: (root: string) => void };

/**
 * A committed copy of the fixture at `version` with origin/main at the commit and the stubs on PATH. `mutate(root)` changes the files before the commit. Returns the root, the environment
 * of the commands, the commit and helpers for the stubs.
 */
export function releaseSandbox(t: Pick<TestContext, 'after'>, { version = '0.0.1', changelog = CHANGELOG, mutate = () => {} }: ReleaseSandboxOptions = {}) {
  const root = fixtureCheckout(t);
  const config = readJson<ReleaseConfig>(root, 'config/release.json');
  for (const file of Object.keys(config.manifests)) setVersion(root, file, version);
  const app = readJson<NpmManifest>(root, 'packages/fixture-app/package.json');
  writeJson(root, 'packages/fixture-app/package.json', { ...app, dependencies: { ...app.dependencies, 'fixture-lib': version } });
  mkdirSync(path.join(root, 'packages/fixture-php/src'), { recursive: true });
  writeFileSync(path.join(root, 'packages/fixture-php/src/Engine.php'), '<?php\n');
  writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  mutate(root);
  const bin = path.join(root, '.stubs/bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, source] of [['gh', GH_STUB], ['python3', PYTHON3_WHEEL_STUB], ['uv', UV_WHEEL_STUB]] as const) {
    writeFileSync(path.join(bin, name), source);
    chmodSync(path.join(bin, name), 0o755);
  }
  // npm is the tool of the checkout, so its stub is the file that var/tools/bin holds (K393-1).
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/npm'), NPM_STUB);
  chmodSync(path.join(root, 'var/tools/bin/npm'), 0o755);
  // The php-config of the checkout, which the pack passes to make as PHP_CONFIG (K930).
  writeFileSync(path.join(root, 'var/tools/bin/php-config'), '#!/bin/sh\nprintf "%s\\n" /opt/php\n');
  chmodSync(path.join(root, 'var/tools/bin/php-config'), 0o755);
  // go reads the go.mod files of the fixture. Pin the binary outside var/tools so a mise shim cannot recurse into this fixture's config.
  checkoutTools(root, ['go']);
  const state = path.join(root, '.stubs/state.json');
  const npmLog = path.join(root, '.stubs/npm.log');
  writeFileSync(npmLog, '');
  // The stubs and the run output are outside the files that Git tracks, so the tagged commit holds the repository only.
  writeFileSync(path.join(root, '.gitignore'), '.stubs/\nvar/\n');
  git(root, 'checkout', '--quiet', '-B', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'release');
  const commit = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', commit);
  // The Python and the uv of the checkout are var/tools/mise/shims/python3 and uv, the shims of mise: they run the pip stub and
  // the uv stub, whose build writes the wheel.
  for (const name of ['python3', 'uv']) {
    const shim = path.join(root, 'var/tools/mise/shims', name);
    mkdirSync(path.dirname(shim), { recursive: true });
    writeFileSync(shim, `#!/bin/sh\nexec '${path.join(bin, name)}' "$@"\n`);
    chmodSync(shim, 0o755);
  }
  const pythonLog = path.join(root, '.stubs/python.log');
  writeFileSync(pythonLog, '');
  // The tools of the sandbox are the stubs: gh, npm, python3 and uv here, and go and composer answering from their records
  // (toolStubs), never a go or Composer of the machine, whose release differs between machines.
  const stubs = toolStubs();
  const env = { ...stubs, PATH: `${bin}${path.delimiter}${stubs.PATH}`, STUB_STATE: state, STUB_NPM_LOG: npmLog, STUB_NPM_MODE: '', STUB_PYTHON_LOG: pythonLog, STUB_WHEEL_REQUIRES_FILE: path.join(root, '.stubs/wheel-requires.json') };
  const box = {
    root,
    env,
    commit,
    /** Resets the state of the gh stub to no calls, with `extra` fields such as failRelease or byId. */
    ghState(extra: Record<string, unknown> = {}) {
      writeFileSync(state, JSON.stringify({ calls: [], notes: null, ...extra }));
    },
    /** The releases the stub lists for the API, drafts included: each { id, tag_name, draft, assets }. */
    releases(list: unknown[]) {
      writeFileSync(state, JSON.stringify({ ...readStub(state, GH_STATE), releases: list }));
    },
    tag(name: string, target = commit): string {
      git(root, 'tag', '-a', name, '-m', name, target);
      return name;
    },
    /** The release tags of a version: vX.Y.Z and the tag of each Go module of the fixture, all at the commit. */
    release(version: string, target = commit): string {
      for (const directory of ['packages/fixture-go']) box.tag(`${directory}/v${version}`, target);
      return box.tag(`v${version}`, target);
    },
    state: () => readStub(state, GH_STATE),
    npmCalls: () => readStubLines(npmLog, STUB_CALL),
    /** The uv and pip calls of the Python stubs, each with its arguments, its directory and the requirements of a -r argument. */
    pipCalls: () => readStubLines(pythonLog, PIP_CALL),
    /** Sets the Requires-Dist lines that the uv stub writes into the wheel it builds. */
    wheelRequires: (lines: WheelRequires) => writeFileSync(env.STUB_WHEEL_REQUIRES_FILE, JSON.stringify(lines)),
  };
  box.ghState();
  return box;
}
