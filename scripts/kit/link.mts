// The local links of 0.0.x development (docs/operations/local-links.md, K201, K205). The checkouts that the arguments name are the
// providers (link-providers.mts): each installed polyspec package of a consumer that is pinned at 0.0.x is pointed at the
// source of the checkout that provides it. link only links; it never builds (link-build.mts rebuilds):
//   npm       each copy that `npm query` lists below node_modules becomes a link to the provider's package folder;
//   Composer  each copy that installed.json of the vendor of the consumer's Composer project (composer config vendor-dir)
//             lists at its install-path becomes a link to the provider's package folder, then composer dump-autoload runs;
//   Python    each declared polyspec package, each polyspec package below it and the consumer's own project are installed
//             from their editable wheels (K222, K224), built where their folder is writable and kept under var/link/wheels,
//             installed into the environment as they are (no sync: the link changes only the linked packages, K239); a read-only
//             folder only installs the wheel that is already there;
//   Go        each go.mod of the consumer gets a git-ignored go.work that uses its module and the provider modules, which
//             go reads by itself; unlink removes it;
//   Rust      `cargo <dir> <args>` runs one cargo command with --config patches and a lock copy under var/link/cargo.
// No environment variable declares anything: without checkouts nothing is linked, and the installs stay the locked releases.
// A consumer is a directory: the top of a work tree stands for every tracked manifest of it, another directory for those
// below it; with --project the folder is the consumer and its own manifest is read, tracked or not (K212). Each file that link writes into the consumer is one that Git ignores there (var/link, and each go.work).
//   node link.mjs link|check [--project <dir>] <checkout>... | unlink [--project <dir>] | rebuild <repository>... |
//                 packages <dir> python|npm | cargo [--checkout <checkout>]... <dir> <args>...
// --project limits link, check and unlink to the manifests directly in <dir>, never a nested project (S-426), and fails when
// <dir> holds none (K212); without it the whole tree of the working directory is the consumer.
import { createHash } from 'node:crypto';
import { accessSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { buildState, rebuild } from './link-build.mts';
import { trackedFiles } from './tracked-files.mts';
import {
  assertIgnored, type Ecosystem, EXCLUDED, goModule, mainCheckouts, MANIFESTS, type Provider,
  providerKey, providers, readTomlFile, repositoryOf, type Tool, trackedManifests, workTreeOf,
} from './link-providers.mts';
import { readComposerManifestFile } from './manifests.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain } from './paths.mts';
import { errorCode, execute, run } from './process.mts';
import { dependencyArrays, dependencyGroups, normalizeName } from './pyproject-dependencies.mts';

type Print = (text: string) => void;

/** The pin rule of the links: only a package pinned at 0.0.x is linked (docs/operations/local-links.md). */
const ZERO = /^v?0\.0\./;

/**
 * The command `name` of the consumer `top`: the variable `variable` when the recipe gives it, else the tool of the checkout
 * (the shim of mise, var/tools/bin/npm, the Composer of mise.toml, or the cargo of rustup); a missing tool fails with its cause.
 */
function consumerTool(top: string, name: 'npm' | 'composer' | 'uv' | 'go' | 'cargo', env: NodeJS.ProcessEnv): Tool {
  const variable = { npm: 'NPM', composer: 'COMPOSER_BIN', uv: 'UV', go: 'GO', cargo: 'CARGO' }[name];
  const given = env[variable];
  if (given) return { command: given, env };
  if (name === 'cargo') return { command: 'cargo', env };
  if (name === 'composer') return { command: composerCommand(top, `the links of ${top}`), env: toolsEnvironment(top, env) };
  const command = name === 'npm' ? toolsPath(top, 'bin', 'npm') : toolCommand(top, name);
  if (!existsSync(command)) throw new Error(`the links of ${top} need ${command}; run make install-tools there, or give ${variable}`);
  return { command, env: toolsEnvironment(top, env) };
}

/** The real path of `file`, or undefined when it does not exist; any other error is thrown. */
function real(file: string): string | undefined {
  try { return realpathSync(file); } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/** The JSON of the file `file`, an error naming the file when it is malformed. */
function readJsonOf(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')) as unknown; } catch (error) {
    throw new Error(`${file} holds no valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The JSON that a command prints, an error naming the command when it is malformed. */
function parseOutput(text: string, what: string): unknown {
  try { return JSON.parse(text) as unknown; } catch (error) {
    throw new Error(`${what} printed no valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The consumer of a directory: its work tree, its repository, the folder that bounds it, whether it is a named project, and its tracked manifests. */
type Consumer = { top: string; repository: string; scope: string; project: boolean; manifests: (ecosystem: Ecosystem, all?: boolean) => string[] };

/** The manifest of `ecosystem` that the folder `folder` holds itself, tracked or not: the consumer of --project (K212). */
function ownManifest(folder: string, ecosystem: Ecosystem): string[] {
  const file = path.join(folder, MANIFESTS[ecosystem]);
  return existsSync(file) ? [file] : [];
}

/**
 * The consumer of `directory`. With `project`, the folder is the consumer and its own manifests are its (a nested project is
 * left out, K201), tracked or not (K212), and a folder with none is an error; without it, every tracked manifest below it is.
 */
function consumerOf(directory: string, project = false): Consumer {
  const scope = realpathSync(directory);
  const top = workTreeOf(scope);
  if (project && !Object.values(MANIFESTS).some(file => existsSync(path.join(scope, file)))) {
    throw new Error(`${scope} holds no ${Object.values(MANIFESTS).join(', ')}: --project names no consumer`);
  }
  const inside = (file: string) => scope === top || `${file}/`.startsWith(`${scope}/`);
  return {
    top, scope, repository: repositoryOf(scope), project,
    // Go lists every module, so the go.work covers each module that a go command can run in; the others leave out EXCLUDED.
    manifests: (ecosystem, all = false) => project
      ? ownManifest(scope, ecosystem)
      : trackedManifests(top, [MANIFESTS[ecosystem]]).filter(file => all || !EXCLUDED.test(file)).map(file => path.join(top, file)).filter(inside),
  };
}

/** The work of one run. */
type Run = { found: Map<string, Provider>; check: boolean; print: Print; failed: boolean; env: NodeJS.ProcessEnv };

/** Prints a state line: `state` (linked, NOT linked, STALE, own) of `ecosystem` and the text. */
const line = (work: Run, state: string, ecosystem: string, text: string) => work.print(`  ${state.padEnd(10)} ${ecosystem.padEnd(8)} ${text}`);

/** The provider of `name`, or why there is none to link: own repository or no provider. */
function providerFor(work: Run, consumer: Consumer, ecosystem: Ecosystem, name: string): Provider | 'own' | 'no provider' {
  const found = work.found.get(providerKey(ecosystem, name));
  if (!found) return 'no provider';
  return found.repository === consumer.repository ? 'own' : found;
}

/**
 * K226: a package that the project provides itself (`own`: its npm workspace members, its Composer names) and no checkout
 * provides is satisfied, reported as workspace and never linked. Returns whether it was one.
 */
function projectPackage(work: Run, ecosystem: Ecosystem, name: string, provider: Provider | 'own' | 'no provider', own: ReadonlySet<string>): boolean {
  if (provider !== 'no provider' || !own.has(name)) return false;
  line(work, 'workspace', ecosystem, `${name} (provided by this project)`);
  return true;
}

/** Reports a polyspec package that is not linked for `reason`, which fails the run; own packages are listed and pass. */
function unlinkable(work: Run, ecosystem: Ecosystem, name: string, reason: string) {
  if (reason === 'own') { line(work, 'own', ecosystem, `${name} (this repository)`); return; }
  line(work, 'NOT linked', ecosystem, `${name} (${reason})`);
  work.failed = true;
}

/** The reason that the pin `version` is not linked, or undefined for a 0.0.x pin. */
const pinProblem = (version: string): string | undefined => (ZERO.test(version) ? undefined : `pinned ${version}, not 0.0.x`);

/** Reports the state of the link `installed` of `provider`: linked, or STALE when its npm build is behind its sources. */
function reportLink(work: Run, ecosystem: Ecosystem, name: string, provider: Provider) {
  const state = ecosystem === 'npm' ? buildState(provider.checkout, provider.folder) : 'fresh';
  if (!state.startsWith('stale')) { line(work, 'linked', ecosystem, `${name} -> ${provider.folder}`); return; }
  line(work, 'STALE', ecosystem, `${name} -> ${provider.folder}: ${state}; run link.mjs rebuild ${provider.checkout}`);
  if (work.check) work.failed = true;
}

/**
 * Links the installed copy `installed` (pinned at `version`) of `name` to `provider`, or with check reports it. Returns
 * whether a link was made.
 */
function linkCopy(work: Run, ecosystem: Ecosystem, name: string, installed: string, version: string, provider: Provider): boolean {
  if (real(installed) === realpathSync(provider.folder)) { reportLink(work, ecosystem, name, provider); return false; }
  const problem = pinProblem(version);
  if (problem) { unlinkable(work, ecosystem, name, `${problem}: ${installed}`); return false; }
  if (work.check) { unlinkable(work, ecosystem, name, installed); return false; }
  assertIgnored(installed);
  rmSync(installed, { recursive: true, force: true });
  symlinkSync(path.relative(path.dirname(installed), provider.folder), installed);
  line(work, 'linked', ecosystem, `${name} -> ${provider.folder} (now)`);
  return true;
}

/** The file `relative` of the links of the consumer `top`, in its var/link; Git must ignore it there, or the link fails. */
export function linkFile(top: string, relative: string): string {
  const file = path.join(top, 'var/link', relative);
  assertIgnored(file);
  return file;
}

// --- npm: npm query lists the installed copies; every @polyspec folder of a node_modules is either such a copy or a link.

/** Every folder of the node_modules trees of `project` whose package name `linkable` accepts, as it is found: a link or a folder. */
function linkableFolders(project: string, linkable: (name: string) => boolean): { name: string; folder: string }[] {
  const found: { name: string; folder: string }[] = [];
  const walk = (modules: string) => {
    if (!existsSync(modules)) return;
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const folder = path.join(modules, entry.name);
      const scoped = entry.name.startsWith('@') && entry.isDirectory();
      const packages = scoped ? readdirSync(folder, { withFileTypes: true }).map(item => ({ item, at: path.join(folder, item.name), name: `${entry.name}/${item.name}` })) : [{ item: entry, at: folder, name: entry.name }];
      for (const { item, at, name } of packages) {
        if (linkable(name)) found.push({ name, folder: at });
        if (item.isDirectory()) walk(path.join(at, 'node_modules'));
      }
    }
  };
  walk(path.join(project, 'node_modules'));
  return found.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
}

/** The npm dependencies that the npm manifest `file` declares, in every section and overrides. */
function declaredNpm(file: string): string[] {
  const manifest = readJsonObject(file);
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides']
    .flatMap(section => (isJsonObject(manifest[section]) ? Object.keys(manifest[section]) : []));
}

function linkNpm(work: Run, consumer: Consumer) {
  const files = consumer.manifests('npm');
  const projects = files.map(file => path.dirname(file)).filter(folder => existsSync(path.join(folder, 'node_modules')));
  const seen = new Set<string>();
  // A name is linked when it is a polyspec package or a package that a provider provides (K220: a private provider too); other packages are no concern.
  const linkable = (name: string) => name.startsWith('@polyspec/') || work.found.has(providerKey('npm', name));
  // K226: the packages that npm query lists at a folder of the project itself, not below a node_modules: its workspace members.
  const own = new Set<string>();
  if (projects.length) {
    const npm = consumerTool(consumer.top, 'npm', work.env);
    const queries = projects.map(project => ({ project, queried: parseOutput(run(npm.command, ['query', '*'], { cwd: project, env: npm.env }), `npm query in ${project}`) }));
    for (const { queried } of queries) {
      for (const entry of Array.isArray(queried) ? queried.filter(isJsonObject) : []) {
        if (typeof entry.name === 'string' && typeof entry.location === 'string' && entry.location !== '' && !entry.location.startsWith('..') && !entry.location.includes('node_modules/')) own.add(entry.name);
      }
    }
    for (const { project, queried } of queries) {
      const versions = new Map<string, string>();
      for (const entry of Array.isArray(queried) ? queried.filter(isJsonObject) : []) {
        if (typeof entry.location === 'string' && entry.location.includes('node_modules/') && !entry.location.startsWith('..') && typeof entry.version === 'string') versions.set(path.join(project, entry.location), entry.version);
      }
      for (const { name, folder } of linkableFolders(project, linkable)) {
        seen.add(name);
        const provider = providerFor(work, consumer, 'npm', name);
        if (typeof provider === 'string') { if (!projectPackage(work, 'npm', name, provider, own)) unlinkable(work, 'npm', name, provider); continue; }
        const version = versions.get(folder);
        // Without a version from npm query there is no pin to judge, so only the copy that is the provider already passes.
        if (version === undefined) {
          if (real(folder) === realpathSync(provider.folder)) reportLink(work, 'npm', name, provider);
          else unlinkable(work, 'npm', name, `not recorded by npm query: ${folder}`);
          continue;
        }
        linkCopy(work, 'npm', name, folder, version, provider);
      }
    }
  }
  for (const name of new Set(files.flatMap(declaredNpm).filter(linkable))) {
    if (seen.has(name)) continue;
    const provider = providerFor(work, consumer, 'npm', name);
    if (projectPackage(work, 'npm', name, provider, own)) continue;
    unlinkable(work, 'npm', name, typeof provider === 'string' ? provider : 'not installed');
  }
}

// --- Composer: the vendor of each Composer project of the consumer, and Composer's record of it.

/** The packages of installed.json, in either of Composer's formats. */
function installedPackages(record: string): Record<string, unknown>[] {
  const parsed = readJsonOf(record);
  const list = isJsonObject(parsed) ? parsed.packages : parsed;
  if (!Array.isArray(list)) throw new Error(`${record} lists no packages`);
  return list.filter(isJsonObject);
}

/**
 * K226: the Composer names that the project at `project` provides itself: the name of its composer.json and the name of the
 * composer.json of each path repository it declares (a literal folder; a glob is not expanded, so it provides nothing).
 */
function ownComposer(project: string): Set<string> {
  const manifest = readComposerManifestFile(path.join(project, MANIFESTS.composer));
  const names = new Set<string>(manifest.name ? [manifest.name] : []);
  for (const repository of manifest.repositories ?? []) {
    if (repository.type !== 'path' || repository.url === undefined) continue;
    const file = path.resolve(project, repository.url, MANIFESTS.composer);
    const name = existsSync(file) ? readComposerManifestFile(file).name : undefined;
    if (name) names.add(name);
  }
  return names;
}

/** The polyspec names that the composer.json `file` requires, in require and require-dev. */
function declaredComposer(file: string): string[] {
  const manifest = readComposerManifestFile(file);
  return [...Object.keys(manifest.require ?? {}), ...Object.keys(manifest['require-dev'] ?? {})].filter(name => name.startsWith('polyspec/'));
}

/**
 * The Composer projects of the consumer, by vendor: the project of each composer.json (the nearest at or above it whose vendor
 * holds installed.json, else its own folder), the polyspec names that its composer.json files declare, and whether the vendor
 * holds installed.json. A vendor without installed.json is reported by linkComposer, never skipped. With --project the project
 * is the named folder itself, never a folder above it (K201-3).
 */
function composerProjects(consumer: Consumer, composer: Tool): { project: string; vendor: string; installed: boolean; declared: string[] }[] {
  const found = new Map<string, { project: string; installed: boolean; declared: Set<string> }>();
  const highest = consumer.project ? consumer.scope : consumer.top;
  for (const file of consumer.manifests('composer')) {
    let chosen: { project: string; vendor: string; installed: boolean } | undefined;
    for (let project = path.dirname(file); `${project}/`.startsWith(`${highest}/`) && !chosen?.installed; project = path.dirname(project)) {
      if (!existsSync(path.join(project, MANIFESTS.composer))) continue;
      const vendor = composerVendor(project, composer);
      const installed = existsSync(path.join(vendor, 'composer/installed.json'));
      if (!chosen || installed) chosen = { project, vendor, installed };
    }
    if (!chosen) continue;
    const entry = found.get(chosen.vendor) ?? { project: chosen.project, installed: chosen.installed, declared: new Set<string>() };
    for (const name of declaredComposer(file)) entry.declared.add(name);
    found.set(chosen.vendor, entry);
  }
  return [...found].map(([vendor, entry]) => ({ project: entry.project, vendor, installed: entry.installed, declared: [...entry.declared].sort() }));
}

function linkComposer(work: Run, consumer: Consumer) {
  if (!consumer.manifests('composer').length) return;
  const composer = consumerTool(consumer.top, 'composer', work.env);
  for (const { project, vendor, installed, declared } of composerProjects(consumer, composer)) {
    // A declared name that is not installed, as the npm copies of a consumer that does not record it.
    const own = ownComposer(project);
    const notInstalled = (name: string) => {
      const provider = providerFor(work, consumer, 'composer', name);
      if (projectPackage(work, 'composer', name, provider, own)) return;
      unlinkable(work, 'composer', name, typeof provider === 'string' ? provider : `not installed in ${vendor}`);
    };
    if (!installed) { declared.forEach(notInstalled); continue; }
    const record = path.join(vendor, 'composer/installed.json');
    const names = new Set<string>();
    const recorded = new Set<string>();
    for (const entry of installedPackages(record)) {
      if (typeof entry.name !== 'string' || !entry.name.startsWith('polyspec/')) continue;
      names.add(entry.name);
      if (typeof entry['install-path'] !== 'string') { unlinkable(work, 'composer', entry.name, `no install-path in ${record}`); continue; }
      const copy = path.resolve(path.dirname(record), entry['install-path']);
      recorded.add(copy);
      const provider = providerFor(work, consumer, 'composer', entry.name);
      if (projectPackage(work, 'composer', entry.name, provider, own)) continue;
      if (typeof provider === 'string') { unlinkable(work, 'composer', entry.name, provider); continue; }
      linkCopy(work, 'composer', entry.name, copy, typeof entry.version === 'string' ? entry.version : '', provider);
    }
    for (const name of declared) if (!names.has(name)) notInstalled(name);
    const folder = path.join(vendor, 'polyspec');
    for (const item of existsSync(folder) ? readdirSync(folder) : []) {
      if (!recorded.has(path.join(folder, item))) unlinkable(work, 'composer', `polyspec/${item}`, `a plain copy that Composer does not record: ${path.join(folder, item)}`);
    }
    // Composer's own answer to autoload rules that a linked package changed; check only reports, so it dumps nothing.
    if (!work.check) run(composer.command, ['dump-autoload', '--working-dir', project], { env: composer.env });
  }
}

// --- Python: the environment of each pyproject, uv's project environment of its workspace root. Each provider is installed
// from an editable wheel (K222): setuptools writes <name>.egg-info into its source tree when it builds, so the wheel is built
// where the checkout is writable, through the backend of its pyproject, in an isolated uv env, and kept under
// var/link/wheels/<name>/<fingerprint>/. A read-only checkout (a container's mount) only installs the wheel that is there.

/** Directories that a build writes (its own, hidden, cache and egg-info folders): never sources, so never fingerprinted. */
const BUILT = /^\.|^__pycache__$|^build$|^dist$|\.egg-info$/;

/** The directories below `below` of `folder` as paths with /, left out: BUILT. */
function pythonDirectories(folder: string): string[] {
  const directories = new Set<string>();
  for (const file of trackedFiles(folder)) {
    for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory)) {
      if (!directory.split('/').some(part => BUILT.test(part))) directories.add(directory);
    }
  }
  return [...directories];
}

/**
 * The fingerprint of the Python provider `folder` of `checkout` (K222): the first 12 hex of sha256 over the resolved absolute
 * path of the checkout, its pyproject.toml bytes and the sorted directories of its tracked or new, not ignored, files (K225; a container writes ignored var/ directories there). The path is part of it because
 * an editable wheel is bound to the path it points at: a wheel built for one checkout is never reused for another.
 */
export function pythonFingerprint(checkout: string, folder: string): string {
  const hash = createHash('sha256').update(`${realpathSync(checkout)}\n`).update(readFileSync(path.join(folder, MANIFESTS.python)));
  for (const directory of pythonDirectories(folder).sort()) hash.update(`\n${directory}`);
  return hash.digest('hex').slice(0, 12);
}

/** The folder of the editable wheel of `name` at fingerprint `fp` in the consumer: var/link/wheels/<name>/<fp> (K222). */
const wheelDirOf = (consumer: Consumer, name: string, fp: string): string => linkFile(consumer.top, path.join('wheels', normalizeName(name), fp));

/** The wheel in `directory`, or undefined when there is none. */
function wheelIn(directory: string): string | undefined {
  if (!existsSync(directory)) return undefined;
  const wheel = readdirSync(directory).find(item => item.endsWith('.whl'));
  return wheel === undefined ? undefined : path.join(directory, wheel);
}

/** Whether this process can write the checkout `folder`: a read-only mount cannot be built in, so its wheel must be prebuilt (K222). */
export function writable(folder: string): boolean {
  try { accessSync(folder, constants.W_OK); return true; } catch { return false; }
}

/** The PEP 517 build of the pyproject `file`: its requirements, backend and backend-path, with the defaults of PEP 517 and 518. */
function buildSystemOf(file: string): { requires: string[]; backend: string; backendPath: string[] } {
  const system = readTomlFile(file)['build-system'];
  const table = isJsonObject(system) ? system : {};
  const strings = (value: unknown, fallback: string[]) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback);
  return {
    requires: strings(table.requires, ['setuptools>=40.8.0']),
    backend: typeof table['build-backend'] === 'string' ? table['build-backend'] : 'setuptools.build_meta:__legacy__',
    backendPath: strings(table['backend-path'], []),
  };
}

