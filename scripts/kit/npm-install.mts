// Installs the npm packages of a consumer in place of its npm ci (K448-2, `make npm-install DIR=<project>`). A polyspec package that a
// sibling checkout provides is linked from the start: the install runs in a temporary folder whose package.json names each such
// package as a file: dependency of its checkout (an absolute path), so npm links the folder and fetches no release. The result is
// moved into the project, with each link made absolute. The tracked package.json and package-lock.json are never written. Without a
// sibling that provides a package the project declares, as in CI, npm ci runs on the tracked lock.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJsonObject } from './bootstrap/files.mts';
import { isMain } from './paths.mts';
import { declaredFor } from './polyspec-lock-check.mts';
import { workTreeOf } from './link-providers.mts';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** The name of the package that `checkout` provides, read from its package.json; undefined when it has none. */
function nameOf(checkout: string): string | undefined {
  if (!existsSync(path.join(checkout, 'package.json'))) return undefined;
  const name = readJsonObject(checkout, 'package.json').name;
  return typeof name === 'string' ? name : undefined;
}

/** The package name of an overrides key without its version or range: "@scope/name@1.0.0" and "name@^2" name "@scope/name" and "name". */
function packageNameOf(key: string): string {
  const at = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  return at === -1 ? key : key.slice(0, at);
}

/**
 * The workspace patterns of a manifest (`workspaces` as a list, or as an object with `packages`), each re-anchored from the temporary folder
 * to the project, so that npm links the workspace folders of the project and no workspace is dropped (K465). A negated pattern keeps its `!`.
 */
function workspacesIn(workspaces: unknown, fromTemporary: string): unknown {
  const anchor = (entry: unknown): unknown => {
    if (typeof entry !== 'string') return entry;
    const negated = entry.startsWith('!');
    const joined = path.posix.join(fromTemporary, negated ? entry.slice(1) : entry);
    return negated ? `!${joined}` : joined;
  };
  const anchorAll = (entries: unknown[]): unknown[] => entries.map((entry: unknown) => anchor(entry));
  if (Array.isArray(workspaces)) return anchorAll(workspaces);
  if (typeof workspaces === 'object' && workspaces !== null && 'packages' in workspaces && Array.isArray(workspaces.packages)) {
    return { ...workspaces, packages: anchorAll(workspaces.packages) };
  }
  return workspaces;
}

/** The links under `dir` whose target does not exist, each with its path; a link of a scope folder is read too. */
function danglingLinksIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const item = path.join(dir, entry);
    if (lstatSync(item).isSymbolicLink()) return existsSync(item) ? [] : [item];
    return entry.startsWith('@') || entry === '.bin' ? danglingLinksIn(item) : [];
  });
}

/** The package folders that a repository root holds under packages/: each directory there with a package.json, sorted. */
function packageFoldersOf(checkout: string): string[] {
  // K448-13: a package may sit deeper than one folder under packages/ (hyper: packages/server/ts), so the folders are searched to a depth of
  // three, not only the direct children; node_modules is never searched.
  const found: string[] = [];
  const visit = (folder: string, depth: number) => {
    if (depth > 3) return;
    for (const entry of readdirSync(folder).sort()) {
      if (entry === 'node_modules') continue;
      const child = path.join(folder, entry);
      if (!lstatSync(child).isDirectory()) continue;
      if (existsSync(path.join(child, 'package.json'))) found.push(child);
      visit(child, depth + 1);
    }
  };
  const packages = path.join(checkout, 'packages');
  if (existsSync(packages) && lstatSync(packages).isDirectory()) visit(packages, 1);
  return found;
}

/**
 * Installs the packages of `directory` and returns the path that it took: `linked` (a sibling package of the project is linked from
 * its checkout) or `locked` (npm ci of the tracked lock). `npm` is the npm to run; the environment is `env`.
 */
