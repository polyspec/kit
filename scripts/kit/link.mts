// The local links of 0.0.x development (docs/operations/local-links.md, K201, K205, K448). The checkouts that the arguments name are the
// providers (link-providers.mts): each installed package folder of a consumer that a provider gives is replaced by a direct relative
// symlink to the provider's package folder (K761): during development the installed folder is a plain directory symlink to the
// development checkout, and a release uses the installed copy. No package manager re-resolves the consumer, Python's
// included (K765). kit itself only links, it never builds (link-build.mts rebuilds):
//   npm       node_modules/<name> of each tracked project, one directory symlink;
//   Composer  <vendor-dir>/<vendor>/<package> of each tracked project, the vendor-dir of its composer.json, one directory symlink;
//   Python    each package of the site-packages of a project's .venv, one link per package of a namespace;
//   Go        each go.mod of the consumer gets a git-ignored go.work that uses its module and the provider modules, which
//             go reads by itself; unlink removes it;
//   Rust      `cargo <dir> <args>` runs one cargo command with --config patches and a lock copy under var/link/cargo.
// No environment variable declares anything: without checkouts nothing is linked, and the installs stay the locked releases.
// A consumer is a directory: the top of a work tree stands for every tracked manifest of it, another directory for those
// below it; with --project the folder is the consumer and its own manifest is read, tracked or not (K212). Each file that link writes
// into the consumer is one that Git ignores there, and link writes nothing into .git (K512) (the links in the install folders, var/link, and each go.work).
//   node link.mjs link|check [--project <dir>] [--siblings] <checkout>... | unlink [--project <dir>] | rebuild <repository>... |
//                 packages <dir> python|npm | cargo [--siblings] [--checkout <checkout>]... <dir> <args>...
// --project limits link, check and unlink to the manifests directly in <dir>, never a nested project (S-426), and fails when
// <dir> holds none (K212); without it the whole tree of the working directory is the consumer.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isJsonObject, readJsonObject, writeAtomic } from './bootstrap/files.mts';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { uvLink } from './uv-install.mts';
import { rebuild } from './link-build.mts';
import { composerVendorDir, folderFindings, hasPythonPackages, linkFolders, type ProvidedFolder, providedFolders, providerDependencyFindings, releaseEnvironmentLinks } from './link-folders.mts';
import { assertIgnored, type Ecosystem, EXCLUDED, goModule, isForkCheckout, mainCheckouts, MANIFESTS, type Provider, providerKey, providers, readTomlFile, repositoryOf, siblingCheckouts, type Tool, trackedManifests, workspaceOf, workTreeOf } from './link-providers.mts';
import { readComposerManifestFile } from './manifests.mts';
import { toolsRoot } from './bootstrap/tool-wrappers.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain, siblingTool } from './paths.mts';
import { kitPackageRoot } from './kit-files.mts';
import { errorCode, execute, run } from './process.mts';
import { acquireHolderLock } from './holder-lock.mts';
import { cargoMetadataArguments, verifyCargoSources } from './cargo-source.mts';
import { manifestPolyspecNames, normalizeName } from './pyproject-dependencies.mts';

type Print = (text: string) => void;
type LinkRuntime = 'go' | 'php' | 'php-ext' | 'python' | 'rust' | 'ts';

/** The native package managers that a runtime link may inspect or invoke. Rust source patches use the cargo wrapper instead. */
const RUNTIME_ECOSYSTEMS: Readonly<Record<LinkRuntime, readonly Ecosystem[]>> = {
  go: ['go'], php: ['composer'], 'php-ext': ['composer'], python: ['python'], rust: [], ts: ['npm'],
};
const ALL_ECOSYSTEMS: readonly Ecosystem[] = ['npm', 'composer', 'python', 'go'];

