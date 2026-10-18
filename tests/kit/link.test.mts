// Tests of link.mts, the local links of 0.0.x development (K201, K201-1). The tools are stubs that answer from files of the
// fixture and log their arguments: npm (npm query), Composer (config vendor-dir, dump-autoload, install), uv (workspace dir,
// pip list, pip install, sync), go (mod edit -json, work init, list -m) and cargo (locate-project); no npm, Composer,
// Python, go or cargo runs. make is the make of the machine, on Makefiles of the fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildState, buildTargets, rebuild } from '../../scripts/kit/link-build.mts';
import { assertIgnored, isIgnored, providers, trackedManifests } from '../../scripts/kit/link-providers.mts';
import { cargo, link, packages, unlink } from '../../scripts/kit/link.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';

/** The checkout of kit. */
const KIT = fileURLToPath(new URL('../../', import.meta.url));

/** The main checkouts that the test's workspace provides; link takes them as arguments (K205). */
let current: string[] = [];

/** Runs git in `directory` and fails with its stderr. */
function git(directory: string, ...args: string[]) {
  const result = spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', ...args], { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** A repository `name` of `root` with `files`, all of them tracked and committed. */
function repository(root: string, name: string, files: Record<string, string>): string {
  const directory = path.join(root, name);
  initRepository(directory);
  put(directory, files);
  git(directory, 'add', '-A');
  git(directory, 'commit', '--quiet', '-m', 'files');
  return directory;
}

/** An executable stub `name` in `bin` that logs its arguments to `log` and runs `body` (sh). */
function stub(bin: string, log: string, name: string, body: string) {
  const file = path.join(bin, name);
  put(bin, { [name]: `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n` });
  chmodSync(file, 0o755);
}

/**
 * A polyspec root with the provider checkout `prov` (the npm package @polyspec/x, the Composer package polyspec/y, the
 * Python package polyspec-z, which requires polyspec-w by its release URL, polyspec-w, and the Go module
 * github.com/polyspec/prov/go) and `kit` (@polyspec/kit), and the consumer checkout `cons`, whose npm project, Composer
 * vendor (under var/contracts, where its composer.json puts it), environment and go.mod hold released 0.0.x copies; the
 * tools are stubs in `bin`, which env names.
 */
function workspace(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'tools.log');
  writeFileSync(log, '');
  const bin = path.join(root, 'bin');
  const provider = repository(root, 'prov', {
    'packages/ts/package.json': JSON.stringify({ name: '@polyspec/x', exports: { '.': './dist/index.js' } }),
    'packages/ts/src/index.ts': 'export const x = 1;\n',
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', autoload: { 'psr-4': { 'Y\\': 'src/' } } }),
    'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = ["polyspec-w @ https://example.invalid/w.whl"]\n',
    'packages/w/pyproject.toml': '[project]\nname = "polyspec-w"\nversion = "0.0.1"\n',
    'go/go.mod': 'module github.com/polyspec/prov/go\n',
    'config/release.json': JSON.stringify({ repositoryUrl: 'https://github.com/polyspec/prov' }),
    'rust/Cargo.toml': '[package]\nname = "polyspec-prov"\nversion = "0.0.1"\n',
    '.gitignore': 'dist/\nvar/\n',
  });
  const kit = repository(root, 'kit', { 'package.json': JSON.stringify({ name: '@polyspec/kit', version: '0.0.53' }), '.gitignore': 'var/\n' });
  const consumer = repository(root, 'cons', {
    'package.json': JSON.stringify({ name: 'cons', private: true, dependencies: { '@polyspec/x': '0.0.1', '@polyspec/own': '0.0.1' }, devDependencies: { '@polyspec/kit': '0.0.53' } }),
    'package-lock.json': '{}',
    'packages/own/package.json': JSON.stringify({ name: '@polyspec/own' }),
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' } }),
    'composer.lock': '{}',
    'tests/release-consumer/composer/composer.json': JSON.stringify({ require: { 'polyspec/y': '0.0.1' } }),
    'python/pyproject.toml': '[project]\nname = "cons"\nversion = "0"\ndependencies = []\n[dependency-groups]\nbase = ["polyspec_Z[extra]==0.0.1; python_version>=\'3\'"]\ntest = [{ include-group = "base" }]\n',
    'python/uv.lock': 'version = 1\n',
    'go.mod': 'module cons\n',
    'Cargo.toml': '[package]\nname = "cons"\nversion = "0.0.0"\n',
    'Cargo.lock': 'version = 4\n',
    '.gitignore': 'node_modules/\nvar/\n.venv/\ngo.work\ngo.work.sum\n',
  });
  put(consumer, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }, { name: '@polyspec/kit', version: '0.0.53', location: 'node_modules/@polyspec/kit' }, { name: '@polyspec/own', version: '0.0.1', location: 'packages/own' }]),
    'node_modules/@polyspec/x/package.json': '{"name":"@polyspec/x","version":"0.0.1"}',
    'node_modules/@polyspec/kit/package.json': '{"name":"@polyspec/kit","version":"0.0.53"}',
    'composer-vendor-dir': 'var/contracts/vendor',
    'var/contracts/vendor/autoload.php': '',
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }] }),
    'var/contracts/vendor/polyspec/y/composer.json': '{"name":"polyspec/y"}',
    'python/.venv/pyvenv.cfg': 'home = /usr\n',
    'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '0.0.1' }, { name: 'polyspec-w', version: '0.0.1' }]),
    'go.mod.json': JSON.stringify({ Module: { Path: 'cons' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.3' }] }),
  });
  put(provider, { 'go/go.mod.json': JSON.stringify({ Module: { Path: 'github.com/polyspec/prov/go' } }) });
  stub(bin, log, 'npm', 'cat npm-query.json');
  stub(bin, log, 'composer', `if [ "$1 $4" = "config vendor-dir" ]; then cat composer-vendor-dir 2>/dev/null || echo vendor; fi`);
  stub(bin, log, 'uv', `case "$1" in run) for a; do last=$a; done; name=$(basename "$(dirname "$last")" | tr - _); mkdir -p "$last" && : > "$last/$name-0.0.1-py3-none-any.whl";; esac
case "$1 $2" in "workspace dir") pwd;; "pip list") cat ${JSON.stringify(path.join(consumer, 'pip-list.json'))};; "pip freeze") cat ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null || true;; esac`);
  stub(bin, log, 'go', `case "$1 $2" in "mod edit") cat "$4.json";; "work init") : > "$GOWORK";; "list -m") echo ${JSON.stringify(path.join(provider, 'go'))};; esac`);
  stub(bin, log, 'cargo', 'if [ "$1" = "locate-project" ]; then echo "$PWD/Cargo.toml"; fi');
  const env = { PATH: process.env.PATH, NPM: path.join(bin, 'npm'), COMPOSER_BIN: path.join(bin, 'composer'), UV: path.join(bin, 'uv'), GO: path.join(bin, 'go'), CARGO: path.join(bin, 'cargo') };
  current = [provider, kit, consumer];
  return { root, provider, kit, consumer, env, log: () => readFileSync(log, 'utf8') };
}

