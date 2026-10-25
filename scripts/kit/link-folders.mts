// The link of kit (K448): each installed polyspec package folder is a direct symlink to the package folder of the checkout that
// provides it. No package manager resolves anything and no version is read: the tracked lock is installed once, as it is, and the
// link replaces each provided package folder, removing a copy. link-state-check reads the same folders.
//
//   npm       node_modules/<name>                  -> the folder of the provider's package.json; for a provider of another repository a
//             real folder of per-file links without the provider's node_modules, so a node run with --preserve-symlinks resolves the
//             package's dependencies from the consumer's node_modules (K558)
//   Composer  <vendor-dir>/<vendor>/<package>      -> the folder of the provider's composer.json
//   Python    <site-packages>/<package path>       -> the same package path under the provider's source root (src/ when it has one),
//             one link per package, so the packages of one namespace (polyspec/orm, polyspec/ordered_json) link apart; a source root
//             whose pyproject maps its directories in the hatchling wheel sources links each directory to its mapped package path (K529)
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
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
  /**
   * An npm package of the consumer's own repository, which stays the whole-folder link of its npm workspace (K530, K558), or one that
   * the consumer's package.json declares as a file: or link: dependency on a folder, which stays the link to the declared path that npm writes (K578).
   */
  own?: boolean;
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
 * The package folders of a checkout that the caller names (K494): the folders under packages/ to a depth of three (hyper's
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

// The specifiers of an npm dependency that names a folder of the consumer: npm writes its package folder as a link to that path (K578).
const LOCAL_SPECIFIER = /^(?:file|link):(.+)$/;

/**
 * The folder that the package.json of the npm project `project` declares for the package `name` as a file: or link: dependency, or
 * undefined when it declares none or has no package.json (K578): npm writes that package folder as a link to the folder, which the
 * consumer may require. A path that is no folder, as a tarball, is none (K579): npm unpacks a tarball into a real folder.
 */
function declaredPath(project: string, name: string): string | undefined {
  if (!existsSync(path.join(project, 'package.json'))) return undefined;
  const manifest = readJsonObject(project, 'package.json');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = manifest[field];
    const specifier = isJsonObject(entries) ? entries[name] : undefined;
    const local = typeof specifier === 'string' ? LOCAL_SPECIFIER.exec(specifier)?.[1] : undefined;
    if (local === undefined) continue;
    const declared = path.resolve(project, local);
    return statSync(declared, { throwIfNoEntry: false })?.isDirectory() === true ? declared : undefined;
  }
  return undefined;
}

/** Whether the folder `folder` is `root` or lies below it, by their real paths when they exist (K558). */
const within = (folder: string, root: string): boolean => {
  const real = (item: string) => (existsSync(item) ? realpathSync(item) : path.resolve(item));
  const inner = real(folder);
  const outer = real(root);
  return inner === outer || inner.startsWith(`${outer}${path.sep}`);
};

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

/** The name of a distribution as a wheel writes it in its dist-info folder: lower case, with each run of -, _ and . as _ (K545). */
export const distributionKey = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '_');

/**
 * The distributions that the environment of `project` holds by their dist-info records (K545), as distributionKey: uv counts a package
 * as installed by its record, whether its folder is there or not.
 */
export function installedDistributions(project: string, environment: string | undefined): Set<string> {
  const held = new Set<string>();
  for (const site of sitePackages(project, environment)) {
    for (const name of readdirSync(site)) {
      const record = /^(.+?)-[^-]+\.dist-info$/.exec(name);
      if (record?.[1] !== undefined) held.add(distributionKey(record[1]));
    }
  }
  return held;
}