const isLinkRuntime = (value: string): value is LinkRuntime => Object.hasOwn(RUNTIME_ECOSYSTEMS, value);

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
  // A missing tool of the checkout throws the message of toolCommand, the one message for it (K393-1).
  return { command: toolCommand(top, name), env: toolsEnvironment(top, env) };
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
    throw new Error(`${file} holds no valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
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


/** Reports a polyspec package that is not linked for `reason`, which fails the run; own packages are listed and pass. */
function unlinkable(work: Run, ecosystem: Ecosystem, name: string, reason: string) {
  if (reason === 'own') { line(work, 'own', ecosystem, `${name} (this repository)`); return; }
  line(work, 'NOT linked', ecosystem, `${name} (${reason})`);
  work.failed = true;
}

/** The reason that the pin `version` is not linked, or undefined for a 0.0.x pin. */
// A fork's pin is a version of the fork (K379), which the install records and checks, so the rule does not apply to a fork.
const pinProblem = (version: string, provider: Provider): string | undefined => (isForkCheckout(provider.checkout) || ZERO.test(version) ? undefined : `pinned ${version}, not 0.0.x`);



/** The file `relative` of the links of the consumer `top`, in its var/link; Git must ignore it there, or the link fails. */
export function linkFile(top: string, relative: string): string {
  const file = path.join(top, 'var/link', relative);
  assertIgnored(file);
  return file;
}

// --- npm: npm query lists the installed copies; every @polyspec folder of a node_modules is either such a copy or a link.


/** The npm dependencies that the npm manifest `file` declares, in every section and overrides. */
function declaredNpm(file: string): string[] {
  const manifest = readJsonObject(file);
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides']
    .flatMap(section => (isJsonObject(manifest[section]) ? Object.keys(manifest[section]) : []));
}


// --- Composer: the vendor of each Composer project of the consumer, and Composer's record of it.

/** The packages of installed.json, in either of Composer's formats. */
export function installedPackages(record: string): Record<string, unknown>[] {
  const parsed = readJsonOf(record);
  const list = isJsonObject(parsed) ? parsed.packages : parsed;
  if (!Array.isArray(list)) throw new Error(`${record} lists no packages`);
  return list.filter(isJsonObject);
}



/** The polyspec names that the composer.json `file` requires, in require and require-dev. */
function declaredComposer(file: string): string[] {
  const manifest = readComposerManifestFile(file);
  return [...Object.keys(manifest.require ?? {}), ...Object.keys(manifest['require-dev'] ?? {})].filter(name => name.startsWith('polyspec/'));
}

/**
 * Whether the Composer project at `project` installs the folder `folder` through one of its path repositories.
 */
function installsFolder(project: string, folder: string): boolean {
  return (readComposerManifestFile(path.join(project, MANIFESTS.composer)).repositories ?? []).some(repository => repository.type === 'path' && repository.url !== undefined && path.resolve(project, repository.url) === folder);
}

/**
 * The Composer projects of the consumer, by vendor: the project of each composer.json (the nearest at or above it whose vendor
 * holds installed.json, else its own folder), the polyspec names that its composer.json files declare, and whether the vendor
 * holds installed.json. A vendor without installed.json is reported by linkComposer, never skipped. With --project the project
 * is the named folder itself (K201-3), except that a folder above it whose path repository installs the named folder is its
 * project too, as the root project installs a package folder without a vendor of its own (K396).
 */
function composerProjects(consumer: Consumer, composer: Tool): { project: string; vendor: string; installed: boolean; declared: string[] }[] {
  const found = new Map<string, { project: string; installed: boolean; declared: Set<string> }>();
  const highest = consumer.project ? consumer.scope : consumer.top;
  for (const file of consumer.manifests('composer')) {
    let chosen: { project: string; vendor: string; installed: boolean } | undefined;
    const folder = path.dirname(file);
    for (let project = folder; `${project}/`.startsWith(`${consumer.top}/`) && !chosen?.installed; project = path.dirname(project)) {
      if (!existsSync(path.join(project, MANIFESTS.composer))) continue;
      const installer = project !== folder && installsFolder(project, folder);
      if (!`${project}/`.startsWith(`${highest}/`) && !installer) continue;
      const vendor = composerVendor(project, composer);
      const installed = existsSync(path.join(vendor, 'composer/installed.json'));
      // The project whose path repository installs the folder is its project even before its install, so the vendor to install is named.
      if (!chosen || installed || installer) chosen = { project, vendor, installed };
    }
    if (!chosen) continue;
    const entry = found.get(chosen.vendor) ?? { project: chosen.project, installed: chosen.installed, declared: new Set<string>() };
    for (const name of declaredComposer(file)) entry.declared.add(name);
    found.set(chosen.vendor, entry);
  }
  return [...found].map(([vendor, entry]) => ({ project: entry.project, vendor, installed: entry.installed, declared: [...entry.declared].sort() }));
}


// --- Python: uv installs the lock and owns the distribution metadata; kit links the installed package folders (K765).

/** The environment of the pyproject `file`: uv's project environment of its workspace root, which uv sync creates when it is missing. */
function installTarget(uv: Tool, file: string): { venv: string; workspace: string } {
  const workspace = run(uv.command, ['workspace', 'dir'], { cwd: path.dirname(file), env: uv.env }).trim();
  const venv = uv.env.VENV ? path.resolve(uv.env.VENV) : path.resolve(workspace, uv.env.UV_PROJECT_ENVIRONMENT ?? '.venv');
  return { venv, workspace };
}

/** The environment of the pyproject `file` and its uv workspace, or why there is none. */
function pythonTarget(uv: Tool, file: string): { venv: string; workspace: string } | string {
  const target = installTarget(uv, file);
  if (!existsSync(path.join(target.venv, 'pyvenv.cfg'))) return `no environment in ${target.workspace}: run the repository's install, or give VENV or UV_PROJECT_ENVIRONMENT`;
  return target;
}

/** Removes the package links of the environment of `target` before uv writes into it, naming each (K539). */
function releaseLinks(target: { venv: string; workspace: string }, print: Print): void {
  for (const link of releaseEnvironmentLinks(target.workspace, target.venv)) print(`  unlinked   python   ${link}, so uv writes no provider checkout`);
}

/** Restores the selected native locked environment, retaining application-owned source declarations. */
function syncPython(uv: Tool, target: { venv: string; workspace: string }, print: Print, ...flags: string[]) {
  releaseLinks(target, print);
  run(uv.command, ['sync', '--locked', ...flags], { cwd: target.workspace, env: { ...uv.env, UV_PROJECT_ENVIRONMENT: target.venv } });
}




/**
 * The PEP 751 lock of the workspace `workspace`, of a project that has no uv.lock: pylock.toml, else the first pylock.<name>.toml
 * in sorted order; undefined when there is none.
 */
function pylockOf(workspace: string): string | undefined {
  const names = readdirSync(workspace).filter(name => /^pylock(\.[A-Za-z0-9_-]+)?\.toml$/.test(name)).sort();
  const name = names.includes('pylock.toml') ? 'pylock.toml' : names[0];
  return name === undefined ? undefined : path.join(workspace, name);
}


/**
 * The locked releases of the linked packages `names` in the PEP 751 lock `lock` (K401-1): each as the requirement `name==version`
 * with its name, and the names that the lock does not hold with a version.
 */
function pylockReleases(lock: string, names: readonly string[]): { pins: { name: string; requirement: string }[]; missing: string[] } {
  const packages = readTomlFile(lock).packages;
  const held = new Map<string, { name: string; requirement: string }>();
  for (const item of Array.isArray(packages) ? packages : []) {
    if (isJsonObject(item) && typeof item.name === 'string' && typeof item.version === 'string') held.set(normalizeName(item.name), { name: item.name, requirement: `${item.name}==${item.version}` });
  }
  return {
    pins: names.flatMap(name => held.get(normalizeName(name)) ?? []),
    missing: names.filter(name => !held.has(normalizeName(name))),
  };
}








/** The polyspec packages of the pyproject `file`: those that it names, whose releases its lock records (K507, K515). */
function declaredPython(file: string): string[] {
  return manifestPolyspecNames(readTomlFile(file), file);
}














