// K448-3: `uv install` of a consumer syncs its uv environment from uv.lock with each polyspec package that a checkout provides excluded,
// and links that checkout from the start: no release of a polyspec package is installed, not even before the link.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uvInstall } from '../../scripts/kit/link.mts';
import { uvInstallCommand } from '../../scripts/kit/uv-install.mts';

const LOCK = [
  'version = 1',
  '',
  '[[package]]',
  'name = "cons"',
  'version = "0"',
  'source = { virtual = "." }',
  'dependencies = [',
  '    { name = "polyspec-z" },',
  '    { name = "six" },',
  ']',
  '',
  '[[package]]',
  'name = "polyspec-z"',
  'version = "0.0.1"',
  'source = { registry = "https://example.invalid/simple" }',
  '',
  '[[package]]',
  'name = "six"',
  'version = "1.17.0"',
  'source = { registry = "https://example.invalid/simple" }',
  '',
].join('\n');

/** Runs git in `cwd` with a fixed identity; a failure throws with git's message. */
function git(cwd: string, ...args: string[]): string {
  const outcome = spawnSync('git', ['-c', 'user.name=min-0-max', '-c', 'user.email=max@blue.tools', ...args], { cwd, encoding: 'utf8' });
  if (outcome.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} exited ${outcome.status}: ${outcome.stderr}`);
  return outcome.stdout;
}

/** A Git repository at `folder` with `files`, committed once. */
function repository(folder: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
  git(folder, 'init', '-q');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'init');
}

/**
 * The fixture: the provider repository `prov` (the Python package polyspec-z in packages/python) and the consumer repository `cons`
 * whose uv project python/ locks polyspec-z 0.0.1 from a registry and six from a registry. `bin` holds the uv stub, which logs each call
 * to `log` and, for a sync that does not exclude polyspec-z, writes the marker of a release install into the environment.
 */
function workspace(t: { after: (fn: () => void) => void }) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-uv-install-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'uv.log');
  writeFileSync(log, '');
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const provider = path.join(root, 'prov');
  const consumer = path.join(root, 'cons');
  repository(provider, {
    '.gitignore': 'var/\n',
    'packages/python/pyproject.toml': '[project]\nname = "polyspec-z"\nversion = "0.0.1"\ndependencies = []\n',
  });
  repository(consumer, {
    '.gitignore': 'var/\n.venv/\n',
    'python/pyproject.toml': '[project]\nname = "cons"\nversion = "0"\nrequires-python = ">=3.10"\ndependencies = ["polyspec-z==0.0.1", "six==1.17.0"]\n',
    'python/uv.lock': LOCK,
  });
  // The python of the environment: a stub that logs its calls; uv sync installs it into the environment it creates.
  const python = path.join(bin, 'python');
  writeFileSync(python, `#!/bin/sh\necho "python $*" >> ${JSON.stringify(log)}\n`);
  chmodSync(python, 0o755);
  const uv = path.join(bin, 'uv');
  writeFileSync(uv, [
    '#!/bin/sh',
    `echo "uv $*" >> ${JSON.stringify(log)}`,
    'case "$1" in',
    '  workspace) pwd ;;',
    '  sync)',
    '    mkdir -p "$UV_PROJECT_ENVIRONMENT/bin"',
    '    echo "home = /usr" > "$UV_PROJECT_ENVIRONMENT/pyvenv.cfg"',
    `    cp ${JSON.stringify(python)} "$UV_PROJECT_ENVIRONMENT/bin/python"`,
    '    case " $* " in *" --no-install-package polyspec-z "*) ;; *) echo release > "$UV_PROJECT_ENVIRONMENT/release-polyspec-z" ;; esac; case " $* " in *" --no-install-package limepie-contracts "*) ;; *) echo release > "$UV_PROJECT_ENVIRONMENT/release-limepie-contracts" ;; esac ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(uv, 0o755);
  return { root, log, provider, consumer, env: { PATH: process.env.PATH, UV: uv } as NodeJS.ProcessEnv };
}

test('uv install syncs the locked releases without polyspec-z and links its checkout from the start (K448-3)', (t) => {
  const { log, provider, consumer, env } = workspace(t);
  const project = path.join(consumer, 'python');
  const venv = path.join(project, '.venv');
  const lines: string[] = [];
  uvInstall({ directory: project, checkouts: [provider], env, print: text => lines.push(text) });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const syncs = calls.filter(call => call.startsWith('uv sync'));
  assert.equal(syncs.length, 1, calls.join('\n'));
  assert.match(syncs[0] ?? '', /--locked .*--no-install-package polyspec-z/, 'the sync excludes the polyspec package of the checkout');
  assert.equal(existsSync(path.join(venv, 'release-polyspec-z')), false, 'no release of polyspec-z is installed');
  const install = calls.find(call => call.startsWith('uv pip install')) ?? '';
  assert.match(install, /--no-deps --reinstall-package polyspec-z/, calls.join('\n'));
  assert.match(install, /var\/link\/python\/.*\.whl$/, 'the install takes the editable wheel that link writes, never a release');
  // The stub logs the multi-line script of the record across lines, so the record is read from the whole log.
  assert.ok(readFileSync(log, 'utf8').includes(`python -I -c `) && readFileSync(log, 'utf8').includes(`polyspec-z file://${path.join(provider, 'packages/python')}`), 'the editable records its checkout');
  assert.equal(git(project, 'status', '--porcelain'), '', 'no tracked file changes');
  assert.equal(readFileSync(path.join(project, 'uv.lock'), 'utf8'), LOCK, 'the tracked lock is unchanged');
  assert.match(lines.join('\n'), /linked +python +polyspec-z -> /);
});

test('uv install refuses a declared polyspec package with no checkout before it runs uv (K448-3)', (t) => {
  const { log, consumer, env } = workspace(t);
  const project = path.join(consumer, 'python');
  assert.throws(() => uvInstall({ directory: project, checkouts: [], env, print: () => undefined }), /polyspec-z has no checkout/);
  assert.equal(readFileSync(log, 'utf8'), '', 'no uv call runs');
});

test('the uv install command refuses a declared polyspec package with no checkout and exits non-zero (K448-3)', (t) => {
  const { consumer, env } = workspace(t);
  const project = path.join(consumer, 'python');
  const output: string[] = [];
  const status = uvInstallCommand([project], { ...process.env, ...env }, text => output.push(text));
  assert.equal(status, 1, output.join(''));
  assert.match(output.join(''), /polyspec-z has no checkout/);
});

// K487: a given checkout whose name the project declares is linked from the start, whatever its name, and excluded from the sync by it:
// a sibling named limepie-contracts is installed from its checkout, and no release of it is installed.
test('uv install links a given checkout named limepie-contracts from the start, whatever its name (K487)', (t) => {
  const { root, log, consumer, env } = workspace(t);
  const contracts = path.join(root, 'contracts');
  repository(contracts, { '.gitignore': 'var/\n', 'packages/contracts/pyproject.toml': '[project]\nname = "limepie-contracts"\nversion = "0.0.1"\ndependencies = []\n' });
  const project = path.join(consumer, 'python');
  writeFileSync(path.join(project, 'pyproject.toml'), '[project]\nname = "cons"\nversion = "0"\nrequires-python = ">=3.10"\ndependencies = ["limepie-contracts==0.0.1"]\n');
  writeFileSync(path.join(project, 'uv.lock'), LOCK.replace('{ name = "polyspec-z" },', '{ name = "limepie-contracts" },').replace('name = "polyspec-z"', 'name = "limepie-contracts"'));
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '-q', '-m', 'lock');
  uvInstall({ directory: project, checkouts: [contracts], env, print: () => undefined });
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /uv sync --locked --no-install-package limepie-contracts/, calls);
  assert.equal(existsSync(path.join(project, '.venv', 'release-limepie-contracts')), false, 'no release of limepie-contracts is installed');
  assert.match(calls, /--reinstall-package limepie-contracts/, calls);
});

