// The local links of 0.0.x development (docs/operations/local-links.md, K201, K205). The checkouts that the arguments name are the
// providers (link-providers.mts): each installed polyspec package of a consumer that is pinned at 0.0.x is pointed at the
// source of the checkout that provides it. link only links; it never builds (link-build.mts rebuilds):
//   npm       each copy that `npm query` lists below node_modules becomes a link to the provider's package folder;
//   Composer  Composer installs the linked packages itself (K304-1): a git-ignored composer.link.json with a path repository
//             (symlink) per provider folder in front of the repositories, a copy of the lock, and a partial composer update of
//             the polyspec packages and the path packages of the project, so the record, the autoload rules and the platform
//             check come from the composer.json of each folder;
//   Python    each declared polyspec package and each polyspec package below it is installed from an editable wheel that link
//             writes into var/link/python (K398): the metadata of its pyproject.toml and a .pth of its import root, no source, so
//             the folder is only read; the consumer's own project is installed from the same editable wheel (K224);
//             there is no sync (K239);
//   Go        each go.mod of the consumer gets a git-ignored go.work that uses its module and the provider modules, which
//             go reads by itself; unlink removes it;
//   Rust      `cargo <dir> <args>` runs one cargo command with --config patches and a lock copy under var/link/cargo.
// No environment variable declares anything: without checkouts nothing is linked, and the installs stay the locked releases.
// A consumer is a directory: the top of a work tree stands for every tracked manifest of it, another directory for those
// below it; with --project the folder is the consumer and its own manifest is read, tracked or not (K212). Each file that link writes into the consumer is one that Git ignores there (var/link, and each go.work).
//   node link.mjs link|check [--project <dir>] [--siblings] <checkout>... | unlink [--project <dir>] | rebuild <repository>... |
//                 packages <dir> python|npm | cargo [--checkout <checkout>]... <dir> <args>...
// --project limits link, check and unlink to the manifests directly in <dir>, never a nested project (S-426), and fails when
// <dir> holds none (K212); without it the whole tree of the working directory is the consumer.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { isJsonObject, readJsonObject, writeAtomic } from './bootstrap/files.mts';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { buildState, rebuild } from './link-build.mts';
import {
  assertIgnored, type Ecosystem, EXCLUDED, goModule, isForkCheckout, mainCheckouts, MANIFESTS, type Provider,
  providerKey, providers, readTomlFile, repositoryOf, siblingCheckouts, type Tool, trackedManifests, workTreeOf,
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

/** The JSON that a command prints, an error naming the command when it is malformed. */
function parseOutput(text: string, what: string): unknown {
  try { return JSON.parse(text) as unknown; } catch (error) {
    throw new Error(`${what} printed no valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
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
// A fork's pin is a version of the fork (K379), which the install records and checks, so the rule does not apply to a fork.
const pinProblem = (version: string, provider: Provider): string | undefined => (isForkCheckout(provider.checkout) || ZERO.test(version) ? undefined : `pinned ${version}, not 0.0.x`);

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
  const problem = pinProblem(version, provider);
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
export function installedPackages(record: string): Record<string, unknown>[] {
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

/** The names of the Composer packages that the project's own path repositories provide, never its root package. */
function ownPathPackages(project: string): string[] {
  const root = readComposerManifestFile(path.join(project, MANIFESTS.composer)).name;
  return [...ownComposer(project)].filter(name => name !== root);
}

/** The lines of the Git exclude file of the work tree `top` that keep the Composer link files out of Git without a tracked change. */
const COMPOSER_LINK_FILES = ['composer.link.json', 'composer.link.lock'] as const;

/** Adds the Composer link files to .git/info/exclude of the repository of `top` (the common Git directory, so a worktree shares it). */
function excludeComposerLinkFiles(top: string) {
  const file = path.join(repositoryOf(top), 'info/exclude');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const missing = COMPOSER_LINK_FILES.filter(name => !text.split('\n').includes(name));
  if (missing.length === 0) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`);
}

/** The released version of every package of composer.lock `lock`, by name. */
function lockedVersions(lock: string): Map<string, string> {
  const parsed = readJsonOf(lock);
  const found = new Map<string, string>();
  if (!isJsonObject(parsed)) return found;
  for (const list of [parsed.packages, parsed['packages-dev']]) {
    for (const item of Array.isArray(list) ? list : []) if (isJsonObject(item) && typeof item.name === 'string' && typeof item.version === 'string') found.set(item.name, item.version);
  }
  return found;
}

/** The polyspec packages that the composer.lock of `project` holds, by name; none without a lock. */
function lockedPolyspec(project: string): string[] {
  const lock = path.join(project, 'composer.lock');
  return existsSync(lock) ? [...lockedVersions(lock).keys()].filter(name => name.startsWith('polyspec/')) : [];
}

/**
 * The composer.json of the link run of `project` (K304-1): the tracked one with a path repository for each linked folder in front
 * of its repositories, so the folder, not a released archive, provides the package. `symlink` makes the installed folder a
 * symbolic link, and `versions` gives the package the version that the lock recorded, so the link counts as the installed
 * released version.
 */
/** The items of a list that a manifest declares, else none. */
function declaredList(value: unknown): unknown[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  return list;
}

function linkManifest(project: string, links: readonly { name: string; folder: string; fork?: boolean }[], versions: ReadonlyMap<string, string>): Record<string, unknown> {
  const manifest = readJsonOf(path.join(project, MANIFESTS.composer));
  if (!isJsonObject(manifest)) throw new Error(`${project}/${MANIFESTS.composer} is no object`);
  // The version of a linked package is the release that the lock recorded, else the exact release that the project requires, so
  // Composer takes the folder for the release and prefers no archive of the same version (K304-2).
  const required = { ...(isJsonObject(manifest.require) ? manifest.require : {}), ...(isJsonObject(manifest['require-dev']) ? manifest['require-dev'] : {}) };
  // K379-1: a fork provides the version that the consumer pins (2.6.0-p1), written as its tag (v2.6.0-p1), not the release that the lock
  // recorded before the pin: a stale version there makes Composer refuse the fork in the partial update.
  // K379-2: the exact pin of a fork is the one that the consumer or a linked provider requires (require and require-dev); two different
  // pins fail the link, naming both.
  const exact = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
  const pins = new Map<string, Set<string>>();
  const addPins = (source: Record<string, unknown>) => {
    for (const block of ['require', 'require-dev'] as const) {
      const requirements = isJsonObject(source[block]) ? source[block] : {};
      for (const [name, pin] of Object.entries(requirements)) {
        if (typeof pin !== 'string' || !exact.test(pin)) continue;
        pins.set(name, (pins.get(name) ?? new Set<string>()).add(pin));
      }
    }
  };
  addPins(manifest);
  for (const link of links) {
    const providerManifest: unknown = existsSync(path.join(link.folder, MANIFESTS.composer)) ? readJsonOf(path.join(link.folder, MANIFESTS.composer)) : undefined;
    if (isJsonObject(providerManifest)) addPins(providerManifest);
  }
  const versionOf = (name: string, fork: boolean): string | undefined => {
    const pin = required[name];
    const found = [...(pins.get(name) ?? [])];
    if (fork && found.length > 1) throw new Error(`${name} is pinned at ${found.join(' and ')}, by the consumer and its linked providers, so the link cannot choose one (K379-2)`);
    const [only] = found;
    if (fork && only !== undefined && found.length === 1) return `v${only.replace(/^v/, '')}`;
    return versions.get(name) ?? (typeof pin === 'string' && /^v?\d+\.\d+\.\d+$/.test(pin) ? pin : undefined);
  };
  const paths = links.map(({ name, folder, fork }) => ({ type: 'path', url: folder, options: { symlink: true, ...(versionOf(name, fork === true) === undefined ? {} : { versions: { [name]: versionOf(name, fork === true) } }) } }));
  const existing = manifest.repositories;
  // Composer reads repositories only from the root manifest (K330): the repositories that a linked package declares, such as the
  // fork that it requires, are written into the link manifest too, so the link resolves them.
  const key = (entry: unknown) => JSON.stringify(entry);
  const present = new Set((Array.isArray(existing) ? existing : isJsonObject(existing) ? Object.values(existing) : []).map(key));
  const provided: unknown[] = [];
  for (const { folder } of links) {
    const provider = readJsonOf(path.join(folder, MANIFESTS.composer));
    const declared = isJsonObject(provider) ? provider.repositories : undefined;
    for (const entry of Array.isArray(declared) ? declared : isJsonObject(declared) ? Object.values(declared) : []) {
      if (isJsonObject(entry) && entry.type !== 'path' && !present.has(key(entry))) { present.add(key(entry)); provided.push(entry); }
    }
  }
  const added = [...paths, ...provided];
  const repositories = isJsonObject(existing) ? { ...Object.fromEntries(added.map((entry, index) => [`polyspec-link-${index}`, entry])), ...existing } : [...added, ...declaredList(existing)];
  return { ...manifest, repositories };
}

/**
 * K392-3: writes the link files that a linked project lacks, as the link run writes them: the manifest of its linked folders
 * (linkManifest), and the link lock as a copy of the tracked lock. A file that exists is kept. Without a tracked lock nothing is
 * written, and the project is reported NOT linked.
 */
function writeMissingLinkFiles(work: Run, top: string, project: string, linked: { name: string; folder: string }[], lock: string) {
  const missing = COMPOSER_LINK_FILES.filter(name => !existsSync(path.join(project, name)));
  const [first] = linked;
  if (missing.length === 0 || first === undefined) return;
  if (!existsSync(lock)) { unlinkable(work, 'composer', first.name, `no composer.lock in ${project}`); return; }
  excludeComposerLinkFiles(top);
  if (missing.includes(COMPOSER_LINK_FILES[0])) writeAtomic(path.join(project, COMPOSER_LINK_FILES[0]), `${JSON.stringify(linkManifest(project, linked, lockedVersions(lock)), null, 4)}\n`);
  if (missing.includes(COMPOSER_LINK_FILES[1])) copyFileSync(lock, path.join(project, COMPOSER_LINK_FILES[1]));
}

/**
 * The partial update of the Composer project `project` from its link files (K304-1): composer.link.json, the link manifest of the
 * folders `links` (name and folder), and composer.link.lock, the copy of the tracked lock that is written only while it is missing.
 * Composer runs with COMPOSER=composer.link.json and updates the `targets`, so the tracked composer.json and composer.lock stay.
 */
function updateLinkedComposer(composer: Tool, top: string, project: string, links: readonly { name: string; folder: string }[], targets: readonly string[]) {
  const lock = path.join(project, 'composer.lock');
  excludeComposerLinkFiles(top);
  writeAtomic(path.join(project, COMPOSER_LINK_FILES[0]), `${JSON.stringify(linkManifest(project, links, lockedVersions(lock)), null, 4)}\n`);
  // The link lock is written from the tracked lock only when it is missing, and kept afterwards (K392): what `dependency-review UPDATE=1`
  // applied to it stays, and the partial update changes only the linked packages there; the packages that it does not link keep their
  // versions. A tracked lock that gained a package is not copied over it: remove the link lock to take the tracked lock again.
  if (!existsSync(path.join(project, COMPOSER_LINK_FILES[1]))) copyFileSync(lock, path.join(project, COMPOSER_LINK_FILES[1]));
  run(composer.command, ['update', ...targets, '--with-dependencies', '--no-scripts', '--no-plugins', '--no-interaction', '--working-dir', project], { env: { ...composer.env, COMPOSER: COMPOSER_LINK_FILES[0] } });
}

/**
 * Installs the Composer project of `directory` through the links (K432) when the sibling `checkouts` provide a polyspec package that its
 * composer.lock holds: the link files are written and the partial update runs from them, so each provided package resolves from its folder
 * and the released metadata of the lock is never read. Returns the names that it linked; none when no checkout provides one, and then the
 * caller installs the tracked lock.
 */
export function linkComposerInstall({ directory, checkouts, composer, print, env }: { directory: string; checkouts: readonly string[]; composer: Tool; print: Print; env: NodeJS.ProcessEnv }): string[] {
  const consumer = consumerOf(directory, true);
  const project = consumer.scope;
  const work: Run = { found: providers(checkouts, undefined, consumer.top, consumer.top), check: false, print, failed: false, env };
  const links = lockedPolyspec(project).flatMap(name => {
    const provider = providerFor(work, consumer, 'composer', name);
    return typeof provider === 'string' ? [] : [{ name, folder: provider.folder }];
  });
  if (links.length === 0) return [];
  updateLinkedComposer(composer, consumer.top, project, links, links.map(item => item.name));
  const record = path.join(composerVendor(project, composer), 'composer/installed.json');
  for (const { name, folder } of links) {
    const entry = installedPackages(record).find(item => item.name === name);
    const copy = typeof entry?.['install-path'] === 'string' ? path.resolve(path.dirname(record), entry['install-path']) : undefined;
    if (copy === undefined || real(copy) !== realpathSync(folder)) throw new Error(`composer update did not link ${name} to ${folder}`);
    line(work, 'linked', 'composer', `${name} -> ${folder} (now)`);
  }
  return links.map(item => item.name);
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
    // A vendor without installed.json, as in a fresh checkout, names the polyspec packages of its composer.lock too.
    if (!installed) { new Set([...declared, ...lockedPolyspec(project)]).forEach(notInstalled); continue; }
    const record = path.join(vendor, 'composer/installed.json');
    const names = new Set<string>();
    const recorded = new Set<string>();
    const toLink: { name: string; folder: string; copy: string; provider: Provider }[] = [];
    const linkedNow: { name: string; folder: string; fork: boolean }[] = [];
    for (const entry of installedPackages(record)) {
      if (typeof entry.name !== 'string') continue;
      // A package of another vendor is linked only when a checkout provides it, such as a fork of forks/ (K379); any other is left alone.
      if (!entry.name.startsWith('polyspec/') && typeof providerFor(work, consumer, 'composer', entry.name) === 'string') continue;
      names.add(entry.name);
      if (typeof entry['install-path'] !== 'string') { unlinkable(work, 'composer', entry.name, `no install-path in ${record}`); continue; }
      const copy = path.resolve(path.dirname(record), entry['install-path']);
      recorded.add(copy);
      const provider = providerFor(work, consumer, 'composer', entry.name);
      if (projectPackage(work, 'composer', entry.name, provider, own)) continue;
      if (typeof provider === 'string') { unlinkable(work, 'composer', entry.name, provider); continue; }
      const version = typeof entry.version === 'string' ? entry.version : '';
      // A link is Composer's own: the record says the package was installed from a path repository. A symbolic link over an
      // archive install, which the earlier mechanism made, is installed anew (K318).
      const installedFromPath = isJsonObject(entry.dist) && entry.dist.type === 'path';
      if (real(copy) === realpathSync(provider.folder) && installedFromPath) { reportLink(work, 'composer', entry.name, provider); linkedNow.push({ name: entry.name, folder: provider.folder, fork: isForkCheckout(provider.checkout) }); continue; }
      const problem = pinProblem(version, provider);
      if (problem) unlinkable(work, 'composer', entry.name, `${problem}: ${copy}`);
      else if (work.check) unlinkable(work, 'composer', entry.name, real(copy) === realpathSync(provider.folder) ? `${copy} is a link over a ${isJsonObject(entry.dist) ? String(entry.dist.type) : 'copy'} install, not Composer's path install` : copy);
      else toLink.push({ name: entry.name, folder: provider.folder, copy, provider });
    }
    for (const name of declared) if (!names.has(name)) notInstalled(name);
    const folder = path.join(vendor, 'polyspec');
    for (const item of existsSync(folder) ? readdirSync(folder) : []) {
      if (!recorded.has(path.join(folder, item))) unlinkable(work, 'composer', `polyspec/${item}`, `a plain copy that Composer does not record: ${path.join(folder, item)}`);
    }
    if (work.check) {
      // A project linked from its vendor that lacks a link file is reported, as the next link run writes the file (K392-3).
      const [first] = linkedNow;
      for (const name of COMPOSER_LINK_FILES) if (first !== undefined && !existsSync(path.join(project, name))) unlinkable(work, 'composer', first.name, `no ${name} in ${project}`);
      continue;
    }
    // Composer installs the linked folders itself (K304-1): a path repository with `symlink` in a git-ignored composer.link.json,
    // a copy of the lock beside it, and a partial update of the polyspec packages and the project's own path packages only, so
    // the record, the autoload rules and the platform check come from the composer.json of each folder, the versions are
    // checked by Composer at that install, and every other package stays at its locked release.
    const lock = path.join(project, 'composer.lock');
    // Composer resolves the whole partial update at once, so the folders that are already linked stay in it: a package of the project
    // that requires one of them is resolved against the folder, not against the release that the lock recorded.
    const ownTargets = ownPathPackages(project).filter(name => names.has(name) && !toLink.some(item => item.name === name) && !linkedNow.some(item => item.name === name));
    // A project that link finds linked from its vendor runs no composer update, so the link files that it lacks are written here (K392-3).
    if (toLink.length === 0 && ownTargets.length === 0) {
      if (linkedNow.length > 0) writeMissingLinkFiles(work, consumer.top, project, linkedNow, lock);
      continue;
    }
    if (!existsSync(lock)) { for (const item of toLink) unlinkable(work, 'composer', item.name, `no composer.lock in ${project}`); continue; }
    const all = [...toLink.map(item => ({ name: item.name, folder: item.folder, fork: isForkCheckout(item.provider.checkout) })), ...linkedNow];
    const targets = [...all.map(item => item.name), ...ownTargets];
    updateLinkedComposer(composer, consumer.top, project, all, targets);
    for (const item of toLink) {
      if (real(item.copy) === realpathSync(item.provider.folder)) line(work, 'linked', 'composer', `${item.name} -> ${item.provider.folder} (now)`);
      else unlinkable(work, 'composer', item.name, `composer update did not link ${item.copy}`);
    }
  }
}

/**
 * K347: after a rebuild of a provider, `composer dump-autoload` of each linked Composer project of the consumers `directories`
 * (the project whose composer.link.json link wrote), so that its autoload names only the files that exist now (a provider may
 * have removed one). A project that is not linked is left as it is.
 */
export function refreshComposerAutoload({ directories, print, env = process.env }: { directories: readonly string[]; print: Print; env?: NodeJS.ProcessEnv }): void {
  for (const consumer of directories.map(directory => consumerOf(directory))) {
    if (!consumer.manifests('composer').length) continue;
    const composer = consumerTool(consumer.top, 'composer', env);
    for (const { project, installed } of composerProjects(consumer, composer)) {
      if (!installed || !existsSync(path.join(project, COMPOSER_LINK_FILES[0]))) continue;
      run(composer.command, ['dump-autoload', '--no-scripts', '--no-plugins', '--no-interaction', '--working-dir', project], { env: { ...composer.env, COMPOSER: COMPOSER_LINK_FILES[0] } });
      print(`  autoload   composer ${project}`);
    }
  }
}

// --- Python: the environment of each pyproject, uv's project environment of its workspace root. Each provider is installed into it
// from an editable wheel that link writes (K398): its metadata and a .pth naming its import root, no source, so the folder is only
// read and no build backend runs. uv installs the wheel with its dependencies and checks Requires-Python at that install. The
// consumer's own project is installed from its editable wheel too, with --no-deps (K224, K280).

/** The environment of the pyproject `file` and its uv workspace, or why there is none. */
function pythonTarget(uv: Tool, file: string): { venv: string; workspace: string } | string {
  const workspace = run(uv.command, ['workspace', 'dir'], { cwd: path.dirname(file), env: uv.env }).trim();
  const venv = uv.env.VENV ? path.resolve(uv.env.VENV) : path.resolve(workspace, uv.env.UV_PROJECT_ENVIRONMENT ?? '.venv');
  if (!existsSync(path.join(venv, 'pyvenv.cfg'))) return `no environment in ${workspace}: run the repository's install, or give VENV or UV_PROJECT_ENVIRONMENT`;
  return { venv, workspace };
}

/** uv sync --locked of the environment of `target`, with `flags`: the locked releases, the step before each install of the linked packages. */
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
 * The PEP 751 lock of the workspace `workspace`, of a project that has no uv.lock: pylock.toml, else the first pylock.<name>.toml
 * in sorted order; undefined when there is none.
 */
function pylockOf(workspace: string): string | undefined {
  const names = readdirSync(workspace).filter(name => /^pylock(\.[A-Za-z0-9_-]+)?\.toml$/.test(name)).sort();
  const name = names.includes('pylock.toml') ? 'pylock.toml' : names[0];
  return name === undefined ? undefined : path.join(workspace, name);
}

/**
 * The locked releases of a PEP 751 lock `lock` as the constraints of an install: each package of the lock that has a version,
 * without the linked packages, as lockedConstraints writes them.
 */
function pylockConstraints(consumer: Consumer, lock: string, venv: string, linked: ReadonlySet<string>): string {
  const packages = readTomlFile(lock).packages;
  const pins = (Array.isArray(packages) ? packages : []).flatMap((item: unknown) => {
    if (!isJsonObject(item) || typeof item.name !== 'string' || typeof item.version !== 'string') return [];
    const name = normalizeName(item.name);
    return linked.has(name) ? [] : [`${name}==${item.version}`];
  });
  return writeLinkFile(consumer, inputName(venv, 'constraints'), pins);
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

/**
 * The overrides of an install of the linked packages (K237, K316-1, K398): each linked package, a provider or a project of the
 * consumer, is named by its wheel, so that another package that requires it by its release URL takes the wheel, a requirement that
 * beats the one of the command line.
 */
function linkedOverrides(consumer: Consumer, venv: string, ready: readonly { provider: Provider; wheel: string }[]): string {
  return writeLinkFile(consumer, inputName(venv, 'overrides'), ready.map(({ provider, wheel }) => `${provider.name} @ ${pathToFileURL(wheel).href}`));
}

/**
 * The project of the pyproject `file` (the consumer's own, or a member of its workspace), as a provider of its folder, so that it is
 * installed as an editable install of its folder like a provider (K224); undefined when the file declares no [project] name.
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
  "    editable = bool(json.loads(text).get('dir_info', {}).get('editable')) if text else False",
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
 * Why the installed state of `provider` is not the editable install of its folder, or undefined when it is (K230, K316): a
 * link is reported only when the environment itself holds that editable install.
 */
function editableProblem(provider: Provider, state: Installed | undefined, venv: string): string | undefined {
  if (state === undefined || state.path === 'absent') return `not installed in ${venv}`;
  if (state.path === 'none') return `not installed from the folder of the checkout in ${venv}: a registry or archive install`;
  if (real(state.path) !== real(provider.folder)) return `installed from ${state.path}, not the editable install of ${provider.folder} in ${venv}`;
  return state.editable ? undefined : `installed from its folder without the editable install in ${venv}`;
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

/** The project.version of the pyproject `file`, or undefined. */
function projectVersion(file: string): string | undefined {
  const project = readTomlFile(file).project;
  const version = isJsonObject(project) ? project.version : undefined;
  return typeof version === 'string' ? version : undefined;
}

/**
 * The metadata of the editable wheel of a provider `folder` (K398), read from its pyproject.toml: the [project] table, and `root`, the
 * import root of its .pth. The build backend is never run, so a provider whose metadata the backend computes is refused, with the reason
 * as a string: a dynamic field, a package-dir of other than the root "", or a build backend that compiles code.
 */
type PythonWheel = { name: string; version: string; requiresPython: string | undefined; requires: string[]; scripts: [string, string][]; root: string | undefined; mappings: [string, string][] };

/** The build backends that compile code (K398): their metadata and their extension modules come from a build that link does not run. */
const COMPILED_BACKENDS = ['maturin', 'scikit_build_core', 'mesonpy'];

/** The [project] fields that a build backend may compute, which the wheel cannot take from the pyproject.toml (K398). */
const DYNAMIC_FIELDS = ['version', 'dependencies', 'requires-python', 'scripts'];

function pythonWheel(folder: string): PythonWheel | string {
  const file = path.join(folder, MANIFESTS.python);
  const document = readTomlFile(file);
  const project = document.project;
  if (!isJsonObject(project) || typeof project.name !== 'string') return `${file} declares no [project] name`;
  const dynamic = declaredList(project.dynamic).map(String).filter(field => DYNAMIC_FIELDS.includes(field));
  if (dynamic.length) return `${file} declares ${dynamic.join(', ')} dynamic: its build backend computes it`;
  if (typeof project.version !== 'string') return `${file} declares no static version`;
  const system = document['build-system'];
  const backend = isJsonObject(system) && typeof system['build-backend'] === 'string' ? system['build-backend'] : '';
  if (COMPILED_BACKENDS.some(name => backend.startsWith(name))) return `build backend ${backend} compiles code`;
  const tool = document.tool;
  const setuptools: Record<string, unknown> = isJsonObject(tool) && isJsonObject(tool.setuptools) ? tool.setuptools : {};
  const setup = path.join(folder, 'setup.py');
  if (setuptools['ext-modules'] !== undefined || (existsSync(setup) && /ext_modules|Extension\(/.test(readFileSync(setup, 'utf8')))) return `${folder} compiles extension modules`;
  // A static package-dir that maps a package to a folder of its own (K398-2) is served by a finder of the wheel; the packages it maps
  // must be listed in setuptools.packages, as setuptools requires for such a mapping.
  const packageDir = setuptools['package-dir'] ?? {};
  if (!isJsonObject(packageDir) || Object.values(packageDir).some(value => typeof value !== 'string')) return `${file} declares a package-dir that is not a static map of strings`;
  const mappings: [string, string][] = Object.entries(packageDir).filter(([key]) => key !== '').map(([key, value]) => [key, path.join(folder, String(value))]);
  const listed = declaredList(setuptools.packages).map(String);
  const unlisted = mappings.map(([key]) => key).filter(key => !listed.includes(key));
  if (unlisted.length) return `${file} maps ${unlisted.join(', ')} in package-dir without listing it in setuptools.packages`;
  const requires = declaredList(project.dependencies);
  if (!requires.every((item): item is string => typeof item === 'string')) return `${file} declares a dependency that is not a string`;
  const scripts = Object.entries(isJsonObject(project.scripts) ? project.scripts : {});
  if (scripts.some(([, target]) => typeof target !== 'string')) return `${file} declares a script that is not a string`;
  const mapped = packageDir[''];
  const requiresPython = project['requires-python'];
  return {
    name: project.name,
    version: project.version,
    requiresPython: typeof requiresPython === 'string' ? requiresPython : undefined,
    requires,
    scripts: scripts.map(([name, target]) => [name, String(target)]),
    root: typeof mapped === 'string' ? path.join(folder, mapped) : mappings.length ? undefined : existsSync(path.join(folder, 'src')) ? path.join(folder, 'src') : folder,
    mappings,
  };
}

/**
 * The finder of the editable wheel that maps each package of a static package-dir to its folder (K398-2): a meta path finder that
 * takes the top-level name of the package from its folder's __init__.py and the folder's submodules through the package's __path__.
 */
function finderLines(mappings: readonly [string, string][]): string[] {
  return [
    'import importlib.abc',
    'import importlib.util',
    'import os',
    'import sys',
    `MAPPING = ${JSON.stringify(Object.fromEntries(mappings))}`,
    'class _Finder(importlib.abc.MetaPathFinder):',
    '    def find_spec(self, name, path=None, target=None):',
    '        location = MAPPING.get(name)',
    '        init = os.path.join(location, "__init__.py") if location is not None else None',
    '        if init is None or not os.path.isfile(init):',
    '            return None',
    '        return importlib.util.spec_from_file_location(name, init, submodule_search_locations=[location])',
    'def install():',
    '    if not any(isinstance(finder, _Finder) for finder in sys.meta_path):',
    '        sys.meta_path.insert(0, _Finder())',
  ];
}

/** The entries of the wheel of `wheel` (K398): its dist-info (METADATA, WHEEL, entry_points.txt when it has scripts, RECORD) and the .pth. */
function wheelEntries(wheel: PythonWheel): { name: string; data: Buffer }[] {
  const dist = normalizeName(wheel.name).replace(/-/g, '_');
  const info = `${dist}-${wheel.version}.dist-info`;
  const text = (lines: readonly string[]) => Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  const entries = [
    { name: `${info}/METADATA`, data: text(['Metadata-Version: 2.1', `Name: ${wheel.name}`, `Version: ${wheel.version}`, ...(wheel.requiresPython === undefined ? [] : [`Requires-Python: ${wheel.requiresPython}`]), ...wheel.requires.map(requirement => `Requires-Dist: ${requirement}`)]) },
    { name: `${info}/WHEEL`, data: text(['Wheel-Version: 1.0', 'Generator: polyspec-kit-link', 'Root-Is-Purelib: true', 'Tag: py3-none-any']) },
    ...(wheel.scripts.length ? [{ name: `${info}/entry_points.txt`, data: text(['[console_scripts]', ...wheel.scripts.map(([name, target]) => `${name} = ${target}`)]) }] : []),
    ...(wheel.mappings.length ? [{ name: `__editable___${dist}_finder.py`, data: text(finderLines(wheel.mappings)) }] : []),
    { name: `__editable__.${dist}.pth`, data: text([...(wheel.root === undefined ? [] : [wheel.root]), ...(wheel.mappings.length ? [`import __editable___${dist}_finder; __editable___${dist}_finder.install()`] : [])]) },
  ];
  const record = [...entries.map(({ name, data }) => `${name},sha256=${createHash('sha256').update(data).digest('base64url')},${data.length}`), `${info}/RECORD,,`];
  return [...entries, { name: `${info}/RECORD`, data: text(record) }];
}

/** A zip archive of `entries`, each stored without compression and dated 1980-01-01, so that its bytes are the same on each run (K398). */
function zipOf(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const dosDate = 0x21;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const bytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(bytes.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(dosDate, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(bytes.length, 28);
    record.writeUInt32LE(offset, 42);
    parts.push(header, bytes, data);
    central.push(record, bytes);
    offset += header.length + bytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Writes the editable wheel of `wheel` into var/link/python of the consumer, and returns its path (K398). */
function writeWheel(consumer: Consumer, wheel: PythonWheel): string {
  const file = linkFile(consumer.top, path.join('python', `${normalizeName(wheel.name).replace(/-/g, '_')}-${wheel.version}-py3-none-any.whl`));
  writeAtomic(file, zipOf(wheelEntries(wheel)));
  return file;
}

/** The script that writes the PEP 610 record of an editable install of the folder named by its URL (argv 2) over the direct_url.json of the distribution named by argv 1 (K398). */
const WRITE_DIRECT_URL = [
  'import importlib.metadata as metadata, json, pathlib, sys',
  "record = next(file for file in metadata.distribution(sys.argv[1]).files if file.name == 'RECORD')",
  "pathlib.Path(record.locate()).parent.joinpath('direct_url.json').write_text(json.dumps({'url': sys.argv[2], 'dir_info': {'editable': True}}))",
].join('\n');

function linkPython(work: Run, consumer: Consumer) {
  const files = consumer.manifests('python');
  if (!files.some(file => declaredPython(file).length)) return;
  const uv = consumerTool(consumer.top, 'uv', work.env);
  // Every project of an environment is a member of it: with --no-install-workspace the sync installs none of them, so each
  // member, polyspec or not, is installed as an editable install of its folder (K224). An environment with no polyspec package is not synced.
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
    // The wheel metadata of each provider, read before any install: a provider whose metadata kit cannot read is refused (K398).
    const wheels = new Map<string, PythonWheel>();
    const linked = [
      ...closure(work, consumer, names).filter((provider) => {
        const wheel = pythonWheel(provider.folder);
        if (typeof wheel === 'string') { unlinkable(work, 'python', provider.name, wheel); return false; }
        wheels.set(provider.name, wheel);
        // A declared package that the environment lacks (a sync of the consumer's install leaves out the polyspec packages and removes
        // the editables of an earlier link) is installed as the editable of its folder, as one over a release wheel is (K316-2); its
        // pin is the version of the folder then.
        const found = installed.get(provider.name);
        const version = found?.version ?? projectVersion(path.join(provider.folder, MANIFESTS.python));
        if (version === undefined) { unlinkable(work, 'python', provider.name, `not installed in ${venv}, and ${path.join(provider.folder, MANIFESTS.python)} declares no version`); return false; }
        const problem = pinProblem(version, provider);
        if (problem) unlinkable(work, 'python', provider.name, `${problem} in ${venv}`);
        return !problem;
      }),
      // An own project is installed from its editable wheel as a provider is (K398-1): a project whose metadata the wheel cannot
      // take is refused, and is not installed from its folder instead.
      ...projects.filter((project) => {
        const wheel = pythonWheel(project.folder);
        if (typeof wheel === 'string') { unlinkable(work, 'python', project.name, wheel); return false; }
        wheels.set(project.name, wheel);
        return true;
      }),
    ];
    // A link is reported from the installed state of the environment, after each install too (K230); a listing is not proof.
    // A linked package is linked and its requirements are met (K238): the unmet requirements are those that uv pip check states.
    const stateOf = (names: readonly string[]) => installedFiles(venv, names, work.env);
    const problemOf = (provider: Provider, state: Map<string, Installed>, unmet: ReadonlyMap<string, string>): string | undefined =>
      editableProblem(provider, state.get(provider.name), venv) ?? unmet.get(normalizeName(provider.name));
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
    // The constraints are the locked releases of the uv.lock of the workspace, or of its PEP 751 lock when it has no uv.lock (K401).
    const pylock = existsSync(path.join(workspace, 'uv.lock')) ? undefined : pylockOf(workspace);
    if (pylock === undefined && !existsSync(path.join(workspace, 'uv.lock'))) {
      for (const provider of linked) unlinkable(work, 'python', provider.name, `no uv.lock or pylock.toml in ${workspace}: run the repository's install`);
      continue;
    }
    // No sync (K239): the consumer's install already synced the environment, and a sync would reinstall any other package
    // from its lock source. The install below changes the linked packages only; its dependencies are added at the locked releases.
    // Each linked package is installed from the wheel that link writes for it (K398): every entry of linked has its wheel metadata.
    const ready = linked.flatMap((provider) => {
      const wheel = wheels.get(provider.name);
      return wheel === undefined ? [] : [{ provider, wheel: writeWheel(consumer, wheel) }];
    });
    const lockedNames = new Set(ready.map(({ provider }) => normalizeName(provider.name)));
    const constraints = pylock === undefined ? lockedConstraints(consumer, uv, workspace, venv, lockedNames) : pylockConstraints(consumer, pylock, venv, lockedNames);
    const overrides = linkedOverrides(consumer, venv, ready);
    // A project of the consumer's own environment is installed with --no-deps (K280): the consumer's lock sync provides its
    // dependencies, and a dependency that the lock provides another way (a path dependency of no index) cannot be resolved here.
    const own = new Set(projects.map(project => project.name));
    const python = path.join(venv, 'bin/python');
    const installs = [
      { flags: ['--constraints', constraints, '--overrides', overrides], items: ready.filter(({ provider }) => !own.has(provider.name)) },
      { flags: ['--no-deps'], items: ready.filter(({ provider }) => own.has(provider.name)) },
    ];
    for (const { flags, items } of installs) {
      if (!items.length) continue;
      run(uv.command, ['pip', 'install', '--python', python, ...flags, ...items.flatMap(({ provider }) => ['--reinstall-package', provider.name]), ...items.map(({ wheel }) => wheel)], { cwd: consumer.top, env: uv.env });
      // The wheel records its install as a non-editable one of its file: the PEP 610 record is written as the editable install of the folder (K398).
      for (const { provider } of items) run(python, ['-I', '-c', WRITE_DIRECT_URL, provider.name, pathToFileURL(provider.folder).href], { cwd: venv, env: work.env });
    }
    reportLinks(stateOf(linked.map(provider => provider.name)), true);
  }
}

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
    if (tracked.has(file)) return usedFolders(go, file);
  }
  return [];
}

/**
 * The module folders that the go.work `file` uses, as go work edit -json reads them: each DiskPath resolved against the folder of
 * the go.work. The check reads them from the go.work itself, not from go list -m of each module.
 */
function usedFolders(go: Tool, file: string): string[] {
  const folder = path.dirname(file);
  const parsed = JSON.parse(run(go.command, ['work', 'edit', '-json', file], { cwd: folder, env: go.env })) as unknown;
  if (!isJsonObject(parsed)) throw new Error(`${file}: go work edit -json printed no object`);
  const uses = Array.isArray(parsed.Use) ? parsed.Use : [];
  return uses.flatMap(item => (isJsonObject(item) && typeof item.DiskPath === 'string' ? [path.resolve(folder, item.DiskPath)] : []));
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
    rmSync(file, { force: true });
    rmSync(`${file}.sum`, { force: true });
    if (!requires.size) continue;
    const folders = [...new Set([directory, ...workspace, ...[...requires.values()].map(provider => provider.folder)])];
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
  const work: Run = { found: providers(checkouts, go, first?.top ?? process.cwd(), first?.top), check, print, failed: false, env };
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
        for (const name of COMPOSER_LINK_FILES) rmSync(path.join(project, name), { force: true });
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
          // their editables; a linked package that the lock does not hold has no locked release to restore.
          const lock = pylockOf(target.workspace);
          if (lock === undefined) { skip(`python ${path.dirname(file)}: no environment or no uv.lock; run the repository's install`); continue; }
          const { pins, missing } = pylockReleases(lock, declaredPython(file));
          for (const name of missing) skip(`python ${path.dirname(file)}: ${name} is not held by ${path.basename(lock)}, not restorable`);
          if (pins.length) {
            run(uv.command, ['pip', 'install', '--python', path.join(target.venv, 'bin/python'), ...pins.map(pin => pin.requirement), ...pins.flatMap(pin => ['--reinstall-package', pin.name])], { cwd: target.workspace, env: uv.env });
            print(`  restored   python   ${target.venv}`);
          }
          continue;
        }
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
    const withoutProject = rest.filter((_, index) => project === -1 || (index !== project && index !== project + 1));
    // `--siblings` takes the checkouts beside the repository as the checkouts (K349): an install recipe links right after the
    // install when polyspec checkouts are present, and a checkout without a sibling, such as CI, installs the released packages.
    const siblings = withoutProject.includes('--siblings');
    const positional = withoutProject.filter(argument => argument !== '--siblings');
    const directories = [projectDirectory ?? '.'];
    if (siblings && (command === 'link' || command === 'check')) {
      const found = siblingCheckouts(projectDirectory ?? '.');
      for (const folder of found.skipped) print(`skipped ${folder}: no main checkout of a polyspec repository, whose origin is github.com/polyspec/<its folder>`);
      positional.push(...found.checkouts);
      if (positional.length === 0) {
        print(`no polyspec checkout beside ${workTreeOf(projectDirectory ?? '.')}: nothing is linked and the installs stay the released packages`);
        process.exit(0);
      }
    }
    switch (command) {
      case 'link': case 'check':
        if (!link({ checkouts: positional, directories, check: command === 'check', print, project: projectDirectory !== undefined })) process.exitCode = 1;
        break;
      case 'unlink':
        if (!unlink({ directories, print, project: projectDirectory !== undefined })) process.exitCode = 1;
        break;
      case 'rebuild':
        for (const repository of rest) rebuild(workTreeOf(repository), print);
        refreshComposerAutoload({ directories, print });
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