// --- uv install (K448-3): the environment of a project installed with its polyspec packages linked from the start.




// --- Go: a go.work at the root of each module of the consumer, which go reads by itself (K205).

/** The go.work of the module in `directory`: the file that link writes there, git-ignored, which go reads without a variable. */
const goWorkOf = (directory: string): string => path.join(directory, 'go.work');

/**
 * The module folders that the tracked go.work of the nearest parent of `directory` up to the work tree `top` uses, as go work edit
 * -json reads them (K399): a go.work that link writes in a module below a tracked workspace of the repository shadows that
 * workspace, so it uses the modules of the workspace too. None when no parent has a tracked go.work. The go.work of `directory`
 * itself is never read: it is the file that link writes there. link-state-check reads it too (K399-2).
 */
export function trackedWorkspaceFolders(go: Tool, top: string, directory: string, tracked: ReadonlySet<string>): string[] {
  for (let folder = path.dirname(directory); `${folder}/`.startsWith(`${top}/`); folder = path.dirname(folder)) {
    const file = goWorkOf(folder);
    if (tracked.has(file)) return worktreeGoFolders(top, usedFolders(go, file));
  }
  return [];
}

/**
 * The module folders that the go.work `file` uses, as go work edit -json reads them: each DiskPath resolved against the folder of
 * the go.work. The check reads them from the go.work itself, not from go list -m of each module.
 */
export function usedFolders(go: Tool, file: string): string[] {
  const folder = path.dirname(file);
  const parsed = JSON.parse(run(go.command, ['work', 'edit', '-json', file], { cwd: folder, env: go.env })) as unknown;
  if (!isJsonObject(parsed)) throw new Error(`${file}: go work edit -json printed no object`);
  const uses = Array.isArray(parsed.Use) ? parsed.Use : [];
  return uses.flatMap(item => (isJsonObject(item) && typeof item.DiskPath === 'string' ? [path.resolve(folder, item.DiskPath)] : []));
}

/** Resolves main-checkout workspace modules to the corresponding source folders of `top`, retaining external providers. */
export function worktreeGoFolders(top: string, folders: readonly string[]): string[] {
  const main = toolsRoot(top);
  return folders.map(folder => {
    const relative = path.relative(main, folder);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? path.join(top, relative) : folder;
  });
}

/** Reconciles native workspace use directives without discarding Go's checksum or other workspace state. */
export function writeGoWorkspace(go: Tool, file: string, folders: readonly string[]): void {
  const directory = path.dirname(file);
  const place = { cwd: directory, env: { ...go.env, GOWORK: file } };
  const desired = new Set(folders.map(folder => path.resolve(folder)));
  if (!existsSync(file)) {
    run(go.command, ['work', 'init', ...[...desired].map(folder => path.relative(directory, folder) || '.')], place);
    return;
  }
  const parsed: unknown = JSON.parse(run(go.command, ['work', 'edit', '-json', file], place));
  if (!isJsonObject(parsed)) throw new Error(`${file}: go work edit -json printed no object`);
  const uses = (Array.isArray(parsed.Use) ? parsed.Use : []).flatMap(item => isJsonObject(item) && typeof item.DiskPath === 'string' ? [item.DiskPath] : []);
  const existing = new Set(uses.map(folder => path.resolve(directory, folder)));
  const edits = [
    ...uses.filter(folder => !desired.has(path.resolve(directory, folder))).map(folder => `-dropuse=${folder}`),
    ...[...desired].filter(folder => !existing.has(folder)).map(folder => `-use=${path.relative(directory, folder) || '.'}`),
  ];
  if (edits.length) run(go.command, ['work', 'edit', ...edits, file], place);
}

function linkGo(work: Run, consumer: Consumer) {
  const modules = consumer.manifests('go', true);
  if (!modules.length) return;
  const go = consumerTool(consumer.top, 'go', work.env);
  const tracked = new Set(trackedManifests(consumer.top, ['go.work']).map(file => path.join(consumer.top, file)));
  for (const module of modules) {
    const directory = path.dirname(module);
    const file = goWorkOf(directory);
    const requires = new Map<string, Provider>();
    for (const requirement of goModule(go, module, consumer.top).requires.filter(item => item.path.startsWith('github.com/polyspec/'))) {
      const provider = providerFor(work, consumer, 'go', requirement.path);
      const problem = typeof provider === 'string' ? provider : pinProblem(requirement.version, provider);
      if (problem) unlinkable(work, 'go', requirement.path, problem);
      else if (typeof provider !== 'string') requires.set(requirement.path, provider);
    }
    // The modules of the tracked workspace that the go.work of this module uses besides its own module.
    const workspace = requires.size ? trackedWorkspaceFolders(go, consumer.top, directory, tracked).filter(folder => folder !== directory) : [];
    if (work.check) {
      // The providers that the module requires are found by go list -m; the modules that the link writes (the module and the
      // tracked workspace) are compared with the modules that the go.work of this module uses.
      for (const [name, provider] of requires) {
        const found = existsSync(file) ? run(go.command, ['list', '-m', '-f', '{{.Dir}}', name], { cwd: directory, env: { ...go.env, GOWORK: file } }).trim() : '';
        if (real(found) === realpathSync(provider.folder)) line(work, 'linked', 'go', `${name} -> ${provider.folder} (${file})`);
        else unlinkable(work, 'go', name, `go.work of ${directory} does not use ${provider.folder}`);
      }
      if (requires.size) {
        const used = new Set(existsSync(file) ? usedFolders(go, file).map(folder => real(folder)) : []);
        for (const folder of [directory, ...workspace]) {
          const name = goModule(go, path.join(folder, 'go.mod'), consumer.top).module;
          if (used.has(real(folder))) line(work, 'linked', 'go', `${name} -> ${folder} (${file})`);
          else unlinkable(work, 'go', name, `go.work of ${directory} does not use ${folder}`);
        }
      }
      continue;
    }
    assertIgnored(file);
    assertIgnored(`${file}.sum`);
    if (!requires.size) {
      rmSync(file, { force: true });
      rmSync(`${file}.sum`, { force: true });
      continue;
    }
    const folders = [...new Set([directory, ...workspace, ...[...requires.values()].map(provider => provider.folder)])];
    writeGoWorkspace(go, file, folders);
    for (const [name, provider] of requires) line(work, 'linked', 'go', `${name} -> ${provider.folder} (${file})`);
  }
}

