// Tests of link.mts, the local links of 0.0.x development (K201, K201-1). The tools are stubs that answer from files of the
// fixture and log their arguments: npm (npm query), Composer (config vendor-dir, update, install), uv (workspace dir,
// pip list, pip install, sync), go (mod edit -json, work init, list -m) and cargo (locate-project); no npm, Composer,
// Python, go or cargo runs. make is the make of the machine, on Makefiles of the fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeTest, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildState, buildTargets } from '../../scripts/kit/link-build.mts';
import { assertIgnored, isIgnored, providers, siblingCheckouts, trackedManifests } from '../../scripts/kit/link-providers.mts';
import { providedFolders } from '../../scripts/kit/link-folders.mts';
import { composerInstall, composerLink } from '../../scripts/kit/composer-install.mts';
import { linkFindings } from '../../scripts/kit/link-state-check.mts';
import { acquireHolderLock } from '../../scripts/kit/holder-lock.mts';
import { cargoMetadataArguments } from '../../scripts/kit/cargo-source.mts';
import { cargo, link, unlink, writeWorkspaceHook } from '../../scripts/kit/link.mts';
import { shippedAssets } from '../../scripts/kit/kit-assets.mts';
import { initRepository } from './sandbox-repository.mts';
import { put } from './tree.mts';
import { readJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { repositoryRoot } from '../../scripts/kit/paths.mts';

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
    'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }], require: { 'polyspec/y': '0.0.1' }, config: { 'vendor-dir': 'var/contracts/vendor' } }),
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
  put(bin, { 'npm-link.mjs': `import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
const names = process.argv.slice(3).filter(argument => !argument.startsWith('--'));
const global = path.join(process.env.npm_config_prefix, 'lib/node_modules');
const links = names.length === 0
  ? [{ target: process.cwd(), folder: path.join(global, JSON.parse(readFileSync('package.json', 'utf8')).name) }]
  : names.map(name => ({ target: realpathSync(path.join(global, name)), folder: path.join('node_modules', name) }));
for (const { target, folder } of links) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(path.relative(path.dirname(path.resolve(folder)), target), folder);
}
` });
  stub(bin, log, 'npm', `if [ "$1" = link ]; then exec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, 'npm-link.mjs'))} "$@"; fi\ncat npm-query.json`);
  // `composer update <names> --working-dir <project>` under COMPOSER=<file>: for each path repository of that file, the installed
  // folder of the package it provides becomes a link to the url (what Composer does with `symlink`); the stub records the file it read.
  put(bin, { 'composer-update.mjs': `import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const project = args.includes('--working-dir') ? args[args.indexOf('--working-dir') + 1] : process.cwd();
const selected = process.env.COMPOSER || 'composer.json';
const file = path.resolve(project, selected);
writeFileSync(path.join(project, 'composer-update.seen.json'), JSON.stringify({ file: process.env.COMPOSER, targets: args.filter(item => item.includes('/') && !item.startsWith('-') && item !== project), manifest: JSON.parse(readFileSync(file, 'utf8')) }));
const manifest = JSON.parse(readFileSync(file, 'utf8'));
const vendor = process.env.COMPOSER_VENDOR_DIR || manifest.config?.['vendor-dir'] || 'vendor';
const recordFile = path.join(project, vendor, 'composer/installed.json');
// A fresh vendor has no record yet, so Composer writes one with each path package that it installs.
const fresh = !existsSync(recordFile);
const record = fresh ? { packages: [] } : JSON.parse(readFileSync(recordFile, 'utf8'));
for (const repository of JSON.parse(readFileSync(file, 'utf8')).repositories ?? []) {
  if (repository.type !== 'path') continue;
  const url = path.resolve(project, repository.url);
  const source = JSON.parse(readFileSync(path.join(url, 'composer.json'), 'utf8'));
  const name = source.name;
  let entry = record.packages.find(item => item.name === name);
  if (!entry && fresh) { entry = { name, version: repository.options?.versions?.[name] ?? '0.0.0', 'install-path': path.join('..', name) }; record.packages.push(entry); }
  if (!entry?.['install-path']) continue;
  const target = path.resolve(project, vendor, 'composer', entry['install-path']);
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  symlinkSync(url, target);
  entry.dist = { type: 'path', url };
  entry.require = source.require;
  if (source.version) entry.version = source.version;
}
mkdirSync(path.dirname(recordFile), { recursive: true });
writeFileSync(recordFile, JSON.stringify(record));
writeFileSync(path.join(project, selected.replace(/\\.json$/, '') + '.lock'), JSON.stringify({ packages: record.packages, 'packages-dev': [] }));
` });
  stub(bin, log, 'composer', `if [ "$1 $4" = "config vendor-dir" ]; then cat composer-vendor-dir 2>/dev/null || echo vendor; fi\nif [ "$1" = update ]; then node ${JSON.stringify(path.join(bin, 'composer-update.mjs'))} "$@"; fi\nif [ "$1" = dump-autoload ]; then echo "COMPOSER=$COMPOSER" >> ${JSON.stringify(log)}; fi`);
  put(bin, { 'uv-editable.mjs': `import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const python = path.join(process.cwd(), '.venv/bin/python');
const site = path.join(path.dirname(path.dirname(python)), 'lib/python3.14/site-packages');
const project = readFileSync(path.join(process.cwd(), 'pyproject.toml'), 'utf8');
const listFile = ${JSON.stringify(path.join(consumer, 'pip-list.json'))};
const installed = JSON.parse(readFileSync(listFile, 'utf8'));
for (const match of project.matchAll(/path = "([^"]+)".*editable = true/g)) {
  const source = path.resolve(process.cwd(), match[1]);
  const manifest = readFileSync(path.join(source, 'pyproject.toml'), 'utf8');
  const name = /^name = "([^"]+)"/m.exec(manifest)?.[1].replaceAll('-', '_');
  if (!name) process.exit(92);
  const distribution = installed.find(item => item.name.replaceAll('-', '_') === name);
  if (distribution) distribution.editable_project_location = source;
  const record = path.join(site, name + '-0.0.1.dist-info');
  // Native sync consumes the application's editable source declaration.
  const released = path.join(site, name);
  if (existsSync(released)) rmSync(released, { recursive: true, force: true });
  mkdirSync(record, { recursive: true });
  writeFileSync(path.join(record, 'direct_url.json'), JSON.stringify({ url: pathToFileURL(source).href, dir_info: { editable: true } }));
}
writeFileSync(listFile, JSON.stringify(installed));
` });
  stub(bin, log, 'uv', `if [ "$1" = sync ]; then ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, 'uv-editable.mjs'))} "$@" || exit $?; fi\ncase "$1" in sync) case " $* " in *" --inexact "*|*" --all-groups "*) ;; *) if [ -f ${JSON.stringify(path.join(consumer, 'test-only.txt'))} ]; then while read n; do grep -v "^$n[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))}; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; done < ${JSON.stringify(path.join(consumer, 'test-only.txt'))}; fi;; esac; if [ -f ${JSON.stringify(path.join(consumer, 'sync-rewrites.txt'))} ]; then while read n u; do case " $* " in *" --no-install-package $n "*) ;; *) grep -v "^$n[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))}; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; echo "$n @ $u" >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; echo "$n no" >> ${JSON.stringify(path.join(consumer, 'editable.txt'))};; esac; done < ${JSON.stringify(path.join(consumer, 'sync-rewrites.txt'))}; fi; ag=no; case " $* " in *" --all-groups "*) ag=yes;; esac; prev=""; for a; do if [ "$prev" = "--reinstall-package" ] && [ "$ag" = yes ]; then grep -v "^$a[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))}; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; grep "^$a==" ${JSON.stringify(path.join(consumer, 'export.txt'))} >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null; fi; prev="$a"; done;;
export) cat ${JSON.stringify(path.join(consumer, 'export.txt'))} 2>/dev/null;;
esac
case "$1 $2" in "workspace dir") d=$PWD; while [ "$d" != / ]; do grep -q tool.uv.workspace "$d/pyproject.toml" 2>/dev/null && { echo "$d"; exit 0; }; d=$(dirname "$d"); done; pwd;; "pip list") cat ${JSON.stringify(path.join(consumer, 'pip-list.json'))};; "pip check") cat ${JSON.stringify(path.join(consumer, 'pip-check.txt'))} 2>/dev/null || true;; "pip freeze") cat ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null || true;; "pip install") rm -f ${JSON.stringify(path.join(consumer, 'pip-check.txt'))}; shift 2; nodeps=""; while [ $# -gt 0 ]; do case "$1" in --constraints) cp "$2" ${JSON.stringify(path.join(consumer, 'constraints.logged'))}; shift 2;; --overrides) cp "$2" ${JSON.stringify(path.join(consumer, 'overrides.logged'))}; shift 2;; --python|--reinstall-package) shift 2;; --no-deps) nodeps=1; shift;; -e) dir=$2; n=$(sed -n 's/^name = "\\(.*\\)"/\\1/p' "$dir/pyproject.toml" | head -n 1 | tr _ -); grep -v "^$n[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} > ${JSON.stringify(path.join(consumer, 'freeze.next'))} 2>/dev/null; mv ${JSON.stringify(path.join(consumer, 'freeze.next'))} ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; echo "$n @ file://$dir" >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; if [ -z "$nodeps" ]; then for dep in $(sed -n 's/^dependencies = \\[\\(.*\\)\\]/\\1/p' "$dir/pyproject.toml" | tr -d "\\"' " | tr ',' '\\n' | sed 's/[=<>@].*//'); do grep -q "^$dep[=@ ]" ${JSON.stringify(path.join(consumer, 'freeze.txt'))} 2>/dev/null || echo "$dep==1.0" >> ${JSON.stringify(path.join(consumer, 'freeze.txt'))}; done; fi; shift 2;; *.whl) n=$(basename "$1" | cut -d- -f1 | tr _ -); grep -v "^$n[=@ ]" ${freezeFile} > ${freezeFile}.next 2>/dev/null; mv ${freezeFile}.next ${freezeFile}; echo "$n @ file://$1" >> ${freezeFile}; if [ -z "$nodeps" ]; then for dep in $(unzip -p "$1" '*.dist-info/METADATA' | sed -n 's/^Requires-Dist: \\([A-Za-z0-9._-]*\\).*/\\1/p'); do grep -q "^$dep[=@ ]" ${freezeFile} 2>/dev/null || echo "$dep==1.0" >> ${freezeFile}; done; fi; shift;; *) shift;; esac; done;; esac`);
  // The work init writes the Use of the go.work that it writes, as a go.work.json beside it, which work edit -json reads.
  // The list -m of a module that the module of the folder a does not require fails as real go does.
  stub(bin, log, 'go', `case "$1 $2" in "mod edit") cat "$4.json";; "work edit") cat "$4.json";; "work init") : > "$GOWORK"; shift 2; { printf '{"Use":['; s=""; for d in "$@"; do printf '%s{"DiskPath":"%s"}' "$s" "$d"; s=","; done; printf ']}'; } > "$GOWORK.json";; "list -m") if [ "$5" = b ] && [ "$(basename "$PWD")" = a ]; then echo "go: module $5: not a known dependency" >&2; exit 1; fi; echo ${JSON.stringify(path.join(provider, 'go'))};; esac`);
  const cargoGraph = JSON.stringify({ packages: [{ id: 'provider', name: 'polyspec-prov', manifest_path: path.join(provider, 'rust/Cargo.toml') }], resolve: { nodes: [{ id: 'provider' }] } });
  stub(bin, log, 'cargo', `for arg in "$@"; do if [ "$arg" = locate-project ]; then echo "$PWD/Cargo.toml"; exit 0; fi; if [ "$arg" = metadata ]; then printf '%s' '${cargoGraph}'; exit 0; fi; done`);
  const pythonProject = path.join(consumer, 'python/pyproject.toml');
  writeFileSync(pythonProject, readFileSync(pythonProject, 'utf8') + '\n[tool.uv.sources]\npolyspec-z = { path = "../../prov/packages/python", editable = true }\npolyspec-w = { path = "../../prov/packages/w", editable = true }\n');
  const env = { PATH: process.env.PATH, NPM: path.join(bin, 'npm'), COMPOSER_BIN: path.join(bin, 'composer'), UV: path.join(bin, 'uv'), GO: path.join(bin, 'go'), CARGO: path.join(bin, 'cargo') };
  current = [provider, kit, consumer];
  return { root, provider, kit, consumer, env, log: () => readFileSync(log, 'utf8') };
}

