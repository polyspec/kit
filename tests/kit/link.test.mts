// Tests of link.mts, the local links of 0.0.x development (K201, K201-1). The tools are stubs that answer from files of the
// fixture and log their arguments: npm (npm query), Composer (config vendor-dir, update, install), uv (workspace dir,
// pip list, pip install, sync), go (mod edit -json, work init, list -m) and cargo (locate-project); no npm, Composer,
// Python, go or cargo runs. make is the make of the machine, on Makefiles of the fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeTest, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildState, buildTargets, rebuild } from '../../scripts/kit/link-build.mts';
import { assertIgnored, isIgnored, providers, siblingCheckouts, trackedManifests } from '../../scripts/kit/link-providers.mts';
import { composerInstall } from '../../scripts/kit/composer-install.mts';
import { linkFindings } from '../../scripts/kit/link-state-check.mts';
import { cargo, link, unlink } from '../../scripts/kit/link.mts';
import { shippedAssets } from '../../scripts/kit/kit-assets.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';
import { isJsonObject, readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { repositoryRoot } from '../../scripts/kit/paths.mts';
import { readJsonFile } from '../../scripts/kit/schema-validate.mts';

/** What the Composer stub saw in its last update: the file it read, the packages it was given and the repositories of that file. */
function seenUpdate(consumer: string): { file: string; targets: unknown[]; repositories: unknown[] } {
  const value: unknown = JSON.parse(readFileSync(path.join(consumer, 'composer-update.seen.json'), 'utf8'));
  if (!isJsonObject(value) || typeof value.file !== 'string' || !isJsonObject(value.manifest)) throw new Error('composer-update.seen.json holds no file and manifest');
  const targets: unknown[] = Array.isArray(value.targets) ? value.targets : [];
  const repositories: unknown[] = Array.isArray(value.manifest.repositories) ? value.manifest.repositories : [];
  return { file: value.file, targets, repositories };
}


/** Every case has its own timeout (K301): a case that hangs fails after a minute instead of holding the run. */
const test = (name: string, body: (t: TestContext) => void): void => { void nodeTest(name, { timeout: 60_000 }, body); };

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
 * The three repositories of every workspace, committed once per process (K301): creating them costs a few dozen git processes, so each
 * workspace is a copy of this tree, which holds only tracked content; the files that name absolute paths are written after the copy.
 */
let template: string | undefined;
function workspaceTemplate(): string {
  if (template !== undefined) return template;
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-template-')));
  process.once('exit', () => rmSync(folder, { recursive: true, force: true }));
  repository(folder, 'prov', {
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
  repository(folder, 'kit', { 'package.json': JSON.stringify({ name: '@polyspec/kit', version: '0.0.53' }), '.gitignore': 'var/\n' });
  // A checkout of a polyspec repository has the origin of its name (K363).
  git(path.join(folder, 'prov'), 'remote', 'add', 'origin', 'https://github.com/polyspec/prov.git');
  git(path.join(folder, 'kit'), 'remote', 'add', 'origin', 'git@github.com:polyspec/kit.git');
  repository(folder, 'cons', {
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
  template = folder;
  return folder;
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
  cpSync(workspaceTemplate(), root, { recursive: true });
  const provider = path.join(root, 'prov');
  const kit = path.join(root, 'kit');
  const consumer = path.join(root, 'cons');
  // The files of the consumer that the uv stub and the venv's python stub share (K398).
  const freezeFile = JSON.stringify(path.join(consumer, 'freeze.txt'));
  put(consumer, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }, { name: '@polyspec/kit', version: '0.0.53', location: 'node_modules/@polyspec/kit' }, { name: '@polyspec/own', version: '0.0.1', location: 'packages/own' }]),
    'node_modules/@polyspec/x/package.json': '{"name":"@polyspec/x","version":"0.0.1"}',
    'node_modules/@polyspec/kit/package.json': '{"name":"@polyspec/kit","version":"0.0.53"}',
    'composer-vendor-dir': 'var/contracts/vendor',
    'var/contracts/vendor/autoload.php': '',
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }] }),
    'var/contracts/vendor/polyspec/y/composer.json': '{"name":"polyspec/y"}',
    'python/.venv/pyvenv.cfg': 'home = /usr\n',
    // The venv's python (K230): for each distribution named after -c SCRIPT it prints the path of the wheel that freeze.txt installs
    // (its direct_url) and the editable marker, which editable.txt removes with a line "name no".
    'python/.venv/bin/python': `#!/bin/sh\ncase "$3" in *write_text*) name=$4; url=$5; grep -v "^$name[=@ ]" ${freezeFile} > ${freezeFile}.next 2>/dev/null; mv ${freezeFile}.next ${freezeFile}; echo "$name @ $url" >> ${freezeFile}; exit 0;; esac\nshift 3\nfor name in "$@"; do\n  if ! grep -q "^$name[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null; then printf '%s\\tabsent\\tno\\n' "$name"; continue; fi\n  url=$(grep "^$name @ " ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null | tail -n 1 | sed 's/^[^@]* @ file:\\/\\///')\n  if grep -qx "$name no" ${JSON.stringify(path.join(consumer, 'editable.txt'))} 2>/dev/null; then editable=no; else editable=yes; fi\n  printf '%s\\t%s\\t%s\\n' "$name" "$( [ -n "$url" ] && echo "$url" || echo none)" "$( [ -n "$url" ] && echo "$editable" || echo no)"\ndone\n`,
    'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '0.0.1' }, { name: 'polyspec-w', version: '0.0.1' }]),
    'go.mod.json': JSON.stringify({ Module: { Path: 'cons' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.3' }] }),
  });
  chmodSync(path.join(consumer, 'python/.venv/bin/python'), 0o755);
  put(provider, { 'go/go.mod.json': JSON.stringify({ Module: { Path: 'github.com/polyspec/prov/go' } }) });
  stub(bin, log, 'npm', 'cat npm-query.json');
  // `composer update <names> --working-dir <project>` under COMPOSER=<file>: for each path repository of that file, the installed
  // folder of the package it provides becomes a link to the url (what Composer does with `symlink`); the stub records the file it read.
  put(bin, { 'composer-update.mjs': `import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const project = args[args.indexOf('--working-dir') + 1];
const file = path.join(project, process.env.COMPOSER);
writeFileSync(path.join(project, 'composer-update.seen.json'), JSON.stringify({ file: process.env.COMPOSER, targets: args.filter(item => item.includes('/') && !item.startsWith('-') && item !== project), manifest: JSON.parse(readFileSync(file, 'utf8')) }));
let vendor = 'vendor';
try { vendor = readFileSync(path.join(project, 'composer-vendor-dir'), 'utf8').trim(); } catch {}
const recordFile = path.join(project, vendor, 'composer/installed.json');
// A fresh vendor has no record yet, so Composer writes one with each path package that it installs.
const fresh = !existsSync(recordFile);
const record = fresh ? { packages: [] } : JSON.parse(readFileSync(recordFile, 'utf8'));
for (const repository of JSON.parse(readFileSync(file, 'utf8')).repositories ?? []) {
  if (repository.type !== 'path') continue;
  const url = path.resolve(project, repository.url);
  const name = JSON.parse(readFileSync(path.join(url, 'composer.json'), 'utf8')).name;
  let entry = record.packages.find(item => item.name === name);
  if (!entry && fresh) { entry = { name, version: repository.options?.versions?.[name] ?? '0.0.0', 'install-path': path.join('..', name) }; record.packages.push(entry); }
  if (!entry?.['install-path']) continue;
  const target = path.resolve(project, vendor, 'composer', entry['install-path']);
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  symlinkSync(url, target);
  entry.dist = { type: 'path', url };
}
mkdirSync(path.dirname(recordFile), { recursive: true });
writeFileSync(recordFile, JSON.stringify(record));
` });
  stub(bin, log, 'composer', `if [ "$1 $4" = "config vendor-dir" ]; then cat composer-vendor-dir 2>/dev/null || echo vendor; fi\nif [ "$1" = update ]; then node ${JSON.stringify(path.join(bin, 'composer-update.mjs'))} "$@"; fi\nif [ "$1" = dump-autoload ]; then echo "COMPOSER=$COMPOSER" >> ${JSON.stringify(log)}; fi`);
  stub(bin, log, 'uv', `case "$1" in sync) case " $* " in *" --inexact "*|*" --all-groups "*) ;; *) if [ -f ${JSON.stringify(path.join(consumer, 'test-only.txt'))} ]; then while read n; do grep -v "^$n[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))}; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; done < ${JSON.stringify(path.join(consumer, 'test-only.txt'))}; fi;; esac; if [ -f ${JSON.stringify(path.join(consumer, 'sync-rewrites.txt'))} ]; then while read n u; do case " $* " in *" --no-install-package $n "*) ;; *) grep -v "^$n[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))}; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; echo "$n @ $u" >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; echo "$n no" >> ${JSON.stringify(path.join(consumer, 'editable.txt'))};; esac; done < ${JSON.stringify(path.join(consumer, 'sync-rewrites.txt'))}; fi; ag=no; case " $* " in *" --all-groups "*) ag=yes;; esac; prev=""; for a; do if [ "$prev" = "--reinstall-package" ] && [ "$ag" = yes ]; then grep -v "^$a[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))}; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; grep "^$a==" ${JSON.stringify(path.join(consumer, 'export.txt'))} >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null; fi; prev="$a"; done;;
export) cat ${JSON.stringify(path.join(consumer, 'export.txt'))} 2>/dev/null;;
esac
case "$1 $2" in "workspace dir") d=$PWD; while [ "$d" != / ]; do grep -q tool.uv.workspace "$d/pyproject.toml" 2>/dev/null && { echo "$d"; exit 0; }; d=$(dirname "$d"); done; pwd;; "pip list") cat ${JSON.stringify(path.join(consumer, 'pip-list.json'))};; "pip check") cat ${JSON.stringify(path.join(consumer, 'pip-check.txt'))} 2>/dev/null || true;; "pip freeze") cat ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null || true;; "pip install") rm -f ${JSON.stringify(path.join(consumer, 'pip-check.txt'))}; shift 2; nodeps=""; while [ $# -gt 0 ]; do case "$1" in --constraints) cp "$2" ${JSON.stringify(path.join(consumer, 'constraints.logged'))}; shift 2;; --overrides) cp "$2" ${JSON.stringify(path.join(consumer, 'overrides.logged'))}; shift 2;; --python|--reinstall-package) shift 2;; --no-deps) nodeps=1; shift;; -e) dir=$2; n=$(sed -n 's/^name = "\\(.*\\)"/\\1/p' "$dir/pyproject.toml" | head -n 1 | tr _ -); grep -v "^$n[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))} 2>/dev/null; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; echo "$n @ file://$dir" >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; if [ -z "$nodeps" ]; then for dep in $(sed -n 's/^dependencies = \\[\\(.*\\)\\]/\\1/p' "$dir/pyproject.toml" | tr -d "\\"' " | tr ',' '\\n' | sed 's/[=<>@].*//'); do grep -q "^$dep[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null || echo "$dep==1.0" >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; done; fi; shift 2;; *.whl) n=$(basename "$1" | cut -d- -f1 | tr _ -); grep -v "^$n[=@ ]" ${freezeFile} > ${freezeFile}.next 2>/dev/null; mv ${freezeFile}.next ${freezeFile}; echo "$n @ file://$1" >> ${freezeFile}; if [ -z "$nodeps" ]; then for dep in $(unzip -p "$1" '*.dist-info/METADATA' | sed -n 's/^Requires-Dist: \\([A-Za-z0-9._-]*\\).*/\\1/p'); do grep -q "^$dep[=@ ]" ${freezeFile} 2>/dev/null || echo "$dep==1.0" >> ${freezeFile}; done; fi; shift;; *) shift;; esac; done;; esac`);
  // The work init writes the Use of the go.work that it writes, as a go.work.json beside it, which work edit -json reads.
  // The list -m of a module that the module of the folder a does not require fails as real go does.
  stub(bin, log, 'go', `case "$1 $2" in "mod edit") cat "$4.json";; "work edit") cat "$4.json";; "work init") : > "$GOWORK"; shift 2; { printf '{"Use":['; s=""; for d in "$@"; do printf '%s{"DiskPath":"%s"}' "$s" "$d"; s=","; done; printf ']}'; } > "$GOWORK.json";; "list -m") if [ "$5" = b ] && [ "$(basename "$PWD")" = a ]; then echo "go: module $5: not a known dependency" >&2; exit 1; fi; echo ${JSON.stringify(path.join(provider, 'go'))};; esac`);
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

test('K205: link links the checkouts that it is given with no environment variable, install-packages only installs, and install links last (K360-1, K360-2)', (t) => {
  const { provider, kit, consumer, env } = workspace(t);
  const lines: string[] = [];
  const ok = link({ checkouts: [provider, kit, consumer], directories: [consumer], check: false, print: text => lines.push(text), env });
  assert.equal(ok, true, lines.join('\n'));
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
  const bootstrap = readFileSync(path.join(KIT, 'scripts/kit/kit-bootstrap.mk'), 'utf8').split('\n');
  // The recipe lines of a rule: the lines after its head that start with a tab.
  const recipeOf = (target: string): string[] => {
    const start = bootstrap.findIndex(line => line.startsWith(`${target}:`));
    assert.ok(start >= 0, `${target} has a rule`);
    const out: string[] = [];
    for (let index = start + 1; index < bootstrap.length && bootstrap[index]?.startsWith('\t'); index += 1) out.push(bootstrap[index] ?? '');
    return out;
  };
  // Before the package is installed there is no Go, so install-packages must not link: only npm ci.
  const packages = recipeOf('install-packages').join('\n');
  assert.match(packages, /\$\(NPM\) ci/);
  assert.doesNotMatch(packages, /link/);
  // install-kit installs only; the recipe of install links, after all its prerequisites, the steps of the repository included.
  assert.doesNotMatch(recipeOf('install-kit').join('\n'), /link/);
  assert.deepEqual(recipeOf('install'), ['\t$(MAKE) --no-print-directory install-link']);
  assert.doesNotMatch(recipeOf('install-link').join('\n'), /\$\(MAKE\)[^\n]*build|npm run build/);
});

// K348-1: beside a kit checkout, KIT is its dist from the first make on; without it, as in CI, the installed package.
test('the bootstrap takes the dist of the kit checkout beside the repository as KIT, fails when it is not built, and takes the installed package without it (K348-1)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-k348-1-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'ws/cons');
  const kit = path.join(root, 'ws/kit');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(path.join(kit, '.git'), { recursive: true });
  mkdirSync(path.join(kit, 'dist'), { recursive: true });
  writeFileSync(path.join(kit, 'dist/kit.mk'), '# the kit.mk of the kit checkout\n');
  const makefile = path.join(KIT, 'scripts/kit/kit-bootstrap.mk');
  const dry = () => spawnSync('make', ['-n', '-f', makefile, 'install-link', 'KIT_EXT=mjs', 'NODE=node'], { cwd, encoding: 'utf8' });
  assert.match(dry().stdout, /node \.\.\/kit\/dist\/link\.mjs link --siblings/);
  rmSync(path.join(kit, 'dist/kit.mk'));
  const unbuilt = dry();
  assert.notEqual(unbuilt.status, 0);
  assert.match(unbuilt.stderr, /\.\.\/kit\/dist\/kit\.mk is missing: the kit checkout beside the repository is not built; run make build in \.\.\/kit/);
  rmSync(kit, { recursive: true, force: true });
  assert.match(dry().stdout, /node node_modules\/@polyspec\/kit\/dist\/link\.mjs link --siblings/);
});