/** The lines that link prints, and its result. */
function linkLines(directories: string[], env: NodeJS.ProcessEnv, check = false) {
  const lines: string[] = [];
  const ok = link({ checkouts: current, directories, check, print: text => lines.push(text), env });
  return { ok, text: lines.join('\n') };
}

test('K205: link links the checkouts that it is given with no environment variable, and install-packages neither builds kit nor links', (t) => {
  const { provider, kit, consumer, env } = workspace(t);
  const lines: string[] = [];
  const ok = link({ checkouts: [provider, kit, consumer], directories: [consumer], check: false, print: text => lines.push(text), env });
  assert.equal(ok, true, lines.join('\n'));
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
  const bootstrap = readFileSync(path.join(KIT, 'scripts/kit/kit-bootstrap.mk'), 'utf8').split('\n');
  const start = bootstrap.findIndex(line => line.startsWith('install-packages:'));
  assert.ok(start >= 0, 'install-packages has a rule');
  const recipe: string[] = [];
  for (let index = start + 1; index < bootstrap.length && bootstrap[index]?.startsWith('\t'); index += 1) recipe.push(bootstrap[index] ?? '');
  assert.doesNotMatch(recipe.join('\n'), /link|build/);
});

test('the npm copies that npm query lists, kit installed as its released package among them, become links to the providers', (t) => {
  const { provider, kit, consumer, env } = workspace(t);
  const before = linkLines([consumer], env, true);
  assert.equal(before.ok, false);
  assert.match(before.text, /NOT linked npm {6}@polyspec\/x \(.*node_modules\/@polyspec\/x\)/);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/kit')), kit);
  assert.match(text, /own {8}npm {6}@polyspec\/own \(this repository\)/);
});

test('a package pinned at anything but 0.0.x is not linked, in each ecosystem', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '1.2.0', location: 'node_modules/@polyspec/x' }]),
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: 'v1.0.0', 'install-path': '../polyspec/y' }] }),
    'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '1.0' }, { name: 'polyspec-w', version: '0.0.1' }]),
    'go.mod.json': JSON.stringify({ Module: { Path: 'cons' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v1.0.0' }] }),
  });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked npm {6}@polyspec\/x \(pinned 1\.2\.0, not 0\.0\.x/);
  assert.match(text, /NOT linked composer polyspec\/y \(pinned v1\.0\.0, not 0\.0\.x/);
  assert.match(text, /NOT linked python {3}polyspec-z \(pinned 1\.0, not 0\.0\.x/);
  assert.match(text, /NOT linked go {7}github\.com\/polyspec\/prov\/go \(pinned v1\.0\.0, not 0\.0\.x\)/);
  assert.equal(lstatSync(path.join(consumer, 'node_modules/@polyspec/x')).isSymbolicLink(), false);
});

test('Composer links the copies of the vendor that composer config vendor-dir names, then dumps the autoloader; a release-consumer project is never linked', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'tests/release-consumer/composer/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }] }), 'tests/release-consumer/composer/vendor/polyspec/y/composer.json': '{}' });
  linkLines([consumer], env);
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')), path.join(provider, 'packages/php'));
  assert.equal(lstatSync(path.join(consumer, 'tests/release-consumer/composer/vendor/polyspec/y')).isSymbolicLink(), false);
  assert.match(log(), new RegExp(`composer dump-autoload --working-dir ${consumer}\\n`));
});