/** The provider folder of the npm package folder `folder`: the real folder of its package.json, through a directory link or a tree of per-file links (K558). */
const npmTarget = (folder: string): string => path.dirname(realpathSync(path.join(folder, 'package.json')));

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
  assert.equal(npmTarget(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
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
  // install-packages installs the tracked lock with npm ci, the release record, and links nothing (K511).
  assert.match(packages, /\$\(ONLINE\) \$\(NPM\) ci/);
  assert.match(readFileSync(path.join(KIT, 'scripts/kit/npm-install.mts'), 'utf8'), /spawnSync\(npm, \['ci'/, 'npm-install runs npm ci');
  assert.doesNotMatch(packages, /link/);
  // install-kit installs only; the recipe of install links, after all its prerequisites, the steps of the repository included.
  assert.doesNotMatch(recipeOf('install-kit').join('\n'), /link/);
  assert.deepEqual(recipeOf('install'), ['\t$(MAKE) --no-print-directory install-link']);
  assert.doesNotMatch(recipeOf('install-link').join('\n'), /\$\(MAKE\)[^\n]*build|npm run build/);
});

// K348-1, K613: a repository includes the kit-bootstrap.mk of the kit checkout beside it, which runs the sources of that checkout: KIT
// is the folder of the bootstrap, whatever the repository, and no dist is read.
test('the bootstrap runs the link source of the kit checkout that holds it, with no dist (K348-1, K613)', (t) => {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-k348-1-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const sources = path.join(KIT, 'scripts/kit');
  const dry = spawnSync('make', ['-n', '-f', path.join(sources, 'kit-bootstrap.mk'), 'install-link', 'NODE=node'], { cwd, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(dry.stdout.includes(`node ${sources}/link.mts link --siblings`), dry.stdout);
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
    'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }, { type: 'path', url: '../forks/json-schema', options: { symlink: true } }], require: { 'polyspec/y': '0.0.1', 'opis/json-schema': '2.6.0-p1' }, config: { 'vendor-dir': 'var/contracts/vendor' } }),
    'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', 'install-path': '../polyspec/y' }, { name: 'opis/json-schema', version: '2.6.0-p1', 'install-path': '../opis/json-schema' }] }),
    'var/contracts/vendor/opis/json-schema/composer.json': '{"name":"opis/json-schema"}',
  });
  const checkouts = siblingCheckouts(consumer).checkouts;
  assert.deepEqual(checkouts, [fork, kit, provider].sort());
  assert.equal(link({ checkouts, directories: [consumer], check: false, print: () => {}, env }), true);
  assert.equal(realpathSync(path.join(consumer, 'var/contracts/vendor/opis/json-schema')), fork);
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