// --- the commands.

/**
 * Links (or with `check`, reports) every polyspec package of each directory of `directories` that the main checkouts
 * `checkouts` provide; false when one is not linked.
 */
export function link({ checkouts, directories, check, print, env = process.env, project = false, runtime }: { checkouts: readonly string[]; directories: readonly string[]; check: boolean; print: Print; env?: NodeJS.ProcessEnv; project?: boolean; runtime?: LinkRuntime }): boolean {
  const consumers = directories.map(directory => consumerOf(directory, project));
  const ecosystems = runtime === undefined ? ALL_ECOSYSTEMS : RUNTIME_ECOSYSTEMS[runtime];
  const first = consumers[0];
  const go = ecosystems.includes('go') && first && first.manifests('go', true).length ? consumerTool(first.top, 'go', env) : undefined;
  const found = providers(checkouts, go, first?.top ?? process.cwd(), first?.top);
  const work: Run = { found: new Map([...found].filter(([, provider]) => ecosystems.includes(provider.ecosystem))), check, print, failed: false, env };
  for (const consumer of consumers) {
    print(`== ${consumer.scope}`);
    if (ecosystems.some(ecosystem => ecosystem !== 'go')) linkPackageFolders(work, consumer, ecosystems);
    if (ecosystems.includes('go')) linkGo(work, consumer);
  }
  return !work.failed;
}

// The tracked projects that the folder link leaves as they are: the tests, the fixtures and the release consumer (K447).
const UNLINKED = /(^|\/)(tests?|[^/]*fixtures?|release-consumer)\//;

/** The vendor folder that the composer.json of `project` names in config.vendor-dir, read from the file, else vendor. */

/**
 * K448: the link of the installed package folders of the consumer. Each folder of a project of the consumer (each folder of a tracked
 * package.json, composer.json or pyproject.toml, and the top) whose installed polyspec package a provider of the run provides becomes a
 * native source connection; with `check`, each folder that is a copy or links elsewhere is reported.
 * Native installation runs before inspecting folders so a newly declared provider can be installed.
 */
function linkPackageFolders(work: Run, consumer: Consumer, ecosystems: readonly Ecosystem[]) {
  // K447: every tracked project of the consumer, a nested one below the root such as hyper's examples/board included, as link-state-check
  // reads them; a test, a fixture or the release consumer keeps the install that it tests.
  const folderEcosystems = ecosystems.filter((ecosystem): ecosystem is 'npm' | 'composer' | 'python' => ecosystem !== 'go');
  if (folderEcosystems.length === 0) return;
  const projects = new Set([consumer.scope, ...folderEcosystems.flatMap(ecosystem => consumer.manifests(ecosystem, true).filter(file => !UNLINKED.test(path.relative(consumer.top, file))).map(file => path.dirname(file)))]);
  for (const project of [...projects].sort()) {
    const composerOwners = folderEcosystems.includes('composer') ? owners(consumer, project, 'composer') : [];
    const pythonManifest = path.join(project, 'pyproject.toml');
    if (folderEcosystems.includes('python') && !work.check && existsSync(pythonManifest) && declaredPython(pythonManifest).length > 0) {
      const uv = consumerTool(consumer.top, 'uv', work.env);
      uvLink({ directory: project, providers: work.found.values(), uv: uv.command, env: uv.env, print: work.print });
    }
    // A path member uses its parent installer's vendor and selected manifest, not a separate member installation (K590).
    const localProviders = [...work.found.values()].filter(provider => provider.ecosystem !== 'composer' || composerOwners.length === 0);
    const folders = providedFolders(project, localProviders, { vendorDir: composerOwners.length === 0 ? composerVendorDir(project, work.env) : undefined });
    // K761, K765: each installed npm, Composer and Python folder of a provided package is one plain directory symlink to its checkout;
    // no package manager re-resolves the consumer. A declared package with no installed folder is reported below (K529).
    if (!work.check) for (const text of linkFolders(folders)) work.print(text);
    // K529: a polyspec package that the manifests of the project declare, and that a provider of the run provides, has an installed folder.
    const missing = declaredWithoutFolder(work, consumer, project, [...folders, ...ownerFolders(work, consumer, project, folderEcosystems)], folderEcosystems);
    for (const name of missing) line(work, 'NOT linked', name.ecosystem, `${name.name}: no installed folder in ${path.relative(consumer.top, project) || '.'}; install the project first`);
    if (missing.length > 0) work.failed = true;
    if (work.check) {
      const findings = [...folderFindings(consumer.top, folders), ...providerDependencyFindings(consumer.top, folders, work.found.values())];
      for (const finding of findings) line(work, 'NOT linked', finding.split(' ')[0] ?? '', finding.slice(finding.indexOf(' ') + 1));
      if (findings.length > 0) work.failed = true;
      continue;
    }
    for (const item of folders) line(work, 'linked', item.ecosystem, `${item.name} -> ${item.target}`);
  }
}

/**
 * The projects above the workspace member `project` that install its packages of `ecosystem` (K590), nearest first: none when the
 * member has a lock of its own. An npm member with no package-lock.json is installed by the nearest npm project above it with one,
 * and node resolves its packages in each node_modules up to that project; a Composer member with no composer.lock is installed by a
 * Composer project above it whose path repository installs its folder (K396), into that project's vendor.
 */