test('Composer dumps the autoloader once per project on every link run, even when nothing new is linked', (t) => {
  const { consumer, env, log } = workspace(t);
  linkLines([consumer], env);
  const dumps = () => log().split('\n').filter(item => item.startsWith('composer dump-autoload')).length;
  assert.equal(dumps(), 1);
  linkLines([consumer], env);
  assert.equal(dumps(), 2, 'the second run links nothing new, and still dumps once');
});

test('a polyspec folder that the tool does not record is a plain copy, NOT linked with its path', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'node_modules/@polyspec/x/node_modules/@polyspec/x/package.json': '{}', 'var/contracts/vendor/polyspec/copied/composer.json': '{}' });
  const { ok, text } = linkLines([consumer], env, true);
  assert.equal(ok, false);
  assert.match(text, /NOT linked npm {6}@polyspec\/x \(not recorded by npm query: .*node_modules\/@polyspec\/x\/node_modules\/@polyspec\/x\)/);
  assert.match(text, /polyspec\/copied \(a plain copy that Composer does not record: .*vendor\/polyspec\/copied\)/);
});

test('an npm copy that npm query does not record is linked only when it already is the provider; it is never linked at a guessed version', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'npm-query.json': JSON.stringify([]) });
  const other = path.join(consumer, 'elsewhere');
  put(consumer, { 'elsewhere/package.json': '{"name":"@polyspec/x"}' });
  rmSync(path.join(consumer, 'node_modules/@polyspec/x'), { recursive: true, force: true });
  symlinkSync(other, path.join(consumer, 'node_modules/@polyspec/x'));
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked npm {6}@polyspec\/x \(not recorded by npm query: .*node_modules\/@polyspec\/x\)/);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), realpathSync(other), 'the foreign link is kept');
  rmSync(path.join(consumer, 'node_modules/@polyspec/x'));
  symlinkSync(path.join(provider, 'packages/ts'), path.join(consumer, 'node_modules/@polyspec/x'));
  put(consumer, { 'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }, { name: '@polyspec/kit', version: '0.0.53', location: 'node_modules/@polyspec/kit' }]) });
  const linked = linkLines([consumer], env);
  assert.equal(linked.ok, true, linked.text);
  assert.match(linked.text, /npm {6}@polyspec\/x -> /);
  assert.doesNotMatch(linked.text, /npm {6}@polyspec\/x -> .*\(now\)/, 'the provider already is the copy: nothing is linked anew');
});

/** The fingerprint of the Python provider `folder` of `checkout` in the tests (K222): the resolved checkout path, its pyproject bytes; the fixture has no subdirectories. */
function fingerprintOf(checkout: string, folder: string): string {
  return createHash('sha256').update(`${realpathSync(checkout)}\n`).update(readFileSync(path.join(checkout, folder, 'pyproject.toml'))).digest('hex').slice(0, 12);
}

/** Makes `folder` writable (`writable`) or read-only for its owner, the way a read-only container mount of a checkout is (K222). */
function setWritable(folder: string, writable: boolean) {
  const result = spawnSync('chmod', ['-R', writable ? 'u+w' : 'a-w', folder], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

/** The wheel that link keeps for `name` of the consumer at fingerprint `fp`: var/link/wheels/<name>/<fp>/ (K222). */
const wheelFile = (consumer: string, name: string, fp: string) => path.join(consumer, 'var/link/wheels', name, fp, `${name.replaceAll('-', '_')}-0.0.1-py3-none-any.whl`);

test('K222: a read-only Python provider is installed from its prebuilt editable wheel of the same fingerprint, with no build in its checkout', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  const z = wheelFile(consumer, 'polyspec-z', fingerprintOf(provider, 'packages/python'));
  const w = wheelFile(consumer, 'polyspec-w', fingerprintOf(provider, 'packages/w'));
  put(consumer, { 'python/uv.lock': 'version = 1\n', [path.relative(consumer, z)]: '', [path.relative(consumer, w)]: '' });
  setWritable(provider, false);
  try {
    const { ok, text } = linkLines([consumer], env);
    assert.equal(ok, true, text);
    assert.match(text, /linked {5}python {3}polyspec-z -> /);
    const install = log().split('\n').find(item => item.startsWith('uv pip install')) ?? '';
    assert.ok(install.includes('--no-deps'), install);
    assert.ok(install.includes(z) && install.includes(w), install);
    assert.doesNotMatch(install, / -e /, 'no editable build of the checkout');
    assert.ok(!log().includes('uv run'), 'no build in a read-only checkout');
  } finally {
    setWritable(provider, true);
  }
});

test('K222: a read-only Python provider without a prebuilt wheel of its fingerprint fails with the stale message, and syncs nothing', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n' });
  setWritable(provider, false);
  try {
    const { ok, text } = linkLines([consumer], env);
    assert.equal(ok, false);
    assert.match(text, /NOT linked python {3}polyspec-z \(stale prebuilt wheel polyspec-z \(fingerprint [0-9a-f]{12}\): run kit link on the host\)/);
    assert.ok(!log().includes('uv sync'), 'no sync before a wheel is known to exist');
  } finally {
    setWritable(provider, true);
  }
});