test('unlink restores the locked releases of a project locked with pylock.toml (K401-1)', (t) => {
  const { consumer, provider, env, log } = workspace(t);
  rmSync(path.join(consumer, 'python/uv.lock'));
  put(consumer, {
    'python/pylock.toml': 'lock-version = "1.0"\ncreated-by = "uv"\n\n[[packages]]\nname = "polyspec-z"\nversion = "0.0.1"\n\n[[packages]]\nname = "jsonschema"\nversion = "4.23.0"\n',
  });
  // This fixture begins with an existing native editable install. Source-link sync requires uv.lock;
  // pylock.toml alone is supported here only for restoring its pinned releases.
  const source = path.join(provider, 'packages/python');
  const site = path.join(consumer, 'python/.venv/lib/python3.14/site-packages');
  rmSync(path.join(site, 'polyspec_z'), { recursive: true, force: true });
  put(site, { 'polyspec_z-0.0.1.dist-info/direct_url.json': JSON.stringify({ url: pathToFileURL(source).href, dir_info: { editable: true } }) });
  put(consumer, { 'freeze.txt': `polyspec-z @ ${pathToFileURL(source).href}\njsonschema==4.23.0\n` });
  assert.doesNotMatch(log(), /^uv sync --locked/m, 'the PEP 751 restore fixture starts installed, without a source-link sync');
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
    npm: npmTarget(path.join(consumer, 'node_modules/@polyspec/x')),
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
  assert.throws(() => linkLines([consumer], env), /is not ignored by Git in its repository; the links write only ignored files/);
});

