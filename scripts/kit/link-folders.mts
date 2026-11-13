// The link of kit (K448): each installed polyspec package folder is a direct symlink to the package folder of the checkout that
// provides it. No package manager resolves anything and no version is read: the tracked lock is installed once, as it is, and the
// link replaces each provided package folder, removing a copy. link-check reads the same folders.
//
//   npm       node_modules/<name>                  -> the folder of the provider's package.json
//   Composer  <vendor-dir>/<vendor>/<package>      -> the folder of the provider's composer.json
//   Python    <site-packages>/<package path>       -> the same package path under the provider's source root (src/ when it has one),
//             one link per package, so the packages of one namespace (example/orm, example/ordered_json) link apart; a source root
//             whose pyproject maps its directories in the hatchling wheel sources links each directory to its mapped package path (K529)
//
// Each installed package is exactly one directory symlink, the user's rule (K591); no kit uv run writes through it, since every uv
// install of kit removes the links first (K539).
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { readToml } from './toml.mts';
import { errorCode } from './process.mts';
import { type Provider, rivalFolders } from './link-providers.mts';
import { normalizeName } from './pyproject-dependencies.mts';

/** One installed folder that a provider provides, and the folder it must link to. */
export interface ProvidedFolder {
  ecosystem: 'npm' | 'composer' | 'python';
  name: string;
  folder: string;
  target: string;
  /** K1187: the package manager made this folder as a link from a local path of the consumer's own manifest; link leaves it. */
  manager?: true;
}

/** The manifest of each ecosystem that names the package of a folder. */
const MANIFEST = { npm: 'package.json', composer: 'composer.json', python: 'pyproject.toml' } as const;

/** The name of the package that the manifest of `ecosystem` in `folder` declares, or undefined. */
function declaredName(folder: string, ecosystem: keyof typeof MANIFEST): string | undefined {
  const file = path.join(folder, MANIFEST[ecosystem]);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  if (ecosystem === 'python') {
    const project = readToml(text, file).project;
    return typeof project === 'object' && project !== null && 'name' in project && typeof project.name === 'string' ? project.name : undefined;
  }
  const manifest: unknown = JSON.parse(text);
  return typeof manifest === 'object' && manifest !== null && 'name' in manifest && typeof manifest.name === 'string' ? manifest.name : undefined;
}

/**
 * The package folders of a checkout that the caller names (K494): the folders under packages/ to a depth of three (a workspace's
 * packages/server/ts), node_modules and vendor never searched, that hold the manifest of `ecosystem`.
 */
function packageFoldersOf(checkout: string, ecosystem: keyof typeof MANIFEST): string[] {
  const found: string[] = [];
  const visit = (folder: string, depth: number) => {
    if (depth > 3) return;
    for (const entry of readdirSync(folder).sort()) {
      if (entry === 'node_modules' || entry === 'vendor' || entry.startsWith('.')) continue;
      const child = path.join(folder, entry);
      if (!lstatSync(child).isDirectory()) continue;
      if (existsSync(path.join(child, MANIFEST[ecosystem]))) found.push(child);
      visit(child, depth + 1);
    }
  };
  const packages = path.join(checkout, 'packages');
  if (existsSync(packages) && lstatSync(packages).isDirectory()) visit(packages, 1);
  return found;
}