test('K222: the same content at another path has another fingerprint, so the wheel of the first checkout is never reused and a read-only copy fails stale', (t) => {
  const { root, provider, kit, consumer, env } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n' });
  const copy = path.join(root, 'prov-copy');
  cpSync(provider, copy, { recursive: true });
  const z = wheelFile(consumer, 'polyspec-z', fingerprintOf(provider, 'packages/python'));
  const w = wheelFile(consumer, 'polyspec-w', fingerprintOf(provider, 'packages/w'));
  put(consumer, { [path.relative(consumer, z)]: '', [path.relative(consumer, w)]: '' });
  const copyFp = fingerprintOf(copy, 'packages/python');
  assert.notEqual(copyFp, fingerprintOf(provider, 'packages/python'));
  setWritable(copy, false);
  try {
    const lines: string[] = [];
    const ok = link({ checkouts: [copy, kit, consumer], directories: [consumer], check: false, print: text => lines.push(text), env });
    const text = lines.join('\n');
    assert.equal(ok, false, text);
    assert.match(text, new RegExp(`NOT linked python {3}polyspec-z \\(stale prebuilt wheel polyspec-z \\(fingerprint ${copyFp}\\): run kit link on the host\\)`));
    assert.doesNotMatch(text, /linked {5}python {3}polyspec-z -> /);
  } finally {
    setWritable(copy, true);
  }
});

test('K222: check fails when the installed wheel was built from another fingerprint than the checkout now has', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n' });
  const oldFp = fingerprintOf(provider, 'packages/python');
  const oldZ = wheelFile(consumer, 'polyspec-z', oldFp);
  const oldW = wheelFile(consumer, 'polyspec-w', fingerprintOf(provider, 'packages/w'));
  put(consumer, { [path.relative(consumer, oldZ)]: '', [path.relative(consumer, oldW)]: '', 'freeze.txt': `polyspec-z @ ${pathToFileURL(oldZ).href}\npolyspec-w @ ${pathToFileURL(oldW).href}\n` });
  assert.match(linkLines([consumer], env, true).text, /linked {5}python {3}polyspec-z -> /);
  put(provider, { 'packages/python/pyproject.toml': `${readFileSync(path.join(provider, 'packages/python/pyproject.toml'), 'utf8')}# changed\n` });
  const newFp = fingerprintOf(provider, 'packages/python');
  assert.notEqual(newFp, oldFp);
  const { ok, text } = linkLines([consumer], env, true);
  assert.equal(ok, false, text);
  assert.match(text, new RegExp(`NOT linked python {3}polyspec-z \\(installed fingerprint ${oldFp} differs from ${newFp} in .*python/\\.venv\\)`));
  assert.match(text, /linked {5}python {3}polyspec-w -> /);
});

test('K222: a writable Python provider without a wheel of its fingerprint is built as an editable wheel by its backend in an isolated uv env, then installed after the sync', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n' });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  const calls = log().split('\n');
  const build = calls.findIndex(item => item.startsWith('uv run --no-project --isolated --with setuptools>=40.8.0 python -c'));
  const sync = calls.findIndex(item => item.startsWith('uv sync --locked'));
  const install = calls.findIndex(item => item.startsWith('uv pip install') && item.includes('--no-deps'));
  assert.ok(build >= 0 && sync > build && install > sync, log());
  assert.ok(existsSync(wheelFile(consumer, 'polyspec-z', fingerprintOf(provider, 'packages/python'))));
});

test('the editable install of an older link (uv pip list shows an editable location, uv pip freeze no wheel) is NOT linked in check', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n', 'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '0.0.1', editable_project_location: path.join(provider, 'packages/python') }, { name: 'polyspec-w', version: '0.0.1', editable_project_location: path.join(provider, 'packages/w') }]) });
  const { ok, text } = linkLines([consumer], env, true);
  assert.equal(ok, false);
  assert.match(text, /NOT linked python {3}polyspec-z \(.*python\/\.venv\)/);
});

test('a Python provider that uv pip list does not show is NOT linked, not installed, and nothing is installed for it', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'pip-list.json': '[]' });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked python {3}polyspec-z \(not installed in .*python\/\.venv\)/);
  assert.match(text, /NOT linked python {3}polyspec-w \(not installed in .*python\/\.venv\)/);
  assert.ok(!log().includes('uv pip install'), 'no install of a provider that is not installed');
});

test('a Composer record without install-path is NOT linked, and no folder is guessed from its name', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }] }) });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked composer polyspec\/y \(no install-path in .*var\/contracts\/vendor\/composer\/installed\.json\)/);
  assert.doesNotMatch(text, /composer polyspec\/y -> /);
  assert.equal(lstatSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')).isSymbolicLink(), false);
});