test('a worktree links a package of its own repository to its own folder, never to the main checkout, and a worktree is no provider (K448)', (t) => {
  const { root, provider, consumer, env } = workspace(t);
  git(consumer, 'worktree', 'add', '--quiet', path.join(root, 'cons-wt'));
  git(provider, 'worktree', 'add', '--quiet', path.join(root, 'prov-wt'));
  const tree = path.join(root, 'cons-wt');
  put(tree, {
    'npm-query.json': JSON.stringify([{ name: '@polyspec/own', version: '0.0.1', location: 'node_modules/@polyspec/own' }, { name: '@polyspec/x', version: '0.0.1', location: 'node_modules/@polyspec/x' }]),
    'node_modules/@polyspec/own/package.json': '{}', 'node_modules/@polyspec/x/package.json': '{}',
    // K529: the packages that the manifests of the worktree declare are installed in it (a worktree's installs are its own copies).
    'node_modules/@polyspec/kit/package.json': '{}',
    'var/contracts/vendor/polyspec/y/composer.json': '{"name":"polyspec/y"}',
    'go.mod.json': readFileSync(path.join(consumer, 'go.mod.json'), 'utf8'),
  });
  const { ok, text } = linkLines([tree], env);
  assert.equal(ok, true, text);
  // K448: a package of its own repository links to the folder of the worktree itself, never to the main checkout of that repository.
  assert.equal(realpathSync(path.join(tree, 'node_modules/@polyspec/own')), realpathSync(path.join(tree, 'packages/own')), 'the own package is the worktree folder');
  assert.equal(npmTarget(path.join(tree, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'), 'the main checkout provides, not prov-wt');
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
  assert.equal(npmTarget(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
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
  assert.equal(npmTarget(path.join(app, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
});

test('a failing git ls-files throws with its cause, in the manifests and in the build inputs', (t) => {
  const { root } = workspace(t);
  const outside = path.join(root, 'not-a-repository');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }));
  assert.throws(() => trackedManifests(outside, ['package.json']), /git ls-files failed in .*not-a-repository: /);
  assert.throws(() => buildState(outside, outside), /git ls-files failed in .*not-a-repository: /);
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
  // The lock names the crate of the provider: a crate that the lock does not name is never patched (K448-5-1).
  const lock = 'version = 4\n\n[[package]]\nname = "polyspec-prov"\nversion = "0.0.1"\n';
  writeFileSync(path.join(consumer, 'Cargo.lock'), lock);
  assert.equal(cargo({ directory: consumer, args: ['check'], checkouts: current, env }), 0);
  const copy = path.join(consumer, 'var/link/cargo/root/Cargo.lock');
  writeFileSync(copy, 'changed\n');
  cargo({ directory: consumer, args: ['check'], checkouts: current, env });
  assert.equal(readFileSync(copy, 'utf8'), lock);
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
  put(consumer, { 'go.work.sum': 'workspace checksum fixture\n' });
  const repeat = linkLines([consumer], env);
  assert.equal(repeat.ok, true, repeat.text);
  assert.equal(readFileSync(path.join(consumer, 'go.work.sum'), 'utf8'), 'workspace checksum fixture\n', 'a repeated Go link preserves checksum state');
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
  assert.equal(npmTarget(path.join(installation, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
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

test('a consumer workspace package wins over a sibling package with the same name (K468-1)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'packages/own/package.json': JSON.stringify({ name: '@polyspec/x', version: '0.0.1' }) });
  assert.equal(providers([provider], undefined, consumer, consumer).get('npm:@polyspec/x')?.folder, path.join(consumer, 'packages/own'));
  const lines: string[] = [];
  const ok = link({ checkouts: [provider, ...current.slice(1)], directories: [consumer], check: false, print: text => lines.push(text), env });
  assert.equal(ok, true, lines.join('\n'));
  assert.doesNotMatch(lines.join('\n'), /NOT linked/);
});

// make composer-install installs a consumer's Composer project through the link when a sibling checkout provides a polyspec
// package that its composer.lock holds, so the lock's release archive is never installed and the provided folder resolves.
/** A fresh checkout of the consumer: its composer.lock pins polyspec/y as a release archive, and no vendor is installed. */
function freshComposer(consumer: string) {
  rmSync(path.join(consumer, 'var/contracts/vendor'), { recursive: true, force: true });
  put(consumer, { 'composer.lock': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', dist: { type: 'zip', url: 'https://example.invalid/polyspec/y-0.0.1.zip' } }] }) });
}

// The lock-only package is not declared by composer.json, so no refusal applies to it (K483-1 refuses a declared package only).
test('make composer-install without a sibling that provides a polyspec package of the lock runs composer install of the tracked lock (K432)', (t) => {
  const { consumer, env, log } = workspace(t);
  freshComposer(consumer);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }], require: {} }) });
  const lines: string[] = [];
  const mode = composerInstall({ directory: consumer, checkouts: [], env, print: text => lines.push(text) });
  assert.match(log(), /^composer install --no-interaction$/m, 'the tracked lock is installed');
  assert.doesNotMatch(log(), /^composer update/m, 'no update runs without a link');
  assert.equal(existsSync(path.join(consumer, 'composer.link.json')), false, 'no link manifest is written');
  assert.equal(mode, 'locked', 'the selected path installs the locked project without source updates');
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

// A runner checkout is an explicit job input, not the folder of an interactive development session.
for (const nested of [false, true]) {
  test(`a ${nested ? 'nested' : 'root'} runner checkout needs no workspace hook and still checks dependency links (K661-6)`, (t) => {
    const { root, kit, env } = workspace(t);
    hookCheckout(kit);
    const runner = { ...env, GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: nested ? root : kit };
    assert.equal(writeWorkspaceHook(root, runner), undefined);
    assert.equal(existsSync(path.join(root, '.claude/settings.json')), false);
    assert.deepEqual(linkFindings(kit, runner), []);
    put(kit, { 'Cargo.lock': 'version = 4\n\n[[package]]\nname = "polyspec-prov"\nversion = "0.0.1"\n' });
    git(kit, 'add', 'Cargo.lock');
    assert.ok(linkFindings(kit, runner).some(finding => finding.includes('polyspec-prov') && finding.includes('records no source')), 'the dependency release-record check remains active in a runner checkout');
  });
}

test('a workspace outside the runner checkout retains missing, modified and non-executable hook checks (K661-6)', (t) => {
  const { root, kit, consumer, env } = workspace(t);
  hookCheckout(kit);
  const runner = { ...env, GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: consumer };
  assert.match(settingsFindings(consumer, runner).join('\n'), /no Bash PreToolUse hook/);
  assert.equal(writeWorkspaceHook(root, runner), workspaceSettingsFile(consumer));
  assert.deepEqual(settingsFindings(consumer, runner), []);
  writeFileSync(workspaceSettingsFile(consumer), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'old/scripts/kit/claude-hook.mts' }] }] } }));
  assert.match(settingsFindings(consumer, runner).join('\n'), /differs from the entry/);
  writeWorkspaceHook(root, runner);
  rmSync(path.join(kit, 'var/tools/bin/node'));
  writeFileSync(path.join(kit, 'var/tools/bin/node'), '#!/bin/sh\n', { mode: 0o644 });
  assert.match(linkFindings(consumer, runner).join('\n'), /node of the kit checkout is missing or not executable/);
  assert.throws(() => writeWorkspaceHook(root, runner), /missing or not executable/);
});

// K448-5: cargo links the sibling crates from the start. make cargo-fetch runs cargo fetch of the project through the link, with
// the checkouts beside it patched, so no fetch materialises the git tag of a sibling crate.
test('make cargo-fetch runs cargo fetch through the link of the sibling checkouts (K448-5)', () => {
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', 'scripts/kit/kit.mk', 'KIT=scripts/kit', 'KIT_EXT=mts', 'ONLINE=online-wrapper', 'NODE=node', 'cargo-fetch', 'DIR=x'], { cwd: KIT, encoding: 'utf8' });
  assert.equal(dry.stdout.trim(), 'online-wrapper node scripts/kit/link.mts cargo --siblings x fetch --locked');
});

test('link cargo --siblings runs cargo with the sibling crates patched and the arguments unchanged (K448-5)', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'Cargo.lock': 'version = 4\n\n[[package]]\nname = "polyspec-prov"\nversion = "0.0.1"\n' });
  const run = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'cargo', '--siblings', consumer, 'fetch', '--locked'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(log(), /cargo --config .*patch\."https:\/\/github\.com\/polyspec\/prov"\.polyspec-prov\.path=.* fetch --locked$/m);
});

// K489: cargo --siblings patches the crates of a sibling checkout that the consumer's lock names from git, and needs nothing from a checkout
// that has no config/release.json and that the lock does not name, such as an unrelated polyspec checkout (fsm) beside the consumer.
test('link cargo --siblings patches no crate of a checkout without config/release.json that the lock does not name (K489)', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'Cargo.lock': 'version = 4\n\n[[package]]\nname = "polyspec-prov"\nversion = "0.0.1"\n' });
  repository(path.dirname(consumer), 'other', { 'rust/Cargo.toml': '[package]\nname = "polyspec-other"\nversion = "0.0.1"\n' });
  git(path.join(path.dirname(consumer), 'other'), 'remote', 'add', 'origin', 'https://github.com/polyspec/other.git');
  const run = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'cargo', '--siblings', consumer, 'fetch', '--locked'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(log(), /patch\."https:\/\/github\.com\/polyspec\/prov"\.polyspec-prov\.path=/);
  assert.doesNotMatch(log(), /polyspec-other/);
});

// K448-5-1: cargo --siblings patches only the crates that the consumer's lock names. A patch of an unnamed crate is unused, and cargo records
// it as a patch.unused entry of the lock, so the tracked lock of the consumer would change and --locked refuses the fetch.
test('link cargo --siblings patches no crate that the consumer lock does not name (K448-5-1)', (t) => {
  const { consumer, env, log } = workspace(t);
  const run = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'cargo', '--siblings', consumer, 'fetch', '--locked'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(log(), /patch\./);
});