// K487: SYNC passes the sync flags that the consumer needs, and refuses any other flag before uv runs.
test('uv install passes --no-install-project and --all-groups to its sync, and refuses another sync flag before uv runs (K487)', (t) => {
  const { log, consumer, env } = workspace(t);
  const project = path.join(consumer, 'python');
  uvInstall({ directory: project, checkouts: [path.join(consumer, '..', 'prov')], sync: ['--no-install-project', '--all-groups'], env, print: () => undefined });
  assert.match(readFileSync(log, 'utf8'), /uv sync --locked --no-install-project --all-groups/);
  writeFileSync(log, '');
  assert.throws(() => uvInstall({ directory: project, checkouts: [], sync: ['--bogus'], env, print: () => undefined }), /unsupported sync flag --bogus/);
  assert.equal(readFileSync(log, 'utf8'), '', 'no uv call runs for a refused flag');
});

// K488: the link state of an install (its editable wheels) is written under STATE, so an install writes nothing into a source checkout
// that is mounted read-only; a STATE that is not absolute is refused.
test('uv install writes its link state under STATE and nothing into a read-only consumer top (K488)', (t) => {
  const { root, consumer, env } = workspace(t);
  const project = path.join(consumer, 'python');
  const state = path.join(root, 'state');
  mkdirSync(state);
  env.UV_PROJECT_ENVIRONMENT = path.join(root, 'venv');
  chmodSync(consumer, 0o555);
  try {
    uvInstall({ directory: project, checkouts: [path.join(root, 'prov')], state, env, print: () => undefined });
  } finally {
    chmodSync(consumer, 0o755);
  }
  assert.equal(existsSync(path.join(state, 'python')), true, 'the wheel is written under STATE');
  assert.equal(existsSync(path.join(consumer, 'var')), false, 'nothing is written into the consumer top');
});

test('uv install refuses a STATE that is not an absolute path (K488)', (t) => {
  const { consumer, env } = workspace(t);
  const project = path.join(consumer, 'python');
  assert.throws(() => uvInstall({ directory: project, checkouts: [], state: 'relative/state', env, print: () => undefined }), /STATE must be an absolute path/);
});