test('a composer.json whose vendor holds no installed.json is reported NOT linked, not skipped', (t) => {
  const { consumer, env } = workspace(t);
  rmSync(path.join(consumer, 'var/contracts/vendor/composer/installed.json'));
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked composer polyspec\/y \(not installed in .*var\/contracts\/vendor\)/);
});

test('a polyspec name of require-dev of a composer.json without a linked record is reported NOT linked', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' }, 'require-dev': { 'polyspec/q': '0.0.1' } }) });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false);
  assert.match(text, /NOT linked composer polyspec\/q \(no provider\)/);
});

test('a missing tool of the consumer fails with its cause', (t) => {
  const { consumer, env } = workspace(t);
  const { UV: _uv, ...noUv } = env;
  assert.throws(() => linkLines([consumer], noUv), /the links of .*cons need .*var\/tools\/mise\/shims\/uv; run make install-tools there, or give UV/);
});

test('a malformed installed.json and a failed uv workspace dir throw with their cause', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'var/contracts/vendor/composer/installed.json': '{' });
  assert.throws(() => linkLines([consumer], env), /var\/contracts\/vendor\/composer\/installed\.json holds no valid JSON/);
  put(consumer, { 'var/contracts/vendor/composer/installed.json': '{"packages":[]}' });
  stub(path.dirname(env.UV), path.join(path.dirname(path.dirname(env.UV)), 'tools.log'), 'uv', 'echo "no workspace" >&2; exit 2');
  assert.throws(() => linkLines([consumer], env), /uv workspace dir exited with 2/);
});

test('two package folders that provide one name fail with both; a repository root next to a package folder does not', (t) => {
  const { root, provider } = workspace(t);
  put(provider, { 'other/package.json': JSON.stringify({ name: '@polyspec/x' }), 'package.json': JSON.stringify({ name: '@polyspec/x' }) });
  git(provider, 'add', '-A');
  git(provider, 'commit', '--quiet', '-m', 'twice');
  assert.throws(() => providers(current, undefined, root), /npm package @polyspec\/x has two providers: .*other and .*packages\/ts|npm package @polyspec\/x has two providers: .*packages\/ts and .*other/);
});

test('two root-level providers of one name from different checkouts throw with both', (t) => {
  const { root } = workspace(t);
  const first = repository(root, 'other', { 'package.json': JSON.stringify({ name: '@polyspec/r' }) });
  const second = repository(root, 'third', { 'package.json': JSON.stringify({ name: '@polyspec/r' }) });
  assert.throws(() => providers([...current, first, second], undefined, root), (error: unknown) => error instanceof Error && error.message.includes(first) && error.message.includes(second));
});

test('a root-level provider of another checkout yields to a package folder of one name', (t) => {
  const { root, provider } = workspace(t);
  const other = repository(root, 'other', { 'package.json': JSON.stringify({ name: '@polyspec/x' }) });
  assert.equal(providers([...current, other], undefined, root).get('npm:@polyspec/x')?.folder, path.join(provider, 'packages/ts'));
});

test('K220: a private npm package of a provider checkout is linked like any other: its copy becomes a link, and check passes', (t) => {
  const { root, consumer, env } = workspace(t);
  const priv = repository(root, 'priv', { 'package.json': JSON.stringify({ name: '@x/p', version: '0.0.1', private: true }), 'index.js': '' });
  current = [...current, priv];
  put(consumer, {
    'package.json': JSON.stringify({ name: 'cons', private: true, dependencies: { '@polyspec/x': '0.0.1', '@polyspec/own': '0.0.1', '@x/p': '0.0.1' }, devDependencies: { '@polyspec/kit': '0.0.53' } }),
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }, { name: '@polyspec/kit', version: '0.0.53', location: 'node_modules/@polyspec/kit' }, { name: '@polyspec/own', version: '0.0.1', location: 'packages/own' }, { name: '@x/p', version: '0.0.1', location: 'node_modules/@x/p' }]),
    'node_modules/@x/p/package.json': '{"name":"@x/p","version":"0.0.1"}',
  });
  const before = linkLines([consumer], env, true);
  assert.equal(before.ok, false, before.text);
  assert.match(before.text, /NOT linked npm {6}@x\/p \(/);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@x/p')), priv);
  const checked = linkLines([consumer], env, true);
  assert.match(checked.text, /^ {2}linked +npm +@x\/p -> /m, checked.text);
  assert.doesNotMatch(checked.text, /NOT linked npm +@x\/p /);
});

test('isIgnored is false outside a repository, decided by the absence of a .git entry; a folder inside one is checked by git', (t) => {
  const { root, consumer } = workspace(t);
  assert.equal(isIgnored(path.join(root, 'outside/var/link/go.work')), false);
  assert.equal(isIgnored(path.join(consumer, 'node_modules/x')), true);
});

test('a broken gitfile fails with git\'s own message, in the write check and in the consumer, and is never taken as outside a repository', (t) => {
  const { root, env } = workspace(t);
  const broken = path.join(root, 'broken');
  mkdirSync(broken);
  writeFileSync(path.join(broken, '.git'), 'gitdir: /nonexistent/git-dir\n');
  assert.throws(() => assertIgnored(path.join(broken, 'var/x')), /not a git repository/);
  assert.throws(() => linkLines([broken], env), /not a git repository/);
});