// K448-5-2: cargo --siblings resolves and fetches the patched graph in the link state (var/link), not against the tracked Cargo.lock:
// metadata first resolves the copied lock, then the original native flags apply while the tracked lock stays byte-identical.
test('link cargo --siblings fetches in the link lock with its native arguments and leaves the tracked Cargo.lock unchanged (K448-5-2)', (t) => {
  const { consumer, env, log } = workspace(t);
  put(consumer, { 'Cargo.lock': 'version = 4\n\n[[package]]\nname = "polyspec-prov"\nversion = "0.0.1"\n' });
  const before = readFileSync(path.join(consumer, 'Cargo.lock'), 'utf8');
  const run = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'cargo', '--siblings', consumer, 'fetch', '--locked'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(log(), /fetch --locked/, 'the requested native arguments are preserved after metadata resolves the link graph');
  assert.match(log(), /resolver\.lockfile-path=.*var\/link\/cargo\/root\/Cargo\.lock.* fetch --locked$/m);
  assert.equal(readFileSync(path.join(consumer, 'Cargo.lock'), 'utf8'), before, 'the tracked Cargo.lock is unchanged');
});

test('link cargo without --siblings runs a plain locked fetch of the release (K448-5-2)', (t) => {
  const { consumer, env, log } = workspace(t);
  const run = spawnSync(process.execPath, [path.join(KIT, 'scripts/kit/link.mts'), 'cargo', consumer, 'fetch', '--locked'], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(log(), /^cargo fetch --locked$/m);
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

// K483-2: composer-install installs with --no-dev when the make option NO_DEV=1 is given, and without it the install is unchanged.
test('composer-install installs with --no-dev when noDev is given, as make composer-install NO_DEV=1 does (K483-2)', (t) => {
  const { consumer, env, log } = workspace(t);
  freshComposer(consumer);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }], require: {} }) });
  composerInstall({ directory: consumer, checkouts: [], env, noDev: true, print: () => undefined });
  assert.match(log(), /^composer install --no-interaction --no-dev$/m, 'the tracked lock is installed without dev packages');
});

test('make -n composer-install NO_DEV=1 passes --no-dev to the composer-install tool, and without it passes none (K483-2)', () => {
  const kitRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const dry = (...extra: string[]) => spawnSync('make', ['-n', 'composer-install', 'DIR=examples/app', ...extra], { cwd: kitRoot, encoding: 'utf8' });
  const withDev = dry();
  assert.equal(withDev.status, 0, withDev.stderr);
  assert.match(withDev.stdout, /composer-install\.(mts|mjs|js) examples\/app\s*$/m, withDev.stdout);
  const noDev = dry('NO_DEV=1');
  assert.equal(noDev.status, 0, noDev.stderr);
  assert.match(noDev.stdout, /composer-install\.(mts|mjs|js) examples\/app --no-dev\s*$/m, noDev.stdout);
});

// K326-3: link writes the target of a link relative to the link's folder, as the rules of kit name (never absolute). A link that an
// earlier run wrote absolute, and that still resolves to its provider, is re-made relative by the next link run.
test('a stale absolute npm link that resolves to its provider is re-made relative by link (K326-3)', (t) => {
  const { kit, consumer, env } = workspace(t);
  const first = linkLines([consumer], env);
  assert.equal(first.ok, true, first.text);
  const installed = path.join(consumer, 'node_modules/@polyspec/kit');
  const target = kit;
  rmSync(installed);
  symlinkSync(target, installed);
  const second = linkLines([consumer], env);
  assert.equal(second.ok, true, second.text);
  assert.equal(readlinkSync(installed), path.relative(path.dirname(installed), target), 'the target is relative to the link folder');
  assert.equal(realpathSync(installed), realpathSync(target), 'the link still resolves to the provider');
});

// K501: composer-install takes the checkouts that provide its polyspec packages as arguments after DIR, as npm-install does (K448-9).
test('composer-install takes the checkouts after DIR and runs the install with them (K501)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-composer-k501-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'app');
  const checkout = path.join(root, 'provider');
  mkdirSync(project);
  mkdirSync(checkout);
  // A checkout is the top level of a Git repository (link takes main checkouts).
  initRepository(checkout);
  initRepository(project);
  writeFileSync(path.join(project, 'composer.json'), JSON.stringify({ name: 'app/app', require: {} }));
  writeFileSync(path.join(project, 'composer.lock'), JSON.stringify({ packages: [], 'packages-dev': [] }));
  const log = path.join(root, 'composer.log');
  const bin = path.join(root, 'composer');
  writeFileSync(bin, `#!/bin/sh\necho "composer $*" >> ${JSON.stringify(log)}\n`);
  chmodSync(bin, 0o755);
  const cli = fileURLToPath(new URL('../../scripts/kit/composer-install.mts', import.meta.url));
  const outcome = spawnSync(process.execPath, [cli, project, checkout], { encoding: 'utf8', env: { ...process.env, COMPOSER_BIN: bin } });
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.match(readFileSync(log, 'utf8'), /composer install/);
});

// K448: the link is the folder. Each installed polyspec package folder that a sibling checkout provides becomes a direct symlink to
// the provider's package folder, a copy is removed, and no package manager runs: no composer.link.json, no npm, no Composer, so no
// version, constraint or provider version is read.
test('link connects npm through its package manager and retains the other local source links (K657-1)', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }], require: { 'polyspec/y': '0.0.1' }, config: { 'vendor-dir': 'var/contracts/vendor' } }) });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'vendor dir');
  writeFileSync(path.join(consumer, '..', 'tools.log'), '');
  const { ok, text } = linkLines([consumer], env);
  assert.equal(ok, true, text);
  const vendor = path.join(consumer, 'var/contracts/vendor/polyspec/y');
  assert.equal(lstatSync(vendor).isSymbolicLink(), true, 'vendor/polyspec/y is a link');
  assert.equal(realpathSync(vendor), realpathSync(path.join(provider, 'packages/php')));
  const npm = path.join(consumer, 'node_modules/@polyspec/x');
  assert.equal(lstatSync(npm).isSymbolicLink(), true, 'node_modules/@polyspec/x is one symlink (K591)');
  assert.equal(npmTarget(npm), realpathSync(path.join(provider, 'packages/ts')));
  assert.equal(existsSync(path.join(consumer, 'composer.link.json')), false, 'no Composer link manifest is written');
  assert.match(log(), /^npm link /m, 'npm owns its local package link (K657-1)');
});