// K360-2: a step of the repository, which installs an environment that the link reads, runs before the link.
test('make install runs the steps of the repository before the link (K360-2)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-k360-2-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'cons');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(cwd, 'Makefile'), `include ${path.join(KIT, 'scripts/kit/kit-bootstrap.mk')}\ninstall: cons-install\ncons-install: install-kit\n\t@echo the step of the repository\n`);
  const run = spawnSync('make', ['-n', 'install', 'KIT_EXT=mjs', 'NODE=node', 'NPM=npm', 'ONLINE='], { cwd, encoding: 'utf8' });
  const step = run.stdout.indexOf('the step of the repository');
  const linked = run.stdout.indexOf('link --siblings');
  assert.ok(step >= 0 && linked > step, `the step of the repository runs before the link:\n${run.stdout}${run.stderr}`);
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

test('Composer links the packages of the vendor that composer config vendor-dir names through a path repository with symlink, in a git-ignored composer.link.json; a release-consumer project is never linked (K304-1)', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'tests/release-consumer/composer/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }] }), 'tests/release-consumer/composer/vendor/polyspec/y/composer.json': '{}' });
  linkLines([consumer], env);
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')), path.join(provider, 'packages/php'));
  assert.equal(lstatSync(path.join(consumer, 'tests/release-consumer/composer/vendor/polyspec/y')).isSymbolicLink(), false);
  assert.match(log(), new RegExp(`composer update polyspec/y --with-dependencies --no-scripts --no-plugins --no-interaction --working-dir ${consumer}\n`));
  const seen = seenUpdate(consumer);
  assert.equal(seen.file, 'composer.link.json', 'Composer reads the link manifest, never the tracked composer.json');
  assert.deepEqual(seen.repositories[0], { type: 'path', url: path.join(provider, 'packages/php'), options: { symlink: true, versions: { 'polyspec/y': '0.0.1' } } });
});

test('rebuild refreshes the Composer autoload of each linked consumer (K347)', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  // A Composer project of the consumer that no link touches: its own vendor, with no polyspec package.
  put(consumer, { 'sub/composer.json': JSON.stringify({ name: 'cons/sub', require: {} }), 'sub/vendor/composer/installed.json': JSON.stringify({ packages: [] }) });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'sub');
  linkLines([consumer], env);
  assert.equal(existsSync(path.join(consumer, 'composer.link.json')), true, 'the consumer is linked');
  const built = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'rebuild', provider], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  assert.match(log(), new RegExp(`composer dump-autoload [^\n]*--working-dir ${consumer}\nCOMPOSER=composer\\.link\\.json\n`));
  assert.doesNotMatch(log(), /dump-autoload [^\n]*--working-dir [^\n]*\/sub\n/, 'a project that is not linked is left as it is');
});

test('a linked package and an own path package are updated by Composer through the path repositories of composer.link.json, with the released version of the lock (K304-1)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, {
    'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }, { name: 'psr/log', version: '3.0.0' }] }),
    'packages/own-php/composer.json': JSON.stringify({ name: 'polyspec/own-php', require: { php: '>=8.4' } }),
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [
      { name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' },
      { name: 'polyspec/own-php', version: 'dev-main', dist: { type: 'path', url: '../../../packages/own-php' }, 'install-path': '../../../../packages/own-php' },
    ] }),
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' }, repositories: [{ type: 'artifact', url: 'var/composer-artifacts' }, { type: 'path', url: 'packages/own-php' }] }),
  });
  linkLines([consumer], env);
  const seen = seenUpdate(consumer);
  assert.deepEqual(seen.targets, ['polyspec/y', 'polyspec/own-php']);
  assert.deepEqual(seen.repositories, [
    { type: 'path', url: path.join(provider, 'packages/php'), options: { symlink: true, versions: { 'polyspec/y': '0.0.1' } } },
    { type: 'artifact', url: 'var/composer-artifacts' },
    { type: 'path', url: 'packages/own-php' },
  ]);
  assert.equal(readJsonFile<{ repositories: unknown[] }>(path.join(consumer, 'composer.json'), 'composer-manifest.schema.json').repositories.length, 2, 'the tracked composer.json is unchanged');
});

test('a relink keeps the versions that the link lock holds for the packages that it does not link (K392)', (t) => {
  const { consumer, env } = workspace(t);
  const vendor = JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }] });
  put(consumer, {
    'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }, { name: 'psr/log', version: '3.0.0' }] }),
    'var/contracts/vendor/composer/installed.json': vendor,
  });
  const linkLock = path.join(consumer, 'composer.link.lock');
  const versionOf = (name: string) => {
    const lock: unknown = JSON.parse(readFileSync(linkLock, 'utf8'));
    if (!isJsonObject(lock) || !Array.isArray(lock.packages)) throw new Error('composer.link.lock holds no packages list');
    const packages: unknown[] = lock.packages;
    const item = packages.find(entry => isJsonObject(entry) && entry.name === name);
    return isJsonObject(item) ? item.version : undefined;
  };
  linkLines([consumer], env);
  assert.equal(versionOf('psr/log'), '3.0.0', 'the first link writes the link lock from the tracked lock');
  // What `make dependency-review UPDATE=1` applies to the link lock: a package that is not linked moves to another release.
  const lock: unknown = JSON.parse(readFileSync(linkLock, 'utf8'));
  if (!isJsonObject(lock) || !Array.isArray(lock.packages)) throw new Error('composer.link.lock holds no packages list');
  const packages: unknown[] = lock.packages;
  for (const item of packages) if (isJsonObject(item) && item.name === 'psr/log') item.version = '3.0.1';
  writeFileSync(linkLock, JSON.stringify(lock));
  // The relink follows a new install of the vendor, which holds the archive again, so Composer updates the linked package.
  writeFileSync(path.join(consumer, 'var/contracts/vendor/composer/installed.json'), vendor);
  linkLines([consumer], env);
  assert.equal(versionOf('psr/log'), '3.0.1', 'the relink keeps the link lock, not the tracked composer.lock');
});