test('link writes nothing that Git does not ignore, and names the path', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { '.gitignore': 'node_modules/\n.venv/\n' });
  assert.throws(() => linkLines([consumer], env), /cons\/var\/.* is not ignored by Git in its repository; the links write only ignored files/);
});

test('link --project handles only the manifests directly in the folder; without it a nested uninstalled project is NOT linked (not installed)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(provider, { 'packages/extra/package.json': JSON.stringify({ name: '@polyspec/extra' }) });
  git(provider, 'add', '-A');
  git(provider, 'commit', '--quiet', '-m', 'extra');
  put(consumer, { 'node/package.json': JSON.stringify({ name: 'node-app', private: true, dependencies: { '@polyspec/extra': '0.0.1' } }) });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'node');
  const whole = linkLines([consumer], env);
  assert.equal(whole.ok, false);
  assert.match(whole.text, /NOT linked npm {6}@polyspec\/extra \(not installed\)/);
  const lines: string[] = [];
  const ok = link({ checkouts: current, directories: [consumer], project: true, check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, true, text);
  assert.doesNotMatch(text, /extra/, 'the nested project is not handled');
  assert.match(text, /npm {6}@polyspec\/x -> /);
});

test('a worktree of the consumer never links a package of its own repository, and a worktree is no provider', (t) => {
  const { root, provider, consumer, env } = workspace(t);
  git(consumer, 'worktree', 'add', '--quiet', path.join(root, 'cons-wt'));
  git(provider, 'worktree', 'add', '--quiet', path.join(root, 'prov-wt'));
  const tree = path.join(root, 'cons-wt');
  put(tree, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/own', version: '0.0.1', location: 'node_modules/@polyspec/own' }, { name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }]),
    'node_modules/@polyspec/own/package.json': '{}', 'node_modules/@polyspec/x/package.json': '{}',
    'go.mod.json': readFileSync(path.join(consumer, 'go.mod.json'), 'utf8'),
  });
  const { text } = linkLines([tree], env);
  assert.match(text, /own {8}npm {6}@polyspec\/own \(this repository\)/);
  assert.equal(lstatSync(path.join(tree, 'node_modules/@polyspec/own')).isSymbolicLink(), false);
  assert.equal(realpathSync(path.join(tree, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'), 'the main checkout provides, not prov-wt');
});

test('a Git hook exports the variables of its repository; the link tool still finds the providers of the other repositories (K201-4)', (t) => {
  const { provider, consumer, env } = workspace(t);
  const keys = ['GIT_DIR', 'GIT_INDEX_FILE'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.GIT_DIR = path.join(consumer, '.git');
  process.env.GIT_INDEX_FILE = path.join(consumer, '.git', 'index');
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.doesNotMatch(text, /NOT linked/);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
});

test('a project with only package.json links with no Composer: each tool resolves only for a project whose manifest needs it (K201-4)', (t) => {
  const { root, provider, env } = workspace(t);
  const { COMPOSER_BIN: _composer, ...withoutComposer } = env;
  const app = repository(root, 'app', {
    'package.json': JSON.stringify({ name: 'app', private: true, dependencies: { '@polyspec/x': '0.0.1' } }),
    'package-lock.json': '{}',
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }]),
    'node_modules/@polyspec/x/package.json': '{"name":"@polyspec/x","version":"0.0.1"}',
    '.gitignore': 'node_modules/\nvar/\n',
  });
  const lines: string[] = [];
  const ok = link({ checkouts: current, directories: [app], check: false, print: text => lines.push(text), env: withoutComposer, project: true });
  assert.equal(ok, true, lines.join('\n'));
  assert.equal(realpathSync(path.join(app, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
});

test('a failing git ls-files throws with its cause, in the manifests and in the build inputs', (t) => {
  const { root } = workspace(t);
  const outside = path.join(root, 'not-a-repository');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }));
  assert.throws(() => trackedManifests(outside, ['package.json']), /git ls-files failed in .*not-a-repository: /);
  assert.throws(() => buildState(outside, outside), /git ls-files failed in .*not-a-repository: /);
});

test('a symbolic link loop of a polyspec folder fails the link with the system error, not as a missing folder', (t) => {
  const { consumer, env } = workspace(t);
  const folder = path.join(consumer, 'node_modules/@polyspec/x');
  rmSync(folder, { recursive: true, force: true });
  symlinkSync(folder, folder);
  assert.throws(() => linkLines([consumer], env), /ELOOP/);
});