// K447: link covers every tracked Composer project of the checkout, not only the root: a project below the root with its own lock (hyper
// examples/board) gets its installed polyspec package linked, as link-state-check reads every tracked manifest.
test('link replaces the polyspec package of a nested Composer project with a link to its provider (K447)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, {
    'examples/board/composer.json': JSON.stringify({ name: 'cons/board', repositories: [{ type: 'path', url: '../../../prov/packages/php', options: { symlink: true } }], require: { 'polyspec/y': '0.0.1' } }),
    'examples/board/composer.lock': '{}',
    'examples/board/.gitignore': 'vendor/\n',
  });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'board');
  put(consumer, { 'examples/board/vendor/polyspec/y/composer.json': '{"name":"polyspec/y"}', 'tests/release-consumer/composer/vendor/polyspec/y/composer.json': '{"name":"polyspec/y"}' });
  const { ok, text } = linkLines([consumer], env);
  assert.equal(lstatSync(path.join(consumer, 'tests/release-consumer/composer/vendor/polyspec/y')).isSymbolicLink(), false, 'the release consumer keeps the install that it tests');
  assert.equal(ok, true, text);
  const vendor = path.join(consumer, 'examples/board/vendor/polyspec/y');
  assert.equal(lstatSync(vendor).isSymbolicLink(), true, 'the nested project vendor holds a link');
  assert.equal(realpathSync(vendor), realpathSync(path.join(provider, 'packages/php')));
});

// K529 (a): a uv workspace member maps its source directory to the package path of its wheel target, so the member limepie-contracts
// links limepie/contracts in the venv of its workspace root (the root holds the member as a provider, and no package folder of src is a package).
test('K529: a uv workspace member links the package path that its hatchling sources map, and no other folder of its source (K529)', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-k529-')));
  try {
    const hyper = path.join(root, 'hyper');
    const repo = repository(hyper, 'python', {
      'pyproject.toml': '[project]\nname = "limepie-python"\nversion = "0"\n\n[tool.uv.workspace]\nmembers = ["contracts"]\n',
      'contracts/pyproject.toml': '[project]\nname = "limepie-contracts"\nversion = "0"\n\n[tool.hatch.build.targets.wheel]\nsources = {"src" = "limepie/contracts"}\n',
      'contracts/src/__init__.py': '',
      'contracts/src/kit/__init__.py': '',
    });
    put(repo, {
      '.venv/pyvenv.cfg': 'home = /usr\n',
      '.venv/lib/python3.14/site-packages/limepie/contracts/__init__.py': '',
    });
    const found = providedFolders(repo, providers([repo], undefined, repo, repo).values(), { environment: '.venv' });
    const lines = found.map(item => `${item.name} ${path.relative(repo, item.folder)} ${path.relative(repo, item.target)}`);
    assert.deepEqual(lines, ['limepie-contracts limepie/contracts .venv/lib/python3.14/site-packages/limepie/contracts contracts/src']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K529 (b): the Composer vendor folder is COMPOSER_VENDOR_DIR when it is set, before config.vendor-dir, as Composer reads it.
test('K529: link reads COMPOSER_VENDOR_DIR as the vendor folder before config.vendor-dir (K529)', (t) => {
  const { provider, consumer, env } = workspace(t);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }], require: { 'polyspec/y': '0.0.1' } }) });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'vendor from the environment');
  const { ok, text } = linkLines([consumer], { ...env, COMPOSER_VENDOR_DIR: 'var/contracts/vendor' });
  assert.equal(ok, true, text);
  const vendor = path.join(consumer, 'var/contracts/vendor/polyspec/y');
  assert.equal(lstatSync(vendor).isSymbolicLink(), true, 'the package in COMPOSER_VENDOR_DIR is a link');
  assert.equal(realpathSync(vendor), realpathSync(path.join(provider, 'packages/php')));
});

// K529 (c): check reports a missing install; mutation delegates the declared initial install to Composer.
test('K529: check rejects a missing declared package and mutation installs its source (K529)', (t) => {
  const { consumer, provider, env } = workspace(t);
  put(consumer, { 'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }], require: { 'polyspec/y': '0.0.1' }, config: { 'vendor-dir': 'var/not-installed' } }) });
  put(consumer, { 'composer-vendor-dir': 'var/not-installed' });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'declared but not installed');
  const checked = linkLines([consumer], env, true);
  assert.equal(checked.ok, false, checked.text);
  assert.match(checked.text, /NOT linked\s+composer\s+polyspec\/y/);
  const linked = linkLines([consumer], env);
  assert.equal(linked.ok, true, linked.text);
  assert.equal(realpathSync(path.join(consumer, 'var/not-installed/polyspec/y')), path.join(provider, 'packages/php'));
  assert.equal(linkLines([consumer], env, true).ok, true);

});


// K643: uv installs a path dependency editable: site-packages then holds no folder of the package, only its dist-info whose
// direct_url.json (PEP 610) names the source folder. Such an install of the provider's folder is linked natively; one of another
// folder is a finding in link and in check.
test('K643: a python package installed editable from its provider is linked, and one installed editable from elsewhere is a finding (K643)', (t) => {
  const { provider, consumer, env } = workspace(t);
  const first = linkLines([consumer], env);
  assert.equal(first.ok, true, first.text);
  const site = path.join(consumer, 'python/.venv/lib/python3.14/site-packages');
  rmSync(path.join(site, 'polyspec_z'), { recursive: true, force: true });
  const record = (folder: string) => put(site, { 'polyspec_z-0.0.1.dist-info/direct_url.json': JSON.stringify({ url: pathToFileURL(folder).href, dir_info: { editable: true } }) });
  record(path.join(provider, 'packages/python'));
  const linked = linkLines([consumer], env, true);
  assert.equal(linked.ok, true, linked.text);
  assert.doesNotMatch(linked.text, /polyspec_z.*no installed folder/i);
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'kit-editable-'));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  record(elsewhere);
  const found = linkLines([consumer], env, true);
  assert.equal(found.ok, false, found.text);
  assert.match(found.text, /NOT linked\s+python\s+polyspec[-_]z: installed editable from .*kit-editable-.*, not from .*packages\/python/i);
  const repaired = linkLines([consumer], env);
  assert.equal(repaired.ok, true, repaired.text);
  const metadata: unknown = JSON.parse(readFileSync(path.join(site, 'polyspec_z-0.0.1.dist-info/direct_url.json'), 'utf8'));
  assert.deepEqual(metadata, { url: pathToFileURL(path.join(provider, 'packages/python')).href, dir_info: { editable: true } });
  assert.equal(linkLines([consumer], env, true).ok, true);

});