// K392-3: link finds a Composer project linked from its installed vendor and runs no update, so it writes the link files that it lacks.
test('a Composer project that link finds linked from its installed vendor gets its link manifest and lock (K392-3)', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }, { name: 'psr/log', version: '3.0.0' }] }) });
  linkLines([consumer], env);
  // The vendor holds the provider as a link to its checkout, and the project has no link files: the state before link wrote them.
  rmSync(path.join(consumer, 'composer.link.json'));
  rmSync(path.join(consumer, 'composer.link.lock'));
  const relinked = linkLines([consumer], env);
  assert.equal(relinked.ok, true, relinked.text);
  assert.equal(existsSync(path.join(consumer, 'composer.link.json')), true, 'the link manifest is written');
  assert.equal(readFileSync(path.join(consumer, 'composer.link.lock'), 'utf8'), readFileSync(path.join(consumer, 'composer.lock'), 'utf8'), 'the link lock is the tracked lock');
  rmSync(path.join(consumer, 'composer.link.lock'));
  const checked = linkLines([consumer], env, true);
  assert.equal(checked.ok, false, checked.text);
  assert.match(checked.text, /NOT linked composer polyspec\/y \(no composer\.link\.lock in /);
});

// K330: Composer reads repositories only from the root manifest, so the link writes those of a linked package into composer.link.json.
test('the repositories that a linked package declares are written into composer.link.json (K330)', (t) => {
  const { provider, consumer, env } = workspace(t);
  const fork = { type: 'vcs', url: 'https://github.com/min-0-max/yaml', 'no-api': true };
  put(provider, { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', repositories: [fork, { type: 'path', url: '../other' }] }) });
  linkLines([consumer], env);
  const seen = seenUpdate(consumer);
  assert.deepEqual(seen.repositories.filter(entry => isJsonObject(entry) && entry.type === 'vcs'), [fork]);
  assert.equal(seen.repositories.filter(entry => isJsonObject(entry) && entry.url === '../other').length, 0, 'a path repository of the provider is relative to the provider and is not copied');
});

// K349: the checkouts beside the repository are the checkouts of a link without arguments, also from a worktree of the repository.
test('siblingCheckouts finds the checkouts beside the repository, not the repository, and a worktree finds the same (K349)', (t) => {
  const { provider, kit, consumer } = workspace(t);
  assert.deepEqual(siblingCheckouts(consumer).checkouts, [kit, provider].sort());
  git(consumer, 'worktree', 'add', '--quiet', path.join(path.dirname(consumer), 'cons-wt'), '-b', 'wt');
  assert.deepEqual(siblingCheckouts(path.join(path.dirname(consumer), 'cons-wt')).checkouts, [kit, provider].sort());
  const alone = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-alone-')));
  t.after(() => rmSync(alone, { recursive: true, force: true }));
  initRepository(path.join(alone, 'only'));
  assert.deepEqual(siblingCheckouts(path.join(alone, 'only')), { checkouts: [], skipped: [] }, 'no sibling, as in CI');
});

// K363: a sibling is the main checkout of a polyspec repository, its origin github.com/polyspec/<name> and its folder that name.
test('siblingCheckouts takes only the checkouts of polyspec repositories and lists every other folder as skipped (K363)', (t) => {
  const { provider, kit, consumer } = workspace(t);
  const workspaceFolder = path.dirname(consumer);
  cpSync(provider, path.join(workspaceFolder, 'prov_2026'), { recursive: true });
  git(path.join(workspaceFolder, 'prov_2026'), 'remote', 'remove', 'origin');
  cpSync(provider, path.join(workspaceFolder, 'prov-copy'), { recursive: true });
  assert.deepEqual(siblingCheckouts(consumer), {
    checkouts: [kit, provider].sort(),
    skipped: [`${path.join(workspaceFolder, 'prov-copy')} (origin https://github.com/polyspec/prov.git)`, `${path.join(workspaceFolder, 'prov_2026')} (no origin)`],
  });
});

test('link --siblings links a fork checkout of forks/ beside the checkouts as the provider of its package (K379)', (t) => {
  const { root, provider, kit, consumer, env } = workspace(t);
  const fork = repository(path.join(root, 'forks'), 'json-schema', {
    'composer.json': JSON.stringify({ name: 'opis/json-schema', autoload: { 'psr-4': { 'Opis\\JsonSchema\\': 'src/' } } }),
    '.gitignore': 'vendor/\n',
  });
  git(fork, 'remote', 'add', 'origin', 'https://github.com/min-median-max/json-schema.git');
  put(consumer, {
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1', 'opis/json-schema': '2.6.0-p1' } }),
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }, { name: 'opis/json-schema', version: '2.6.0-p1', 'install-path': '../opis/json-schema' }] }),
    'var/contracts/vendor/opis/json-schema/composer.json': '{"name":"opis/json-schema"}',
  });
  const checkouts = siblingCheckouts(consumer).checkouts;
  assert.deepEqual(checkouts, [fork, kit, provider].sort());
  assert.equal(link({ checkouts, directories: [consumer], check: false, print: () => {}, env }), true);
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/opis/json-schema')), fork);
  // The 0.0.x rule still holds for a polyspec package: polyspec/y pinned 1.0.0 is NOT linked in the same run.
  const lines: string[] = [];
  put(consumer, {
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '1.0.0', 'install-path': '../polyspec/y' }, { name: 'opis/json-schema', version: '2.6.0-p1', 'install-path': '../opis/json-schema' }] }),
  });
  link({ checkouts, directories: [consumer], check: false, print: text => lines.push(text), env });
  assert.match(lines.join('\n'), /NOT linked +composer +polyspec\/y .*pinned 1\.0\.0, not 0\.0\.x/);
});

// K379-1: a fork that the consumer pins at an exact version (2.6.0-p1, declared with a vcs repository) is linked with that version, so
// Composer takes the fork folder for it in the partial update, not the release that the lock recorded.
test('link --siblings writes the pinned version of a linked fork into the link manifest, so Composer takes it from forks/ (K379-1)', (t) => {
  const { root, consumer, env } = workspace(t);
  const fork = repository(path.join(root, 'forks'), 'json-schema', {
    'composer.json': JSON.stringify({ name: 'opis/json-schema', autoload: { 'psr-4': { 'Opis\\JsonSchema\\': 'src/' } } }),
  });
  put(consumer, {
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1', 'opis/json-schema': '2.6.0-p1' }, repositories: [{ type: 'vcs', url: 'https://github.com/min-0-max/json-schema' }] }),
    // The lock still holds the release that it recorded before the fork was pinned (limepie, S-565), as the tracked lock and the link lock do.
    'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }, { name: 'opis/json-schema', version: '2.6.0' }] }),
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }, { name: 'opis/json-schema', version: '2.6.0', 'install-path': '../opis/json-schema' }] }),
    'var/contracts/vendor/opis/json-schema/composer.json': '{"name":"opis/json-schema"}',
  });
  const checkouts = siblingCheckouts(consumer).checkouts;
  assert.ok(checkouts.includes(fork), 'the fork of forks/ is a checkout');
  const lines: string[] = [];
  assert.equal(link({ checkouts, directories: [consumer], check: false, print: text => lines.push(text), env }), true, lines.join('\n'));
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/opis/json-schema')), fork, 'the fork is linked from forks/');
  assert.ok(seenUpdate(consumer).targets.includes('opis/json-schema'), 'the partial update names the fork');
  // The link manifest keeps the requirement of the consumer, and its path repository of the fork names the version the consumer pins.
  const manifest: unknown = JSON.parse(readFileSync(path.join(consumer, 'composer.link.json'), 'utf8'));
  if (!isJsonObject(manifest) || !isJsonObject(manifest.require) || !Array.isArray(manifest.repositories)) throw new Error('composer.link.json holds no require and repositories');
  const repositories: unknown[] = manifest.repositories;
  assert.equal(manifest.require['opis/json-schema'], '2.6.0-p1');
  assert.deepEqual(repositories.find(item => isJsonObject(item) && item.url === fork), { type: 'path', url: fork, options: { symlink: true, versions: { 'opis/json-schema': 'v2.6.0-p1' } } });
});

// K385: a worktree is its own repository: its packages are its own, and the main checkout of its repository is never a provider.
test('providers take the packages of the work tree of the consumer as its own, and never the main checkout of its repository (K385)', (t) => {
  const { provider, kit, consumer } = workspace(t);
  const worktree = path.join(path.dirname(consumer), 'cons-wt');
  git(consumer, 'worktree', 'add', '--quiet', worktree, '-b', 'wt');
  const found = providers([provider, kit, consumer], undefined, worktree, worktree);
  const own = found.get('npm:@polyspec/own');
  assert.ok(own, 'the own package of the consumer is a provider');
  assert.equal(own.checkout, worktree, 'it is provided by the work tree that runs the link, not by the main checkout');
  assert.equal(own.repository, realpathSync(path.join(consumer, '.git')));
  assert.equal(found.get('npm:@polyspec/x')?.checkout, provider, 'another repository stays a provider');
  assert.equal(providers([provider, kit], undefined, consumer, consumer).get('npm:@polyspec/own')?.checkout, consumer, 'a main checkout reads its own packages without naming itself');
});

test('Composer updates the packages to link once, and a second link run, with everything linked, runs no update (K304-1)', (t) => {
  const { consumer, env, log } = workspace(t);
  linkLines([consumer], env);
  const dumps = () => log().split('\n').filter(item => item.startsWith('composer update')).length;
  assert.equal(dumps(), 1);
  linkLines([consumer], env);
  assert.equal(dumps(), 1, 'the second run links nothing new, so Composer has nothing to install');
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

// K316-2: the install recipe of a consumer (uv sync without the polyspec packages) removes the editables of an earlier link, so the second
// run finds the declared polyspec packages not installed and installs them as the editables of their folders again.
test('a link run twice, with an install between, ends linked both times: a declared package that is not installed is installed as an editable (K316-2)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n', 'freeze.txt': 'polyspec-z @ file:///released/polyspec_z-0.0.1-py3-none-any.whl\n' });
  const z = path.join(provider, 'packages/python');
  const first = linkLines([consumer], env);
  assert.equal(first.ok, true, first.text);
  assert.ok(readFileSync(path.join(consumer, 'freeze.txt'), 'utf8').includes(`polyspec-z @ file://${z}`));
  // The install between the runs: uv sync uninstalls the linked editables and installs nothing in their place.
  put(consumer, { 'freeze.txt': '', 'pip-list.json': '[]' });
  const second = linkLines([consumer], env);
  assert.equal(second.ok, true, second.text);
  assert.match(second.text, /linked {5}python {3}polyspec-z -> .*\(.*, now\)/);
  assert.ok(readFileSync(path.join(consumer, 'freeze.txt'), 'utf8').includes(`polyspec-z @ file://${z}`), 'the package is installed as the editable of its folder');
  const third = linkLines([consumer], env);
  assert.equal(third.ok, true, third.text);
});