test('link never builds; check reports a provider whose output is behind its sources as STALE and fails; rebuild records it', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(provider, { Makefile: 'release-assets: build-ts\nbuild-ts:\n\tmkdir -p packages/ts/dist && cp packages/ts/src/index.ts packages/ts/dist/index.js\n' });
  git(provider, 'add', 'Makefile');
  git(provider, 'commit', '--quiet', '-m', 'make');
  assert.deepEqual(buildTargets(provider), ['build-ts']);
  linkLines([consumer], env);
  const folder = path.join(provider, 'packages/ts');
  assert.equal(existsSync(path.join(folder, 'dist')), false, 'link built nothing');
  const stale = linkLines([consumer], env, true);
  assert.equal(stale.ok, false);
  assert.match(stale.text, /STALE {6}npm {6}@polyspec\/x -> .*: stale \(missing dist\/index\.js\); run link\.mjs rebuild /);
  rebuild(provider, () => {}, env);
  assert.equal(buildState(provider, folder), 'fresh');
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(folder, 'src/index.ts'), later, later);
  assert.equal(buildState(provider, folder), 'fresh', 'a touch is no change');
  writeFileSync(path.join(folder, 'src/index.ts'), 'export const x = 2;\n');
  utimesSync(path.join(folder, 'src/index.ts'), later, later);
  assert.match(buildState(provider, folder), /^stale \(src\/index\.ts is newer than dist\/index\.js\)$/);
});

test('a make status 2 other than a missing rule fails the build targets with its error', (t) => {
  const { provider } = workspace(t);
  put(provider, { Makefile: 'ifeq (a,a)\nbuild:\n\ttrue\n' });
  assert.throws(() => buildTargets(provider), /make -pq release-assets failed in .*endif/);
});

test('a missing prerequisite of release-assets fails with make\'s error, not as a missing target', (t) => {
  const { provider } = workspace(t);
  put(provider, { Makefile: 'release-assets: missing-dep\n\ttrue\n' });
  assert.throws(() => buildTargets(provider), /No rule to make target `missing-dep', needed by `release-assets'\./);
});

test('cargo copies the tracked lock afresh on every run and patches the URL that the provider declares', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  assert.equal(cargo({ directory: consumer, args: ['check'], checkouts: current, env }), 0);
  const copy = path.join(consumer, 'var/link/cargo/root/Cargo.lock');
  writeFileSync(copy, 'changed\n');
  cargo({ directory: consumer, args: ['check'], checkouts: current, env });
  assert.equal(readFileSync(copy, 'utf8'), 'version = 4\n');
  assert.match(log(), new RegExp(`patch\\."https://github\\.com/polyspec/prov"\\.polyspec-prov\\.path=${JSON.stringify(path.join(provider, 'rust')).replaceAll('.', '\\.')}`));
  rmSync(path.join(provider, 'config/release.json'));
  assert.throws(() => cargo({ directory: consumer, args: ['check'], checkouts: current, env }), /config\/release\.json declares no repositoryUrl/);
});

test('unlink restores with each tool and reports each restore that it skips', (t) => {
  const { consumer, env, log } = workspace(t);
  rmSync(path.join(consumer, 'composer.lock'));
  rmSync(path.join(consumer, 'python/uv.lock'));
  const lines: string[] = [];
  assert.equal(unlink({ directories: [consumer], print: text => lines.push(text), env }), false);
  assert.match(log(), /npm ci\n/);
  assert.match(lines.join('\n'), /skipped {4}composer .*: no composer\.lock/);
  assert.match(lines.join('\n'), /skipped {4}python .*: no environment or no uv\.lock/);
});