export function npmInstall({ directory, checkouts, npm = 'npm', env = process.env, print, explicit = false }: {
  directory: string; checkouts: readonly string[]; npm?: string; env?: NodeJS.ProcessEnv; print: (text: string) => void; explicit?: boolean;
}): 'linked' | 'locked' {
  const project = path.resolve(directory);
  const manifest = readJsonObject(project, 'package.json');
  const sectionOf = (section: string): Record<string, unknown> => {
    const value = manifest[section];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
  };
  // The packages that config/polyspec.json declares for the project are declared too (K468): the tracked manifest names none.
  const declared = new Set([...SECTIONS.flatMap(section => Object.keys(sectionOf(section))), ...declaredFor(workTreeOf(project), 'npm', project)]);
  // The packages of the lock too: a transitive package is named only there, and a sibling checkout that provides it is linked through
  // an override of the temporary manifest (K448-7).
  const lock = path.join(project, 'package-lock.json');
  const locked = new Set<string>();
  if (existsSync(lock)) {
    const packages = readJsonObject(project, 'package-lock.json').packages;
    if (typeof packages === 'object' && packages !== null) {
      for (const key of Object.keys(packages)) {
        const at = key.lastIndexOf('node_modules/');
        if (at !== -1) locked.add(key.slice(at + 'node_modules/'.length));
      }
    }
  }
  const wanted = new Set([...declared, ...locked]);
  // The checkouts that the caller names are package folders (K448-9). A repository root holds them under packages/: it is refused,
  // naming them, instead of being skipped, so nothing is guessed.
  if (explicit) {
    for (const checkout of checkouts) {
      const folders = packageFoldersOf(checkout);
      if (folders.length) throw new Error(`${checkout} is a repository root, not a package folder; give the package folders it contains: ${folders.join(', ')}`);
      if (nameOf(checkout) === undefined) throw new Error(`${checkout} is not a package folder: it has no package.json with a name`);
    }
  }
  const provided = new Map<string, string>();
  // A sibling checkout is a repository root, whose npm packages sit under packages/ (template's @polyspec/template is in
  // packages/ts), so its package folders are looked at too; a checkout that the caller names is a package folder already (K448-11).
  for (const checkout of explicit ? checkouts : checkouts.flatMap(checkout => [checkout, ...packageFoldersOf(checkout)])) {
    const name = nameOf(checkout);
    if (name !== undefined && wanted.has(name) && !provided.has(name)) provided.set(name, path.resolve(checkout));
  }
  // With the checkouts that the caller names (explicit), a declared @polyspec package that no checkout provides is a failure, not a
  // reason to run npm ci of the released tarballs (K448-7).
  if (explicit) {
    const missing = [...wanted].filter(name => name.startsWith('@polyspec/') && !provided.has(name) && declared.has(name));
    if (missing.length) throw new Error(`${missing.join(', ')} has no checkout among the given checkouts; give the checkout that provides it, and never a release`);
  }
  if (provided.size === 0) {
    print(`npm-install ${project}: no sibling checkout provides a package the project declares; npm ci of the tracked lock`);
    const ci = spawnSync(npm, ['ci', '--no-audit', '--no-fund'], { cwd: project, env, encoding: 'utf8' });
    if (ci.status !== 0) throw new Error(`npm ci of ${project} exited ${ci.status}: ${ci.stderr}`);
    return 'locked';
  }
  // The temporary folder lies under the real path of tmpdir(), so the relative paths of the workspaces are plain climbs: npm drops a
  // workspace whose path crosses a symbolic link, such as /var to /private/var on macOS (K465).
  const temporary = mkdtempSync(path.join(realpathSync(tmpdir()), 'kit-npm-install-'));
  try {
    const linked: Record<string, unknown> = { ...manifest };
    // The workspaces of the root are the project's own packages: the temporary install reads them from the project (K465).
    if ('workspaces' in manifest) linked.workspaces = workspacesIn(manifest.workspaces, path.posix.relative(temporary.split(path.sep).join('/'), project.split(path.sep).join('/')));
    const fromProject = (spec: string): string =>
      spec.startsWith('file:') && !path.isAbsolute(spec.slice('file:'.length)) ? `file:${path.resolve(project, spec.slice('file:'.length))}` : spec;
    for (const section of SECTIONS) {
      const deps: Record<string, unknown> = sectionOf(section);
      if (Object.keys(deps).length === 0) continue;
      for (const [name, folder] of provided) if (name in deps) deps[name] = `file:${folder}`;
      // The manifest is installed from a temporary folder, so a relative file: spec of the project is given from the project folder
      // (K448-12).
      for (const [name, spec] of Object.entries(deps)) if (typeof spec === 'string') deps[name] = fromProject(spec);
      linked[section] = deps;
    }
    // Every overrides entry that names a provided package, at any depth, takes its checkout folder: npm refuses an override of a direct
    // dependency whose spec differs from the dependency's (EOVERRIDE, npm docs: package.json, overrides), so no asset spec of a provided
    // package stays in the temporary manifest (K448-10). The other overrides of the manifest are kept.
    const rewrite = (entries: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(entries).map(([key, value]) => {
      const folder = provided.get(packageNameOf(key));
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nested = rewrite(Object.fromEntries(Object.entries(value)));
        if (folder !== undefined) nested['.'] = `file:${folder}`;
        return [key, nested];
      }
      return [key, folder !== undefined ? `file:${folder}` : typeof value === 'string' ? fromProject(value) : value];
    }));
    const overrides = rewrite(sectionOf('overrides'));
    // The packages that only the lock names, transitively, are linked through overrides (K448-7).
    for (const [name, folder] of provided) if (!declared.has(name) && !(name in overrides)) overrides[name] = `file:${folder}`;
    if (Object.keys(overrides).length) linked.overrides = overrides;
    writeFileSync(path.join(temporary, 'package.json'), JSON.stringify(linked, null, 2) + '\n');
    if (existsSync(lock)) copyFileSync(lock, path.join(temporary, 'package-lock.json'));
    const install = spawnSync(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: temporary, env, encoding: 'utf8' });
    if (install.status !== 0) throw new Error(`npm install of the linked packages of ${project} exited ${install.status}: ${install.stderr}`);
    // npm links a file: folder with a relative symlink: make each one absolute before the folder moves.
    const modules = path.join(temporary, 'node_modules');
    const scopes = existsSync(modules) ? readdirSync(modules) : [];
    const absolute = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const item = path.join(dir, entry);
        if (entry.startsWith('@') && lstatSync(item).isDirectory()) { absolute(item); continue; }
        if (!lstatSync(item).isSymbolicLink()) continue;
        const target = path.resolve(dir, readlinkSync(item));
        unlinkSync(item);
        symlinkSync(target, item);
      }
    };
    void scopes;
    absolute(modules);
    const destination = path.join(project, 'node_modules');
    rmSync(destination, { recursive: true, force: true });
    renameSync(modules, destination);
    // An install that leaves a dangling link of the project fails, never exits 0 with it (K465).
    const dangling = danglingLinksIn(destination);
    if (dangling.length) throw new Error(`npm install of ${project} left dangling links: ${dangling.join(', ')}`);
    print(`npm-install ${project}: linked ${[...provided.keys()].join(', ')} from their checkouts`);
    return 'linked';
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const [directory, ...given] = process.argv.slice(2);
  if (directory === undefined) {
    process.stderr.write('Usage: node scripts/kit/npm-install.mts <dir> [<checkout>...]\n');
    process.exitCode = 2;
  } else {
    // The checkouts that the caller names are linked whatever their origin; without them the sibling checkouts of the repository are used.
    const { siblingCheckouts } = await import('./link-providers.mts');
    const checkouts = given.length ? given.map(checkout => path.resolve(checkout)) : siblingCheckouts(path.resolve(directory)).checkouts;
    try {
      npmInstall({ directory, checkouts, explicit: given.length > 0, npm: process.env.NPM_BIN ?? 'npm', print: text => process.stdout.write(`${text}\n`) });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