test('K237: a link keeps the packages of the consumer groups, installs the dependencies of the checkout and holds the locked versions', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  // The checkout declares jsonschema, which the consumer's lock holds for its test group, and small-dep, which the lock does not hold.
  put(provider, { 'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = ["jsonschema==4.23.0", "small-dep>=1"]\n' });
  // The consumer's install with all groups: polyspec-z and jsonschema are in the test group, which the default sync does not select.
  put(consumer, {
    'python/uv.lock': 'version = 1\n',
    'freeze.txt': 'jsonschema==4.23.0\npolyspec-z @ file:///released/polyspec_z-0.0.1-py3-none-any.whl\n',
    'test-only.txt': 'polyspec-z\njsonschema\n',
    'export.txt': 'jsonschema==4.23.0\npolyspec-z==0.0.1\n',
  });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  const freeze = readFileSync(path.join(consumer, 'freeze.txt'), 'utf8');
  const z = path.join(provider, 'packages/python');
  assert.match(freeze, /^jsonschema==4\.23\.0$/m, 'the package of the test group that the consumer installed is kept');
  assert.match(freeze, /^small-dep==1\.0$/m, 'a dependency that the checkout declares and the lock does not hold is installed');
  assert.ok(freeze.includes(`polyspec-z @ file://${z}`), 'polyspec-z is the wheel of the checkout');
  assert.match(text, /linked {5}python {3}polyspec-z -> /);
  const calls = log().split('\n');
  assert.ok(!log().includes('uv sync'), 'the link runs no sync: the consumer set is not reinstalled (K239)');
  assert.ok(calls.some(item => item.startsWith('uv export --frozen --all-groups')), log());
  const install = calls.find(item => item.startsWith('uv pip install')) ?? '';
  assert.ok(!install.includes('--no-deps') && install.includes('--constraints') && install.includes('--overrides'), install);
  const constraints = readFileSync(path.join(consumer, 'constraints.logged'), 'utf8');
  assert.match(constraints, /^jsonschema==4\.23\.0$/m, 'the locked versions are the constraints');
  assert.doesNotMatch(constraints, /polyspec-z/, 'a linked package is no constraint: its checkout version is installed');
});

test('K280: a project of the consumer environment is installed with --no-deps, a linked provider with its dependencies', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  // The consumer project depends on a package that the consumer's lock sync provides another way (a path dependency of no index).
  put(provider, { 'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = ["small-dep>=1"]\n' });
  put(consumer, { 'python/uv.lock': 'version = 1\n', 'python/pyproject.toml': readFileSync(path.join(consumer, 'python/pyproject.toml'), 'utf8').replace('dependencies = []', 'dependencies = ["path-only-dep"]') });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  const freeze = readFileSync(path.join(consumer, 'freeze.txt'), 'utf8');
  assert.match(freeze, /^small-dep==1\.0$/m, 'a dependency of the linked provider is installed');
  assert.doesNotMatch(freeze, /path-only-dep/, 'a dependency of the consumer project is left to the consumer lock sync');
  const installs = log().split('\n').filter(item => item.startsWith('uv pip install'));
  const own = installs.filter(item => item.includes('cons-0-py3-none-any.whl'));
  assert.equal(own.length, 1, installs.join('\n'));
  assert.ok(own[0]?.includes('--no-deps') && own[0].includes('--reinstall-package cons') && !own[0].includes('polyspec_z'), installs.join('\n'));
  const providers = installs.filter(item => !item.includes('cons-0-py3-none-any.whl'));
  assert.equal(providers.length, 1, installs.join('\n'));
  assert.ok(!providers[0]?.includes('--no-deps') && providers[0]?.includes('--constraints') && providers[0].includes('--overrides'), installs.join('\n'));
});

test('K230: a provider installed from its folder without the editable install is NOT linked, though the folder is the one of the checkout', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n' });
  const z = path.join(provider, 'packages/python');
  const w = path.join(provider, 'packages/w');
  put(consumer, { 'freeze.txt': `polyspec-z @ ${pathToFileURL(z).href}\npolyspec-w @ ${pathToFileURL(w).href}\n`, 'editable.txt': 'polyspec-z no\n' });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false, text);
  assert.doesNotMatch(text, /linked {5}python {3}polyspec-z -> /, 'no link is reported while the venv holds no editable install');
  assert.match(text, /NOT linked python {3}polyspec-z \(installed from its folder without the editable install in .*python\/\.venv\)/);
  assert.match(text, /linked {5}python {3}polyspec-w -> /);
  assert.ok(log().includes('uv pip install'), 'the folder is installed again before the verdict');
});

/** The files of `folder` by their relative paths: a folder as <dir>, a file as its bytes in base64 (K398). */
function folderState(folder: string): Record<string, string> {
  const state: Record<string, string> = {};
  for (const name of readdirSync(folder, { recursive: true, encoding: 'utf8' })) {
    const entry = path.join(folder, name);
    state[name] = lstatSync(entry).isDirectory() ? '<dir>' : readFileSync(entry, 'base64');
  }
  return state;
}

// K398: a provider in a read-only folder is linked by the wheel that link writes into var/link, and its folder is not written.
test('K398: a Python provider in a read-only folder is linked by a wheel in var/link/python, and its folder is not written (K398)', (t) => {
  let folder = '';
  // Registered before the workspace, so the folder is writable again before the workspace is removed.
  t.after(() => { if (folder) spawnSync('chmod', ['-R', 'u+w', folder]); });
  const { provider, consumer, env, log } = workspace(t);
  folder = path.join(provider, 'packages/python');
  const before = folderState(folder);
  assert.equal(spawnSync('chmod', ['-R', 'a-w', folder]).status, 0);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.deepEqual(folderState(folder), before, 'the provider folder is unchanged, with no new file');
  const wheels = readdirSync(path.join(consumer, 'var/link/python')).filter(name => name.endsWith('.whl'));
  assert.ok(wheels.includes('polyspec_z-0.0.1-py3-none-any.whl'), 'the wheel of the provider is written into var/link/python');
  const entries = spawnSync('unzip', ['-Z1', path.join(consumer, 'var/link/python/polyspec_z-0.0.1-py3-none-any.whl')], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.ok(entries.every(entry => /^polyspec_z-0\.0\.1\.dist-info\/[^/]+$/.test(entry) || /^__editable__\.polyspec_z\.pth$/.test(entry)), entries.join('\n'));
  assert.equal(entries.filter(entry => entry.endsWith('.pth')).length, 1, entries.join('\n'));
  assert.ok(!log().split('\n').some(item => item.startsWith('uv pip install') && item.includes(`-e ${folder}`)), log());
  assert.match(text, /linked {5}python {3}polyspec-z -> /);
});

// K398-2: a Python provider with a static package-dir that maps its package to a folder of its own is linked with no write to its folder,
// through a finder of the editable wheel that maps the package name to the folder (K398-2).
test('K398-2: a Python provider with a static package-dir is linked by an editable wheel whose finder maps the package, and its folder is not written (K398-2)', (t) => {
  let folder = '';
  t.after(() => { if (folder) spawnSync('chmod', ['-R', 'u+w', folder]); });
  const { provider, consumer, env, log } = workspace(t);
  put(provider, {
    'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\n[tool.setuptools]\npackage-dir = {"polyspec_z" = "src"}\npackages = ["polyspec_z"]\n',
    'packages/python/src/__init__.py': 'VALUE = 1\n',
  });
  folder = path.join(provider, 'packages/python');
  const before = folderState(folder);
  assert.equal(spawnSync('chmod', ['-R', 'a-w', folder]).status, 0);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.deepEqual(folderState(folder), before, 'the provider folder is unchanged, with no new file');
  const wheel = path.join(consumer, 'var/link/python/polyspec_z-0.0.1-py3-none-any.whl');
  const entries = spawnSync('unzip', ['-Z1', wheel], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.ok(entries.some(entry => /^__editable___polyspec_z_finder\.py$/.test(entry)), entries.join('\n'));
  assert.ok(entries.every(entry => /^polyspec_z-0\.0\.1\.dist-info\/[^/]+$|^__editable__\.polyspec_z\.pth$|^__editable___polyspec_z_finder\.py$/.test(entry)), entries.join('\n'));
  assert.ok(!log().split('\n').some(item => item.startsWith('uv pip install') && item.includes(`-e ${folder}`)), log());
});

// K398-3: a static package-dir that maps a prefix to '.' links its listed subpackages: each listed package resolves through the longest
// package-dir prefix, and the prefix itself need not be listed (K398-3).
test('K398-3: a provider whose package-dir maps a prefix to "." and lists only its subpackages is linked, and its folder is not written (K398-3)', (t) => {
  let folder = '';
  t.after(() => { if (folder) spawnSync('chmod', ['-R', 'u+w', folder]); });
  const { provider, consumer, env, log } = workspace(t);
  put(provider, {
    'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\n[tool.setuptools]\npackage-dir = {"polyspec_z.module.x" = "."}\npackages = ["polyspec_z.module.x.src"]\n',
    'packages/python/src/__init__.py': 'VALUE = 1\n',
  });
  folder = path.join(provider, 'packages/python');
  const before = folderState(folder);
  assert.equal(spawnSync('chmod', ['-R', 'a-w', folder]).status, 0);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.deepEqual(folderState(folder), before, 'the provider folder is unchanged, with no new file');
  const wheel = path.join(consumer, 'var/link/python/polyspec_z-0.0.1-py3-none-any.whl');
  const entries = spawnSync('unzip', ['-Z1', wheel], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.ok(entries.includes('__editable___polyspec_z_finder.py'), entries.join('\n'));
  assert.ok(!log().split('\n').some(item => item.startsWith('uv pip install') && item.includes(`-e ${folder}`)), log());
});

// K398-1: an own Python project of the consumer is installed from the editable wheel that link writes, as a provider is, with --no-deps (K280):
// in a read-only folder it is linked, and its folder is not written.
test('K398-1: an own Python project of the consumer in a read-only folder is installed from its editable wheel, with --no-deps, and its folder is not written (K398-1)', (t) => {
  let folder = '';
  // Registered before the workspace, so the folder is writable again before the workspace is removed.
  t.after(() => { if (folder) spawnSync('chmod', ['-R', 'u+w', folder]); });
  const { consumer, env, log } = workspace(t);
  folder = path.join(consumer, 'python');
  put(consumer, { 'python/uv.lock': 'version = 1\n' });
  const before = folderState(folder);
  assert.equal(spawnSync('chmod', ['-R', 'a-w', folder]).status, 0);
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.deepEqual(folderState(folder), before, 'the own project folder is unchanged, with no new file');
  const installs = log().split('\n').filter(item => item.startsWith('uv pip install'));
  assert.ok(!installs.some(item => item.includes(' -e ')), installs.join('\n'));
  const own = installs.find(item => item.includes('cons-0-py3-none-any.whl')) ?? '';
  assert.ok(own.includes('--no-deps'), installs.join('\n'));
  assert.ok(existsSync(path.join(consumer, 'var/link/python/cons-0-py3-none-any.whl')), 'the wheel of the own project is in var/link/python');
  assert.match(text, /linked {5}python {3}cons -> /);
});

test('K224: a uv workspace root has its project installed as an editable install of its folder, from its wheel (K398-1)', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n', 'python/pyproject.toml': `${readFileSync(path.join(consumer, 'python/pyproject.toml'), 'utf8')}[tool.uv.workspace]\nmembers = []\n` });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.ok(!log().includes('uv sync'), 'the link runs no sync (K239)');
  assert.ok(!log().split('\n').some(item => item.startsWith('uv pip install') && item.includes(' -e ')), 'the consumer project is installed from its wheel, not by -e (K398-1)');
  assert.ok(log().includes('cons-0-py3-none-any.whl'), 'the consumer project is installed from the wheel of its folder, as a provider is');
});

test('K224: a uv workspace member without polyspec deps is installed from its folder, so --no-install-workspace drops no member', (t) => {
  const { consumer, env, log } = workspace(t);
  const root = readFileSync(path.join(consumer, 'python/pyproject.toml'), 'utf8');
  put(consumer, { 'python/uv.lock': 'version = 1\n', 'python/pyproject.toml': `${root}[tool.uv.workspace]\nmembers = ["member"]\n`, 'python/member/pyproject.toml': '[project]\nname = "member"\nversion = "0"\ndependencies = []\n' });
  git(consumer, 'add', 'python/member/pyproject.toml');
  git(consumer, 'commit', '--quiet', '-m', 'member');
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.ok(!log().includes('uv sync'), 'the link runs no sync (K239)');
  const install = log().split('\n').find(item => item.startsWith('uv pip install') && item.includes('member-0-py3-none-any.whl')) ?? '';
  assert.ok(install.includes('--no-deps'), install);
  assert.match(text, /linked {5}python {3}member -> .*\/python\/member \(.*python\/\.venv, now\)/);
});

test('the editable install of an older link (uv pip list shows an editable location, uv pip freeze no wheel) is NOT linked in check', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n', 'pip-list.json': JSON.stringify([{ name: 'polyspec-z', version: '0.0.1', editable_project_location: path.join(provider, 'packages/python') }, { name: 'polyspec-w', version: '0.0.1', editable_project_location: path.join(provider, 'packages/w') }]) });
  const { ok, text } = linkLines([consumer], env, true);
  assert.equal(ok, false);
  assert.match(text, /NOT linked python {3}polyspec-z \(.*python\/\.venv\)/);
});

test('a Python provider that uv pip list does not show is installed from its wheel as the editable of its folder (K316-2, K398)', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'pip-list.json': '[]' });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.match(text, /linked {5}python {3}polyspec-z -> .*python\/\.venv, now\)/);
  const wheel = path.join(consumer, 'var/link/python/polyspec_z-0.0.1-py3-none-any.whl');
  const install = log().split('\n').find(item => item.startsWith('uv pip install')) ?? '';
  assert.ok(install.includes(wheel), install);
  assert.ok(!log().includes(`-e ${path.join(provider, 'packages/python')}`), 'the provider folder is not an install target');
});

