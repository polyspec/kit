// The link of kit (K448): each installed polyspec package folder is a direct symlink to the package folder of the checkout that
// provides it. No package manager resolves anything and no version is read: the tracked lock is installed once, as it is, and the
// link replaces each provided package folder, removing a copy. link-state-check reads the same folders.
//
//   npm       node_modules/<name>                  -> the folder of the provider's package.json
//   Composer  <vendor-dir>/<vendor>/<package>      -> the folder of the provider's composer.json
//   Python    <site-packages>/<package path>       -> the same package path under the provider's source root (src/ when it has one),
//             one link per package, so the packages of one namespace (example/orm, example/ordered_json) link apart; a source root
//             whose pyproject maps its directories in the hatchling wheel sources links each directory to its mapped package path (K529)
//
// Each installed package is exactly one directory symlink, the user's rule (K591); no kit uv run writes through it, since every uv
// install of kit removes the links first (K539).
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { readToml } from './toml.mts';
import { errorCode } from './process.mts';
import type { Provider } from './link-providers.mts';

/** One installed folder that a provider provides, and the folder it must link to. */
export interface ProvidedFolder {
  ecosystem: 'npm' | 'composer' | 'python';
  name: string;
  folder: string;
  target: string;
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
const present = (file: string): boolean => {
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
 * Removes each entry of the site-packages of the environment of `project` (`environment` as in sitePackages), at any depth of its
 * real folders, that is a link resolving outside the environment, a package folder that link made into a provider checkout, and returns the removed paths
 * (K539): uv writes and deletes through such a link, so every uv install of the environment removes them first; the link only
 * goes, never its target. A dangling link goes too.
 */
export function releaseEnvironmentLinks(project: string, environment: string | undefined): string[] {
  const venv = path.resolve(project, environment === undefined || environment === '' ? '.venv' : environment);
  const own = existsSync(venv) ? realpathSync(venv) : venv;
  const removed: string[] = [];
  // K541: the real folders of site-packages at any depth, as a namespace folder that holds a link of its package.
  const visit = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const entry = path.join(folder, name);
      const stat = lstatSync(entry);
      if (stat.isDirectory()) visit(entry);
      if (!stat.isSymbolicLink()) continue;
      const target = existsSync(entry) ? realpathSync(entry) : undefined;
      if (target !== undefined && target.startsWith(`${own}${path.sep}`)) continue;
      unlinkSync(entry);
      removed.push(entry);
    }
  };
  for (const folder of sitePackages(project, environment)) visit(folder);
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
      if (present(folder)) found.push({ ecosystem: 'npm', name: provider.name, folder, target: provider.folder });
    } else if (provider.ecosystem === 'composer') {
      const folder = path.join(vendorDirectory(project, vendorDir), provider.name);
      if (present(folder)) found.push({ ecosystem: 'composer', name: provider.name, folder, target: provider.folder });
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
 * Replaces each provided folder that is not a link to its target with that one directory link (K591, K761); returns a line for each
 * folder it changed. A folder that does not exist yet, as a package that ADD names (K485), gets its parent and the link.
 */
export function linkFolders(folders: readonly ProvidedFolder[]): string[] {
  const lines: string[] = [];
  for (const item of folders) {
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
    if (!present(item.folder)) return [`${item.ecosystem} ${item.name}: ${shown} is missing; fix: make link`];
    if (!lstatSync(item.folder).isSymbolicLink()) return [`${item.ecosystem} ${item.name}: ${shown} is a copy, not a link to ${item.target}; fix: make link`];
    if (!linksTo(item.folder, item.target)) return [`${item.ecosystem} ${item.name}: ${shown} links to ${existsSync(item.folder) ? realpathSync(item.folder) : 'nothing'}, not to ${item.target}; fix: make link`];
    return [];
  });
}

/**
 * The findings of the polyspec packages that the linked npm providers of `folders` load (K761). Node resolves a dependency of a linked
 * package from the real path of its checkout, so each polyspec package that the provider's manifest needs at run time must resolve there
 * to the same checkout as in the consumer: a copy there is a second instance of the package, and `instanceof` fails across the two.
 */
export function providerDependencyFindings(root: string, folders: readonly ProvidedFolder[], provided: Iterable<Provider>): string[] {
  const byName = new Map([...provided].filter(provider => provider.ecosystem === 'npm').map(provider => [provider.name, provider.folder]));
  return folders.filter(item => item.ecosystem === 'npm' && present(item.folder) && linksTo(item.folder, item.target)).flatMap((item) => {
    const manifest = readJsonObject(item.target, 'package.json');
    const names = ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap(section => {
      const value = manifest[section];
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
    }).filter(name => byName.has(name));
    return names.flatMap((name) => {
      const resolved = createRequire(path.join(realpathSync(item.target), 'package.json')).resolve.paths(name)?.map(folder => path.join(folder, name)).find(present);
      const target = byName.get(name) ?? '';
      if (resolved === undefined || linksTo(resolved, target)) return [];
      return [`npm ${name}: ${path.relative(root, resolved)}, which the linked ${item.name} loads, is ${lstatSync(resolved).isSymbolicLink() ? `a link to ${realpathSync(resolved)}` : 'a copy'}, not a link to ${target}; fix: make link in the checkout of ${item.name}`];
    });
  });
}
