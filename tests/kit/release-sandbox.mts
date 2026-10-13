// Helpers of the release tests: a Git repository in a temporary directory that holds the fixture at one version, a change
// log, origin/main and stubs of `gh` and `npm` first on PATH. The stub `gh` answers the check runs of the GitHub API from a
// JSON state file and records each call and the notes of a release; the stub `npm` packs the package.json of its directory
// into the tarball that npm pack writes and records each call. No test reaches GitHub or a registry.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { fixtureCheckout } from './checkout.mts';
import { sha256 } from '../../scripts/kit/bootstrap/digest.mts';
import { BACKEND_BYTES, BACKEND_FILE, PYTHON3_WHEEL_STUB } from './wheel-stubs.mts';
import type { WheelRequires } from './wheel-stubs.mts';

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
  release.assets.push({ id: release.assets.length + 1, name: decodeURIComponent(upload[2]), url: null, digest: null });
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
} else if (args[0] === 'api' && args[1] === '--paginate') {
  for (const run of state.checkRuns) console.log(JSON.stringify([run.id, run.name, run.status, run.conclusion]));
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

export const CHANGELOG = `# Changelog

## Unreleased

- A change after the release.

## 0.0.1

- The first entry of 0.0.1.
- The second entry of 0.0.1.
`;

// The time of every commit of the sandbox; the zip entries of an archive carry it.
export const COMMIT_DATE = '2001-02-03T04:05:06Z';

export const git = (root: string, ...args: string[]) => {
  const env = { ...process.env, GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE };
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
};

export const readJson = (root: string, file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
export const writeJson = (root: string, file: string, value: unknown) => writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);

/** Sets the version of a manifest file of the sandbox (package.json, composer.json, Cargo.toml, pyproject.toml). */
function setVersion(root: string, file: string, version: string) {
  if (file.endsWith('.json')) {
    const data = readJson(root, file);
    writeJson(root, file, { ...data, version });
  } else {
    const text = readFileSync(path.join(root, file), 'utf8');
    writeFileSync(path.join(root, file), text.replace(/^version = ".*"$/m, `version = "${version}"`));
  }
}

/** The options of releaseSandbox. */
export type ReleaseSandboxOptions = { version?: string; changelog?: string; mutate?: (root: string) => void };

/**
 * A committed copy of the fixture at `version` with origin/main at the commit, the stubs on PATH and the check runs
 * push-gate and ci-passed succeeded. `mutate(root)` changes the files before the commit. Returns the root, the environment
 * of the commands, the commit and helpers for the stubs.
 */
export function releaseSandbox(t: Pick<TestContext, 'after'>, { version = '0.0.1', changelog = CHANGELOG, mutate = () => {} }: ReleaseSandboxOptions = {}) {
  const root = fixtureCheckout(t);
  const config = readJson(root, 'config/release.json');
  for (const file of Object.keys(config.manifests)) setVersion(root, file, version);
  const app = readJson(root, 'packages/fixture-app/package.json');
  writeJson(root, 'packages/fixture-app/package.json', { ...app, dependencies: { ...app.dependencies, 'fixture-lib': version } });
  mkdirSync(path.join(root, 'packages/fixture-php/src'), { recursive: true });
  writeFileSync(path.join(root, 'packages/fixture-php/src/Engine.php'), '<?php\n');
  writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  // The build backend of the sandbox is the stand-in of the wheel tests, so the declared sha256 is the digest of the stand-in.
  writeJson(root, 'config/release.json', { ...config, buildBackend: { ...config.buildBackend, sha256: sha256(BACKEND_BYTES) } });
  mutate(root);
  const bin = path.join(root, '.stubs/bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, source] of [['gh', GH_STUB], ['npm', NPM_STUB], ['python3', PYTHON3_WHEEL_STUB]] as const) {
    writeFileSync(path.join(bin, name), source);
    chmodSync(path.join(bin, name), 0o755);
  }
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
  // The Python of the checkout is var/tools/mise/shims/python3, the shim of mise: it runs the pip stub, and the build
  // backend is the stand-in file in var/tools/wheels, which release-backend.mts writes from its pinned download.
  const python = path.join(root, 'var/tools/mise/shims/python3');
  mkdirSync(path.dirname(python), { recursive: true });
  writeFileSync(python, `#!/bin/sh\nexec '${path.join(bin, 'python3')}' "$@"\n`);
  chmodSync(python, 0o755);
  mkdirSync(path.join(root, 'var/tools/wheels'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/wheels', BACKEND_FILE), BACKEND_BYTES);
  const pythonLog = path.join(root, '.stubs/python.log');
  writeFileSync(pythonLog, '');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_STATE: state, STUB_NPM_LOG: npmLog, STUB_NPM_MODE: '', STUB_PYTHON_LOG: pythonLog, STUB_WHEEL_REQUIRES_FILE: path.join(root, '.stubs/wheel-requires.json') };
  const box = {
    root,
    env,
    commit,
    /** The check runs the stub answers: [name, conclusion or null for a run in progress], with ids in order. */
    checkRuns(runs: Array<[string, string | null]>, extra: Record<string, unknown> = {}) {
      writeFileSync(state, JSON.stringify({ calls: [], notes: null, checkRuns: runs.map(([name, conclusion], index) => ({ id: index + 1, name, status: conclusion ? 'completed' : 'in_progress', conclusion })), ...extra }));
    },
    /** The releases the stub lists for the API, drafts included: each { id, tag_name, draft, assets }. */
    releases(list: unknown[]) {
      const current = JSON.parse(readFileSync(state, 'utf8'));
      writeFileSync(state, JSON.stringify({ ...current, releases: list }));
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
    state: () => JSON.parse(readFileSync(state, 'utf8')),
    npmCalls: () => readFileSync(npmLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
    /** The pip calls of the Python stub, each with its arguments, its directory and the requirements of a -r argument. */
    pipCalls: () => readFileSync(pythonLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
    /** Sets the Requires-Dist lines that the pip stub writes into the wheel it builds. */
    wheelRequires: (lines: WheelRequires) => writeFileSync(env.STUB_WHEEL_REQUIRES_FILE, JSON.stringify(lines)),
  };
  box.checkRuns([['push-gate', 'success'], ['ci-passed', 'success']]);
  return box;
}