// K401: a Python project locked by a PEP 751 pylock.toml has no uv.lock; its install takes the locked releases from that lock.
test('a Python project locked with pylock.toml and no uv.lock is linked with the constraints of its lock (K401)', (t) => {
  const { consumer, env, log } = workspace(t);
  rmSync(path.join(consumer, 'python/uv.lock'));
  put(consumer, {
    'python/pylock.toml': 'lock-version = "1.0"\ncreated-by = "uv"\n\n[[packages]]\nname = "polyspec-z"\nversion = "0.0.1"\n\n[[packages]]\nname = "jsonschema"\nversion = "4.23.0"\n\n[[packages]]\nname = "local-dir"\n',
  });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.ok(!log().includes('uv export'), 'a pylock.toml is read, not exported: the workspace has no uv.lock');
  const install = log().split('\n').find(item => item.startsWith('uv pip install')) ?? '';
  assert.ok(install.includes(path.join(consumer, 'var/link/python/polyspec_z-0.0.1-py3-none-any.whl')), install);
  const constraints = readFileSync(path.join(consumer, 'constraints.logged'), 'utf8');
  assert.match(constraints, /^jsonschema==4\.23\.0$/m, 'the locked release of the other package is a constraint');
  assert.doesNotMatch(constraints, /polyspec-z/, 'a linked package is no constraint: its checkout version is installed');
  assert.doesNotMatch(constraints, /local-dir/, 'a package of the lock that has no version is no constraint');
  assert.match(text, /linked {5}python {3}polyspec-z -> /);
});

test('a Python project with neither uv.lock nor pylock.toml is not linked, and the message names both locks (K401)', (t) => {
  const { consumer, env } = workspace(t);
  rmSync(path.join(consumer, 'python/uv.lock'));
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, false, text);
  assert.match(text, /NOT linked python {3}polyspec-z \(no uv\.lock or pylock\.toml in .*python: run the repository's install\)/);
});

test('unlink restores the locked releases of a project locked with pylock.toml (K401-1)', (t) => {
  const { consumer, env, log } = workspace(t);
  rmSync(path.join(consumer, 'python/uv.lock'));
  put(consumer, {
    'python/pylock.toml': 'lock-version = "1.0"\ncreated-by = "uv"\n\n[[packages]]\nname = "polyspec-z"\nversion = "0.0.1"\n\n[[packages]]\nname = "jsonschema"\nversion = "4.23.0"\n',
  });
  assert.equal(linkLines([consumer], env).ok, true);
  const lines: string[] = [];
  unlink({ directories: [consumer], print: text => lines.push(text), env });
  assert.doesNotMatch(lines.join('\n'), /skipped/, lines.join('\n'));
  const install = log().split('\n').filter(item => item.startsWith('uv pip install') && item.includes('--reinstall-package polyspec-z')).at(-1) ?? '';
  assert.ok(install.includes(`--python ${path.join(consumer, 'python/.venv/bin/python')}`), install);
  assert.ok(install.includes('polyspec-z==0.0.1'), install);
});

// K316-2: the link of every ecosystem is idempotent: a second run ends linked, with the state of the first.
test('a second link run ends linked with the state of the first, in npm, Composer and Go (K316-2)', (t) => {
  const { provider, consumer, env } = workspace(t);
  const requires = JSON.stringify({ Module: { Path: 'sub' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.3' }] });
  put(consumer, { 'sub/go.mod': 'module sub\n', 'sub/go.mod.json': requires });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'sub');
  const state = () => ({
    npm: realpathSync(path.join(consumer, 'node_modules/@polyspec/x')),
    composer: realpathSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')),
    go: readFileSync(path.join(consumer, 'sub/go.work'), 'utf8'),
  });
  const first = linkLines([consumer], env);
  assert.equal(first.ok, true, first.text);
  const before = state();
  assert.equal(before.npm, path.join(provider, 'packages/ts'));
  assert.equal(before.composer, path.join(provider, 'packages/php'));
  const second = linkLines([consumer], env);
  assert.equal(second.ok, true, second.text);
  assert.deepEqual(state(), before);
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
  assert.throws(() => linkLines([consumer], noUv), /uv of the checkout is missing \(var\/tools\/bin\/uv, var\/tools\/mise\/shims\/uv\); run make install/);
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

// K462: `link.mjs providers <checkout>...` prints each npm provider with its folder, by the rule that link reads the providers with: the
// excluded paths are left out, and a package folder is named as its folder, never the repository root beside it, so a consumer asks the
// kit for the folders instead of copying the rule (S-584-1).
test('K462: link providers prints each npm provider with its folder, leaving out an excluded path (K462)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-providers-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = repository(root, 'polyspec', {
    'packages/ts/package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }),
    'tests/fixture/package.json': JSON.stringify({ name: '@polyspec/y', version: '0.0.1' }),
    'package.json': JSON.stringify({ name: '@polyspec/z', version: '0.0.1' }),
  });
  const run = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'providers', checkout], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, `@polyspec/x\t${path.join(checkout, 'packages/ts')}\n@polyspec/z\t${checkout}\n`);
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
  // make names the missing prerequisite and the target that needs it; the quotes around them differ between make releases.
  assert.throws(() => buildTargets(provider), /No rule to make target .missing-dep., needed by .release-assets./);
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

test('K237: unlink restores the locked releases of the linked packages and keeps the groups of the consumer install', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(provider, { 'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = ["jsonschema==4.23.0", "small-dep>=1"]\n' });
  put(consumer, {
    'python/uv.lock': 'version = 1\n',
    'freeze.txt': 'jsonschema==4.23.0\npolyspec-z @ file:///released/polyspec_z-0.0.1-py3-none-any.whl\n',
    'test-only.txt': 'polyspec-z\njsonschema\n',
    'export.txt': 'jsonschema==4.23.0\npolyspec-z==0.0.1\n',
  });
  assert.equal(linkLines([consumer], env).ok, true);
  assert.match(readFileSync(path.join(consumer, 'freeze.txt'), 'utf8'), /^polyspec-z @ file:\/\/.*\/prov\/packages\/python$/m, 'the checkout is linked');
  const lines: string[] = [];
  unlink({ directories: [consumer], print: text => lines.push(text), env });
  assert.match(lines.join('\n'), /restored {3}python/);
  const freeze = readFileSync(path.join(consumer, 'freeze.txt'), 'utf8');
  assert.match(freeze, /^jsonschema==4\.23\.0$/m, 'the test-group dependency of the consumer install is kept at its locked version');
  assert.match(freeze, /^polyspec-z==0\.0\.1$/m, 'the linked package is restored to its locked release');
  assert.doesNotMatch(freeze, /^polyspec-z @ .*\/prov\//m, `no link of the polyspec checkout remains: ${freeze}`);
  const sync = log().split('\n').filter(item => item.startsWith('uv sync --locked')).at(-1) ?? '';
  assert.ok(sync.includes('--inexact') && sync.includes('--reinstall-package polyspec-z'), sync);
});

test('K238: a link of packages that are already linked installs the requirement that uv pip check reports as unmet', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(provider, { 'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = ["jsonschema==4.23.0", "small-dep>=1"]\n' });
  const z = path.join(provider, 'packages/python');
  const project = path.join(consumer, 'python');
  // The links are in place from an earlier link that installed the wheels without their dependencies.
  put(consumer, {
    'python/uv.lock': 'version = 1\n',
    'freeze.txt': `polyspec-z @ file://${z}\ncons @ file://${project}\n`,
    'export.txt': 'jsonschema==4.23.0\npolyspec-z==0.0.1\n',
    // What uv pip check reports for the environment: both dependencies of the linked package are not installed.
    'pip-check.txt': 'The package `polyspec-z` requires `jsonschema==4.23.0`, but it\'s not installed\nThe package `polyspec-z` requires `small-dep>=1`, but it\'s not installed\n',
  });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.ok(log().split('\n').some(item => item.startsWith('uv pip install')), 'the missing dependencies are installed');
  const freeze = readFileSync(path.join(consumer, 'freeze.txt'), 'utf8');
  assert.match(freeze, /^jsonschema==/m, 'jsonschema, a dependency of the linked package, is installed');
  assert.match(freeze, /^small-dep==/m, 'small-dep, a dependency of the linked package, is installed');
});

test('K238: a requirement whose environment marker holds is reported by uv pip check and installed; the check is the one of uv', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  // The checkout declares jsonschema with a marker. The marker is evaluated by uv: pip check states the requirement only when its marker holds.
  put(provider, { 'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = [\'jsonschema==4.23.0; python_version >= "3.12"\']\n' });
  const z = path.join(provider, 'packages/python');
  const project = path.join(consumer, 'python');
  put(consumer, {
    'python/uv.lock': 'version = 1\n',
    'freeze.txt': `polyspec-z @ file://${z}\ncons @ file://${project}\n`,
    'export.txt': 'jsonschema==4.23.0\npolyspec-z==0.0.1\n',
    'pip-check.txt': 'The package `polyspec-z` requires `jsonschema==4.23.0 ; python_full_version >= \'3.12\'`, but it\'s not installed\n',
  });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  assert.ok(log().split('\n').some(item => item.startsWith('uv pip check')), 'the requirements are checked by uv');
  assert.ok(log().split('\n').some(item => item.startsWith('uv pip install')), 'the requirement whose marker holds is installed');
  assert.match(readFileSync(path.join(consumer, 'freeze.txt'), 'utf8'), /^jsonschema==/m);
});