function sitePackages(project: string, environment: string | undefined): string[] {
  const lib = path.join(path.resolve(project, environment === undefined || environment === '' ? '.venv' : environment), 'lib');
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
 * source directory of the folder is installed as the package path of its entry, so the member limepie-contracts maps src to
 * limepie/contracts. Empty when the pyproject declares no such table.
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
export function providedFolders(project: string, provided: Iterable<Provider>, { vendorDir, environment = process.env.UV_PROJECT_ENVIRONMENT, held }: { vendorDir?: string | undefined; environment?: string | undefined; held?: ReadonlySet<string> | undefined } = {}): ProvidedFolder[] {
  const found: ProvidedFolder[] = [];
  const sites = sitePackages(project, environment);
  // K554: a provided Python package that the environment holds by its dist-info gets its folder in the first site-packages, also when
  // the folder is missing, so link builds it from the checkout; its checkout must hold a package.
  const wanted = (provider: Provider, site: string, folder: string) => present(folder) || (held?.has(distributionKey(provider.name)) === true && site === sites[0]);
  for (const provider of provided) {
    if (provider.ecosystem === 'npm') {
      const folder = path.join(project, 'node_modules', provider.name);
      const declared = declaredPath(project, provider.name);
      if (present(folder)) found.push({ ecosystem: 'npm', name: provider.name, folder, target: declared ?? provider.folder, own: declared !== undefined || within(project, provider.checkout) });
    } else if (provider.ecosystem === 'composer') {
      const folder = path.join(vendorDirectory(project, vendorDir), provider.name);
      if (present(folder)) found.push({ ecosystem: 'composer', name: provider.name, folder, target: provider.folder });
    } else if (provider.ecosystem === 'python' && hatchSources(provider.folder).length > 0) {
      for (const site of sites) {
        for (const { from, to } of hatchSources(provider.folder)) {
          const folder = path.join(site, to);
          if (wanted(provider, site, folder)) found.push({ ecosystem: 'python', name: `${provider.name} ${to}`, folder, target: path.join(provider.folder, from) });
        }
      }
    } else if (provider.ecosystem === 'python') {
      const source = existsSync(path.join(provider.folder, 'src')) ? path.join(provider.folder, 'src') : provider.folder;
      const packages = pythonPackages(source);
      if (packages.length === 0 && held?.has(distributionKey(provider.name)) === true) throw new Error(`${provider.name} is held in the environment, but its checkout ${source} holds no package to link (K554)`);
      for (const site of sites) {
        for (const relative of packages) {
          const folder = path.join(site, relative);
          if (wanted(provider, site, folder)) found.push({ ecosystem: 'python', name: `${provider.name} ${relative}`, folder, target: path.join(source, relative) });
        }
      }
    }
  }
  return found;
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
 * The folders that a tree of per-file links leaves out, at any depth, by ecosystem: the caches of Python (K541); the node_modules of the
 * provider, which node would resolve before the consumer's, and Git's folder, which npm never publishes (K558). In the consumer's folder
 * the same names are no entries of the tree, so the node_modules that the consumer's npm installs in a package folder stays.
 */
const LEFT_OUT = { python: new Set(['__pycache__']), npm: new Set(['node_modules', '.git']) } as const;

/** Why a directory link of a package folder is a finding, by ecosystem (K541, K558). */
const DIRECTORY_LINK = {
  python: 'through which uv deletes its files',
  npm: 'through which node resolves the provider\'s node_modules',
} as const;

/** The ecosystems whose package folder is a tree of per-file links. */
type TreeEcosystem = keyof typeof LEFT_OUT;

/**
 * The top-level entries of the npm provider `target` below which its tree holds files (K558): those that a positive entry of the files
 * of its package.json names by its first segment, or undefined, every entry, when it declares no files or a positive entry starts with a
 * pattern. The top-level files are always in the tree, as package.json, which npm always publishes, so the tree holds at least every file
 * that npm publishes.
 */
function npmPublishedRoots(target: string): Set<string> | undefined {
  const files = readJsonObject(path.join(target, MANIFEST.npm)).files;
  if (files === undefined) return undefined;
  if (!Array.isArray(files)) throw new Error(`files of ${path.join(target, MANIFEST.npm)} is no list`);
  const roots = new Set<string>();
  for (const entry of files) {
    if (typeof entry !== 'string') throw new Error(`files of ${path.join(target, MANIFEST.npm)} holds ${JSON.stringify(entry)}, which is no path`);
    if (entry.startsWith('!')) continue;
    const first = entry.replace(/^\.?\//, '').split('/')[0] ?? '';
    if (/[*?[{]/.test(first)) return undefined;
    roots.add(first);
  }
  return roots;
}

/** The files of the provider folder of `item`, relative to it, at any depth, without the folders of LEFT_OUT and, for npm, below the roots that it publishes. */
function providerFiles(item: ProvidedFolder & { ecosystem: TreeEcosystem }): string[] {
  const left = LEFT_OUT[item.ecosystem];
  const roots = item.ecosystem === 'npm' ? npmPublishedRoots(item.target) : undefined;
  const visit = (relative: string): string[] => readdirSync(path.join(item.target, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(relative, entry.name);
    if (!entry.isDirectory()) return [name];
    if (left.has(entry.name) || (relative === '' && roots !== undefined && !roots.has(entry.name))) return [];
    return visit(name);
  });
  return visit('').sort();
}

/** The entries of the folder `folder`, relative to it, at any depth, without the folders of `left`: files, links and empty folders. */
function treeEntries(folder: string, left: ReadonlySet<string>, relative = ''): string[] {
  return readdirSync(path.join(folder, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) return left.has(entry.name) ? [] : treeEntries(folder, left, name);
    return [name];
  }).sort();
}

/** Whether the package folder of `item` is a tree of per-file links: a Python package (K541), an npm package of another repository (K558). */
const isTree = (item: ProvidedFolder): item is ProvidedFolder & { ecosystem: TreeEcosystem } => item.ecosystem === 'python' || (item.ecosystem === 'npm' && item.own !== true);

/**
 * The findings of the package folder of `item`, a tree (K541, K558): it is a real folder whose entries are exactly the files of the
 * provider, each a link to its file. uv deletes and writes through a directory link and never through the link of a file; node resolves
 * the imports of a file from its real path, and with --preserve-symlinks from the folder of its link, where a directory link holds the
 * provider's node_modules.
 */
function treeFindings(root: string, item: ProvidedFolder & { ecosystem: TreeEcosystem }): string[] {
  const shown = path.relative(root, item.folder);
  const head = `${item.ecosystem} ${item.name}`;
  const stat = lstatSync(item.folder, { throwIfNoEntry: false });
  if (stat === undefined) return [`${head}: ${shown} is missing; fix: make link`];
  if (stat.isSymbolicLink()) return [`${head}: ${shown} is a directory link into the provider, ${DIRECTORY_LINK[item.ecosystem]}; fix: make link`];
  const files = providerFiles(item);
  const found = files.flatMap((file) => {
    const entry = path.join(item.folder, file);
    const stat = lstatSync(entry, { throwIfNoEntry: false });
    if (stat === undefined) return [`${head}: ${file} of the provider has no link; fix: make link`];
    if (!stat.isSymbolicLink()) return [`${head}: ${path.join(shown, file)} is a copy, not a link to ${path.join(item.target, file)}; fix: make link`];
    // A link is written relative to its folder (K326-3), so an absolute link that an earlier run wrote is a finding.
    if (path.isAbsolute(readlinkSync(entry))) return [`${head}: ${path.join(shown, file)} links to the absolute path ${readlinkSync(entry)}; fix: make link`];
    return linksTo(entry, path.join(item.target, file)) ? [] : [`${head}: ${path.join(shown, file)} links elsewhere than ${path.join(item.target, file)}; fix: make link`];
  });
  const extra = treeEntries(item.folder, LEFT_OUT[item.ecosystem]).filter(entry => !files.includes(entry));
  return [...found, ...extra.map(entry => `${head}: ${path.join(shown, entry)} is no file of the provider; fix: make link`)];
}

/**
 * Makes the package folder of `item` a real folder of relative per-file links into the provider (K541, K558), replacing a directory link,
 * a copy or an outdated tree; a removal takes the links and the copies of the folder, never the files of the provider, and keeps the
 * folders of LEFT_OUT, as the node_modules that the consumer's npm installed in it. Returns what the folder was, or undefined when it was
 * already the tree.
 */
function linkTree(root: string, item: ProvidedFolder & { ecosystem: TreeEcosystem }): string | undefined {
  const findings = treeFindings(root, item);
  if (findings.length === 0) return undefined;
  if (!existsSync(item.target)) throw new Error(`${item.name}: the checkout lacks ${item.target}, the package folder to link`);
  const stat = lstatSync(item.folder, { throwIfNoEntry: false });
  const was = stat === undefined ? 'missing' : stat.isSymbolicLink() ? 'a directory link' : 'a folder that differs from the provider';
  if (stat?.isDirectory() === true) {
    for (const name of readdirSync(item.folder)) if (!LEFT_OUT[item.ecosystem].has(name)) rmSync(path.join(item.folder, name), { recursive: true, force: true });
  } else {
    rmSync(item.folder, { recursive: true, force: true });
  }
  for (const file of providerFiles(item)) {
    const entry = path.join(item.folder, file);
    mkdirSync(path.dirname(entry), { recursive: true });
    symlinkSync(path.relative(path.dirname(entry), path.join(item.target, file)), entry);
  }
  return was;
}

/**
 * Replaces each provided folder that is not a link to its target with that link, and makes the folder of a Python package (K541) and of
 * an npm package of another repository (K558) a folder of per-file links; returns a line for each folder it changed.
 */
export function linkFolders(folders: readonly ProvidedFolder[]): string[] {
  const lines: string[] = [];
  for (const item of folders) {
    if (isTree(item)) {
      const was = linkTree(path.dirname(item.folder), item);
      if (was !== undefined) lines.push(`${item.ecosystem} ${item.name}: ${item.folder} was ${was}; linked file by file to ${item.target}`);
      continue;
    }
    // A link to the right folder stays, unless it is absolute, which is made relative (K326-3).
    if (linksTo(item.folder, item.target) && !path.isAbsolute(readlinkSync(item.folder))) continue;
    const was = lstatSync(item.folder).isSymbolicLink() ? 'a link elsewhere' : 'a copy';
    rmSync(item.folder, { recursive: true, force: true });
    // A relative link (K326-3): the checkout and its siblings move together, so the link survives a moved workspace.
    symlinkSync(path.relative(path.dirname(item.folder), item.target), item.folder);
    lines.push(`${item.ecosystem} ${item.name}: ${item.folder} was ${was}; linked to ${item.target}`);
  }
  return lines;
}

/** The findings of the provided folders: a copy, or a link to another folder than its provider's, and for a tree those of K541 and K558. */
export function folderFindings(root: string, folders: readonly ProvidedFolder[]): string[] {
  return folders.flatMap((item) => {
    if (isTree(item)) return treeFindings(root, item);
    const shown = path.relative(root, item.folder);
    if (!lstatSync(item.folder).isSymbolicLink()) return [`${item.ecosystem} ${item.name}: ${shown} is a copy, not a link to ${item.target}; fix: make link`];
    if (!linksTo(item.folder, item.target)) return [`${item.ecosystem} ${item.name}: ${shown} links to ${existsSync(item.folder) ? realpathSync(item.folder) : 'nothing'}, not to ${item.target}; fix: make link`];
    return [];
  });
}