function owners(consumer: Consumer, project: string, ecosystem: 'npm' | 'composer'): string[] {
  const lock = ecosystem === 'npm' ? 'package-lock.json' : 'composer.lock';
  if (existsSync(path.join(project, lock))) return [];
  const found: string[] = [];
  for (let folder = path.dirname(project); `${folder}/`.startsWith(`${consumer.top}/`); folder = path.dirname(folder)) {
    if (!existsSync(path.join(folder, MANIFESTS[ecosystem]))) continue;
    if (ecosystem === 'npm') {
      found.push(folder);
      if (existsSync(path.join(folder, lock))) return found;
    } else if (installsFolder(folder, project)) {
      return [folder];
    }
  }
  return [];
}

/** The installed folders of `ecosystem` that the owners of the workspace member `project` hold for it (K590). */
function ownerFolders(work: Run, consumer: Consumer, project: string, ecosystems: readonly ('npm' | 'composer' | 'python')[]): ProvidedFolder[] {
  return (['npm', 'composer'] as const).filter(ecosystem => ecosystems.includes(ecosystem)).flatMap(ecosystem => owners(consumer, project, ecosystem).flatMap(owner =>
    providedFolders(owner, work.found.values(), { vendorDir: composerVendorDir(owner, work.env) }).filter(folder => folder.ecosystem === ecosystem)));
}

/**
 * The provided packages that the manifests of `project` declare and that have no installed folder among `folders` (K529): a declared
 * polyspec package with no folder is a finding, never a silent pass. A python member is installed as its package paths, so it is
 * installed when one of its folders is there.
 */
function declaredWithoutFolder(work: Run, consumer: Consumer, project: string, folders: readonly ProvidedFolder[], ecosystems: readonly ('npm' | 'composer' | 'python')[]): { ecosystem: Ecosystem; name: string }[] {
  const declared: { ecosystem: Ecosystem; name: string }[] = [];
  const files: readonly (readonly [Ecosystem, string, (file: string) => string[]])[] = ([['composer', MANIFESTS.composer, declaredComposer], ['npm', MANIFESTS.npm, declaredNpm], ['python', MANIFESTS.python, declaredPython]] as const).filter(([ecosystem]) => ecosystems.includes(ecosystem));
  for (const [ecosystem, manifest, names] of files) {
    const file = path.join(project, manifest);
    if (!existsSync(file)) continue;
    for (const name of names(file)) declared.push({ ecosystem, name });
  }
  return declared.filter(({ ecosystem, name }) => {
    const provider = work.found.get(providerKey(ecosystem, name));
    // A package of the consumer's own repository is never installed from a folder of another checkout, and a python provider with
    // no package path installs no folder (K529).
    if (provider === undefined || provider.repository === repositoryOf(consumer.top)) return false;
    if (ecosystem === 'python' && !hasPythonPackages(provider)) return false;
    return !folders.some(folder => folder.ecosystem === ecosystem && (folder.name === name || folder.name.startsWith(`${name} `)));
  });
}

