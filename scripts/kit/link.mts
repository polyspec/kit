// The local links of 0.0.x development (docs/operations/local-links.md, K201, K205, K448). The checkouts that the arguments name are the
// providers (link-providers.mts): each installed package folder of a consumer that a provider gives is replaced by a direct relative
// symlink to the provider's package folder (K761): during development the installed folder is a plain directory symlink to the
// development checkout, and a release uses the installed copy. No package manager re-resolves the consumer, Python's
// included (K765). kit itself only links: it never builds and runs no package manager over the consumer (K856):
//   npm       node_modules/<name> of each tracked project, one directory symlink;
//   Composer  <vendor-dir>/<vendor>/<package> of each tracked project, the vendor-dir of its composer.json, one directory symlink;
//   Python    each package of the site-packages of a project's .venv, one link per package of a namespace;
//   Go        each go.mod of the consumer gets a git-ignored go.work that uses its module and the provider modules, which
//             go reads by itself, whatever version the module requires (K856), and that replaces each required version of a
//             provider module with its folder, so go fetches no version that has no tag yet (K1212); unlink removes it;
//   Rust      `cargo <dir> <args>` runs one cargo command with --config patches and a lock copy under var/link/cargo;
//             `maturin <dir> <args>` runs one maturin command with the same options, which maturin passes to the cargo it runs (K1266);
//             `cargo --tracked-lock <dir> <args>` runs one cargo command as given, which writes the tracked lock (K1287).
// No environment variable declares anything: without checkouts nothing is linked, and the installs stay the locked releases.
// A consumer is a directory: the top of a work tree stands for every tracked manifest of it, another directory for those
// below it; with --project the folder is the consumer and its own manifest is read, tracked or not (K212). Each file that link writes
// into the consumer is one that Git ignores there, and link writes nothing into .git (K512) (the links in the install folders, var/link, and each go.work).
// unlink only removes the links and the files that link wrote; make install restores the locked installs, reinstalling each Python
// distribution whose package folder a removed link left missing (K856).
//   node link.mjs link [--project <dir>] [--runtime <runtime>] | unlink [--project <dir>] |
//                 providers [--ecosystem npm|composer|python|go] [<checkout>...] | cargo [--tracked-lock] <dir> <args>... | maturin <dir> <args>...
// The providers are the checkouts that the link declaration names (K869): LINKS_FILE at the root of the checkout itself (K1118), one path per
// line; with no file nothing is linked. make link-check (link-check.mts) compares the declaration with the state.
// A package name that two folders of a provider give (K1213) is judged only for the ecosystems of the runtime and in a project that
// holds the package installed: the project decides the folder (decideProviders of link-folders.mts), or link fails with the package and
// the folders.
// --project limits link, check and unlink to the manifests directly in <dir>, never a nested project (S-426), and fails when
// <dir> holds none (K212); without it the whole tree of the working directory is the consumer.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { projectEnvironment, uvLink } from './uv-install.mts';
import { composerRecordFindings, composerVendorDir, decideProviders, environmentLinks, folderFindings, hasPythonPackages, linkFolders, managerLink, managerLinkFindings, nativeLocalSourceFindings, present, type ProvidedFolder, providedFolders, providerDependencyFindings } from './link-folders.mts';
import { assertIgnored, declaredCheckouts, type Ecosystem, EXCLUDED, goModule, type GoRequirement, LINKS_FILE, mainCheckouts, MANIFESTS, type Provider, providerKey, providers, readTomlFile, repositoryOf, soleProvider, type Tool, trackedManifests, workTreeOf } from './link-providers.mts';
import { readComposerManifestFile } from './manifests.mts';
import { toolCommand } from './mise-tools.mts';
import { isMain } from './paths.mts';
import { errorCode, executeInherited, run } from './process.mts';
import { acquireHolderLock } from './holder-lock.mts';
import { cargoMetadataArguments, verifyCargoSources } from './cargo-source.mts';
import { manifestPolyspecNames } from './pyproject-dependencies.mts';

type Print = (text: string) => void;
type LinkRuntime = 'go' | 'php' | 'php-ext' | 'python' | 'rust' | 'ts';

/** The native package managers that a runtime link may inspect or invoke. Rust source patches use the cargo wrapper instead. */
const RUNTIME_ECOSYSTEMS: Readonly<Record<LinkRuntime, readonly Ecosystem[]>> = {
  go: ['go'], php: ['composer'], 'php-ext': ['composer'], python: ['python'], rust: [], ts: ['npm'],
};
const ALL_ECOSYSTEMS: readonly Ecosystem[] = ['npm', 'composer', 'python', 'go'];

const isLinkRuntime = (value: string): value is LinkRuntime => Object.hasOwn(RUNTIME_ECOSYSTEMS, value);

/**
 * The command `name` of the consumer `top`: the variable `variable` when the recipe gives it, else the tool of the checkout
 * (the shim of mise, var/tools/bin/npm, the Composer of mise.toml), else the one on PATH (K947), and cargo is that of PATH; a
 * tool that cannot start fails with its cause.
 */
