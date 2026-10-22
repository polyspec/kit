// The link of kit (K448): each installed polyspec package folder is a direct symlink to the package folder of the checkout that
// provides it. No package manager resolves anything and no version is read: the tracked lock is installed once, as it is, and the
// link replaces each provided package folder, removing a copy. link-state-check reads the same folders.
//
//   npm       node_modules/<name>                  -> the folder of the provider's package.json
//   Composer  <vendor-dir>/<vendor>/<package>      -> the folder of the provider's composer.json
//   Python    <site-packages>/<package path>       -> the same package path under the provider's source root (src/ when it has one),
//             one link per package, so the packages of one namespace (polyspec/orm, polyspec/ordered_json) link apart
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { readToml } from './toml.mts';
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

/** Whether `file` exists as an entry, a dangling link included. */
const present = (file: string): boolean => {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * The site-packages folders of the environment of `project`, the one that uv syncs: `environment` (UV_PROJECT_ENVIRONMENT, relative to the
 * project or absolute, K448-14), else .venv; each is <environment>/lib/<python>/site-packages.
 */
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

/** The vendor folder of the Composer project `project`: composer.json's config.vendor-dir, else vendor. */
function vendorDirectory(project: string, vendorDir: string | undefined): string {
  return path.join(project, vendorDir ?? 'vendor');
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
    } else if (provider.ecosystem === 'python') {
      const source = existsSync(path.join(provider.folder, 'src')) ? path.join(provider.folder, 'src') : provider.folder;
      for (const site of sites) {
        for (const relative of pythonPackages(source)) {
          const folder = path.join(site, relative);
          if (present(folder)) found.push({ ecosystem: 'python', name: `${provider.name} ${relative}`, folder, target: path.join(source, relative) });
        }
      }
    }
  }
  return found;
}

/** Whether `folder` is a symbolic link that resolves to `target`. */
const linksTo = (folder: string, target: string): boolean => lstatSync(folder).isSymbolicLink() && existsSync(folder) && realpathSync(folder) === realpathSync(target);

/** Replaces each provided folder that is not a link to its target with that link; returns a line for each folder it changed. */
export function linkFolders(folders: readonly ProvidedFolder[]): string[] {
  const lines: string[] = [];
  for (const item of folders) {
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

/** The findings of the provided folders: a copy, or a link to another folder than its provider's. Nothing else is judged. */
export function folderFindings(root: string, folders: readonly ProvidedFolder[]): string[] {
  return folders.flatMap((item) => {
    const shown = path.relative(root, item.folder);
    if (!lstatSync(item.folder).isSymbolicLink()) return [`${item.ecosystem} ${item.name}: ${shown} is a copy, not a link to ${item.target}; fix: make link`];
    if (!linksTo(item.folder, item.target)) return [`${item.ecosystem} ${item.name}: ${shown} links to ${existsSync(item.folder) ? realpathSync(item.folder) : 'nothing'}, not to ${item.target}; fix: make link`];
    return [];
  });
}