/** The polyspec packages of `ecosystem` that the consumer `directory` declares, for a recipe (uv sync --no-install-package). */
export function packages(directory: string, ecosystem: 'python' | 'npm'): string[] {
  const consumer = consumerOf(directory);
  const names = ecosystem === 'python'
    ? consumer.manifests('python').flatMap(file => declaredPython(file))
    : consumer.manifests('npm').flatMap(file => declaredNpm(file));
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
        if (typeof target === 'string') { skip(`python ${path.dirname(file)}: no environment or no uv.lock; run the repository's install`); continue; }
        if (!existsSync(path.join(target.workspace, 'uv.lock'))) {
          // A project locked by a PEP 751 lock and no uv.lock (K401-1) gets the locked releases of its linked packages installed over
          // their links; a linked package that the lock does not hold has no locked release to restore.
          const lock = pylockOf(target.workspace);
          if (lock === undefined) { skip(`python ${path.dirname(file)}: no environment or no uv.lock; run the repository's install`); continue; }
          const { pins, missing } = pylockReleases(lock, declaredPython(file));
          for (const name of missing) skip(`python ${path.dirname(file)}: ${name} is not held by ${path.basename(lock)}, not restorable`);
          if (pins.length) {
            releaseLinks(target, print);
            run(uv.command, ['pip', 'install', '--python', path.join(target.venv, 'bin/python'), ...pins.map(pin => pin.requirement), ...pins.flatMap(pin => ['--reinstall-package', pin.name])], { cwd: target.workspace, env: uv.env });
            print(`  restored   python   ${target.venv}`);
          }
          continue;
        }
        // The restore selects every group, as the consumer's install does (K238): uv reinstalls only the packages that a sync
        // selects; --all-groups includes test dependencies and retains native sources declared by the application.
        // --inexact keeps every other package (K237).
        syncPython(uv, target, print, '--all-groups', '--inexact', ...declaredPython(file).flatMap(name => ['--reinstall-package', name]));
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
 * their packages, and the lock of the tree is copied to var/link, so the patches resolve against it. Native arguments remain unchanged;
 * ambient CARGO_TARGET_DIR is omitted so Cargo resolves its own workspace target.
 */
export function cargo({ directory, args, checkouts = [], env = process.env }: { directory: string; args: readonly string[]; checkouts?: readonly string[]; env?: NodeJS.ProcessEnv }): number {
  const consumer = consumerOf(directory);
  const cargoEnv = { ...env };
  delete cargoEnv.CARGO_TARGET_DIR;
  const tool = consumerTool(consumer.top, 'cargo', cargoEnv);
  const channel = args[0]?.startsWith('+') ? [args[0]] : [];
  const commandArgs = channel.length ? args.slice(1) : args;
  const graphArgs = cargoMetadataArguments(args);
  const manifestArgs = graphArgs.flatMap((arg, index) => arg.startsWith('--manifest-path=') ? [arg] : arg === '--manifest-path' ? [arg, graphArgs[index + 1] ?? ''] : []);
  const config: string[] = [];
  let held: ReturnType<typeof acquireHolderLock> | undefined;
  const expected = new Map<string, string>();
  const patched: string[] = [];
  try {
    if (checkouts.length) {
      const workspace = path.dirname(run(tool.command, [...channel, 'locate-project', '--workspace', '--message-format', 'plain', ...manifestArgs], { cwd: consumer.scope, env: tool.env }).trim());
      held = acquireHolderLock(path.join(consumer.top, 'var/link/cargo', path.relative(consumer.top, workspace).replaceAll('/', '_') || 'root', 'execution.lock'), { checkout: consumer.top, command: ['cargo', ...args].join(' ') });
      // A fresh copy of the tracked lock on every run, so the patches resolve against the lock of the tree.
      const copy = linkFile(consumer.top, path.join('cargo', path.relative(consumer.top, workspace).replaceAll('/', '_') || 'root', 'Cargo.lock'));
      mkdirSync(path.dirname(copy), { recursive: true });
      copyFileSync(path.join(workspace, 'Cargo.lock'), copy);
      config.push('--config', `resolver.lockfile-path=${JSON.stringify(copy)}`);
      const packages = readTomlFile(copy).package;
      const locked = new Set((Array.isArray(packages) ? packages : []).flatMap((item: unknown) => isJsonObject(item) && typeof item.name === 'string' ? [item.name] : []));
      for (const checkout of mainCheckouts(checkouts).filter(item => repositoryOf(item) !== consumer.repository)) {
        const crates = trackedManifests(checkout, ['Cargo.toml']).filter(file => !EXCLUDED.test(file)).flatMap((file) => {
          const pkg = readTomlFile(path.join(checkout, file)).package;
          return isJsonObject(pkg) && typeof pkg.name === 'string' ? [{ name: pkg.name, folder: path.join(checkout, path.dirname(file)) }] : [];
        });
        for (const crate of crates) expected.set(crate.name, crate.folder);
        if (!crates.length) continue;
        // K448-5-1: a crate the lock does not name is never used, so its patch would be recorded as an unused patch of the lock (K489 needs no release file for it).
        const used = crates.filter(crate => locked.has(crate.name));
        if (!used.length) continue;
        const url = declaredUrl(checkout);
        for (const crate of used) {
          config.push('--config', `patch.${JSON.stringify(url)}.${crate.name}.path=${JSON.stringify(crate.folder)}`);
          patched.push(crate.name);
        }
      }
    }
    // Resolve only the sibling packages in the generated development lock. A release lock can pin an older, incompatible
    // version, so metadata against a fresh copy would otherwise ignore the path patch and report the release as selected.
    if (patched.length) run(tool.command, [...channel, ...config, 'update', '--offline', ...patched, ...manifestArgs], { cwd: directory, env: tool.env });
    // This validates the resolved workspace, including packages outside a caller's -p execution scope.
    if (checkouts.length && expected.size) {
      const metadata = run(tool.command, [...channel, ...config, 'metadata', '--format-version=1', ...graphArgs], { cwd: directory, env: tool.env });
      verifyCargoSources(metadata, expected);
    }
    const outcome = execute(tool.command, [...channel, ...config, ...commandArgs], { cwd: directory, env: tool.env });
    if (outcome.error) throw new Error(`${tool.command} could not start: ${outcome.error.message}`);
    process.stdout.write(outcome.stdout);
    process.stderr.write(outcome.stderr);
    return outcome.status ?? 1;
  } finally {
    held?.release();
  }
}

/** A shell word of one single-quoted argument, as the Claude Code hook command runs it. */
const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// K440: a Claude Code session started in the workspace folder (the folder of kit and its siblings) loads no .claude/settings.json of
// kit, so link --siblings writes the Bash PreToolUse hook of claude-hook into the settings of that folder, run by its kit checkout.
const KIT_HOOK = path.relative(kitPackageRoot(), siblingTool(import.meta.url, 'claude-hook'));
// The node of a kit checkout that runs the hook: installed by make install-tools (K171, K440-2).
const KIT_NODE = 'var/tools/bin/node';

/**
 * The kit checkout of a development workspace whose claude-hook exists. A kit inside the explicit GitHub Actions checkout
 * is a job input, including a nested checkout, rather than an interactive workspace; only its workspace hook is inapplicable.
 */
export function kitHookCheckout(workspace: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const kit = path.join(workspace, 'kit');
  if (!existsSync(path.join(kit, KIT_HOOK))) return undefined;
  const checkout = env.GITHUB_WORKSPACE;
  if (env.GITHUB_ACTIONS === 'true' && checkout && path.isAbsolute(checkout) && existsSync(checkout)) {
    const relative = path.relative(realpathSync(checkout), realpathSync(kit));
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return undefined;
  }
  return kit;
}

/**
 * Whether the node of the kit checkout `kit` can run the hook (K440-2): its path resolves through links to a regular file, and that
 * file is executable. The writer and link-state-check both judge the node by this predicate.
 */
export function kitNodeRunnable(kit: string): boolean {
  const node = path.join(kit, KIT_NODE);
  if (!existsSync(node)) return false;
  const real = realpathSync(node);
  if (!statSync(real).isFile()) return false;
  try {
    accessSync(real, constants.X_OK);
    return true;
  } catch (error) {
    if (errorCode(error) === 'EACCES') return false;
    throw error;
  }
}

/** The PreToolUse entry of the Bash tool that runs the node and the claude-hook of the kit checkout `kit`, both absolute. */
export function workspaceHookEntry(kit: string) {
  return { matcher: 'Bash', hooks: [{ type: 'command', command: `${quote(path.join(kit, KIT_NODE))} ${quote(path.join(kit, KIT_HOOK))}` }] };
}

/** Whether a PreToolUse entry runs the claude-hook of a kit checkout. */
export const isKitHookEntry = (entry: unknown): boolean => isJsonObject(entry) && Array.isArray(entry.hooks) && entry.hooks.some(hook => isJsonObject(hook) && typeof hook.command === 'string' && hook.command.includes(KIT_HOOK));

/** The settings with the kit hook entry added to PreToolUse, or replacing the entry of an earlier kit checkout; all else is kept. */
export function withWorkspaceHook(settings: Record<string, unknown>, kit: string): Record<string, unknown> {
  const hooks = isJsonObject(settings.hooks) ? settings.hooks : {};
  const pre: unknown[] = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const entry = workspaceHookEntry(kit);
  const index = pre.findIndex(isKitHookEntry);
  // The entry replaces the first kit entry, and any further kit entry (of an earlier checkout) is dropped, so one entry stays.
  const next = index === -1 ? [...pre, entry] : pre.flatMap((item, position) => (position === index ? [entry] : isKitHookEntry(item) ? [] : [item]));
  return { ...settings, hooks: { ...hooks, PreToolUse: next } };
}

/** The settings file of the workspace folder, or an empty object while it does not exist. */
export const workspaceSettings = (workspace: string): Record<string, unknown> => (existsSync(path.join(workspace, '.claude/settings.json')) ? readJsonObject(workspace, '.claude/settings.json') : {});

/**
 * Writes the kit hook into the settings of the workspace folder when it has a kit checkout; returns the file written, or undefined.
 * The node of the checkout is checked first: while it is missing or not executable the write is refused and the settings file is left
 * as it is (K440-2).
 */
export function writeWorkspaceHook(workspace: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const kit = kitHookCheckout(workspace, env);
  if (kit === undefined) return undefined;
  if (!kitNodeRunnable(kit)) throw new Error(`${path.join(kit, KIT_NODE)} is missing or not executable, so the Claude Code hook cannot run; run make -C ${realpathSync(kit)} install-tools`);
  const file = path.join(workspace, '.claude/settings.json');
  const settings = workspaceSettings(workspace);
  const next = withWorkspaceHook(settings, kit);
  if (JSON.stringify(next) !== JSON.stringify(settings)) writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return file;
}

// K498: a consumer checkout (link --project) loads the claude-hook of the kit that runs the link, through its untracked
// .claude/settings.local.json, which the Git exclude of the consumer ignores. The hook is the file beside this module of the same
// kind (scripts/kit/claude-hook.mts, or dist/claude-hook.mjs of the built package), run by the node of the running link.
const PROJECT_HOOK_FILE = '.claude/settings.local.json';
const THIS_MODULE = fileURLToPath(import.meta.url);

/** The settings file of the consumer `project` that the link writes its hook into (K498). */
export const projectHookFile = (project: string): string => path.join(project, PROJECT_HOOK_FILE);

/**
 * The kit checkout or package that holds the running link: its folder beside `dist/` or `scripts/kit/` is the root (K498-3).
 * The root of the built package is the parent of `dist/`; a source module lies two folders below the root.
 */
const kitRoot = (): string => (path.basename(path.dirname(THIS_MODULE)) === 'dist' ? path.resolve(path.dirname(THIS_MODULE), '..') : path.resolve(path.dirname(THIS_MODULE), '../..'));

/**
 * The Bash PreToolUse entry of the claude-hook of the running kit (K498): the node of that kit (its runnable var/tools/bin/node) and
 * the claude-hook beside the link. It names no node of the process, so a link and a check run by different nodes build one entry
 * (K498-3). Throws while the node of the kit is missing or not executable.
 */
function projectHookEntry() {
  const kit = kitRoot();
  if (!kitNodeRunnable(kit)) throw new Error(`${path.join(kit, KIT_NODE)} is missing or not executable, so the Claude Code hook cannot run; run make -C ${kit} install-tools`);
  const hook = path.join(path.dirname(THIS_MODULE), `claude-hook${THIS_MODULE.endsWith('.mts') ? '.mts' : '.mjs'}`);
  return { matcher: 'Bash', hooks: [{ type: 'command', command: `${quote(path.join(kit, KIT_NODE))} ${quote(hook)}` }] };
}

/** Whether a PreToolUse entry runs a claude-hook of either form (K498). */
const isClaudeHookEntry = (entry: unknown): boolean => isJsonObject(entry) && Array.isArray(entry.hooks) && entry.hooks.some(hook => isJsonObject(hook) && typeof hook.command === 'string' && /claude-hook\.m[jt]s/.test(hook.command));

/** The settings with `entry` as the one claude-hook entry of PreToolUse, replacing an earlier one; all else is kept (K498). */
function withProjectHook(settings: Record<string, unknown>, entry: ReturnType<typeof projectHookEntry>): Record<string, unknown> {
  const hooks = isJsonObject(settings.hooks) ? settings.hooks : {};
  const pre: unknown[] = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const index = pre.findIndex(isClaudeHookEntry);
  const next = index === -1 ? [...pre, entry] : pre.flatMap((item, position) => (position === index ? [entry] : isClaudeHookEntry(item) ? [] : [item]));
  return { ...settings, hooks: { ...hooks, PreToolUse: next } };
}

/**
 * Whether Git ignores the settings file of the consumer `project`, when the consumer is a Git checkout. The link writes nothing into
 * .git, whose common directory of a worktree is the main checkout's (K512): the consumer's .gitignore ignores the file.
 */
function hookFileIgnored(project: string): boolean {
  if (spawnSync('git', ['-C', project, 'rev-parse', '--git-dir']).status !== 0) return true;
  return spawnSync('git', ['-C', project, 'check-ignore', '-q', PROJECT_HOOK_FILE]).status === 0;
}

/** Writes the claude-hook of the running kit into the untracked settings of the consumer `project` (K498); returns the file. */
export function writeProjectHook(project: string): string {
  const file = projectHookFile(project);
  const settings = existsSync(file) ? readJsonObject(project, PROJECT_HOOK_FILE) : {};
  const next = withProjectHook(settings, projectHookEntry());
  if (!existsSync(file) || JSON.stringify(next) !== JSON.stringify(settings)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return file;
}

/** The findings of the consumer `project` whose settings lack the claude-hook of the running kit (K498); fix: make link. */
export function projectHookFindings(project: string): string[] {
  const file = projectHookFile(project);
  const settings = existsSync(file) ? readJsonObject(project, PROJECT_HOOK_FILE) : {};
  const hooks = isJsonObject(settings.hooks) ? settings.hooks : {};
  const present = (Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : []).filter(isClaudeHookEntry);
  if (present.length === 0) return [`${file}: no Bash PreToolUse hook runs the claude-hook of the kit that links it (K498); fix: make link`];
  if (JSON.stringify(present) !== JSON.stringify([projectHookEntry()])) return [`${file}: the Bash PreToolUse hook of the claude-hook differs from the entry the link writes (K498); fix: make link`];
  if (!hookFileIgnored(project)) return [`${file}: Git does not ignore the settings that the link writes (K512); fix: add the line /${PROJECT_HOOK_FILE} to the .gitignore of ${project}`];
  return [];
}

if (isMain(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const print: Print = text => process.stdout.write(`${text}\n`);
  try {
    // `--project <dir>` names the consumer (K201, S-426); the other arguments are the checkouts that provide the packages.
    const project = rest.indexOf('--project');
    const projectDirectory = project === -1 ? undefined : rest[project + 1];
    if (project !== -1 && !projectDirectory) throw new Error('Usage: link.mjs ... --project <dir>');
    const runtimeIndex = command === 'link' || command === 'check' ? rest.indexOf('--runtime') : -1;
    const runtimeValue = runtimeIndex === -1 ? undefined : rest[runtimeIndex + 1];
    let runtime: LinkRuntime | undefined;
    if (runtimeIndex !== -1) {
      if (runtimeValue === undefined || !isLinkRuntime(runtimeValue)) {
        throw new Error(`unknown or missing runtime ${runtimeValue ?? ''}; choose go, php, php-ext, python, rust or ts`);
      }
      runtime = runtimeValue;
    }
    const withoutOptions = rest.filter((_, index) => (project === -1 || (index !== project && index !== project + 1)) && (runtimeIndex === -1 || (index !== runtimeIndex && index !== runtimeIndex + 1)));
    // `--siblings` takes the checkouts beside the repository as the checkouts (K349): an install recipe links right after the
    // install when polyspec checkouts are present, and a checkout without a sibling, such as CI, installs the released packages.
    const siblings = withoutOptions.includes('--siblings');
    const positional = withoutOptions.filter(argument => argument !== '--siblings');
    const directories = [projectDirectory ?? '.'];
    // K498, K506: a consumer named by --project gets the claude-hook of the running kit before the packages are linked, whatever
    // their result, and check reads that entry; both run before the early return below, which a checkout without a polyspec sibling takes.
    if (projectDirectory !== undefined && command === 'link') writeProjectHook(projectDirectory);
    const hookFindings = projectDirectory !== undefined && command === 'check' ? projectHookFindings(projectDirectory) : [];
    if (siblings && (command === 'link' || command === 'check')) {
      const found = siblingCheckouts(projectDirectory ?? '.');
      for (const folder of found.skipped) print(`skipped ${folder}: no main checkout of a polyspec repository, whose origin is github.com/polyspec/<its folder>`);
      positional.push(...found.checkouts);
      if (positional.length === 0) {
        print(`no polyspec checkout beside ${workTreeOf(projectDirectory ?? '.')}: nothing is linked and the installs stay the released packages`);
        for (const finding of hookFindings) print(finding);
        process.exit(hookFindings.length === 0 ? 0 : 1);
      }
    }
    switch (command) {
      case 'link': case 'check':
        if (!link({ checkouts: positional, directories, check: command === 'check', print, project: projectDirectory !== undefined, ...(runtime === undefined ? {} : { runtime }) })) process.exitCode = 1;
        else if (command === 'link' && siblings) writeWorkspaceHook(workspaceOf(projectDirectory ?? '.'));
        for (const finding of hookFindings) { print(finding); process.exitCode = 1; }
        break;
      case 'unlink':
        if (!unlink({ directories, print, project: projectDirectory !== undefined })) process.exitCode = 1;
        break;
      case 'rebuild':
        for (const repository of rest) rebuild(workTreeOf(repository), print);
        break;
      case 'providers': {
        // The npm providers of the checkouts that the arguments name, one line each: the name, a tab and the package folder, sorted by
        // name. They are read by the rules of link (the excluded paths, a package folder before its root, one provider per name), so a
        // consumer takes the folder of each polyspec package from the kit (K462).
        if (rest.length === 0) throw new Error('Usage: link.mjs providers <checkout>...');
        const npm = [...providers(rest, undefined, process.cwd()).values()].filter(provider => provider.ecosystem === 'npm');
        for (const provider of npm.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) print(`${provider.name}\t${provider.folder}`);
        break;
      }
      case 'packages': {
        const [directory, ecosystem] = rest;
        if (!directory || (ecosystem !== 'python' && ecosystem !== 'npm')) throw new Error('Usage: link.mjs packages <dir> python|npm');
        for (const name of packages(directory, ecosystem)) print(name);
        break;
      }
      case 'cargo': {
        // `--siblings` takes the checkouts beside the project as the checkouts, as link does (K448-5); without any, cargo runs as given.
        const siblings = rest[0] === '--siblings';
        if (siblings) rest.shift();
        const checkouts: string[] = [];
        while (rest[0] === '--checkout') checkouts.push(rest.splice(0, 2)[1] ?? '');
        const [directory, ...args] = rest;
        if (!directory) throw new Error('Usage: link.mjs cargo [--siblings] [--checkout <checkout>]... <dir> <cargo args>...');
        if (siblings) {
          const found = siblingCheckouts(directory);
          for (const folder of found.skipped) print(`skipped ${folder}: no main checkout of a polyspec repository, whose origin is github.com/polyspec/<its folder>`);
          checkouts.push(...found.checkouts);
        }
        process.exitCode = cargo({ directory, args, checkouts });
        break;
      }
      default: throw new Error('Usage: link.mjs link|check [--project <dir>] <checkout>... | unlink [--project <dir>] | rebuild <repository>... | packages <dir> python|npm | providers <checkout>... | cargo [--siblings] [--checkout <checkout>]... <dir> <args>...');
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