function consumerTool(top: string, name: 'npm' | 'composer' | 'uv' | 'go' | 'cargo', env: NodeJS.ProcessEnv): Tool {
  const variable = { npm: 'NPM', composer: 'COMPOSER_BIN', uv: 'UV', go: 'GO', cargo: 'CARGO' }[name];
  const given = env[variable];
  if (given) return { command: given, env };
  if (name === 'cargo') return { command: 'cargo', env };
  // The tool of the checkout, else the one on PATH (K947).
  return { command: toolCommand(top, name), env };
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
type Run = { found: Map<string, Provider>; check: boolean; print: Print; failed: boolean; env: NodeJS.ProcessEnv; declared: Set<string> };

/** Prints a state line: `state` (linked, retained, NOT linked, STALE, own) of `ecosystem` and the text. */
const line = (work: Run, state: string, ecosystem: string, text: string) => work.print(`  ${state.padEnd(10)} ${ecosystem.padEnd(8)} ${text}`);

/**
 * The provider of `name`, or why there is none to link: own repository or no provider. A name that two folders give fails with both
 * (K1213): a Go module is named by its module path alone, so nothing decides between two folders of one path.
 */
function providerFor(work: Run, consumer: Consumer, ecosystem: Ecosystem, name: string): Provider | 'own' | 'no provider' {
  const found = work.found.get(providerKey(ecosystem, name));
  if (!found) return 'no provider';
  return soleProvider(found).repository === consumer.repository ? 'own' : found;
}


/** Reports a polyspec package that is not linked for `reason`, which fails the run; own packages are listed and pass. */
function unlinkable(work: Run, ecosystem: Ecosystem, name: string, reason: string) {
  if (reason === 'own') { line(work, 'own', ecosystem, `${name} (this repository)`); return; }
  line(work, 'NOT linked', ecosystem, `${name} (${reason})`);
  work.failed = true;
}




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



/**
 * The packages that the composer.json `file` requires, in require and require-dev, whatever their scope: a package that a checkout of
 * .links provides, a polyspec provider or a fork, is linked (K999); the providers of the run select them.
 */
function declaredComposer(file: string): string[] {
  const manifest = readComposerManifestFile(file);
  return [...Object.keys(manifest.require ?? {}), ...Object.keys(manifest['require-dev'] ?? {})];
}

/**
 * Whether the Composer project at `project` installs the folder `folder` through one of its path repositories.
 */
function installsFolder(project: string, folder: string): boolean {
  return (readComposerManifestFile(path.join(project, MANIFESTS.composer)).repositories ?? []).some(repository => repository.type === 'path' && repository.url !== undefined && path.resolve(project, repository.url) === folder);
}

// --- Python: uv installs the lock and owns the distribution metadata; kit links the installed package folders (K765).

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
 * itself is never read: it is the file that link writes there. link-check reads it too (K399-2).
 */
export function trackedWorkspaceFolders(go: Tool, top: string, directory: string, tracked: ReadonlySet<string>): string[] {
  for (let folder = path.dirname(directory); `${folder}/`.startsWith(`${top}/`); folder = path.dirname(folder)) {
    const file = goWorkOf(folder);
    if (tracked.has(file)) return usedFolders(go, file);
  }
  return [];
}

/** A replace directive of a go.work: the module and the version that it replaces, and the folder that replaces them. */
type GoReplace = { module: string; version: string; folder: string };

/** The name of the replaced module version `item` as go work edit takes it: <module>@<version>, or the module alone for all versions. */
const replaced = (item: { module: string; version: string }): string => (item.version === '' ? item.module : `${item.module}@${item.version}`);

/**
 * The use and replace directives of the go.work `file`, as go work edit -json reads them: each used folder as the file writes it and
 * resolved against the folder of the go.work, and each replaced module version with the folder that replaces it, undefined when
 * another module version replaces it, which link never writes.
 */
function readGoWorkspace(go: Tool, file: string, env: NodeJS.ProcessEnv = go.env): { uses: { written: string; folder: string }[]; replaces: { module: string; version: string; folder: string | undefined }[] } {
  const directory = path.dirname(file);
  const parsed: unknown = JSON.parse(run(go.command, ['work', 'edit', '-json', file], { cwd: directory, env }));
  if (!isJsonObject(parsed)) throw new Error(`${file}: go work edit -json printed no object`);
  const uses = (Array.isArray(parsed.Use) ? parsed.Use : []).flatMap(item => (isJsonObject(item) && typeof item.DiskPath === 'string' ? [{ written: item.DiskPath, folder: path.resolve(directory, item.DiskPath) }] : []));
  const replaces = (Array.isArray(parsed.Replace) ? parsed.Replace : []).flatMap((item) => {
    if (!isJsonObject(item) || !isJsonObject(item.Old) || !isJsonObject(item.New) || typeof item.Old.Path !== 'string' || typeof item.New.Path !== 'string') return [];
    const folder = typeof item.New.Version === 'string' && item.New.Version !== '' ? undefined : path.resolve(directory, item.New.Path);
    return [{ module: item.Old.Path, version: typeof item.Old.Version === 'string' ? item.Old.Version : '', folder }];
  });
  return { uses, replaces };
}

/**
 * The module folders that the go.work `file` uses, as go work edit -json reads them: each DiskPath resolved against the folder of
 * the go.work. The check reads them from the go.work itself, not from go list -m of each module.
 */
export function usedFolders(go: Tool, file: string): string[] {
  return readGoWorkspace(go, file).uses.map(item => item.folder);
}

/**
 * K1212: the replace directives of a go.work that uses the module folders `folders`: each version at which the go.mod of one of them,
 * read by `read`, requires a module of `linked`, replaced by the folder of its provider. Go reads the go.mod of every version that a
 * module of a workspace requires, a module that the workspace uses included, so a required version that no tag names yet fails each
 * command that loads the module graph (go list -m all, and a build of a package that imports a module outside the workspace). Go
 * refuses a replace of all versions of a module that the workspace uses, so each required version is named.
 */
function goReplaces(folders: readonly string[], linked: ReadonlyMap<string, Provider>, read: (file: string) => { requires: GoRequirement[] }): GoReplace[] {
  const found = new Map<string, GoReplace>();
  for (const folder of folders) {
    for (const requirement of read(path.join(folder, MANIFESTS.go)).requires) {
      const provider = linked.get(requirement.path);
      if (provider !== undefined) found.set(`${requirement.path}@${requirement.version}`, { module: requirement.path, version: requirement.version, folder: provider.folder });
    }
  }
  return [...found.values()];
}

/**
 * Reconciles the native use and replace directives of the workspace `file` with `folders` and `replaces` (K1212), without discarding
 * Go's checksum or other workspace state: go work init writes a new go.work, and go work edit changes only what differs.
 */
export function writeGoWorkspace(go: Tool, file: string, folders: readonly string[], replaces: readonly GoReplace[] = []): void {
  const directory = path.dirname(file);
  const place = { cwd: directory, env: { ...go.env, GOWORK: file } };
  const desired = new Set(folders.map(folder => path.resolve(folder)));
  const shown = (folder: string) => path.relative(directory, folder) || '.';
  // go work init writes the use directives that it is given, and no replace.
  const fresh = !existsSync(file);
  if (fresh) run(go.command, ['work', 'init', ...[...desired].map(shown)], place);
  const written = fresh ? { uses: [...desired].map(folder => ({ written: shown(folder), folder })), replaces: [] } : readGoWorkspace(go, file, place.env);
  const wanted = new Map(replaces.map(item => [replaced(item), path.resolve(item.folder)]));
  const kept = new Set(written.replaces.filter(item => item.folder !== undefined && wanted.get(replaced(item)) === item.folder).map(replaced));
  // go takes a replacing folder only as a directory path, which starts with ./ or ../ when it is relative.
  const directoryPath = (folder: string) => (shown(folder).startsWith('.') ? shown(folder) : `./${shown(folder)}`);
  const edits = [
    ...written.uses.filter(item => !desired.has(item.folder)).map(item => `-dropuse=${item.written}`),
    ...[...desired].filter(folder => !written.uses.some(item => item.folder === folder)).map(folder => `-use=${shown(folder)}`),
    ...written.replaces.filter(item => !wanted.has(replaced(item))).map(item => `-dropreplace=${replaced(item)}`),
    ...replaces.filter(item => !kept.has(replaced(item))).map(item => `-replace=${replaced(item)}=${directoryPath(item.folder)}`),
  ];
  if (edits.length) run(go.command, ['work', 'edit', ...edits, file], place);
}

function linkGo(work: Run, consumer: Consumer) {
  const modules = consumer.manifests('go', true);
  if (!modules.length) return;
  const go = consumerTool(consumer.top, 'go', work.env);
  const tracked = new Set(trackedManifests(consumer.top, ['go.work']).map(file => path.join(consumer.top, file)));
  // Each go.mod is read once for the run: the go.work of a module reads the go.mod of every module that it uses (K1212).
  const read = new Map<string, ReturnType<typeof goModule>>();
  const moduleOf = (file: string) => {
    const found = read.get(file) ?? goModule(go, file, consumer.top);
    read.set(file, found);
    return found;
  };
  for (const module of modules) {
    const directory = path.dirname(module);
    const file = goWorkOf(directory);
    const requires = new Map<string, Provider>();
    for (const requirement of moduleOf(module).requires.filter(item => item.path.startsWith('github.com/polyspec/'))) {
      const provider = providerFor(work, consumer, 'go', requirement.path);
      // K869: a module that no declared checkout provides is the release, as a package of the other ecosystems is.
      if (provider === 'own') unlinkable(work, 'go', requirement.path, provider);
      else if (provider !== 'no provider') requires.set(requirement.path, provider);
    }
    // The modules of the tracked workspace that the go.work of this module uses besides its own module.
    const workspace = requires.size ? trackedWorkspaceFolders(go, consumer.top, directory, tracked).filter(folder => folder !== directory) : [];
    const folders = [...new Set([directory, ...workspace, ...[...requires.values()].map(provider => provider.folder)])];
    // K1212: each version at which a module that the go.work uses requires a provider module that it uses is replaced by the provider.
    const replaces = requires.size ? goReplaces(folders, requires, moduleOf) : [];
    if (work.check) {
      // K869: the go.work that link writes is the link of Go, so its use list is the state that the declaration is compared with:
      // the module, the modules of the tracked workspace and each declared provider that the module requires, no more and no fewer;
      // with none required, link writes no go.work.
      const written = existsSync(file) && !tracked.has(file) ? readGoWorkspace(go, file) : undefined;
      const used = written === undefined ? undefined : new Set(written.uses.map(item => real(item.folder) ?? item.folder));
      if (!requires.size) {
        if (used !== undefined) unlinkable(work, 'go', path.relative(consumer.top, file), 'a go.work that link wrote, though the link declaration names no provider that the module requires; Fix: make link');
        continue;
      }
      const named = [...[directory, ...workspace].map(folder => ({ name: moduleOf(path.join(folder, 'go.mod')).module, folder })), ...[...requires].map(([name, provider]) => ({ name, folder: provider.folder }))];
      const expected = new Map(named.map(item => [real(item.folder) ?? item.folder, item]));
      for (const [key, { name, folder }] of expected) {
        if (used?.has(key) === true) line(work, 'linked', 'go', `${name} -> ${folder} (${file})`);
        else unlinkable(work, 'go', name, `go.work of ${directory} does not use ${folder}; Fix: make link`);
      }
      for (const folder of used ?? []) if (!expected.has(folder)) unlinkable(work, 'go', folder, `go.work of ${directory} uses it, though the link declaration does not name it; Fix: make link`);
      // K1212: check recorded replacements; K1238 also accepts the exact source selected natively by a main workspace module.
      for (const item of written === undefined ? [] : replaces) {
        const actual = written?.replaces.find(candidate => replaced(candidate) === replaced(item));
        if (actual?.folder !== undefined && (real(actual.folder) ?? actual.folder) === (real(item.folder) ?? item.folder)) continue;
        if (actual === undefined) {
          // K1238: Go's workspace selection already supplies a main module; a replace is not its source identity.
          const selected: unknown = JSON.parse(run(go.command, ['list', '-m', '-json', item.module], { cwd: directory, env: { ...go.env, GOWORK: file } }));
          if (!isJsonObject(selected)) throw new Error(`${file}: go list -m -json printed no module object`);
          if (selected.Main === true && selected.Path === item.module) {
            const source = typeof selected.Dir === 'string' ? real(selected.Dir) : undefined;
            if (source !== undefined && source === (real(item.folder) ?? item.folder)) continue;
            unlinkable(work, 'go', item.module, `native workspace source ${typeof selected.Dir === 'string' ? selected.Dir : 'is missing'}, not ${item.folder}; Fix: make link`);
            continue;
          }
        }
        const state = actual === undefined ? 'does not replace it with' : `replaces it with ${actual.folder ?? 'a module version'}, not with`;
        unlinkable(work, 'go', `${item.module} ${item.version}`, `go.work of ${directory} ${state} ${item.folder}; Fix: make link`);
      }
      for (const item of written?.replaces ?? []) {
        if (!replaces.some(wanted => replaced(wanted) === replaced(item))) unlinkable(work, 'go', `${item.module} ${item.version}`.trim(), `go.work of ${directory} replaces it, though no module that it uses requires that version of a linked module; Fix: make link`);
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
    writeGoWorkspace(go, file, folders, replaces);
    for (const [name, provider] of requires) line(work, 'linked', 'go', `${name} -> ${provider.folder} (${file})`);
  }
}

// --- the commands.

/**
 * Links (or with `check`, reports) every polyspec package of each directory of `directories` that the main checkouts
 * `checkouts` provide; false when one is not linked. With `own` false the work tree of the checkout provides nothing either: with
 * no link declaration make link links nothing (K869), so the check of that release state demands no link of an own package (K935).
 */
export function link({ checkouts, directories, check, print, env = process.env, project = false, runtime, own = true }: { checkouts: readonly string[]; directories: readonly string[]; check: boolean; print: Print; env?: NodeJS.ProcessEnv; project?: boolean; runtime?: LinkRuntime; own?: boolean }): boolean {
  const consumers = directories.map(directory => consumerOf(directory, project));
  const ecosystems = runtime === undefined ? ALL_ECOSYSTEMS : RUNTIME_ECOSYSTEMS[runtime];
  const first = consumers[0];
  const go = ecosystems.includes('go') && first && first.manifests('go', true).length ? consumerTool(first.top, 'go', env) : undefined;
  const found = providers(checkouts, go, first?.top ?? process.cwd(), own ? first?.top : undefined);
  const work: Run = { found: new Map([...found].filter(([, provider]) => ecosystems.includes(provider.ecosystem))), check, print, failed: false, env, declared: new Set() };
  for (const consumer of consumers) {
    print(`== ${consumer.scope}`);
    if (ecosystems.some(ecosystem => ecosystem !== 'go')) {
      linkPackageFolders(work, consumer, ecosystems);
      undeclaredLinks(work, consumer, ecosystems);
    }
    if (ecosystems.includes('go')) linkGo(work, consumer);
  }
  return !work.failed;
}

// The tracked projects that the folder link leaves as they are: the tests and the fixtures (K447).
const UNLINKED = /(^|\/)(tests?|[^/]*fixtures?)\//;

// K1277: the Composer types of the PIE manifest of a PHP extension, which PIE installs from a Composer repository and no composer
// install installs, so its folder has no vendor.
const PIE_TYPES = new Set(['php-ext', 'php-ext-zend']);

type FolderEcosystem = 'npm' | 'composer' | 'python';

/**
 * K447: every tracked project of the consumer, a nested one below the root such as hyper's examples/board included, as link-check
 * reads them; a test, a fixture or the release consumer keeps the install that it tests, and a PIE manifest is no project (K1277).
 */
function linkedProjects(consumer: Consumer, ecosystems: readonly FolderEcosystem[]): string[] {
  const project = (ecosystem: FolderEcosystem, file: string) => !UNLINKED.test(path.relative(consumer.top, file)) && !(ecosystem === 'composer' && PIE_TYPES.has(String(readJsonObject(file).type)));
  return [...new Set([consumer.scope, ...ecosystems.flatMap(ecosystem => consumer.manifests(ecosystem, true).filter(file => project(ecosystem, file)).map(file => path.dirname(file)))])].sort();
}

/**
 * The environment of the Python project `project` of `top` (K890): that of its uv workspace (projectEnvironment), the one rule of the
 * link, its checks and the install, for a project that declares a polyspec package that `found` provides in Python, as uv names it.
 * Undefined otherwise, so a run with no such package runs no uv;
 * the answer of a project is kept for the run.
 */
export function pythonEnvironmentOf(top: string, project: string, found: ReadonlyMap<string, Provider>, env: NodeJS.ProcessEnv): string | undefined {
  const manifest = path.join(project, MANIFESTS.python);
  if (!existsSync(manifest) || !declaredPython(manifest).some(name => found.get(providerKey('python', name)) !== undefined)) return undefined;
  return environmentOf(top, project, env);
}

/** The environment of the uv workspace of the Python project `project` of `top`, found once for the run (projectEnvironment). */
function environmentOf(top: string, project: string, env: NodeJS.ProcessEnv): string | undefined {
  const key = `${top}\0${project}\0${env.UV_PROJECT_ENVIRONMENT ?? ''}`;
  if (!ENVIRONMENTS.has(key)) {
    const uv = consumerTool(top, 'uv', env);
    ENVIRONMENTS.set(key, projectEnvironment(project, uv.command, uv.env).venv);
  }
  return ENVIRONMENTS.get(key);
}

/** The environments that pythonEnvironmentOf found, by checkout, project and UV_PROJECT_ENVIRONMENT. */
const ENVIRONMENTS = new Map<string, string>();

/** The environment of the Python project `project` of the run (pythonEnvironmentOf); undefined without Python among `ecosystems`. */
function pythonVenv(work: Run, consumer: Consumer, project: string, ecosystems: readonly FolderEcosystem[]): string | undefined {
  return ecosystems.includes('python') ? pythonEnvironmentOf(consumer.top, project, work.found, work.env) : undefined;
}

/**
 * K1213: the providers of the run as `project` takes them (decideProviders): a name that two folders give is decided by the project, or
 * fails with both when the project holds the package installed and nothing decides. A Composer path member holds no vendor of its own,
 * so its Composer packages are those of its owner (K590, ownerFolders).
 */
function projectProviders(work: Run, consumer: Consumer, project: string, ecosystems: readonly FolderEcosystem[]): Provider[] {
  const owned = ecosystems.includes('composer') && owners(consumer, project, 'composer').length > 0;
  const taken = [...work.found.values()].filter(provider => provider.ecosystem !== 'composer' || !owned);
  return decideProviders(project, taken, { vendorDir: owned ? undefined : composerVendorDir(project, work.env), environment: pythonVenv(work, consumer, project, ecosystems) });
}

/** The installed folders of `project` that a provider of the run provides; a path member uses its parent installer's vendor (K590). */
function projectFolders(work: Run, consumer: Consumer, project: string, ecosystems: readonly FolderEcosystem[]): ProvidedFolder[] {
  const owned = ecosystems.includes('composer') && owners(consumer, project, 'composer').length > 0;
  return providedFolders(project, projectProviders(work, consumer, project, ecosystems), { vendorDir: owned ? undefined : composerVendorDir(project, work.env), environment: pythonVenv(work, consumer, project, ecosystems) });
}

/**
 * K888: the provided packages that the tracked projects of `directory` declare and that no installed folder holds, each as a finding
 * of link-check: link leaves out a project whose installer has not run yet, so a project that make install never installed is
 * reported here. With `project`, only that project is judged, as link judges it (K975).
 */
export function declaredUnlinked(directory: string, found: Map<string, Provider>, env: NodeJS.ProcessEnv, project = false): string[] {
  const consumer = consumerOf(directory, project);
  const work: Run = { found, check: true, print: () => {}, failed: false, env, declared: new Set() };
  const ecosystems: FolderEcosystem[] = ['npm', 'composer', 'python'];
  return linkedProjects(consumer, ecosystems).flatMap((project) => {
    const folders = [...projectFolders(work, consumer, project, ecosystems), ...ownerFolders(work, consumer, project, ecosystems)];
    return declaredWithoutFolder(work, consumer, project, folders, ecosystems, true)
      .map(({ ecosystem, name }) => `${ecosystem} ${name}: no installed folder of ${path.relative(consumer.top, project) || '.'} links it; Fix: make install`);
  });
}

/**
 * K1181, K1183: the linked Composer packages of the tracked projects of `directory` whose autoload in Composer's record differs from
 * their provider, each as a finding of link-check with its own fix: make link does not change a record that the install wrote. With
 * `project`, only that project is judged (K975).
 */
export function autoloadRecordFindings(directory: string, found: Map<string, Provider>, env: NodeJS.ProcessEnv, project = false): string[] {
  const consumer = consumerOf(directory, project);
  const work: Run = { found, check: true, print: () => {}, failed: false, env, declared: new Set() };
  const ecosystems: FolderEcosystem[] = ['composer'];
  return [...new Set(linkedProjects(consumer, ecosystems).flatMap(item => composerRecordFindings(consumer.top, [...projectFolders(work, consumer, item, ecosystems), ...ownerFolders(work, consumer, item, ecosystems)])))];
}

/** K1230: native installed local sources of each selected project, independent of .links providers. */
export function nativeSourceFindings(directory: string, env: NodeJS.ProcessEnv, project = false): string[] {
  const consumer = consumerOf(directory, project);
  return linkedProjects(consumer, ['npm', 'composer', 'python']).flatMap(item => nativeLocalSourceFindings(item, env, () => environmentOf(consumer.top, item, env)));
}

/** The vendor folder that the composer.json of `project` names in config.vendor-dir, read from the file, else vendor. */

/**
 * K448: the link of the installed package folders of the consumer. Each folder of a project of the consumer (each folder of a tracked
 * package.json, composer.json or pyproject.toml, and the top) whose installed polyspec package a provider of the run provides becomes a
 * native source connection; with `check`, each folder that is a copy or links elsewhere is reported.
 * Native installation runs before inspecting folders so a newly declared provider can be installed.
 */
function linkPackageFolders(work: Run, consumer: Consumer, ecosystems: readonly Ecosystem[]) {
  const folderEcosystems = ecosystems.filter((ecosystem): ecosystem is FolderEcosystem => ecosystem !== 'go');
  if (folderEcosystems.length === 0) return;
  for (const project of linkedProjects(consumer, folderEcosystems)) {
    const pythonManifest = path.join(project, 'pyproject.toml');
    if (folderEcosystems.includes('python') && !work.check && existsSync(pythonManifest) && declaredPython(pythonManifest).length > 0) {
      const uv = consumerTool(consumer.top, 'uv', work.env);
      uvLink({ directory: project, providers: projectProviders(work, consumer, project, folderEcosystems), uv: uv.command, env: uv.env, print: work.print });
    }
    const folders = projectFolders(work, consumer, project, folderEcosystems);
    for (const item of folders) work.declared.add(item.folder);
    // K761, K765: each installed npm, Composer and Python folder of a provided package is one plain directory symlink to its checkout;
    // no package manager re-resolves the consumer. A declared package with no installed folder is reported below (K529).
    if (!work.check) for (const text of linkFolders(folders)) work.print(text);
    // K529: a polyspec package that the manifests of an installed project declare, and that a provider of the run provides, has an
    // installed folder; a project whose installer has not run yet is left out (K888).
    const missing = declaredWithoutFolder(work, consumer, project, [...folders, ...ownerFolders(work, consumer, project, folderEcosystems)], folderEcosystems, false);
    for (const name of missing) line(work, 'NOT linked', name.ecosystem, `${name.name}: no installed folder in ${path.relative(consumer.top, project) || '.'}; install the project first`);
    if (missing.length > 0) work.failed = true;
    if (work.check) {
      const findings = [...folderFindings(consumer.top, folders), ...providerDependencyFindings(consumer.top, folders, projectProviders(work, consumer, project, folderEcosystems))];
      for (const finding of findings) line(work, 'NOT linked', finding.split(' ')[0] ?? '', finding.slice(finding.indexOf(' ') + 1));
      if (findings.length > 0) work.failed = true;
      continue;
    }
    for (const item of folders) {
      if (item.manager === undefined) {
        line(work, 'linked', item.ecosystem, `${item.name} -> ${item.target}`);
        continue;
      }
      // K1234: a retained native installation can come from a different source than the provider.
      const installed = item.ecosystem === 'python' ? item.target : item.folder;
      const target = real(installed);
      const linked = item.ecosystem === 'python' || lstatSync(item.folder).isSymbolicLink();
      const location = target === undefined ? `at ${installed} (native source unresolved)` : `${linked ? '->' : 'at'} ${target}`;
      line(work, 'retained', item.ecosystem, `${item.name} ${location}`);
    }
  }
}

/**
 * K869: the links of the install folders of the consumer that no provider of the link declaration gives, as a link from an earlier
 * declaration: link removes each, so the state is the declaration, and the check reports each.
 */
function undeclaredLinks(work: Run, consumer: Consumer, ecosystems: readonly Ecosystem[]) {
  for (const entry of outsideLinks(consumer, work.env, ecosystems).filter(item => !work.declared.has(item))) {
    // K1187: a link that the package manager made from a local path of the consumer's manifest is its result, never kit's.
    if (managerLink(entry) !== undefined) {
      for (const finding of work.check ? managerLinkFindings(consumer.top, entry) : []) {
        line(work, 'NOT linked', finding.split(' ')[0] ?? '', finding.slice(finding.indexOf(' ') + 1));
        work.failed = true;
      }
      continue;
    }
    if (work.check) {
      line(work, 'NOT linked', 'link', `${entry}: a link that the link declaration (${LINKS_FILE}) does not name; Fix: make link`);
      work.failed = true;
    } else {
      rmSync(entry);
      line(work, 'unlinked', 'link', `${entry}: the link declaration (${LINKS_FILE}) does not name it`);
    }
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

/**
 * Whether the installer of `ecosystem` has run for `project` (K888): node_modules of the npm project or of an owner above it, the vendor
 * folder of the Composer project or of its path owner, the environment of the Python project.
 */
function installed(work: Run, consumer: Consumer, project: string, ecosystem: Ecosystem): boolean {
  if (ecosystem === 'python') {
    const venv = pythonVenv(work, consumer, project, ['python']);
    return venv !== undefined && existsSync(path.join(venv, 'pyvenv.cfg'));
  }
  if (ecosystem !== 'npm' && ecosystem !== 'composer') return true;
  return [project, ...owners(consumer, project, ecosystem)].some(folder => existsSync(ecosystem === 'npm' ? path.join(folder, 'node_modules') : path.resolve(folder, composerVendorDir(folder, work.env) ?? 'vendor')));
}

/** The installed folders of `ecosystem` that the owners of the workspace member `project` hold for it (K590). */
function ownerFolders(work: Run, consumer: Consumer, project: string, ecosystems: readonly FolderEcosystem[]): ProvidedFolder[] {
  return (['npm', 'composer'] as const).filter(ecosystem => ecosystems.includes(ecosystem)).flatMap(ecosystem => owners(consumer, project, ecosystem).flatMap((owner) => {
    // K1213: the owner holds the installed folder, so the owner decides a name that two folders give.
    const vendorDir = composerVendorDir(owner, work.env);
    const taken = decideProviders(owner, [...work.found.values()].filter(provider => provider.ecosystem === ecosystem), { vendorDir });
    return providedFolders(owner, taken, { vendorDir });
  }));
}

/**
 * The provided packages that the manifests of `project` declare and that have no installed folder among `folders` (K529): a declared
 * polyspec package with no folder is a finding, never a silent pass. A python member is installed as its package paths, so it is
 * installed when one of its folders is there.
 */
function declaredWithoutFolder(work: Run, consumer: Consumer, project: string, folders: readonly ProvidedFolder[], ecosystems: readonly FolderEcosystem[], uninstalled: boolean): { ecosystem: Ecosystem; name: string }[] {
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
    if (ecosystem === 'python' && ![provider, ...(provider.rivals ?? [])].some(hasPythonPackages)) return false;
    // K888: a project whose installer has not run yet has no folder to link; link-check reports it once make install has run.
    if (!uninstalled && !installed(work, consumer, project, ecosystem)) return false;
    // K1280: a provided folder counts only when it exists: an installed distribution whose package folder a removed link left missing
    // is in `folders` and holds no folder.
    return !folders.some(folder => folder.ecosystem === ecosystem && present(folder.folder) && (folder.name === name || folder.name.startsWith(`${name} `)));
  });
}

/**
 * Removes the links of each directory (K856): the npm and Composer folders that are links out of the checkout, the package links of
 * each Python environment and the files that link wrote. It installs nothing; make install restores the locked installs.
 */
export function unlink({ directories, print, env = process.env, project = false, runtime }: { directories: readonly string[]; print: Print; env?: NodeJS.ProcessEnv; project?: boolean; runtime?: LinkRuntime }): boolean {
  // K983: a runtime selects the links that are removed, as it selects those that link writes, so a job of one runtime starts no
  // package manager of another, as uv for the environment of a Python project.
  const ecosystems = runtime === undefined ? ALL_ECOSYSTEMS : RUNTIME_ECOSYSTEMS[runtime];
  for (const consumer of directories.map(directory => consumerOf(directory, project))) {
    print(`== ${consumer.scope}`);
    for (const entry of outsideLinks(consumer, env, ecosystems).filter(item => managerLink(item) === undefined)) {
      rmSync(entry);
      print(`  unlinked   ${entry}`);
    }
    removeWritten(consumer, runtime);
  }
  return true;
}

/**
 * The links of the install folders of the consumer that resolve out of its checkout, or dangle (K856, K869): each package
 * <folder>/<name> or <folder>/<scope>/<name> of each node_modules and Composer vendor folder, and the package links of each Python
 * environment of a project that declares a polyspec package. A link of a workspace package of the consumer resolves inside it.
 */
function outsideLinks(consumer: Consumer, env: NodeJS.ProcessEnv, ecosystems: readonly Ecosystem[] = ALL_ECOSYSTEMS): string[] {
  const own = realpathSync(consumer.top);
  const outside = (entry: string) => !existsSync(entry) || !realpathSync(entry).startsWith(`${own}${path.sep}`);
  const npmFolders = ecosystems.includes('npm') ? consumer.manifests('npm').map(file => path.join(path.dirname(file), 'node_modules')) : [];
  // The vendor folder that composer.json names, read without Composer.
  const composerFolders = ecosystems.includes('composer') ? consumer.manifests('composer').map(file => path.resolve(path.dirname(file), composerVendorDir(path.dirname(file), env) ?? 'vendor')) : [];
  const entries = (folder: string) => (existsSync(folder) ? readdirSync(folder) : []).filter(name => !name.startsWith('.')).map(name => path.join(folder, name));
  // The package folders: an npm name or an @scope and a name, a Composer vendor and a name; the bin folders hold the links of the
  // package managers.
  const npmPackages = (folder: string) => entries(folder).flatMap(item => (path.basename(item).startsWith('@') && lstatSync(item).isDirectory() ? entries(item) : [item]));
  const composerPackages = (folder: string) => entries(folder).filter(item => !['bin', 'composer'].includes(path.basename(item)) && lstatSync(item).isDirectory()).flatMap(entries);
  // A package folder that links out of the checkout is kit's (K869); the links of the consumer's own workspace point into the checkout.
  const found = [...npmFolders.flatMap(npmPackages), ...composerFolders.flatMap(composerPackages)]
    .filter(entry => lstatSync(entry).isSymbolicLink() && outside(entry));
  const pythonFiles = ecosystems.includes('python') ? consumer.manifests('python').filter(file => declaredPython(file).length) : [];
  for (const file of pythonFiles) {
    const venv = environmentOf(consumer.top, path.dirname(file), env);
    if (venv !== undefined) found.push(...environmentLinks(path.dirname(file), venv));
  }
  return [...new Set(found)];
}

/**
 * The links of the install folders of the checkout at `root` that resolve out of it, or dangle (K939): the release refuses them, since
 * a pack reads the dependencies of the checkout and a link would bring in another tree. Nothing is changed.
 */
export function linksOutsideCheckout(root: string, env: NodeJS.ProcessEnv): string[] {
  return outsideLinks(consumerOf(root), env);
}

/**
 * Removes the files that link wrote for the consumer: the go.work and go.work.sum of each of its Go modules, the overrides
 * file of each environment and the Cargo lock copy of each workspace, each by its exact name, then each folder of var/link
 * that the removal leaves empty. Never a folder recursively: a nested project's files and folders stay (K201-3).
 */
function removeWritten(consumer: Consumer, runtime?: LinkRuntime) {
  const base = path.join(consumer.top, 'var/link');
  const written: string[] = [];
  // A go.work that the repository tracks is its own, never one that link wrote.
  const tracked = new Set(trackedManifests(consumer.top, ['go.work', 'go.work.sum']).map(file => path.join(consumer.top, file)));
  for (const module of runtime === undefined || runtime === 'go' ? consumer.manifests('go', true) : []) {
    const file = goWorkOf(path.dirname(module));
    written.push(...[file, `${file}.sum`].filter(item => !tracked.has(item)));
  }
  const cargo = path.join(base, 'cargo');
  for (const entry of (runtime === undefined || runtime === 'rust') && existsSync(cargo) ? readdirSync(cargo, { withFileTypes: true }) : []) {
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
 * their packages, and the lock of the tree is copied to var/link, so the patches resolve against it. Native arguments and the
 * environment, CARGO_TARGET_DIR among them, remain unchanged (K1049). With `trackedLock` the command runs as given, with no patch
 * and no copy, so it reads and writes the tracked lock from the sources that the manifests name (K1287).
 */
export function cargo({ directory, args, checkouts = [], env = process.env, runner = 'cargo', trackedLock = false }: { directory: string; args: readonly string[]; checkouts?: readonly string[]; env?: NodeJS.ProcessEnv; runner?: 'cargo' | 'maturin'; trackedLock?: boolean }): number {
  const consumer = consumerOf(directory);
  const tool = consumerTool(consumer.top, 'cargo', env);
  // K1266: maturin runs cargo itself, so the options of the link reach that cargo only as maturin's own --config options (maturin
  // 1.16 `build --help`: --config <KEY=VALUE>); the workspace and the graph are still read with cargo. kit installs no maturin into
  // the checkout, so the checkout's maturin is MATURIN, never a maturin of PATH.
  const command = runner === 'maturin' ? env.MATURIN : tool.command;
  if (!command) throw new Error("link.mjs maturin needs MATURIN, the checkout's maturin");
  const channel = runner === 'cargo' && args[0]?.startsWith('+') ? [args[0]] : [];
  const commandArgs = channel.length ? args.slice(1) : args;
  const graphArgs = cargoMetadataArguments(args);
  const manifestArgs = graphArgs.flatMap((arg, index) => arg.startsWith('--manifest-path=') ? [arg] : arg === '--manifest-path' ? [arg, graphArgs[index + 1] ?? ''] : []);
  const config: string[] = [];
  let held: ReturnType<typeof acquireHolderLock> | undefined;
  const expected = new Map<string, string>();
  const patched: string[] = [];
  try {
    // K1270: cargo fmt takes no --config and formats only the files of the workspace's own crates, which no patch changes.
    if (!trackedLock && checkouts.length && !(runner === 'cargo' && commandArgs[0] === 'fmt')) {
      const workspace = path.dirname(run(tool.command, [...channel, 'locate-project', '--workspace', '--message-format', 'plain', ...manifestArgs], { cwd: consumer.scope, env: tool.env }).trim());
      held = acquireHolderLock(path.join(consumer.top, 'var/link/cargo', path.relative(consumer.top, workspace).replaceAll('/', '_') || 'root', 'execution.lock'), { checkout: consumer.top, command: ['cargo', ...args].join(' ') });
      // A fresh copy of the tracked lock on every run, so the patches resolve against the lock of the tree.
      const copy = linkFile(consumer.top, path.join('cargo', path.relative(consumer.top, workspace).replaceAll('/', '_') || 'root', 'Cargo.lock'));
      mkdirSync(path.dirname(copy), { recursive: true });
      copyFileSync(path.join(workspace, 'Cargo.lock'), copy);
      config.push('--config', `resolver.lockfile-path=${JSON.stringify(copy)}`);
      const packages = readTomlFile(copy).package;
      const entries = (Array.isArray(packages) ? packages : []).flatMap((item: unknown) => isJsonObject(item) && typeof item.name === 'string' ? [{ name: item.name, version: typeof item.version === 'string' ? item.version : undefined }] : []);
      const locked = new Set(entries.map(entry => entry.name));
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
          // K1273: each version of the crate in the lock copy, since a bare name is ambiguous when two tags pull in two versions.
          for (const entry of entries.filter(item => item.name === crate.name)) patched.push(entry.version === undefined ? crate.name : `${crate.name}@${entry.version}`);
        }
      }
    }
    // K1269: the copy names the versions of the tags, and a linked crate of another version is an unused patch that --locked cannot
    // update; so cargo updates the copy offline for each patched crate with the same patches, and the tracked lock stays as it is.
    if (patched.length) run(tool.command, [...channel, 'update', ...config, '--offline', ...patched.flatMap(name => ['-p', name]), ...manifestArgs], { cwd: directory, env: tool.env });
    // This validates the resolved workspace, including packages outside a caller's -p execution scope.
    if (checkouts.length && expected.size) {
      const metadata = run(tool.command, [...channel, ...config, 'metadata', '--format-version=1', ...graphArgs], { cwd: directory, env: tool.env });
      verifyCargoSources(metadata, expected);
    }
    // The configuration follows the subcommand (K802): cargo passes a --config before it to no external subcommand, and cargo clippy runs
    // cargo again, which would resolve the git tag of the lock instead of the sibling.
    const [subcommand, ...options] = commandArgs;
    // K1283: the streams pass through as cargo writes them, so `Running <target>` on stderr stays before the lines of its tests.
    const outcome = executeInherited(command, [...channel, ...(subcommand === undefined ? [] : [subcommand]), ...config, ...options], { cwd: directory, env: tool.env });
    if (outcome.error) throw new Error(`${command} could not start: ${outcome.error.message}`);
    const status = outcome.status ?? 1;
    // K1287: no patch reaches this cargo, so no path of a linked checkout enters the tracked lock, and what only such a checkout
    // provides fails in cargo; the line states that cause after the error of cargo.
    if (trackedLock && checkouts.length && status !== 0) process.stderr.write(`link.mjs cargo --tracked-lock: cargo exited ${status} without the patches of ${LINKS_FILE}: a crate or a version that only a linked checkout provides is not in the sources that the manifests name until it is released\n`);
    return status;
  } finally {
    held?.release();
  }
}

if (isMain(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const print: Print = text => process.stdout.write(`${text}\n`);
  try {
    // `--project <dir>` names the consumer (K201, S-426); the other arguments are the checkouts that provide the packages.
    const project = rest.indexOf('--project');
    const projectDirectory = project === -1 ? undefined : rest[project + 1];
    if (project !== -1 && !projectDirectory) throw new Error('Usage: link.mjs ... --project <dir>');
    const runtimeIndex = command === 'link' || command === 'unlink' ? rest.indexOf('--runtime') : -1;
    const runtimeValue = runtimeIndex === -1 ? undefined : rest[runtimeIndex + 1];
    let runtime: LinkRuntime | undefined;
    if (runtimeIndex !== -1) {
      if (runtimeValue === undefined || !isLinkRuntime(runtimeValue)) {
        throw new Error(`unknown or missing runtime ${runtimeValue ?? ''}; choose go, php, php-ext, python, rust or ts`);
      }
      runtime = runtimeValue;
    }
    const withoutOptions = rest.filter((word, index) => (project === -1 || (index !== project && index !== project + 1)) && (runtimeIndex === -1 || (index !== runtimeIndex && index !== runtimeIndex + 1)));
    const directories = [projectDirectory ?? '.'];
    switch (command) {
      case 'link': {
        // K869: the link declaration of the checkout names the providers; with no file nothing is linked, the release state.
        if (withoutOptions.length) throw new Error(`link takes no checkout: ${LINKS_FILE} of the checkout declares them`);
        // With no file the checkout is in its release state: link removes the links that an earlier declaration made, as unlink does.
        const checkouts = declaredCheckouts(projectDirectory ?? '.');
        if (checkouts === undefined) {
          if (!unlink({ directories, print, project: projectDirectory !== undefined, ...(runtime === undefined ? {} : { runtime }) })) process.exitCode = 1;
          print(`no ${LINKS_FILE} in ${workTreeOf(projectDirectory ?? '.')}: nothing is linked; make install restores a released package whose link was removed`);
        } else if (!link({ checkouts, directories, check: false, print, project: projectDirectory !== undefined, ...(runtime === undefined ? {} : { runtime }) })) process.exitCode = 1;
        break;
      }
      case 'unlink':
        if (withoutOptions.length) throw new Error(`unlink takes no argument but --project and --runtime: ${rest.join(' ')}`);
        if (!unlink({ directories, print, project: projectDirectory !== undefined, ...(runtime === undefined ? {} : { runtime }) })) process.exitCode = 1;
        break;
      case 'providers': {
        // The providers of one ecosystem, npm unless --ecosystem names another, one line each: the name, a tab and the package folder,
        // sorted by name. They are read by the rules of link (the excluded paths, a package folder before its root, one provider per
        // name), so a consumer takes the folder of each polyspec package from the kit (K462). The checkouts are the arguments, or with
        // none the link declaration of the checkout of this folder, which with no file declares none (K1008).
        const flag = rest.indexOf('--ecosystem');
        const ecosystem = flag < 0 ? 'npm' : rest[flag + 1];
        if (ecosystem === undefined || !Object.hasOwn(MANIFESTS, ecosystem)) throw new Error('Usage: link.mjs providers [--ecosystem npm|composer|python|go] [<checkout>...]');
        const named = flag < 0 ? rest : rest.filter((_, index) => index !== flag && index !== flag + 1);
        const checkouts = named.length ? named : declaredCheckouts(process.cwd()) ?? [];
        const go = ecosystem === 'go' ? consumerTool(process.cwd(), 'go', process.env) : undefined;
        // K1213: a name of this ecosystem that two folders give fails with both; a name of another ecosystem is not judged.
        const found = [...providers(checkouts, go, process.cwd()).values()].filter(provider => provider.ecosystem === ecosystem).map(soleProvider);
        for (const provider of found.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) print(`${provider.name}\t${provider.folder}`);
        break;
      }
      case 'cargo': {
        // K869: the providers are those of the link declaration of the project; with no file cargo runs as given.
        // K1287: --tracked-lock before the directory runs cargo as given under a declaration too, so the command writes the tracked lock.
        const trackedLock = rest[0] === '--tracked-lock';
        const [directory, ...args] = trackedLock ? rest.slice(1) : rest;
        if (!directory) throw new Error('Usage: link.mjs cargo [--tracked-lock] <dir> <cargo args>...');
        process.exitCode = cargo({ directory, args, checkouts: declaredCheckouts(directory) ?? [], trackedLock });
        break;
      }
      case 'maturin': {
        // K1266: the link of `cargo` for the cargo that maturin runs; with no file maturin runs as given.
        const [directory, ...args] = rest;
        if (!directory) throw new Error('Usage: link.mjs maturin <dir> <maturin args>...');
        process.exitCode = cargo({ directory, args, checkouts: declaredCheckouts(directory) ?? [], runner: 'maturin' });
        break;
      }
      default: throw new Error('Usage: link.mjs link [--project <dir>] [--runtime <runtime>] | unlink [--project <dir>] | providers [--ecosystem npm|composer|python|go] [<checkout>...] | cargo [--tracked-lock] <dir> <args>... | maturin <dir> <args>...');
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