/** The folders of a member pattern of a uv workspace below `root`: a segment with * matches the folder names of its level. */
function memberFolders(root: string, pattern: string): string[] {
  let found = [root];
  for (const segment of pattern.split('/').filter(part => part !== '' && part !== '.')) {
    if (!segment.includes('*')) {
      found = found.map(folder => path.join(folder, segment));
      continue;
    }
    const match = new RegExp(`^${segment.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
    found = found.flatMap(folder => (existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory() && match.test(entry.name)).map(entry => path.join(folder, entry.name)) : []));
  }
  return found;
}

/**
 * The member folders of the uv workspace that the pyproject.toml of `folder` declares in [tool.uv.workspace] members (K518), none
 * when it declares no workspace; throws when a member names no folder with a pyproject.toml.
 */
function workspaceMembers(folder: string): string[] {
  const file = path.join(folder, 'pyproject.toml');
  if (!existsSync(file)) return [];
  const tool = readToml(readFileSync(file, 'utf8'), file).tool;
  const uv = typeof tool === 'object' && tool !== null && 'uv' in tool ? tool.uv : undefined;
  const workspace = typeof uv === 'object' && uv !== null && 'workspace' in uv ? uv.workspace : undefined;
  const members = typeof workspace === 'object' && workspace !== null && 'members' in workspace ? workspace.members : undefined;
  if (members === undefined) return [];
  if (!Array.isArray(members) || !members.every((member): member is string => typeof member === 'string')) throw new Error(`[tool.uv.workspace] members of ${file} is no list of folder patterns`);
  return members.flatMap((member) => {
    const found = memberFolders(folder, member).filter(candidate => existsSync(path.join(candidate, 'pyproject.toml')));
    if (found.length === 0) throw new Error(`the member ${member} of the uv workspace ${folder} names no folder with a pyproject.toml`);
    return found;
  });
}

/**
 * The providers of `ecosystem` in the checkouts that the caller names, each a package folder or a repository root (K494): a root with
 * package folders gives those folders and never itself, since a root may carry the name of the package it holds (K494-2); a checkout
 * that provides no package of the ecosystem provides none (K494-1). The first checkout that provides a name provides it.
 */
export function checkoutProviders(checkouts: readonly string[], ecosystem: keyof typeof MANIFEST): Provider[] {
  const found = new Map<string, Provider>();
  for (const checkout of checkouts) {
    const folders = packageFoldersOf(checkout, ecosystem);
    const own = folders.length ? folders : [checkout];
    // K518: a Python folder that is a uv workspace root provides its members too, from the workspace declaration.
    for (const folder of ecosystem === 'python' ? [...own, ...own.flatMap(workspaceMembers)] : own) {
      const name = declaredName(folder, ecosystem);
      if (name !== undefined && !found.has(name)) found.set(name, { ecosystem, name, folder: path.resolve(folder), repository: path.resolve(checkout), checkout: path.resolve(checkout) });
    }
  }
  return [...found.values()];
}

/** Whether `file` exists as an entry, a dangling link included. */
export const present = (file: string): boolean => {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    // ENOENT: no entry; ENOTDIR: a parent is a file. Any other failure, as EACCES, is no answer (K559).
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return false;
    throw error;
  }
};

/**
 * The site-packages folders of the environment of `project`, the one that uv syncs: `environment` (UV_PROJECT_ENVIRONMENT, relative to the
 * project or absolute, K448-14), else .venv; each is <environment>/lib/<python>/site-packages.
 */
/**
 * The entries of the site-packages of the environment of `project` (`environment` as in sitePackages), at any depth of its real
 * folders, that are links resolving outside the environment, or dangling: the package folders that link made into a provider checkout
 * (K539, K541).
 */
export function environmentLinks(project: string, environment: string | undefined): string[] {
  const venv = path.resolve(project, environment === undefined || environment === '' ? '.venv' : environment);
  const own = existsSync(venv) ? realpathSync(venv) : venv;
  const found: string[] = [];
  const visit = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const entry = path.join(folder, name);
      const stat = lstatSync(entry);
      if (stat.isDirectory()) visit(entry);
      // A package link of kit is a folder link; a file link is uv's own, as with UV_LINK_MODE=symlink (K869).
      if (!stat.isSymbolicLink() || (existsSync(entry) && !statSync(entry).isDirectory())) continue;
      const target = existsSync(entry) ? realpathSync(entry) : undefined;
      if (target === undefined || !target.startsWith(`${own}${path.sep}`)) found.push(entry);
    }
  };
  for (const folder of sitePackages(project, environment)) visit(folder);
  return found;
}

/**
 * Removes the links of environmentLinks and returns them: uv writes and deletes through such a link, so every uv install of the
 * environment removes them first (K539); the link only goes, never its target.
 */
export function releaseEnvironmentLinks(project: string, environment: string | undefined): string[] {
  const removed = environmentLinks(project, environment);
  for (const entry of removed) unlinkSync(entry);
  return removed;
}

/**
 * The distributions of the environment of `project` (`environment` as in sitePackages) that miss a file of their RECORD inside
 * site-packages, by the name of their dist-info, sorted: uv keeps an installed distribution as it is (K772), so a package folder whose
 * link was removed stays missing until uv reinstalls the distribution (K856).
 */
export function incompleteDistributions(project: string, environment: string | undefined): string[] {
  const names = new Set<string>();
  for (const site of sitePackages(project, environment)) {
    for (const entry of readdirSync(site).filter(name => name.endsWith('.dist-info'))) {
      const record = path.join(site, entry, 'RECORD');
      if (!existsSync(record)) continue;
      const files = readFileSync(record, 'utf8').split('\n').flatMap(line => {
        const file = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(',')[0] ?? '';
        return file === '' || path.isAbsolute(file) || file.startsWith('..') ? [] : [file];
      });
      if (files.some(file => !present(path.join(site, file)))) names.add(entry.slice(0, entry.indexOf('-')));
    }
  }
  return [...names].sort();
}

/** The environment folder of the Python project `project`: `environment` (UV_PROJECT_ENVIRONMENT), else .venv. */
function pythonEnvironment(project: string, environment = process.env.UV_PROJECT_ENVIRONMENT): string {
  return path.resolve(project, environment === undefined || environment === '' ? '.venv' : environment);
}

function sitePackages(project: string, environment: string | undefined): string[] {
  const lib = path.join(pythonEnvironment(project, environment), 'lib');
  if (!existsSync(lib)) return [];
  return readdirSync(lib).map(name => path.join(lib, name, 'site-packages')).filter(folder => existsSync(folder));
}

/**
 * The package paths of a Python source root: a folder with __init__.py is a package; a folder without one is a namespace, whose
 * child packages are its packages, so two distributions that share the namespace link apart.
 */
function pythonPackages(source: string, prefix = ''): string[] {
  if (!existsSync(source)) return [];
  return readdirSync(source, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith('.egg-info') && entry.name !== '__pycache__').flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    return existsSync(path.join(source, entry.name, '__init__.py')) ? [relative] : pythonPackages(path.join(source, entry.name), relative);
  });
}

/** The vendor folder of the Composer project `project`: the vendor-dir it is given (absolute or relative to the project), else vendor. */
function vendorDirectory(project: string, vendorDir: string | undefined): string {
  return path.resolve(project, vendorDir ?? 'vendor');
}

/**
 * The vendor-dir of the Composer project `project` as Composer reads it (K529): COMPOSER_VENDOR_DIR of `env` when it is set, else
 * config.vendor-dir of its composer.json, else undefined (vendor). The value of the environment is read first, as Composer does.
 */
export function composerVendorDir(project: string, env: NodeJS.ProcessEnv): string | undefined {
  const fromEnvironment = env.COMPOSER_VENDOR_DIR;
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment;
  const file = path.join(project, MANIFEST.composer);
  if (!existsSync(file)) return undefined;
  const config = readJsonObject(file).config;
  return isJsonObject(config) && typeof config['vendor-dir'] === 'string' ? config['vendor-dir'] : undefined;
}

/**
 * The installed package paths of a Python provider folder that its pyproject.toml maps in the wheel target's sources (K529): each
 * source directory of the folder is installed as the package path of its entry, so the member example-contracts maps src to
 * example/contracts. Empty when the pyproject declares no such table.
 */
function hatchSources(folder: string): { from: string; to: string }[] {
  const file = path.join(folder, MANIFEST.python);
  if (!existsSync(file)) return [];
  const tool = readToml(readFileSync(file, 'utf8'), file).tool;
  const hatch = typeof tool === 'object' && tool !== null && 'hatch' in tool ? tool.hatch : undefined;
  const build = typeof hatch === 'object' && hatch !== null && 'build' in hatch ? hatch.build : undefined;
  const targets = typeof build === 'object' && build !== null && 'targets' in build ? build.targets : undefined;
  const wheel = typeof targets === 'object' && targets !== null && 'wheel' in targets ? targets.wheel : undefined;
  const sources = typeof wheel === 'object' && wheel !== null && 'sources' in wheel ? wheel.sources : undefined;
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) return [];
  return Object.entries(sources).map(([from, to]) => {
    if (typeof to !== 'string') throw new Error(`[tool.hatch.build.targets.wheel] sources of ${file}: ${from} is no package path`);
    return { from, to };
  });
}

/**
 * The installed folders of the project `project` that a provider of `provided` provides, each with the folder it must link to. A
 * package that is not installed is left out: the install of the tracked lock installs what the project needs, and the link only
 * replaces it.
 */
export function providedFolders(project: string, provided: Iterable<Provider>, { vendorDir, environment = process.env.UV_PROJECT_ENVIRONMENT }: { vendorDir?: string | undefined; environment?: string | undefined } = {}): ProvidedFolder[] {
  const found: ProvidedFolder[] = [];
  const sites = sitePackages(project, environment);
  for (const provider of provided) {
    if (provider.ecosystem === 'npm') {
      const folder = path.join(project, 'node_modules', provider.name);
      if (present(folder)) found.push({ ecosystem: 'npm', name: provider.name, folder, target: provider.folder, ...(managerLink(folder) ? { manager: true as const } : {}) });
    } else if (provider.ecosystem === 'composer') {
      const folder = path.join(vendorDirectory(project, vendorDir), provider.name);
      if (present(folder)) found.push({ ecosystem: 'composer', name: provider.name, folder, target: provider.folder, ...(managerLink(folder) ? { manager: true as const } : {}) });
    } else if (provider.ecosystem === 'python' && hatchSources(provider.folder).length > 0) {
      for (const site of sites) {
        for (const { from, to } of hatchSources(provider.folder)) {
          const folder = path.join(site, to);
          if (present(folder) || distributionInstalled(site, provider.name)) found.push({ ecosystem: 'python', name: `${provider.name} ${to}`, folder, target: path.join(provider.folder, from) });
        }
      }
    } else if (provider.ecosystem === 'python') {
      const source = existsSync(path.join(provider.folder, 'src')) ? path.join(provider.folder, 'src') : provider.folder;
      const packages = pythonPackages(source);
      for (const site of sites) {
        for (const relative of packages) {
          const folder = path.join(site, relative);
          if (present(folder) || distributionInstalled(site, provider.name)) found.push({ ecosystem: 'python', name: `${provider.name} ${relative}`, folder, target: path.join(source, relative) });
        }
      }
    }
  }
  return found;
}

/**
 * Whether the site-packages `site` holds the distribution `name`, a <name>-<version>.dist-info of its normalized name (K772): uv keeps
 * an installed distribution as it is, so a package folder that the installer unlinked before uv sync stays missing, and the
 * distribution, not the folder, says that the package is installed.
 */
function distributionInstalled(site: string, name: string): boolean {
  const normal = name.toLowerCase().replace(/[-_.]+/g, '_');
  return readdirSync(site).some(entry => entry.endsWith('.dist-info') && entry.slice(0, entry.indexOf('-')).toLowerCase().replace(/[-_.]+/g, '_') === normal);
}

/**
 * Whether the Python provider `provider` names installable package paths: its hatchling sources, or the packages of its source root.
 * A provider with none installs no folder, so a declaration of it has nothing to link (K529).
 */
export function hasPythonPackages(provider: Provider): boolean {
  if (hatchSources(provider.folder).length > 0) return true;
  const source = existsSync(path.join(provider.folder, 'src')) ? path.join(provider.folder, 'src') : provider.folder;
  return pythonPackages(source).length > 0;
}

/** Whether the paths `left` and `right` name one existing folder. */
const sameFolder = (left: string, right: string): boolean => existsSync(left) && existsSync(right) && realpathSync(left) === realpathSync(right);

/** The table `key` of the table `value`, or an empty one. */
const tableOf = (value: unknown, key: string): Record<string, unknown> => {
  const found = isJsonObject(value) ? value[key] : undefined;
  return isJsonObject(found) ? found : {};
};

/**
 * K1213: the local paths by which the manifest of `project` names the package `provider`, resolved against the project: the url of each
 * Composer path repository, an npm dependency `file:<path>` of that name, and the path of the uv source of that name.
 */
function manifestPaths(project: string, provider: Provider): string[] {
  if (provider.ecosystem === 'go') return [];
  const file = path.join(project, MANIFEST[provider.ecosystem]);
  if (!existsSync(file)) return [];
  if (provider.ecosystem === 'python') {
    const sources = tableOf(tableOf(tableOf(readToml(readFileSync(file, 'utf8'), file), 'tool'), 'uv'), 'sources');
    return Object.entries(sources).flatMap(([name, source]) => (normalizeName(name) === provider.name && isJsonObject(source) && typeof source.path === 'string' ? [path.resolve(project, source.path)] : []));
  }
  const manifest = readJsonObject(file);
  if (provider.ecosystem === 'composer') {
    // Composer takes its repositories as a list or as an object by name.
    const repositories = Array.isArray(manifest.repositories) ? manifest.repositories : Object.values(tableOf(manifest, 'repositories'));
    return repositories.flatMap((repository: unknown) => (isJsonObject(repository) && repository.type === 'path' && typeof repository.url === 'string' ? [path.resolve(project, repository.url)] : []));
  }
  return ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((section) => {
    const spec = tableOf(manifest, section)[provider.name];
    return typeof spec === 'string' && spec.startsWith('file:') ? [path.resolve(project, spec.slice('file:'.length))] : [];
  });
}

/** The `type` of the Composer package that the manifest or the record `value` describes, `library` when it names none, as Composer reads it. */
const composerType = (value: Record<string, unknown>): string => (typeof value.type === 'string' ? value.type : 'library');

/**
 * K1213: the providers of `provided` as the project `project` takes them. A name that one folder gives is its provider. A name that two
 * folders give is decided by the project, by the first of these that selects one folder:
 *   - a local path by which the project's own manifest names the package (manifestPaths);
 *   - the installed folder when the package manager itself linked it from such a path (managerLink): link leaves that folder as it is;
 *   - for Composer, the `type` that Composer recorded for the installed package in installed.json: the folder whose composer.json
 *     declares that type provides it, as the library beside the extension package (`php-ext`) of one name.
 * When none selects one folder, a package that the project holds installed, which link would link, fails with the package and the
 * folders; a package that it does not hold is left out, since nothing of it is linked there, so it fails nothing.
 */
export function decideProviders(project: string, provided: Iterable<Provider>, { vendorDir, environment = process.env.UV_PROJECT_ENVIRONMENT }: { vendorDir?: string | undefined; environment?: string | undefined } = {}): Provider[] {
  return [...provided].flatMap((provider) => {
    if (!provider.rivals?.length) return [provider];
    const { rivals, ...first } = provider;
    const candidates: Provider[] = [first, ...rivals];
    const one = (found: Provider[]) => (found.length === 1 ? found : undefined);
    const paths = manifestPaths(project, provider);
    const named = one(candidates.filter(candidate => paths.some(local => sameFolder(local, candidate.folder))));
    if (named) return named;
    const installed = provider.ecosystem === 'npm' ? path.join(project, 'node_modules', provider.name) : provider.ecosystem === 'composer' ? path.join(vendorDirectory(project, vendorDir), provider.name) : undefined;
    if (installed !== undefined && present(installed)) {
      if (managerLink(installed) !== undefined) return [candidates.find(candidate => sameFolder(installed, candidate.folder)) ?? first];
      const record = path.join(path.dirname(path.dirname(installed)), 'composer/installed.json');
      const entry = provider.ecosystem === 'composer' && existsSync(record) ? installedEntries(record).find(candidate => candidate.name === provider.name) : undefined;
      const typed = entry === undefined ? undefined : one(candidates.filter(candidate => composerType(readJsonObject(candidate.folder, MANIFEST.composer)) === composerType(entry)));
      if (typed) return typed;
    }
    // The project holds the package when link would link a folder of one of the candidates there (providedFolders).
    if (!candidates.some(candidate => providedFolders(project, [candidate], { vendorDir, environment }).length > 0)) return [];
    const ways = provider.ecosystem === 'composer' ? 'a path repository of its composer.json names neither folder, and the type that Composer recorded for the installed package is the type of both or of neither' : `${provider.ecosystem === 'npm' ? 'a file: dependency of its package.json' : 'a uv source path of its pyproject.toml'} names neither folder`;
    throw new Error(`${rivalFolders(provider)}; the project ${project} holds the package installed, and nothing decides between the folders: ${ways}`);
  });
}

/** Whether `folder` is a symbolic link that resolves to `target`. */
const linksTo = (folder: string, target: string): boolean => lstatSync(folder).isSymbolicLink() && existsSync(folder) && realpathSync(folder) === realpathSync(target);

/**
 * The node_modules/.bin links of the linked npm package `item` (K767), at the paths where npm writes them: <bin>/<name> ->
 * ../<package>/<path> for each entry of the "bin" of the linked package.json, a string naming the package's own name. The install
 * wrote them from the release, whose bin can name a path that the checkout lacks; returns a line for each link it changed. Unlike the
 * bin links of npm, it sets no execute bit on a target: the mode of a bin belongs to its provider, as its tracked mode or its build,
 * and no file of the provider checkout is written, which may be mounted read-only (K872).
 */
function linkBins(item: ProvidedFolder): string[] {
  const manifest = readJsonObject(item.target, 'package.json');
  const bin = typeof manifest.bin === 'string' ? { [item.name.split('/').pop() ?? item.name]: manifest.bin } : isJsonObject(manifest.bin) ? manifest.bin : {};
  const folder = path.join(path.dirname(item.folder), ...item.name.split('/').slice(1).map(() => '..'), '.bin');
  const lines: string[] = [];
  for (const [name, file] of Object.entries(bin)) {
    if (typeof file !== 'string') continue;
    const link = path.join(folder, name);
    const target = path.join('..', item.name, path.normalize(file));
    if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() && readlinkSync(link) === target) continue;
    rmSync(link, { force: true });
    mkdirSync(folder, { recursive: true });
    symlinkSync(target, link);
    lines.push(`npm ${item.name}: ${link} linked to ${target}`);
  }
  return lines;
}

/**
 * K1187: the package at `folder` when the package manager itself installed it as a link from a local path that the consumer's own
 * manifest declares, else undefined: an npm `file:` dependency, whose entry in the nearest package-lock.json above its node_modules
 * has `"link": true`, or a Composer package that a path repository installed, whose entry in the vendor folder's
 * composer/installed.json has the dist type `path`. Such a folder is the package manager's result, so link neither replaces nor
 * removes it.
 */
export function managerLink(folder: string): { ecosystem: 'npm' | 'composer'; name: string } | undefined {
  const parts = folder.split(path.sep);
  const at = parts.lastIndexOf('node_modules');
  if (at >= 0) {
    const name = parts.slice(at + 1).join('/');
    for (let directory = parts.slice(0, at).join(path.sep) || path.sep; ; directory = path.dirname(directory)) {
      const lock = path.join(directory, 'package-lock.json');
      if (existsSync(lock)) {
        const packages = readJsonObject(directory, 'package-lock.json').packages;
        const entry = isJsonObject(packages) ? packages[path.relative(directory, folder).split(path.sep).join('/')] : undefined;
        return isJsonObject(entry) && entry.link === true ? { ecosystem: 'npm', name } : undefined;
      }
      if (path.dirname(directory) === directory) return undefined;
    }
  }
  const record = path.join(path.dirname(path.dirname(folder)), 'composer/installed.json');
  if (!existsSync(record)) return undefined;
  const name = `${path.basename(path.dirname(folder))}/${path.basename(folder)}`;
  const entry = installedEntries(record).find(candidate => candidate.name === name);
  const dist = entry?.dist;
  return isJsonObject(dist) && dist.type === 'path' ? { ecosystem: 'composer', name } : undefined;
}

/** The package entries of a Composer installed.json, in either of its formats. */
function installedEntries(record: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(readFileSync(record, 'utf8'));
  const list: unknown = isJsonObject(parsed) ? parsed.packages : parsed;
  return (Array.isArray(list) ? list : []).filter(isJsonObject);
}

/**
 * K1187: the finding of a package manager's link at `folder` (managerLink): none when it resolves to a directory whose manifest names
 * its package, else one line with the fix in the consumer's own manifest.
 */
export function managerLinkFindings(root: string, folder: string): string[] {
  const found = managerLink(folder);
  if (found === undefined) return [];
  const real = existsSync(folder) && statSync(folder).isDirectory() ? realpathSync(folder) : undefined;
  if (real !== undefined && declaredName(real, found.ecosystem) === found.name) return [];
  const where = real === undefined ? 'resolves to no directory' : `resolves to ${real}, whose ${MANIFEST[found.ecosystem]} does not name ${found.name}`;
  return [`${found.ecosystem} ${found.name}: ${path.relative(root, folder)} is the package manager's link from a local path of the manifest, but it ${where}; fix: correct that local path and install again`];
}

/**
 * Replaces each provided folder that is not a link to its target with that one directory link (K591, K761); returns a line for each
 * folder it changed. A folder that does not exist yet, as a package that ADD names (K485), gets its parent and the link.
 */
export function linkFolders(folders: readonly ProvidedFolder[]): string[] {
  const lines: string[] = [];
  for (const item of folders.filter(folder => folder.manager === undefined)) {
    if (item.ecosystem === 'npm') lines.push(...linkBins(item));
    // A link to the right folder stays, unless it is absolute, which is made relative (K326-3).
    if (present(item.folder) && linksTo(item.folder, item.target) && !path.isAbsolute(readlinkSync(item.folder))) continue;
    const was = !present(item.folder) ? 'missing' : lstatSync(item.folder).isSymbolicLink() ? 'a link elsewhere' : 'a copy';
    rmSync(item.folder, { recursive: true, force: true });
    mkdirSync(path.dirname(item.folder), { recursive: true });
    // A relative link (K326-3): the checkout and its siblings move together, so the link survives a moved workspace.
    symlinkSync(path.relative(path.dirname(item.folder), item.target), item.folder);
    lines.push(`${item.ecosystem} ${item.name}: ${item.folder} was ${was}; linked to ${item.target}`);
  }
  return lines;
}

/** The findings of the provided folders: a missing folder, a copy, or a link to another folder than its provider's (K591). */
export function folderFindings(root: string, folders: readonly ProvidedFolder[]): string[] {
  return folders.flatMap((item) => {
    const shown = path.relative(root, item.folder);
    if (item.manager !== undefined) return managerLinkFindings(root, item.folder);
    if (!present(item.folder)) return [`${item.ecosystem} ${item.name}: ${shown} is missing; fix: make link`];
    if (!lstatSync(item.folder).isSymbolicLink()) return [`${item.ecosystem} ${item.name}: ${shown} is a copy, not a link to ${item.target}; fix: make link`];
    if (!linksTo(item.folder, item.target)) return [`${item.ecosystem} ${item.name}: ${shown} links to ${existsSync(item.folder) ? realpathSync(item.folder) : 'nothing'}, not to ${item.target}; fix: make link`];
    return [];
  });
}

/** `value` as JSON with the keys of every object sorted, so that two autoload values compare by content, not by key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isJsonObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/**
 * K1181: the findings of the linked Composer packages of `folders` whose autoload in Composer's record differs from the provider's
 * composer.json. The link delivers sources only; autoload rules are release metadata that Composer records in
 * vendor/composer/installed.json at install (either of its formats) and builds the class map from, so a provider that moved them
 * reaches the consumer by its release. Reported only; nothing rewrites the record.
 */
export function composerRecordFindings(root: string, folders: readonly ProvidedFolder[]): string[] {
  return folders.filter(item => item.ecosystem === 'composer' && item.manager === undefined && present(item.folder) && linksTo(item.folder, item.target)).flatMap((item) => {
    const record = path.join(path.dirname(path.dirname(item.folder)), 'composer/installed.json');
    if (!existsSync(record)) return [];
    const entry = installedEntries(record).find(candidate => candidate.name === item.name);
    if (entry === undefined) return [];
    const recorded = entry.autoload;
    const declared = readJsonObject(item.target, MANIFEST.composer).autoload;
    if (canonical(recorded) === canonical(declared)) return [];
    const show = (value: unknown) => (value === undefined ? 'none' : JSON.stringify(value));
    return [`composer ${item.name}: ${path.relative(root, record)} records the autoload ${show(recorded)}, the provider declares ${show(declared)}; install the provider release that carries this autoload, then make link`];
  });
}

/**
 * The findings of the polyspec packages that the linked npm providers of `folders` load (K761). Node resolves a dependency of a linked
 * package from the real path of its checkout, so each polyspec package that the provider's manifest needs at run time must resolve there
 * to the same checkout as in the consumer: a copy there is a second instance of the package, and `instanceof` fails across the two.
 */
export function providerDependencyFindings(root: string, folders: readonly ProvidedFolder[], provided: Iterable<Provider>): string[] {
  const byName = new Map([...provided].filter(provider => provider.ecosystem === 'npm').map(provider => [provider.name, provider.folder]));
  return folders.filter(item => item.ecosystem === 'npm' && item.manager === undefined && present(item.folder) && linksTo(item.folder, item.target)).flatMap((item) => {
    const manifest = readJsonObject(item.target, 'package.json');
    const names = ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap(section => {
      const value = manifest[section];
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
    }).filter(name => byName.has(name));
    return names.flatMap((name) => {
      const resolved = createRequire(path.join(realpathSync(item.target), 'package.json')).resolve.paths(name)?.map(folder => path.join(folder, name)).find(present);
      const target = byName.get(name) ?? '';
      if (resolved === undefined || linksTo(resolved, target)) return [];
      // A link that resolves to nothing (K1185): the provider's own .links names a checkout that is gone, such as a renamed repository.
      if (lstatSync(resolved).isSymbolicLink() && !existsSync(resolved)) {
        return [`npm ${name}: ${path.relative(root, resolved)}, which the linked ${item.name} loads, is a dangling link to ${readlinkSync(resolved)}; fix: correct the .links of the checkout of ${item.name} and run make link there`];
      }
      return [`npm ${name}: ${path.relative(root, resolved)}, which the linked ${item.name} loads, is ${lstatSync(resolved).isSymbolicLink() ? `a link to ${realpathSync(resolved)}` : 'a copy'}, not a link to ${target}; fix: make link in the checkout of ${item.name}`];
    });
  });
}