test('K238: unlink keeps the consumer project wheel of the link, and restores the locked releases of the polyspec packages', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(provider, { 'packages/python/pyproject.toml': '[project]\nname = "polyspec_z"\nversion = "0.0.1"\ndependencies = ["jsonschema==4.23.0", "small-dep>=1"]\n' });
  put(consumer, {
    'python/uv.lock': 'version = 1\n',
    'freeze.txt': 'jsonschema==4.23.0\npolyspec-z @ file:///released/polyspec_z-0.0.1-py3-none-any.whl\n',
    'test-only.txt': 'polyspec-z\njsonschema\n',
    'export.txt': 'jsonschema==4.23.0\npolyspec-z==0.0.1\n',
  });
  assert.equal(linkLines([consumer], env).ok, true);
  const project = path.join(consumer, 'python');
  assert.ok(readFileSync(path.join(consumer, 'freeze.txt'), 'utf8').includes(`cons @ file://${project}`), 'the consumer project is linked');
  const lines: string[] = [];
  unlink({ directories: [consumer], print: text => lines.push(text), env });
  const freeze = readFileSync(path.join(consumer, 'freeze.txt'), 'utf8');
  assert.ok(freeze.includes(`cons @ file://${project}`), `the consumer project wheel survives the unlink: ${freeze}`);
  assert.match(freeze, /^polyspec-z==0\.0\.1$/m, 'the polyspec package is back at its locked release');
  assert.match(freeze, /^jsonschema==4\.23\.0$/m, 'the locked dependency is kept');
  const sync = log().split('\n').filter(item => item.startsWith('uv sync --locked')).at(-1) ?? '';
  assert.ok(sync.includes('--all-groups'), `the restore selects every group, as the consumer install does, so its reinstall reaches the test group: ${sync}`);
});

test('K239: a link leaves a package that is installed outside its lock source as it is, and runs no sync', (t) => {
  const { consumer, env, log } = workspace(t);
  // consumer-contracts is installed editable from a checkout that the lock does not name as its source. A sync of the lock would
  // reinstall it from the lock's path source (sync-rewrites.txt models that), so a link must not sync at all.
  put(consumer, {
    'python/uv.lock': 'version = 1\n',
    'freeze.txt': 'consumer-contracts @ file:///editable/contracts\n',
    'sync-rewrites.txt': 'consumer-contracts file:///consumer/python/var/platforms/contracts\n',
  });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  const freeze = readFileSync(path.join(consumer, 'freeze.txt'), 'utf8');
  assert.match(freeze, /^consumer-contracts @ file:\/\/\/editable\/contracts$/m, `the editable install is kept as it is: ${freeze}`);
  assert.ok(!log().includes('uv sync'), 'the link runs no sync (K239)');
  assert.match(text, /linked {5}python {3}polyspec-z -> /, 'the linked package is still linked');
});

/** A copy of the Makefile of kit and of its kit.mk, with the empty folders that the build of the Makefile copies. */
function kitSandbox(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-make-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(path.join(KIT, 'Makefile'), path.join(dir, 'Makefile'));
  // Every folder that the build ships, as the Makefile names it (K421), so a folder that a later row adds to the build is there too.
  for (const asset of shippedAssets(readFileSync(path.join(KIT, 'Makefile'), 'utf8'))) {
    if (asset !== 'kit.mk') mkdirSync(path.join(dir, 'scripts/kit', asset), { recursive: true });
  }
  copyFileSync(path.join(KIT, 'scripts/kit/kit.mk'), path.join(dir, 'scripts/kit/kit.mk'));
  return dir;
}