// K590: a workspace member has no lock of its own: npm installs an npm workspace member's packages into the node_modules of the root
// whose package-lock.json installs it, and the root composer.json installs a Composer package through its path repository into the
// root's vendor. link takes the member's installed folders from that owner; a package that the owner lacks stays a finding of the member.
test('K590: link takes the installed folders of a workspace member with no lock from the project whose lock installs it (K590)', (t) => {
  const { consumer, provider, env } = workspace(t);
  const manifest = readJsonObject(path.join(consumer, 'package.json'));
  put(consumer, {
    'package.json': JSON.stringify({ ...manifest, workspaces: ['packages/app'] }),
    'packages/app/package.json': JSON.stringify({ name: '@cons/app', dependencies: { '@polyspec/x': '0.0.1' } }),
    'composer.json': JSON.stringify({ name: 'cons/app', repositories: [{ type: 'path', url: '../prov/packages/php', options: { symlink: true } }, { type: 'path', url: 'packages/srv' }], require: { 'polyspec/y': '0.0.1', 'cons/srv': '0.0.1' }, config: { 'vendor-dir': 'var/contracts/vendor' } }),
    'packages/srv/composer.json': JSON.stringify({ name: 'cons/srv', require: { 'polyspec/y': '0.0.1' } }),
  });
  git(consumer, 'add', '-A');
  git(consumer, 'commit', '--quiet', '-m', 'workspace members');
  rmSync(path.join(consumer, 'var/contracts/vendor'), { recursive: true, force: true });
  const linked = linkLines([consumer], env);
  assert.equal(linked.ok, true, linked.text);
  assert.doesNotMatch(linked.text, /no installed folder/);
  const checked = linkLines([consumer], env, true);
  assert.equal(checked.ok, true, checked.text);
  // The owner lacks the package: the member is named.
  rmSync(path.join(consumer, 'node_modules/@polyspec/x'), { recursive: true, force: true });
  const missing = linkLines([consumer], env, true);
  assert.equal(missing.ok, false, missing.text);
  assert.match(missing.text, /NOT linked\s+npm\s+@polyspec\/x: no installed folder in packages\/app/);
  const repaired = linkLines([consumer], env);
  assert.equal(repaired.ok, true, repaired.text);
  assert.equal(realpathSync(path.join(consumer, 'node_modules/@polyspec/x')), path.join(provider, 'packages/ts'));
  assert.equal(linkLines([consumer], env, true).ok, true);

});

test('K657-3: Python links use native editable installation and check refuses legacy links without invoking uv', (t) => {
  const { provider, consumer, env, log } = workspace(t);
  const source = path.join(provider, 'packages/python/src/polyspec_z');
  const site = path.join(consumer, 'python/.venv/lib/python3.14/site-packages');
  put(provider, { 'packages/python/src/polyspec_z/__init__.py': 'VALUE = 1\n' });
  put(consumer, { 'python/.venv/lib/python3.14/site-packages/polyspec_z/__init__.py': 'VALUE = 0\n' });
  const installed = linkLines([consumer], env);
  assert.equal(installed.ok, true, installed.text);
  assert.equal(log().split('\n').filter(line => line === 'uv sync --locked').length, 1);
  assert.match(log(), /uv pip check --python/);
  assert.match(log(), /uv pip list --python .*--format json/);
  assert.doesNotMatch(log(), /uv pip list --editable/);
  assert.doesNotMatch(log(), /uv pip install/);
  assert.equal(existsSync(path.join(site, 'polyspec_z')), false);
  const record = path.join(site, 'polyspec_z-0.0.1.dist-info/direct_url.json');
  const metadata: unknown = JSON.parse(readFileSync(record, 'utf8'));
  assert.deepEqual(metadata, { url: pathToFileURL(path.join(provider, 'packages/python')).href, dir_info: { editable: true } });
  const uvLog = () => log().split('\n').filter(line => line.startsWith('uv ')).join('\n');
  const before = uvLog();
  assert.equal(linkLines([consumer], env, true).ok, true);
  assert.equal(uvLog(), before, 'check invokes no uv command');
  rmSync(path.dirname(record), { recursive: true });
  symlinkSync(source, path.join(site, 'polyspec_z'));
  const legacy = linkLines([consumer], env, true);
  assert.equal(legacy.ok, false);
  assert.match(legacy.text, /legacy package link requires a fresh native editable environment/);
  assert.equal(uvLog(), before, 'legacy check also invokes no uv command');
  assert.throws(() => linkLines([consumer], env), /legacy Python package links require migration/);
  assert.equal(readFileSync(path.join(source, '__init__.py'), 'utf8'), 'VALUE = 1\n');
});

// K539: legacy package-folder links are removed before native sync can write through them.
// The application keeps its declared editable source; restoring its lock must not change the provider checkout.
test('unlink removes legacy package links before native sync and keeps declared editable sources safe (K539)', (t) => {
  const { provider, consumer, env } = workspace(t);
  assert.equal(linkLines([consumer], env).ok, true);
  const source = path.join(provider, 'packages/python/src/polyspec_z/__init__.py');
  put(provider, { 'packages/python/src/polyspec_z/__init__.py': 'VALUE = "checkout"\n' });
  const site = path.join(consumer, 'python/.venv/lib/python3.14/site-packages');
  mkdirSync(site, { recursive: true });
  symlinkSync(path.dirname(source), path.join(site, 'polyspec_z'));
  // A sync that reinstalls a package writes its files into the package folder of the environment, as uv does.
  const uv = path.join(path.dirname(consumer), 'uv-writes');
  writeFileSync(uv, `#!/bin/sh\ncase "$1" in sync) mkdir -p ${JSON.stringify(path.join(site, 'polyspec_z'))} && printf 'VALUE = "released"\\n' > ${JSON.stringify(path.join(site, 'polyspec_z/__init__.py'))};; esac\nexec ${JSON.stringify(env.UV)} "$@"\n`);
  chmodSync(uv, 0o755);
  const lines: string[] = [];
  unlink({ directories: [consumer], print: text => lines.push(text), env: { ...env, UV: uv } });
  assert.equal(readFileSync(source, 'utf8'), 'VALUE = "checkout"\n', 'the provider checkout keeps its tracked file');
  assert.equal(existsSync(path.join(site, 'polyspec_z')), false, 'native editable sync replaces the legacy package folder');
  const metadata: unknown = JSON.parse(readFileSync(path.join(site, 'polyspec_z-0.0.1.dist-info/direct_url.json'), 'utf8'));
  assert.deepEqual(metadata, { url: pathToFileURL(path.join(provider, 'packages/python')).href, dir_info: { editable: true } });
  assert.match(lines.join('\n'), /polyspec_z/, 'the removed link is named');
});