/** The script of buildEditable: the backend (module:object) builds the editable wheel of the working directory into the folder given. */
const BUILD_EDITABLE = [
  'import importlib, os, sys',
  'backend, paths, out = sys.argv[1], sys.argv[2], sys.argv[3]',
  'sys.path[:0] = [os.path.abspath(p) for p in paths.split(os.pathsep) if p]',
  "module, _, attribute = backend.partition(':')",
  'target = importlib.import_module(module)',
  "for part in filter(None, attribute.split('.')): target = getattr(target, part)",
  'target.build_editable(out)',
].join('\n');

/** Builds the editable wheel of the Python provider into `directory` (K222): an isolated uv env with [build-system].requires, in the checkout. */
function buildEditable(uv: Tool, provider: Provider, directory: string) {
  const system = buildSystemOf(path.join(provider.folder, MANIFESTS.python));
  const staging = `${directory}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  run(uv.command, ['run', '--no-project', '--isolated', ...system.requires.flatMap(requirement => ['--with', requirement]), 'python', '-c', BUILD_EDITABLE, system.backend, system.backendPath.join(path.delimiter), staging], { cwd: provider.folder, env: uv.env });
  rmSync(directory, { recursive: true, force: true });
  renameSync(staging, directory);
}

/** The editable wheel of the Python provider at its fingerprint (K222): prebuilt, or built where its folder is writable; else undefined with the stale reason (K224). */
function wheelOf(work: Run, consumer: Consumer, uv: Tool, provider: Provider): string | undefined {
  const fp = pythonFingerprint(provider.checkout, provider.folder);
  const directory = wheelDirOf(consumer, provider.name, fp);
  const existing = wheelIn(directory);
  if (existing) return existing;
  if (!writable(provider.folder)) {
    unlinkable(work, 'python', provider.name, `stale prebuilt wheel ${provider.name} (fingerprint ${fp}): run kit link on the host`);
    return undefined;
  }
  buildEditable(uv, provider, directory);
  const built = wheelIn(directory);
  if (!built) throw new Error(`the build of ${provider.folder} wrote no wheel into ${directory}`);
  return built;
}

/** The environment of the pyproject `file` and its uv workspace, or why there is none. */
function pythonTarget(uv: Tool, file: string): { venv: string; workspace: string } | string {
  const workspace = run(uv.command, ['workspace', 'dir'], { cwd: path.dirname(file), env: uv.env }).trim();
  const venv = uv.env.VENV ? path.resolve(uv.env.VENV) : path.resolve(workspace, uv.env.UV_PROJECT_ENVIRONMENT ?? '.venv');
  if (!existsSync(path.join(venv, 'pyvenv.cfg'))) return `no environment in ${workspace}: run the repository's install, or give VENV or UV_PROJECT_ENVIRONMENT`;
  return { venv, workspace };
}