test('make kit-build restores dist when the rename of dist.next fails, and exits 1', (t) => {
  const dir = kitSandbox(t);
  put(dir, { 'node_modules/.bin/tsc': '#!/bin/sh\nmkdir -p dist.next\n', 'dist/old.js': 'old\n', 'bin/mv': '#!/bin/sh\nif [ "$1" = dist.next ] && [ "$2" = dist ]; then echo "mv: injected failure" >&2; exit 1; fi\nexec /bin/mv "$@"\n' });
  chmodSync(path.join(dir, 'node_modules/.bin/tsc'), 0o755);
  chmodSync(path.join(dir, 'bin/mv'), 0o755);
  const result = spawnSync('make', ['-C', dir, 'kit-build'], { encoding: 'utf8', env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` } });
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /mv: injected failure/, 'the recipe stopped at the failed rename');
  assert.equal(readFileSync(path.join(dir, 'dist/old.js'), 'utf8'), 'old\n', 'the previous dist is back');
  assert.equal(existsSync(path.join(dir, 'dist.old')), false);
});

test('a release target runs with GOWORK off, and a Go target keeps the GOWORK of its environment (K205, K343)', (t) => {
  const dir = kitSandbox(t);
  const log = path.join(dir, 'node.log');
  put(dir, { 'bin/node': `#!/bin/sh\necho "$* GOWORK=$GOWORK" >> ${JSON.stringify(log)}\n` });
  chmodSync(path.join(dir, 'bin/node'), 0o755);
  const { GOWORK: _inherited, ...base } = process.env;
  const make = (...goals: string[]) => spawnSync('make', ['-C', dir, `NODE=${path.join(dir, 'bin/node')}`, ...goals], { encoding: 'utf8', env: { ...base, TAG: 'v0.0.1' } });
  assert.equal(make('release-assets').status, 0);
  assert.equal(make('dependency-policy-check').status, 0);
  assert.equal(make('kit-fixture-record').status, 0);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.match(lines[0] ?? '', /assets v0\.0\.1 GOWORK=off$/);
  // The policy reads the released modules as the review does (K343).
  assert.match(lines[1] ?? '', /check-dependency-policy\.mts GOWORK=off$/);
  assert.match(lines[2] ?? '', /record-fixture\.mts GOWORK=$/);
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
test('the go.work that link writes for a module of a tracked workspace uses every module of that workspace (K399)', (t) => {
  const { consumer, env, log } = workspace(t);
  const requires = JSON.stringify({ Module: { Path: 'a' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.3' }] });
  put(consumer, {
    'ws/go.work': 'go 1.22\n\nuse (\n\t./a\n\t./b\n)\n',
    'ws/go.work.json': JSON.stringify({ Use: [{ DiskPath: './a' }, { DiskPath: './b' }] }),
    'ws/a/go.mod': 'module a\n', 'ws/a/go.mod.json': requires,
    'ws/b/go.mod': 'module b\n', 'ws/b/go.mod.json': JSON.stringify({ Module: { Path: 'b' }, Require: [] }),
  });
  git(consumer, 'add', '-A');
  // The go.work of the repository is ignored by .gitignore, so it is added by force, as a tracked file of the repository.
  git(consumer, 'add', '-f', 'ws/go.work');
  git(consumer, 'commit', '--quiet', '-m', 'workspace');
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  // The folders are the module itself, then the modules of the tracked workspace, then the provider (relative to the module).
  assert.match(log(), /go work init \. \.\.\/b \.\.\/\.\.\/\.\.\/prov\/go\n/);
});
test('link check passes for a module of a tracked workspace that does not require another module of it (K399-1)', (t) => {
  const { consumer, provider, env } = workspace(t);
  // The npm provider is built (its dist is git-ignored), so the check of the go modules decides the result.
  put(provider, { 'packages/ts/dist/index.js': 'export {};\n' });
  const requires = JSON.stringify({ Module: { Path: 'a' }, Require: [{ Path: 'github.com/polyspec/prov/go', Version: 'v0.0.3' }] });
  put(consumer, {
    'ws/go.work': 'go 1.22\n\nuse (\n\t./a\n\t./b\n)\n',
    'ws/go.work.json': JSON.stringify({ Use: [{ DiskPath: './a' }, { DiskPath: './b' }] }),
    'ws/a/go.mod': 'module a\n', 'ws/a/go.mod.json': requires,
    'ws/b/go.mod': 'module b\n', 'ws/b/go.mod.json': JSON.stringify({ Module: { Path: 'b' }, Require: [] }),
  });
  git(consumer, 'add', '-A');
  git(consumer, 'add', '-f', 'ws/go.work');
  git(consumer, 'commit', '--quiet', '-m', 'workspace');
  const written = linkLines([consumer], env);
  assert.equal(written.ok, true, written.text);
  const checked = linkLines([consumer], env, true);
  assert.equal(checked.ok, true, checked.text);
  assert.match(checked.text, /^ {2}linked +go +b -> /m, checked.text);
});
test('a path package installed by the root project is linked in the vendor of the root project (K396)', (t) => {
  const { root, provider, env, log } = workspace(t);
  // The root project installs packages/php through a path repository into vendor-php; packages/php has no vendor of its own.
  const app = repository(root, 'app', {
    '.gitignore': 'vendor-php/\n',
    'composer-vendor-dir': 'vendor-php',
    'composer.json': JSON.stringify({ name: 'app/root', require: { 'polyspec/ordered-json': '0.0.1' }, repositories: [{ type: 'path', url: 'packages/php' }] }),
    'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/ordered-json', version: '0.0.1' }, { name: 'polyspec/y', version: '0.0.1' }] }),
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/ordered-json', require: { 'polyspec/y': '0.0.1' } }),
  });
  // The vendor of the root project is git-ignored, as an installed vendor is.
  put(app, {
    'vendor-php/composer/installed.json': JSON.stringify({ packages: [
      { name: 'polyspec/ordered-json', version: 'dev-main', dist: { type: 'path', url: '../../packages/php' }, 'install-path': '../../packages/php' },
      { name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' },
    ] }),
    'vendor-php/polyspec/y/composer.json': '{"name":"polyspec/y"}',
  });
  const lines: string[] = [];
  // Under --project the named folder is the consumer: its own composer.json has no vendor, and the root project installs it.
  const ok = link({ checkouts: current, directories: [path.join(app, 'packages/php')], project: true, check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, true, text);
  assert.doesNotMatch(text, /NOT linked/);
  assert.equal(realpathSync(path.join(app, 'vendor-php/polyspec/y')), path.join(provider, 'packages/php'));
  assert.match(log(), new RegExp(`composer update polyspec/y [^\n]*--working-dir ${app}\n`));
});
test('a path package whose installing root project is not installed yet is reported in the vendor of the root project (K396)', (t) => {
  const { root, env } = workspace(t);
  // Neither vendor is installed: the vendor to install is the one of the root project, whose path repository installs packages/php.
  const app = repository(root, 'app', {
    '.gitignore': 'vendor-php/\n',
    'composer-vendor-dir': 'vendor-php',
    'composer.json': JSON.stringify({ name: 'app/root', require: { 'polyspec/ordered-json': '0.0.1' }, repositories: [{ type: 'path', url: 'packages/php' }] }),
    'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/ordered-json', version: '0.0.1' }, { name: 'polyspec/y', version: '0.0.1' }] }),
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/ordered-json', require: { 'polyspec/y': '0.0.1' } }),
  });
  const lines: string[] = [];
  const ok = link({ checkouts: current, directories: [app], check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, false, text);
  assert.match(text, new RegExp(`NOT linked composer polyspec/y \\(not installed in ${path.join(app, 'vendor-php').replaceAll('/', '\\/')}\\)`));
  assert.doesNotMatch(text, /packages\/php\/vendor/);
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
  assert.doesNotMatch(log(), /composer update .*--working-dir .*cons\n/, 'the ancestor project is not updated');
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

/**
 * K226: a consumer whose own repository provides a dependency: an npm workspace member (the root package.json `workspaces`
 * glob) that a sibling declares, and the Composer name of the root composer.json and of a path repository it declares. With
 * `ghost`, one more npm and one more Composer dependency have no provider at all.
 */
function ownPackages(t: TestContext, ghost: boolean) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-link-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'tools.log');
  writeFileSync(log, '');
  const bin = path.join(root, 'bin');
  const consumer = repository(root, 'mono', {
    'package.json': JSON.stringify({ name: 'mono', private: true, workspaces: ['packages/*'] }),
    'package-lock.json': '{}',
    'packages/a/package.json': JSON.stringify({ name: '@polyspec/a', version: '0.0.1', dependencies: { '@polyspec/b': '0.0.1', ...(ghost ? { '@polyspec/ghost': '0.0.1' } : {}) } }),
    'packages/b/package.json': JSON.stringify({ name: '@polyspec/b', version: '0.0.1' }),
    'composer.json': JSON.stringify({ name: 'polyspec/mono', require: { 'polyspec/mono': '0.0.1', 'polyspec/widget': '0.0.18', ...(ghost ? { 'polyspec/ghost': '0.0.1' } : {}) }, repositories: [{ type: 'path', url: 'packages/php', options: { symlink: true } }] }),
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/widget' }),
    '.gitignore': 'node_modules/\nvar/\nvendor/\n',
  });
  mkdirSync(path.join(consumer, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync('../../packages/a', path.join(consumer, 'node_modules/@polyspec/a'));
  symlinkSync('../../packages/b', path.join(consumer, 'node_modules/@polyspec/b'));
  put(consumer, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/a', version: '0.0.1', location: 'packages/a' }, { name: '@polyspec/b', version: '0.0.1', location: 'packages/b' }]),
  });
  stub(bin, log, 'npm', 'cat npm-query.json');
  stub(bin, log, 'composer', `if [ "$1 $4" = "config vendor-dir" ]; then echo vendor; fi`);
  const env = { PATH: process.env.PATH, NPM: path.join(bin, 'npm'), COMPOSER_BIN: path.join(bin, 'composer') };
  return { consumer, env };
}

test('K226: a dependency that the project itself provides (an npm workspace member, the root Composer name, a Composer path repository) is satisfied as own (K226, K385)', (t) => {
  const { consumer, env } = ownPackages(t, false);
  const lines: string[] = [];
  const ok = link({ checkouts: [], directories: [consumer], check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, true, text);
  // The work tree of the consumer provides the packages of its repository (K385), so they are its own.
  assert.match(text, /^ {2}own +npm +@polyspec\/b \(this repository\)/m);
  assert.match(text, /^ {2}own +composer +polyspec\/widget \(this repository\)/m);
  assert.match(text, /^ {2}own +composer +polyspec\/mono \(this repository\)/m);
  assert.doesNotMatch(text, /NOT linked/);
});

test('K226: a dependency that no provider and no project package provides still fails the run', (t) => {
  const { consumer, env } = ownPackages(t, true);
  const lines: string[] = [];
  const ok = link({ checkouts: [], directories: [consumer], check: false, print: text => lines.push(text), env });
  const text = lines.join('\n');
  assert.equal(ok, false, text);
  assert.match(text, /NOT linked npm +@polyspec\/ghost \(no provider\)/);
  assert.match(text, /NOT linked composer polyspec\/ghost \(no provider\)/);
  assert.match(text, /^ {2}own +npm +@polyspec\/b \(this repository\)/m);
});

test('a linked package that the lock does not hold takes the exact release that the project requires as the version of its path repository (K304-2)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, {
    'composer.lock': JSON.stringify({ packages: [{ name: 'psr/log', version: '3.0.0' }] }),
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.9' } }),
  });
  linkLines([consumer], env);
  const seen = seenUpdate(consumer);
  assert.deepEqual(seen.repositories[0], { type: 'path', url: path.join(provider, 'packages/php'), options: { symlink: true, versions: { 'polyspec/y': '0.0.9' } } });
});

test('K316-1, K398: the overrides of an install name each linked provider by its wheel, so a package installed from a release is installed again from the wheel', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'python/uv.lock': 'version = 1\n', 'freeze.txt': `polyspec-z @ file://${path.join(provider, 'packages/python')}\n` });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  const overrides = readFileSync(path.join(consumer, 'overrides.logged'), 'utf8').split('\n');
  const wheel = path.join(consumer, 'var/link/python/polyspec_z-0.0.1-py3-none-any.whl');
  assert.ok(overrides.includes(`polyspec-z @ file://${wheel}`), 'a name @ file:// line of the wheel beats the release URL of another requirement');
  assert.ok(!overrides.includes(`-e ${path.join(provider, 'packages/python')}`), 'the provider is named by its wheel, not by its folder');
});

// make composer-install installs a consumer's Composer project through the link when a sibling checkout provides a polyspec
// package that its composer.lock holds, so the lock's release archive is never installed and the provided folder resolves.
/** A fresh checkout of the consumer: its composer.lock pins polyspec/y as a release archive, and no vendor is installed. */
function freshComposer(consumer: string) {
  rmSync(path.join(consumer, 'var/contracts/vendor'), { recursive: true, force: true });
  put(consumer, { 'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', dist: { type: 'zip', url: 'https://example.invalid/polyspec/y-0.0.1.zip' } }] }) });
}

test('make composer-install in a fresh consumer links the polyspec package of its lock from the sibling checkout and never runs composer install (K432)', (t) => {
  const { provider, kit, consumer, env, log } = workspace(t);
  freshComposer(consumer);
  const lines: string[] = [];
  composerInstall({ directory: consumer, checkouts: [provider, kit], env, print: text => lines.push(text) });
  assert.doesNotMatch(log(), /^composer install/m, 'no composer install runs, neither of the tracked lock nor of the link');
  const seen = seenUpdate(consumer);
  assert.equal(seen.file, 'composer.link.json', 'the partial update reads the link manifest');
  assert.deepEqual(seen.targets, ['polyspec/y'], 'the update names the provided package');
  assert.match(log(), new RegExp(`composer update polyspec/y --with-dependencies --no-scripts --no-plugins --no-interaction --working-dir ${consumer}\n`));
  assert.deepEqual(seen.repositories[0], { type: 'path', url: path.join(provider, 'packages/php'), options: { symlink: true, versions: { 'polyspec/y': '0.0.1' } } });
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/polyspec/y')), path.join(provider, 'packages/php'), 'the installed folder is the provider folder');
  assert.equal(existsSync(path.join(consumer, 'composer.link.lock')), true, 'the link lock is written beside the link manifest');
  assert.match(lines.join('\n'), /through the link/, 'the path that was taken is printed');
});

test('make composer-install without a sibling that provides a polyspec package of the lock runs composer install of the tracked lock (K432)', (t) => {
  const { consumer, env, log } = workspace(t);
  freshComposer(consumer);
  const lines: string[] = [];
  composerInstall({ directory: consumer, checkouts: [], env, print: text => lines.push(text) });
  assert.match(log(), /^composer install --no-interaction$/m, 'the tracked lock is installed');
  assert.doesNotMatch(log(), /^composer update/m, 'no update runs without a link');
  assert.equal(existsSync(path.join(consumer, 'composer.link.json')), false, 'no link manifest is written');
  assert.match(lines.join('\n'), /composer install of the tracked lock/, 'the path that was taken is printed');
});