test('K664: shared link installs declared npm and Composer sources before inspecting missing folders', (t) => {
  const { consumer, provider, env, log } = workspace(t);
  const vendor = path.join(consumer, 'var/contracts/vendor');
  rmSync(vendor, { recursive: true, force: true });
  const npmFolder = path.join(consumer, 'node_modules/@polyspec/x');
  rmSync(npmFolder, { recursive: true, force: true });
  const installed = linkLines([consumer], env);
  assert.equal(installed.ok, true, installed.text);
  assert.doesNotMatch(installed.text, /no installed folder/);
  assert.equal(realpathSync(npmFolder), path.join(provider, 'packages/ts'));
  assert.equal(realpathSync(path.join(vendor, 'polyspec/y')), path.join(provider, 'packages/php'));
  const record = readJsonObject(vendor, 'composer/installed.json');
  assert.ok(Array.isArray(record.packages));
  assert.ok(record.packages.some((entry: unknown) => typeof entry === 'object' && entry !== null && 'name' in entry && entry.name === 'polyspec/y'));
  assert.match(log(), /^composer update polyspec\/y .*--with-dependencies/m);
});

// K653's source/runtime metadata mismatch is resolved by the native development manifest, not a synthetic release record.
test('K653: native Composer updates source requirements and its development lock (K657-2)', (t) => {
  const { consumer, provider, env, log } = workspace(t);
  const vendor = path.join(consumer, 'var/contracts/vendor');
  const source = { name: 'polyspec/y', version: '0.0.2', require: { php: '>=8.4' } };
  put(provider, { 'packages/php/composer.json': JSON.stringify(source) });
  const record = { packages: [{ name: source.name, version: '0.0.1', require: { php: '>=8.5' }, 'install-path': '../polyspec/y' }] };
  put(consumer, { 'var/contracts/vendor/composer/installed.json': JSON.stringify(record), 'composer.lock': JSON.stringify({ packages: record.packages, 'packages-dev': [] }) });
  const before = readFileSync(path.join(consumer, 'composer.lock'), 'utf8');
  const first = linkLines([consumer], env);
  assert.equal(first.ok, true, first.text);
  assert.match(log(), /^composer update polyspec\/y .*--with-dependencies/m);
  assert.doesNotMatch(log(), /--ignore-platform|platform-check|--no-install/);
  assert.notEqual(readFileSync(path.join(consumer, 'composer.lock'), 'utf8'), before);
  const installed = readJsonObject(vendor, 'composer/installed.json');
  assert.deepEqual(installed.packages, [{ ...record.packages[0], version: source.version, require: source.require, dist: { type: 'path', url: path.join(provider, 'packages/php') } }]);
  assert.equal(realpathSync(path.join(vendor, 'polyspec/y')), path.join(provider, 'packages/php'));
  const second = linkLines([consumer], env);
  assert.equal(second.ok, true, second.text);
  assert.equal(existsSync(path.join(consumer, 'var/link/composer')), false, 'no synthetic Composer state is written');
});


test('K653: a Composer platform resolution failure propagates and releases its lease', (t) => {
  const { consumer, provider, env } = workspace(t);
  put(provider, { 'packages/php/composer.json': JSON.stringify({ name: 'polyspec/y', require: { php: '>=8.5' } }) });
  put(consumer, { 'composer.lock': JSON.stringify({ packages: [] }), 'var/contracts/vendor/composer/installed.json': JSON.stringify({ packages: [{ name: 'polyspec/y', version: '0.0.1', require: { php: '>=8.4' } }] }) });
  const command = env.COMPOSER_BIN;
  assert.ok(command);
  writeFileSync(command, '#!/bin/sh\nexit 31\n');
  chmodSync(command, 0o755);
  const folders = providedFolders(consumer, [{ ecosystem: 'composer', name: 'polyspec/y', folder: path.join(provider, 'packages/php'), checkout: provider, repository: provider }], { vendorDir: 'var/contracts/vendor' });
  const tool = { command, env };
  assert.throws(() => composerLink(consumer, folders, tool, () => {}), /exited with 31/);
  assert.equal(existsSync(path.join(consumer, 'var/link/composer/metadata.lock')), false);
});


test('K664-3 refuses a release selected instead of the sibling development source and releases its holder', (t) => {
  const { consumer, env } = workspace(t);
  put(consumer, { 'Cargo.lock': 'version = 4\n\n[[package]]\nname = "polyspec-prov"\nversion = "0.0.1"\n', 'release/Cargo.toml': '[package]\nname="polyspec-prov"\nversion="0.0.1"\n' });
  const metadata = JSON.stringify({ packages: [{ id: 'opaque-release', name: 'polyspec-prov', manifest_path: path.join(consumer, 'release/Cargo.toml') }], resolve: { nodes: [{ id: 'opaque-release' }] } });
  stub(path.dirname(env.CARGO), path.join(consumer, 'cargo-source.log'), 'cargo', `for arg in "$@"; do if [ "$arg" = locate-project ]; then echo "$PWD/Cargo.toml"; exit 0; fi; if [ "$arg" = metadata ]; then printf '%s' '${metadata}'; exit 0; fi; done; echo executed >> ${JSON.stringify(path.join(consumer, 'executed'))}`);
  assert.throws(() => cargo({ directory: consumer, args: ['check'], checkouts: current, env }), /Cargo selected .*instead of development source/);
  assert.equal(existsSync(path.join(consumer, 'executed')), false);
  assert.equal(existsSync(path.join(consumer, 'var/link/cargo/root/execution.lock')), false);
  put(consumer, { 'Cargo.lock': 'version = 4\n' });
  assert.throws(() => cargo({ directory: consumer, args: ['check'], checkouts: current, env }), /Cargo selected .*instead of development source/, 'a new dependency missing from the tracked lock cannot silently select its release');
});

test('K664-3 refuses a concurrent holder before replacing the link lock', (t) => {
  const { consumer, env } = workspace(t);
  const folder = path.join(consumer, 'var/link/cargo/root');
  put(consumer, { 'Cargo.lock': 'version = 4\n', 'var/link/cargo/root/Cargo.lock': 'preserved\n' });
  const held = acquireHolderLock(path.join(folder, 'execution.lock'));
  try {
    assert.throws(() => cargo({ directory: consumer, args: ['check'], checkouts: current, env }), /lock/);
    assert.equal(readFileSync(path.join(folder, 'Cargo.lock'), 'utf8'), 'preserved\n');
  } finally { held.release(); }
});

test('K664-3 workspace metadata forwards native graph flags and leaves execution flags to Cargo', () => {
  assert.deepEqual(cargoMetadataArguments(['+1.99.0', 'test', '-p', 'app', '--features', 'one', '-Ftwo', '--features=three', '--manifest-path', 'app/Cargo.toml', '--offline', '--config', 'net.retry=2', '--target=x86_64-unknown-linux-gnu', '--no-default-features', '--all-features', '--', '--features=not-a-cargo-flag']), ['--features', 'one', '-Ftwo', '--features=three', '--manifest-path', 'app/Cargo.toml', '--offline', '--config', 'net.retry=2', '--filter-platform=x86_64-unknown-linux-gnu', '--no-default-features', '--all-features']);
});