/** A copy of the Makefile of kit and of its kit.mk, with the empty folders that the build of the Makefile copies. */
function kitSandbox(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-make-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(path.join(KIT, 'Makefile'), path.join(dir, 'Makefile'));
  mkdirSync(path.join(dir, 'scripts/kit/schema'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts/kit/symbols'), { recursive: true });
  copyFileSync(path.join(KIT, 'scripts/kit/kit.mk'), path.join(dir, 'scripts/kit/kit.mk'));
  return dir;
}

test('make build restores dist when the rename of dist.next fails, and exits 1', (t) => {
  const dir = kitSandbox(t);
  put(dir, { 'node_modules/.bin/tsc': '#!/bin/sh\nmkdir -p dist.next\n', 'dist/old.js': 'old\n', 'bin/mv': '#!/bin/sh\nif [ "$1" = dist.next ] && [ "$2" = dist ]; then echo "mv: injected failure" >&2; exit 1; fi\nexec /bin/mv "$@"\n' });
  chmodSync(path.join(dir, 'node_modules/.bin/tsc'), 0o755);
  chmodSync(path.join(dir, 'bin/mv'), 0o755);
  const result = spawnSync('make', ['-C', dir, 'build'], { encoding: 'utf8', env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` } });
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /\*\*\* \[build\] Error 1/);
  assert.equal(readFileSync(path.join(dir, 'dist/old.js'), 'utf8'), 'old\n', 'the previous dist is back');
  assert.equal(existsSync(path.join(dir, 'dist.old')), false);
});

test('a release target runs with GOWORK off, and a Go target keeps the GOWORK of its environment (K205)', (t) => {
  const dir = kitSandbox(t);
  const log = path.join(dir, 'node.log');
  put(dir, { 'bin/node': `#!/bin/sh\necho "$* GOWORK=$GOWORK" >> ${JSON.stringify(log)}\n` });
  chmodSync(path.join(dir, 'bin/node'), 0o755);
  const { GOWORK: _inherited, ...base } = process.env;
  const make = (...goals: string[]) => spawnSync('make', ['-C', dir, `NODE=${path.join(dir, 'bin/node')}`, ...goals], { encoding: 'utf8', env: { ...base, TAG: 'v0.0.1' } });
  assert.equal(make('release-assets').status, 0);
  assert.equal(make('kit-fixture-record').status, 0);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.match(lines[0] ?? '', /assets v0\.0\.1 GOWORK=off$/);
  assert.match(lines[1] ?? '', /record-fixture\.mts GOWORK=$/);
  assert.equal(existsSync(path.join(dir, 'var/link')), false, 'make writes no link file of its own');
});
test('K205: each Go module gets a git-ignored go.work at its root that uses the module and the providers; unlink --project removes only its own', (t) => {
  const { consumer, env, log } = workspace(t);
  const requires = JSON.stringify({ Module: { Path: 'sub' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.3' }] });
  put(consumer, { 'sub/go.mod': 'module sub\n', 'sub/go.mod.json': requires });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'sub');
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  const outer = path.join(consumer, 'go.work');
  const inner = path.join(consumer, 'sub/go.work');
  assert.ok(existsSync(outer), 'go work init wrote the go.work at the module root');
  assert.ok(isIgnored(outer) && isIgnored(inner), 'both are git-ignored');
  assert.match(log(), /go work init \. \.\.\/prov\/go\n/);
  assert.match(log(), /go work init \. \.\.\/\.\.\/prov\/go\n/);
  const lines: string[] = [];
  assert.equal(unlink({ directories: [consumer], project: true, print: text => lines.push(text), env }), true, lines.join('\n'));
  assert.equal(existsSync(outer), false, 'the go.work of the named module is removed');
  assert.equal(existsSync(inner), true, 'the go.work of the nested module stays');
});
test('Composer under --project: a named project with its own composer.json and no installed vendor never takes the vendor of an ancestor project', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'sub/composer.json': JSON.stringify({ name: 'cons/sub', require: { 'polyspec/y': '0.0.1' } }) });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'sub');
  const lines: string[] = [];
  const ok = link({ checkouts: current, directories: [path.join(consumer, 'sub')], project: true, check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, false, text);
  assert.match(text, new RegExp(`NOT linked composer polyspec/y \\(not installed in ${path.join(consumer, 'sub/vendor').replaceAll('/', '\\/')}\\)`));
  assert.equal(lstatSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')).isSymbolicLink(), false, 'the ancestor vendor is not linked');
  assert.doesNotMatch(log(), /composer dump-autoload --working-dir .*cons\n/, 'the ancestor project is not dumped');
});

test('Composer under --project: a named folder with no composer.json of its own, nested in a Composer project, touches no vendor of the ancestor', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'sub/go.mod': 'module sub\n', 'sub/go.mod.json': JSON.stringify({ Module: { Path: 'sub' }, Require: [] }) });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'sub');
  const lines: string[] = [];
  assert.equal(link({ checkouts: current, directories: [path.join(consumer, 'sub')], project: true, check: false, print: text => lines.push(text), env }), true, lines.join('\n'));
  assert.equal(lstatSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')).isSymbolicLink(), false);
  assert.doesNotMatch(log(), /composer/, 'Composer is not involved for a folder without a composer.json');
});

test('K212: an explicit --project folder under a git-ignored tree is read from its own manifests, and its npm copies link with no package-lock.json', (t) => {
  const { provider, consumer, env } = workspace(t);
  const installation = path.join(consumer, 'var/example/installation');
  put(installation, {
    'package.json': JSON.stringify({ name: 'installation', private: true, dependencies: { '@polyspec/x': '0.0.1' } }),
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }]),
    'node_modules/@polyspec/x/package.json': '{"name":"@polyspec/x","version":"0.0.1"}',
  });
  assert.equal(existsSync(path.join(installation, 'package-lock.json')), false);
  const lines: string[] = [];
  const ok = link({ checkouts: current, directories: [installation], project: true, check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, true, text);
  assert.match(text, /linked .*@polyspec\/x -> /);
  assert.equal(realpathSync(path.join(installation, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
});

test('K212: an explicit --project folder that holds no manifest throws an error that names it, never a silent pass', (t) => {
  const { consumer, env } = workspace(t);
  const empty = path.join(consumer, 'var/example/empty');
  put(empty, { 'README.txt': 'no manifest\n' });
  assert.throws(
    () => link({ checkouts: current, directories: [empty], project: true, check: false, print: () => {}, env }),
    (error: unknown) => error instanceof Error && error.message.includes(empty) && /holds no package\.json/.test(error.message),
  );
});

test('K212: a declared @polyspec dependency that an explicit --project folder does not link fails the run', (t) => {
  const { consumer, env } = workspace(t);
  const installation = path.join(consumer, 'var/example/installation');
  put(installation, { 'package.json': JSON.stringify({ name: 'installation', private: true, dependencies: { '@polyspec/x': '0.0.1' } }) });
  const lines: string[] = [];
  const ok = link({ checkouts: current, directories: [installation], project: true, check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, false, text);
  assert.match(text, /NOT linked npm {6}@polyspec\/x \(not installed\)/);
});