test('link reads the polyspec packages of a Composer project from its composer.lock when its vendor holds no installed.json (K432)', (t) => {
  const { consumer, env } = workspace(t);
  freshComposer(consumer);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', require: {} }) });
  const checked = linkLines([consumer], env, true);
  assert.equal(checked.ok, false, checked.text);
  assert.match(checked.text, /NOT linked +composer +polyspec\/y \(not installed in /);
});

// K448-1: a tracked Composer project below the root with its own lock and var folder (hyper examples/board) takes the sibling
// provider from the start, so no release is copied into its vendor.
test('make composer-install of a nested Composer project links the polyspec package of its lock and copies no release (K448-1)', (t) => {
  const { provider, kit, consumer, env, log } = workspace(t);
  const board = path.join(consumer, 'examples/board');
  put(consumer, { 'examples/board/composer.json': JSON.stringify({ name: 'cons/board', require: { 'polyspec/y': '0.0.1' } }) });
  freshComposer(board);
  // hyper's board keeps its Composer vendor in vendor/, not in var/contracts (K448-1).
  put(board, { 'composer-vendor-dir': 'vendor' });
  mkdirSync(path.join(board, 'var'), { recursive: true });
  const lines: string[] = [];
  composerInstall({ directory: board, checkouts: [provider, kit], env, print: text => lines.push(text) });
  assert.doesNotMatch(log(), /^composer install/m, 'no composer install of the tracked lock runs in the nested project');
  assert.equal(realpathSync(path.join(board, 'vendor/polyspec/y')), path.join(provider, 'packages/php'), 'the nested project links the provider folder');
});

// K379-2: a fork that only a linked provider pins takes the version of that pin, written as its tag, not the release of the lock: the
// consumer does not require the fork, and the provider polyspec/y, which the consumer requires, pins it at 2.6.0-p1.
test('link --siblings gives a fork the version that a linked provider pins (K379-2)', (t) => {
  const { root, consumer, env, provider } = workspace(t);
  const fork = repository(path.join(root, 'forks'), 'json-schema', {
    'composer.json': JSON.stringify({ name: 'opis/json-schema', autoload: { 'psr-4': { 'Opis\\JsonSchema\\': 'src/' } } }),
  });
  put(provider, {
    'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', require: { 'opis/json-schema': '2.6.0-p1' }, repositories: [{ type: 'vcs', url: 'https://github.com/min-0-max/json-schema' }], autoload: { 'psr-4': { 'Y\\': 'src/' } } }),
  });
  git(provider, 'add', '-A');
  git(provider, 'commit', '--quiet', '-m', 'pin the fork');
  put(consumer, {
    'composer.json': JSON.stringify({ name: 'cons/app', require: { 'polyspec/y': '0.0.1' } }),
    'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1' }, { name: 'opis/json-schema', version: '2.6.0' }] }),
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }, { name: 'opis/json-schema', version: '2.6.0', 'install-path': '../opis/json-schema' }] }),
    'var/contracts/vendor/opis/json-schema/composer.json': '{"name":"opis/json-schema"}',
  });
  const checkouts = siblingCheckouts(consumer).checkouts;
  assert.ok(checkouts.includes(fork), 'the fork of forks/ is a checkout');
  const lines: string[] = [];
  assert.equal(link({ checkouts, directories: [consumer], check: false, print: text => lines.push(text), env }), true, lines.join('\n'));
  const manifest: unknown = JSON.parse(readFileSync(path.join(consumer, 'composer.link.json'), 'utf8'));
  if (!isJsonObject(manifest) || !Array.isArray(manifest.repositories)) throw new Error('composer.link.json holds no repositories');
  assert.deepEqual(manifest.repositories.find(item => isJsonObject(item) && item.url === fork), { type: 'path', url: fork, options: { symlink: true, versions: { 'opis/json-schema': 'v2.6.0-p1' } } });
});

// K440: a Claude Code session started in the workspace folder (the folder of kit and its siblings) loads no .claude/settings.json of
// kit, so link --siblings writes the Bash PreToolUse hook of claude-hook into the settings of that folder, run by its kit checkout.
/** The claude-hook and the node of the kit checkout `kit`, as a checkout has them (linked to the hook and node of this checkout). */
function hookCheckout(kit: string) {
  mkdirSync(path.join(kit, 'scripts/kit'), { recursive: true });
  symlinkSync(path.join(KIT, 'scripts/kit/claude-hook.mts'), path.join(kit, 'scripts/kit/claude-hook.mts'));
  mkdirSync(path.join(kit, 'var/tools/bin'), { recursive: true });
  symlinkSync(process.execPath, path.join(kit, 'var/tools/bin/node'));
}

/** The command of the kit checkout `kit` that runs its node and its claude-hook, as the link writes it. */
const hookCommand = (kit: string) => `'${path.join(kit, 'var/tools/bin/node')}' '${path.join(kit, 'scripts/kit/claude-hook.mts')}'`;

/** The Bash PreToolUse entry of the hook command of `kit`. */
const hookEntry = (kit: string) => ({ matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand(kit) }] });

/** `link --siblings` run as the command of the consumer, with the stubs of `env`. */
function linkSiblings(consumer: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'link', '--siblings'], { cwd: consumer, env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('link --siblings writes the Bash PreToolUse hook of claude-hook into the workspace folder, which refuses sleep 240 (K440)', (t) => {
  const { kit, consumer, env } = workspace(t);
  hookCheckout(kit);
  linkSiblings(consumer, env);
  assert.deepEqual(readJsonObject(path.dirname(consumer), '.claude/settings.json'), { hooks: { PreToolUse: [hookEntry(kit)] } });
  const hook = spawnSync('/bin/sh', ['-c', hookCommand(kit)], { cwd: consumer, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sleep 240' } }), encoding: 'utf8' });
  assert.equal(hook.status, 2, hook.stderr);
  assert.match(hook.stderr, /refuse/);
});

test('link --siblings keeps the other settings of the workspace folder and replaces its kit hook, so a second run changes nothing (K440)', (t) => {
  const { kit, consumer, env } = workspace(t);
  hookCheckout(kit);
  const file = path.join(path.dirname(consumer), '.claude/settings.json');
  const other = { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo edit' }] };
  const stop = [{ hooks: [{ type: 'command', command: 'echo done' }] }];
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ model: 'sonnet', hooks: { Stop: stop, PreToolUse: [other, { matcher: 'Bash', hooks: [{ type: 'command', command: '"/old/kit/var/tools/bin/node" "/old/kit/scripts/kit/claude-hook.mts"' }] }] } }));
  linkSiblings(consumer, env);
  const first = readFileSync(file, 'utf8');
  assert.deepEqual(readJsonObject(file), { model: 'sonnet', hooks: { Stop: stop, PreToolUse: [other, hookEntry(kit)] } });
  linkSiblings(consumer, env);
  assert.equal(readFileSync(file, 'utf8'), first);
});

test('a workspace without a kit checkout holding claude-hook gets no settings file, as in CI (K440)', (t) => {
  const { consumer, env } = workspace(t);
  linkSiblings(consumer, env);
  assert.equal(existsSync(path.join(path.dirname(consumer), '.claude')), false);
});

test('link-state-check fails while the workspace folder lacks the kit hook, names the file, and passes after link --siblings (K440)', (t) => {
  const { kit, consumer, env } = workspace(t);
  hookCheckout(kit);
  const file = path.join(path.dirname(consumer), '.claude/settings.json');
  assert.ok(linkFindings(consumer, env).some(finding => finding.includes(file) && /make link/.test(finding)), 'a finding names the file and make link');
  linkSiblings(consumer, env);
  assert.deepEqual(linkFindings(consumer, env).filter(finding => finding.includes('settings.json')), []);
});

// K440-2: the writer and link-state-check judge the node of the kit checkout by one predicate, and each drift class has its own finding.
/** The settings file of the workspace folder of `consumer`, which `link --siblings` writes. */
const workspaceSettingsFile = (consumer: string) => path.join(path.dirname(consumer), '.claude/settings.json');

/** `link --siblings` run as the command of the consumer, which returns its status and stderr instead of asserting them. */
function linkSiblingsResult(consumer: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'link', '--siblings'], { cwd: consumer, env: { ...process.env, ...env }, encoding: 'utf8' });
}

/** The findings of `consumer` that concern its workspace settings file. */
const settingsFindings = (consumer: string, env: NodeJS.ProcessEnv) => linkFindings(consumer, env).filter(finding => finding.includes('.claude/settings.json'));

test('link-state-check reports a missing kit hook with its own message, when the settings hold no kit entry (K440-2)', (t) => {
  const { kit, consumer, env } = workspace(t);
  hookCheckout(kit);
  linkSiblings(consumer, env);
  writeFileSync(workspaceSettingsFile(consumer), JSON.stringify({ model: 'sonnet', hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo edit' }] }] } }));
  const found = settingsFindings(consumer, env);
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', /no Bash PreToolUse hook runs the claude-hook of the kit checkout \(K440\); fix: make link$/);
});

test('link-state-check reports a kit hook whose content differs with its own message, and link --siblings rewrites it (K440-2)', (t) => {
  const { kit, consumer, env } = workspace(t);
  hookCheckout(kit);
  linkSiblings(consumer, env);
  writeFileSync(workspaceSettingsFile(consumer), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `'/old/kit/var/tools/bin/node' '${path.join(kit, 'scripts/kit/claude-hook.mts')}'` }] }] } }));
  const found = settingsFindings(consumer, env);
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', /differs from the entry the link writes \(K440-2\); fix: make link$/);
  linkSiblings(consumer, env);
  assert.deepEqual(settingsFindings(consumer, env), []);
});

test('link-state-check reports a node that is not executable with its own message, and the writer refuses it (K440-2)', (t) => {
  const { kit, consumer, env } = workspace(t);
  hookCheckout(kit);
  linkSiblings(consumer, env);
  const file = workspaceSettingsFile(consumer);
  const before = readFileSync(file, 'utf8');
  const node = path.join(kit, 'var/tools/bin/node');
  rmSync(node);
  writeFileSync(node, '#!/bin/sh\n', { mode: 0o644 });
  const found = linkFindings(consumer, env).filter(finding => finding.includes(node));
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', new RegExp(`${node.replaceAll('.', '\\.')}: the node of the kit checkout is missing or not executable, so the Claude Code hook cannot run \\(K440-2\\); fix: make -C ${realpathSync(kit).replaceAll('.', '\\.')} install-tools$`));
  const refused = linkSiblingsResult(consumer, env);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, new RegExp(`make -C ${realpathSync(kit).replaceAll('.', '\\.')} install-tools`));
  assert.equal(readFileSync(file, 'utf8'), before);
});

// K448-5: cargo links the sibling crates from the start. make cargo-fetch runs cargo fetch of the project through the link, with
// the checkouts beside it patched, so no fetch materialises the git tag of a sibling crate.
test('make cargo-fetch runs cargo fetch through the link of the sibling checkouts (K448-5)', () => {
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'ONLINE=online-wrapper', 'NODE=node', 'cargo-fetch', 'DIR=x'], { cwd: KIT, encoding: 'utf8' });
  assert.equal(dry.stdout.trim(), 'online-wrapper node scripts/kit/link.mts cargo --siblings x fetch --locked');
});

test('link cargo --siblings runs cargo with the sibling crates patched and the arguments unchanged (K448-5)', (t) => {
  const { consumer, env, log } = workspace(t);
  const run = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'cargo', '--siblings', consumer, 'fetch', '--locked'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(log(), /cargo --config .*patch\."https:\/\/github\.com\/polyspec\/prov"\.polyspec-prov\.path=.* fetch --locked/);
});

// K440-2: link writes a git-ignored go.work into each Go module of a checkout, kit's own tools included (scripts/kit/symbols/go), so the
// checkout of kit must ignore it; otherwise link fails before it writes the workspace hook of K440.
test('every Go module of the kit checkout gets a git-ignored go.work (K440-2)', () => {
  const root = repositoryRoot();
  const modules = trackedManifests(root, ['go.mod']);
  assert.ok(modules.length > 0, 'the checkout tracks a Go module');
  for (const manifest of modules) {
    const work = path.join(root, path.dirname(manifest), 'go.work');
    assert.equal(isIgnored(work), true, `${work} is not ignored by Git, so link fails on it`);
  }
});