/** uv sync --locked of the environment of `target`, with `flags`: the locked releases, the step before each install of a wheel (K222). */
function syncPython(uv: Tool, target: { venv: string; workspace: string }, ...flags: string[]) {
  run(uv.command, ['sync', '--locked', ...flags], { cwd: target.workspace, env: { ...uv.env, UV_PROJECT_ENVIRONMENT: target.venv } });
}

/** Writes `lines` to the file `relative` of the links of the consumer, through a temporary file and a rename; returns its path. */
function writeLinkFile(consumer: Consumer, relative: string, lines: readonly string[]): string {
  const file = linkFile(consumer.top, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.partial`, `${lines.join('\n')}\n`);
  renameSync(`${file}.partial`, file);
  return file;
}

/** The file name of an install's input for the environment `venv`, in var/link: a hash of its path, one file per environment. */
const inputName = (venv: string, kind: string): string => path.join(kind, `${createHash('sha256').update(venv).digest('hex').slice(0, 12)}.txt`);

/**
 * The locked releases of the workspace as the constraints of an install (K237): uv export of every group, without the linked
 * packages, which the install gives their checkout versions.
 */
function lockedConstraints(consumer: Consumer, uv: Tool, workspace: string, venv: string, linked: ReadonlySet<string>): string {
  const exported = run(uv.command, ['export', '--frozen', '--all-groups', '--no-hashes', '--no-annotate', '--no-header', '--no-emit-workspace'], { cwd: workspace, env: { ...uv.env, UV_PROJECT_ENVIRONMENT: venv } });
  const pins = exported.split('\n').filter(line => {
    const name = /^([A-Za-z0-9._-]+)==/.exec(line)?.[1];
    return name !== undefined && !linked.has(normalizeName(name));
  });
  return writeLinkFile(consumer, inputName(venv, 'constraints'), pins);
}

/**
 * The overrides of an install of the linked wheels (K237): each linked package is the wheel of its checkout, also where another
 * package requires it by its release URL, which would conflict with the wheel named on the command line.
 */
function linkedOverrides(consumer: Consumer, venv: string, ready: readonly { provider: Provider; wheel: string }[]): string {
  return writeLinkFile(consumer, inputName(venv, 'overrides'), ready.map(({ provider, wheel }) => `${provider.name} @ ${pathToFileURL(wheel).href}`));
}

/**
 * The project of the pyproject `file` (the consumer's own, or a member of its workspace), as a provider of its folder, so that it is
 * installed from its editable wheel like a provider (K224); undefined when the file declares no [project] name.
 */
function ownProject(consumer: Consumer, file: string): Provider | undefined {
  const project = readTomlFile(file).project;
  if (!isJsonObject(project) || typeof project.name !== 'string') return undefined;
  return { ecosystem: 'python', name: project.name, folder: path.dirname(file), repository: consumer.repository, checkout: consumer.top };
}

/** What an environment installs of a distribution (K230): the path that PEP 610 direct_url.json names ('none' when none is a file, 'absent' when it is not installed) and whether RECORD holds the PEP 660 editable marker. */
type Installed = { path: string; editable: boolean };

/** Reads the installed state of `names` in the environment `venv` with its own python, outside any checkout (-I): the state, not a listing of it (K230). */
const READ_INSTALLED = [
  'import importlib.metadata as metadata, json, sys',
  'from urllib.parse import unquote, urlparse',
  'for name in sys.argv[1:]:',
  '    try:',
  '        dist = metadata.distribution(name)',
  '    except metadata.PackageNotFoundError:',
  "        print(name, 'absent', 'no', sep='\\t')",
  '        continue',
  "    text = dist.read_text('direct_url.json')",
  "    url = json.loads(text).get('url', '') if text else ''",
  "    location = unquote(urlparse(url).path) if url.startswith('file:') else 'none'",
  "    editable = any(str(item).startswith('__editable__') for item in dist.files or [])",
  "    print(name, location, 'yes' if editable else 'no', sep='\\t')",
].join('\n');

/**
 * The requirements that the installed packages of `venv` do not meet, by the normalized name of the package that states them,
 * as uv pip check reports them (K238): uv evaluates each requirement's environment markers with the environment's interpreter,
 * so a requirement whose marker holds is checked and one whose marker does not is not.
 */
function unmetPython(uv: Tool, venv: string): Map<string, string> {
  const unmet = new Map<string, string>();
  const output = run(uv.command, ['pip', 'check', '--python', path.join(venv, 'bin/python')], { env: uv.env, statuses: [0, 1] });
  for (const line of output.split('\n')) {
    const name = /^The package `([^`]+)` requires `/.exec(line)?.[1];
    if (name !== undefined && !unmet.has(normalizeName(name))) unmet.set(normalizeName(name), `${line.trim()} (${venv})`);
  }
  return unmet;
}

/** The installed state of each of `names` in `venv`, by name (K230). */
function installedFiles(venv: string, names: readonly string[], env: NodeJS.ProcessEnv): Map<string, Installed> {
  const found = new Map<string, Installed>();
  if (!names.length) return found;
  for (const line of run(path.join(venv, 'bin/python'), ['-I', '-c', READ_INSTALLED, ...names], { cwd: venv, env }).split('\n')) {
    const [name, location, editable] = line.split('\t');
    if (name && location && editable) found.set(name, { path: location, editable: editable === 'yes' });
  }
  return found;
}

/**
 * Why the installed state of `provider` is not its editable wheel at the current fingerprint, or undefined when it is (K230): a
 * link is reported only when the environment itself holds that editable install.
 */
function editableProblem(consumer: Consumer, provider: Provider, state: Installed | undefined, venv: string): string | undefined {
  if (state === undefined || state.path === 'none' || state.path === 'absent') return `not installed from a wheel in ${venv}`;
  const fp = pythonFingerprint(provider.checkout, provider.folder);
  const dir = path.dirname(state.path);
  if (dir !== wheelDirOf(consumer, provider.name, fp)) {
    return path.basename(path.dirname(dir)) === normalizeName(provider.name)
      ? `installed fingerprint ${path.basename(dir)} differs from ${fp} in ${venv}`
      : `installed from ${state.path}, not the editable wheel of ${provider.folder} in ${venv}`;
  }
  return state.editable ? undefined : `installed from its wheel without the editable install in ${venv}`;
}

/** The normalized project names of the PEP 508 requirements of `list`, a URL requirement too; any other item is ignored. */
function requirementNames(list: readonly unknown[]): string[] {
  return list.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const parsed = parsePipRequirementsLine(item);
    return parsed && (parsed.type === 'ProjectName' || parsed.type === 'ProjectURL') ? [normalizeName(parsed.name)] : [];
  });
}

/** The normalized polyspec requirements of the pyproject `file`: dependencies, extras and dependency groups (PEP 508, PEP 735). */
function declaredPython(file: string): string[] {
  const document = readTomlFile(file);
  const requirements = [
    ...dependencyArrays(document, file).filter(array => !array.kind.startsWith('group:')).flatMap(array => array.list),
    ...[...dependencyGroups(document, file).values()].flat(),
  ];
  return [...new Set(requirementNames(requirements).filter(name => name.startsWith('polyspec-')))];
}

/** `names` with every polyspec package that their providers require, as providers; a requirement without a provider is reported. */
function closure(work: Run, consumer: Consumer, names: Iterable<string>): Provider[] {
  const result = new Map<string, Provider>();
  const pending = [...names];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (result.has(name)) continue;
    const provider = providerFor(work, consumer, 'python', name);
    if (typeof provider === 'string') { unlinkable(work, 'python', name, provider); continue; }
    result.set(name, provider);
    pending.push(...declaredPython(path.join(provider.folder, MANIFESTS.python)));
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The installed distributions of `venv` by normalized name: version and editable location (uv pip list --format json). */
function installedPython(uv: Tool, venv: string): Map<string, { version: string }> {
  const listed = parseOutput(run(uv.command, ['pip', 'list', '--format', 'json', '--python', path.join(venv, 'bin/python')], { env: uv.env }), `uv pip list in ${venv}`);
  const found = new Map<string, { version: string }>();
  for (const item of Array.isArray(listed) ? listed.filter(isJsonObject) : []) {
    if (typeof item.name !== 'string' || typeof item.version !== 'string') continue;
    found.set(normalizeName(item.name), { version: item.version });
  }
  return found;
}

function linkPython(work: Run, consumer: Consumer) {
  const files = consumer.manifests('python');
  if (!files.some(file => declaredPython(file).length)) return;
  const uv = consumerTool(consumer.top, 'uv', work.env);
  // Every project of an environment is a member of it: with --no-install-workspace the sync installs none of them, so each
  // member, polyspec or not, is installed from its wheel (K224). An environment with no polyspec package is not synced.
  const byVenv = new Map<string, { workspace: string; names: Set<string>; projects: Provider[] }>();
  for (const file of files) {
    const target = pythonTarget(uv, file);
    const declared = declaredPython(file);
    if (typeof target === 'string') { for (const name of declared) unlinkable(work, 'python', name, target); continue; }
    const entry = byVenv.get(target.venv) ?? { workspace: target.workspace, names: new Set<string>(), projects: [] };
    for (const name of declared) entry.names.add(name);
    const project = ownProject(consumer, file);
    if (project) entry.projects.push(project);
    byVenv.set(target.venv, entry);
  }
  for (const [venv, { workspace, names, projects }] of byVenv) {
    if (!names.size) continue;
    const installed = installedPython(uv, venv);
    const linked = [
      ...closure(work, consumer, names).filter((provider) => {
        const found = installed.get(provider.name);
        if (!found) { unlinkable(work, 'python', provider.name, `not installed in ${venv}`); return false; }
        const problem = pinProblem(found.version);
        if (problem) unlinkable(work, 'python', provider.name, `${problem} in ${venv}`);
        return !problem;
      }),
      ...projects,
    ];
    // A link is reported from the installed state of the environment, after each install too (K230); a listing is not proof.
    // A linked package is linked and its requirements are met (K238): the unmet requirements are those that uv pip check states.
    const stateOf = (names: readonly string[]) => installedFiles(venv, names, work.env);
    const problemOf = (provider: Provider, state: Map<string, Installed>, unmet: ReadonlyMap<string, string>): string | undefined =>
      editableProblem(consumer, provider, state.get(provider.name), venv) ?? unmet.get(normalizeName(provider.name));
    const reportLinks = (state: Map<string, Installed>, now: boolean) => {
      const unmet = unmetPython(uv, venv);
      for (const provider of linked) {
        const problem = problemOf(provider, state, unmet);
        if (problem) unlinkable(work, 'python', provider.name, problem);
        else line(work, 'linked', 'python', `${provider.name} -> ${provider.folder} (${venv}${now ? ', now' : ''})`);
      }
    };
    const state = stateOf(linked.map(provider => provider.name));
    const unmet = unmetPython(uv, venv);
    if (work.check || linked.every(provider => problemOf(provider, state, unmet) === undefined)) {
      reportLinks(state, false);
      continue;
    }
    if (!existsSync(path.join(workspace, 'uv.lock'))) {
      for (const provider of linked) unlinkable(work, 'python', provider.name, `no uv.lock in ${workspace}: run the repository's install`);
      continue;
    }
    // Every wheel is resolved before the sync: a sync removes each project that it does not install, so a missing wheel
    // leaves the environment untouched and the run fails (K224).
    const ready: { provider: Provider; wheel: string }[] = [];
    let complete = true;
    for (const provider of linked) {
      const wheel = wheelOf(work, consumer, uv, provider);
      if (wheel === undefined) complete = false;
      else ready.push({ provider, wheel });
    }
    if (!complete || !ready.length) continue;
    // No sync (K239): the consumer's install already synced the environment, and a sync would reinstall any other package
    // from its lock source. The install below changes the linked packages only; its dependencies are added at the locked releases.
    const constraints = lockedConstraints(consumer, uv, workspace, venv, new Set(ready.map(({ provider }) => normalizeName(provider.name))));
    const overrides = linkedOverrides(consumer, venv, ready);
    // A project of the consumer's own environment is installed with --no-deps (K280): the consumer's lock sync provides its
    // dependencies, and a dependency that the lock provides another way (a path dependency of no index) cannot be resolved here.
    const own = new Set(projects.map(project => project.name));
    const python = path.join(venv, 'bin/python');
    const installs = [
      { flags: ['--constraints', constraints, '--overrides', overrides], wheels: ready.filter(({ provider }) => !own.has(provider.name)) },
      { flags: ['--no-deps'], wheels: ready.filter(({ provider }) => own.has(provider.name)) },
    ];
    for (const { flags, wheels } of installs) {
      if (!wheels.length) continue;
      run(uv.command, ['pip', 'install', '--python', python, ...flags, ...wheels.flatMap(({ provider }) => ['--reinstall-package', provider.name]), ...wheels.map(({ wheel }) => wheel)], { cwd: consumer.top, env: uv.env });
    }
    reportLinks(stateOf(linked.map(provider => provider.name)), true);
  }
}

// --- Go: a go.work at the root of each module of the consumer, which go reads by itself (K205).

/** The go.work of the module in `directory`: the file that link writes there, git-ignored, which go reads without a variable. */
const goWorkOf = (directory: string): string => path.join(directory, 'go.work');

function linkGo(work: Run, consumer: Consumer) {
  const modules = consumer.manifests('go', true);
  if (!modules.length) return;
  const go = consumerTool(consumer.top, 'go', work.env);
  for (const module of modules) {
    const directory = path.dirname(module);
    const file = goWorkOf(directory);
    const requires = new Map<string, Provider>();
    for (const requirement of goModule(go, module, consumer.top).requires.filter(item => item.path.startsWith('github.com/polyspec/'))) {
      const provider = providerFor(work, consumer, 'go', requirement.path);
      const problem = typeof provider === 'string' ? provider : pinProblem(requirement.version);
      if (problem) unlinkable(work, 'go', requirement.path, problem);
      else if (typeof provider !== 'string') requires.set(requirement.path, provider);
    }
    if (work.check) {
      for (const [name, provider] of requires) {
        const found = existsSync(file) ? run(go.command, ['list', '-m', '-f', '{{.Dir}}', name], { cwd: directory, env: { ...go.env, GOWORK: file } }).trim() : '';
        if (real(found) === realpathSync(provider.folder)) line(work, 'linked', 'go', `${name} -> ${provider.folder} (${file})`);
        else unlinkable(work, 'go', name, `go.work of ${directory} does not use ${provider.folder}`);
      }
      continue;
    }
    assertIgnored(file);
    assertIgnored(`${file}.sum`);
    rmSync(file, { force: true });
    rmSync(`${file}.sum`, { force: true });
    if (!requires.size) continue;
    const folders = [directory, ...new Set([...requires.values()].map(provider => provider.folder))];
    run(go.command, ['work', 'init', ...folders.map(folder => path.relative(directory, folder) || '.')], { cwd: directory, env: { ...go.env, GOWORK: file } });
    for (const [name, provider] of requires) line(work, 'linked', 'go', `${name} -> ${provider.folder} (${file})`);
  }
}

// --- the commands.

/**
 * Links (or with `check`, reports) every polyspec package of each directory of `directories` that the main checkouts
 * `checkouts` provide; false when one is not linked.
 */
export function link({ checkouts, directories, check, print, env = process.env, project = false }: { checkouts: readonly string[]; directories: readonly string[]; check: boolean; print: Print; env?: NodeJS.ProcessEnv; project?: boolean }): boolean {
  const consumers = directories.map(directory => consumerOf(directory, project));
  const first = consumers[0];
  const go = first && first.manifests('go', true).length ? consumerTool(first.top, 'go', env) : undefined;
  const work: Run = { found: providers(checkouts, go, first?.top ?? process.cwd()), check, print, failed: false, env };
  for (const consumer of consumers) {
    print(`== ${consumer.scope}`);
    linkNpm(work, consumer);
    linkComposer(work, consumer);
    linkPython(work, consumer);
    linkGo(work, consumer);
  }
  return !work.failed;
}

/** The polyspec packages of `ecosystem` that the consumer `directory` declares, for a recipe (uv sync --no-install-package). */
export function packages(directory: string, ecosystem: 'python' | 'npm'): string[] {
  const consumer = consumerOf(directory);
  const names = ecosystem === 'python' ? consumer.manifests('python').flatMap(declaredPython) : consumer.manifests('npm').flatMap(declaredNpm);
  return [...new Set(names)].sort();
}

/** Restores the locked installs of each directory with each tool's own install and removes var/link; false when one is skipped. */
export function unlink({ directories, print, env = process.env, project = false }: { directories: readonly string[]; print: Print; env?: NodeJS.ProcessEnv; project?: boolean }): boolean {
  let restored = true;
  const skip = (text: string) => { print(`  skipped    ${text}`); restored = false; };
  for (const consumer of directories.map(directory => consumerOf(directory, project))) {
    print(`== ${consumer.scope}`);
    for (const folder of consumer.manifests('npm').map(file => path.dirname(file)).filter(item => existsSync(path.join(item, 'node_modules')))) {
      if (!existsSync(path.join(folder, 'package-lock.json'))) { skip(`npm ${folder}: no package-lock.json; its workspace root restores it`); continue; }
      const npm = consumerTool(consumer.top, 'npm', env);
      run(npm.command, ['ci'], { cwd: folder, env: npm.env });
      print(`  restored   npm      ${folder}`);
    }
    if (consumer.manifests('composer').length) {
      const composer = consumerTool(consumer.top, 'composer', env);
      for (const { project, vendor } of composerProjects(consumer, composer).filter(item => item.installed)) {
        const folder = path.join(vendor, 'polyspec');
        for (const item of existsSync(folder) ? readdirSync(folder) : []) if (lstatSync(path.join(folder, item)).isSymbolicLink()) rmSync(path.join(folder, item));
        if (!existsSync(path.join(project, 'composer.lock'))) { skip(`composer ${project}: no composer.lock`); continue; }
        run(composer.command, ['install', '--no-interaction'], { cwd: project, env: composer.env });
        print(`  restored   composer ${project}`);
      }
    }
    const pythonFiles = consumer.manifests('python').filter(file => declaredPython(file).length);
    if (pythonFiles.length) {
      const uv = consumerTool(consumer.top, 'uv', env);
      for (const file of pythonFiles) {
        const target = pythonTarget(uv, file);
        if (typeof target === 'string' || !existsSync(path.join(target.workspace, 'uv.lock'))) { skip(`python ${path.dirname(file)}: no environment or no uv.lock; run the repository's install`); continue; }
        // The restore selects every group, as the consumer's install does (K238): uv reinstalls only the packages that a sync
        // selects, so a polyspec package of the test group is reinstalled at its locked release only with --all-groups.
        // --inexact keeps every other package (K237).
        syncPython(uv, target, '--all-groups', '--inexact', ...declaredPython(file).flatMap(name => ['--reinstall-package', name]));
        print(`  restored   python   ${target.venv}`);
      }
    }
    removeWritten(consumer);
  }
  return restored;
}

/**
 * Removes the files that link wrote for the consumer: the go.work and go.work.sum of each of its Go modules, the overrides
 * file of each environment and the Cargo lock copy of each workspace, each by its exact name, then each folder of var/link
 * that the removal leaves empty. Never a folder recursively: a nested project's files and folders stay (K201-3).
 */
function removeWritten(consumer: Consumer) {
  const base = path.join(consumer.top, 'var/link');
  const written: string[] = [];
  for (const module of consumer.manifests('go', true)) {
    const file = goWorkOf(path.dirname(module));
    written.push(file, `${file}.sum`);
  }
  const cargo = path.join(base, 'cargo');
  for (const entry of existsSync(cargo) ? readdirSync(cargo, { withFileTypes: true }) : []) {
    if (entry.isDirectory()) written.push(path.join(cargo, entry.name, 'Cargo.lock'));
  }
  for (const file of written) {
    rmSync(file, { force: true });
    removeEmptyFolders(path.dirname(file), consumer.top);
  }
}

/** Removes `folder` and each folder above it that is empty, down to but not including `stop`, which is never removed. */
function removeEmptyFolders(folder: string, stop: string) {
  for (let current = folder; current.startsWith(`${stop}${path.sep}`) && existsSync(current) && readdirSync(current).length === 0; current = path.dirname(current)) {
    rmdirSync(current);
  }
}

/** The repository URL that the checkout `checkout` declares in config/release.json. */
function declaredUrl(checkout: string): string {
  const file = path.join(checkout, 'config/release.json');
  const url = existsSync(file) ? readJsonObject(file).repositoryUrl : undefined;
  if (typeof url !== 'string') throw new Error(`${file} declares no repositoryUrl, which the Cargo patch of ${checkout} needs`);
  return url;
}

/**
 * Runs one cargo command in `directory`; with checkouts given, the polyspec git sources of those checkouts are patched to
 * their packages, and the lock of the tree is copied to var/link, so the patches resolve against it. Without checkouts, cargo runs as given.
 */
export function cargo({ directory, args, checkouts = [], env = process.env }: { directory: string; args: readonly string[]; checkouts?: readonly string[]; env?: NodeJS.ProcessEnv }): number {
  const consumer = consumerOf(directory);
  const tool = consumerTool(consumer.top, 'cargo', env);
  const config: string[] = [];
  if (checkouts.length) {
    const workspace = path.dirname(run(tool.command, ['locate-project', '--workspace', '--message-format', 'plain'], { cwd: consumer.scope, env: tool.env }).trim());
    // A fresh copy of the tracked lock on every run, so the patches resolve against the lock of the tree.
    const copy = linkFile(consumer.top, path.join('cargo', path.relative(consumer.top, workspace).replaceAll('/', '_') || 'root', 'Cargo.lock'));
    mkdirSync(path.dirname(copy), { recursive: true });
    copyFileSync(path.join(workspace, 'Cargo.lock'), copy);
    config.push('--config', `resolver.lockfile-path=${JSON.stringify(copy)}`);
    for (const checkout of mainCheckouts(checkouts).filter(item => repositoryOf(item) !== consumer.repository)) {
      const crates = trackedManifests(checkout, ['Cargo.toml']).filter(file => !EXCLUDED.test(file)).flatMap((file) => {
        const pkg = readTomlFile(path.join(checkout, file)).package;
        return isJsonObject(pkg) && typeof pkg.name === 'string' ? [{ name: pkg.name, folder: path.join(checkout, path.dirname(file)) }] : [];
      });
      if (!crates.length) continue;
      const url = declaredUrl(checkout);
      for (const crate of crates) config.push('--config', `patch.${JSON.stringify(url)}.${crate.name}.path=${JSON.stringify(crate.folder)}`);
    }
  }
  const outcome = execute(tool.command, [...config, ...args], { cwd: directory, env: tool.env });
  if (outcome.error) throw new Error(`${tool.command} could not start: ${outcome.error.message}`);
  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  return outcome.status ?? 1;
}

if (isMain(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const print: Print = text => process.stdout.write(`${text}\n`);
  try {
    // `--project <dir>` names the consumer (K201, S-426); the other arguments are the checkouts that provide the packages.
    const project = rest.indexOf('--project');
    const projectDirectory = project === -1 ? undefined : rest[project + 1];
    if (project !== -1 && !projectDirectory) throw new Error('Usage: link.mjs ... --project <dir>');
    const positional = rest.filter((_, index) => project === -1 || (index !== project && index !== project + 1));
    const directories = [projectDirectory ?? '.'];
    switch (command) {
      case 'link': case 'check':
        if (!link({ checkouts: positional, directories, check: command === 'check', print, project: projectDirectory !== undefined })) process.exitCode = 1;
        break;
      case 'unlink':
        if (!unlink({ directories, print, project: projectDirectory !== undefined })) process.exitCode = 1;
        break;
      case 'rebuild':
        for (const repository of rest) rebuild(workTreeOf(repository), print);
        break;
      case 'packages': {
        const [directory, ecosystem] = rest;
        if (!directory || (ecosystem !== 'python' && ecosystem !== 'npm')) throw new Error('Usage: link.mjs packages <dir> python|npm');
        for (const name of packages(directory, ecosystem)) print(name);
        break;
      }
      case 'cargo': {
        const checkouts: string[] = [];
        while (rest[0] === '--checkout') checkouts.push(rest.splice(0, 2)[1] ?? '');
        const [directory, ...args] = rest;
        if (!directory) throw new Error('Usage: link.mjs cargo [--checkout <checkout>]... <dir> <cargo args>...');
        process.exitCode = cargo({ directory, args, checkouts });
        break;
      }
      default: throw new Error('Usage: link.mjs link|check [--project <dir>] <checkout>... | unlink [--project <dir>] | rebuild <repository>... | packages <dir> python|npm | cargo [--checkout <checkout>]... <dir> <args>...');
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
