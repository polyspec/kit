// Installs the locked npm dependencies with npm ci, then asks npm link to connect the selected local sources.
// npm owns the installed links and metadata; --no-save retains release files while npm reads the lock.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readJsonObject } from './bootstrap/files.mts';
import { isMain } from './paths.mts';
import { checkoutProviders, providedFolders, type ProvidedFolder } from './link-folders.mts';
import { run } from './process.mts';
import type { Provider } from './link-providers.mts';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
const SOURCE_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** Selects installed provider packages and declared provider dependencies, including sources not installed yet. */
export function npmSourceFolders(project: string, providers: Iterable<Provider>): ProvidedFolder[] {
  const npm = [...providers].filter(provider => provider.ecosystem === 'npm');
  const folders = providedFolders(project, npm);
  const manifest = readJsonObject(project, 'package.json');
  const declared = new Set(SECTIONS.flatMap(section => {
    const dependencies = manifest[section];
    return typeof dependencies === 'object' && dependencies !== null && !Array.isArray(dependencies) ? Object.keys(dependencies) : [];
  }));
  const selected = new Set(folders.map(folder => folder.name));
  for (const provider of npm) {
    if (!declared.has(provider.name) || selected.has(provider.name)) continue;
    folders.push({ ecosystem: 'npm', name: provider.name, folder: path.join(project, 'node_modules', provider.name), target: provider.folder });
    selected.add(provider.name);
  }
  // A linked package can carry dependencies that its consumer does not declare. Link every local provider in that source graph as
  // well, or npm resolves the release of a transitive dependency while processing the linked package (K672).
  const byName = new Map(npm.map(provider => [provider.name, provider]));
  const queue = [...selected];
  for (let index = 0; index < queue.length; index += 1) {
    const provider = byName.get(queue[index] ?? '');
    if (!provider) continue;
    const source = readJsonObject(provider.folder, 'package.json');
    const dependencies = SOURCE_SECTIONS.flatMap(section => {
      const value = source[section];
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
    });
    for (const name of dependencies) {
      const dependency = byName.get(name);
      if (!dependency || selected.has(name)) continue;
      folders.push({ ecosystem: 'npm', name, folder: path.join(project, 'node_modules', name), target: dependency.folder });
      selected.add(name);
      queue.push(name);
    }
  }
  return folders;
}

/** Links local npm packages with npm, retaining the release manifest and lock and a project-local global prefix. */
export function npmLink(project: string, folders: readonly ProvidedFolder[], npm: string, env: NodeJS.ProcessEnv, print: (text: string) => void): void {
  const npmFolders = folders.filter(folder => folder.ecosystem === 'npm');
  const targets = [...new Set(npmFolders.map(folder => folder.target))];
  if (targets.length === 0) return;
  if (npmFolders.length > 0 && npmFolders.every(folder => existsSync(folder.folder) && existsSync(folder.target)
    && realpathSync(folder.folder) === realpathSync(folder.target))) {
    print('npm link: every selected package already resolves to its source; skipped consumer reification');
    return;
  }
  const prefix = path.join(project, 'var/link/npm');
  mkdirSync(prefix, { recursive: true });
  print(`npm link: ${targets.join(', ')}: started`);
  const environment = { ...env, npm_config_prefix: prefix, npm_config_cache: path.join(prefix, 'cache'), npm_config_allow_remote: 'root' };
  const flags = ['--no-save', '--no-audit', '--no-fund'];
  for (const target of targets) {
    print(`npm link provider: ${target}`);
    run(npm, ['link', ...flags], { cwd: target, env: environment });
  }
  const names = [...new Set(npmFolders.map(folder => folder.name))];
  const output = run(npm, ['link', ...names, ...flags, '--workspaces=false'], { cwd: project, env: environment });
  if (output.trim()) print(output.trim());
  print('npm link: passed');
}

/**
 * Installs the packages of `directory` and returns the path that it took: `linked` (a package of the project is linked to its checkout)
 * or `locked` (no checkout provides one). The tracked lock is installed as it is, with npm ci, and each installed package that a checkout
 * provides is connected by npm link. npm manages its own dependency resolution and installed records. `npm` is the npm to run;
 * the environment is `env`.
 */
export function npmInstall({ directory, checkouts, npm = 'npm', env = process.env, print, explicit = false, added = [] }: {
  directory: string; checkouts: readonly string[]; npm?: string; env?: NodeJS.ProcessEnv; print: (text: string) => void; explicit?: boolean;
  added?: readonly string[];
}): 'linked' | 'locked' {
  const project = path.resolve(directory);
  const manifest = readJsonObject(project, 'package.json');
  const sectionOf = (section: string): Record<string, unknown> => {
    const value = manifest[section];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
  };
  // The packages that the manifest declares, whose releases the tracked lock records (K507, K515).
  const declared = new Set(SECTIONS.flatMap(section => Object.keys(sectionOf(section))));
  // A checkout that the caller names is a package folder or a repository root (K494): a root holds its npm packages under packages/, which
  // the kit finds itself; a checkout that provides no npm package provides none (K494-1); a named entry that is no directory is refused.
  for (const checkout of [...(explicit ? checkouts : []), ...added]) {
    if (!existsSync(checkout) || !lstatSync(checkout).isDirectory()) throw new Error(`${checkout} is no existing directory`);
  }
  const provided = new Map(checkoutProviders(checkouts, 'npm').map(item => [item.name, item.folder]));
  // An added checkout (ADD, K485) provides its packages whether or not the project declares them: each is linked even when npm ci did
  // not install it.
  const forced = new Map<string, string>();
  for (const checkout of added) {
    const named = checkoutProviders([checkout], 'npm');
    if (named.length === 0) throw new Error(`${checkout} holds no package with a name; ADD takes a package folder or a repository root`);
    for (const item of named) forced.set(item.name, item.folder);
  }
  // A declared @polyspec package that no checkout provides is a failure in every mode (K448-7, K483-1).
  const missing = [...declared].filter(name => name.startsWith('@polyspec/') && !provided.has(name) && !forced.has(name));
  if (missing.length) throw new Error(`${missing.join(', ')} has no checkout: give the checkout that provides it`);
  // npm ci empties node_modules and keeps the directory itself, so a node_modules that is a mount point stays (K486). The lock
  // resolves @polyspec/kit from the URL of its release asset, which npm refuses unless allow-remote opts in: root allows only the
  // URLs that package.json names, as install-packages does (K526).
  const ci = spawnSync(npm, ['ci', '--no-audit', '--no-fund'], { cwd: project, env: { ...env, npm_config_allow_remote: 'root' }, encoding: 'utf8' });
  if (ci.status !== 0) throw new Error(`npm ci of ${project} exited ${ci.status}: ${ci.stderr}`);
  const folders = providedFolders(project, [...provided].map(([name, folder]) => ({ ecosystem: 'npm' as const, name, folder, repository: folder, checkout: folder })));
  for (const [name, folder] of forced) {
    const installed = path.join(project, 'node_modules', name);
    if (!folders.some(item => item.folder === installed)) {
      folders.push({ ecosystem: 'npm', name, folder: installed, target: folder });
    }
  }
  if (folders.length === 0) {
    print(`npm-install ${project}: npm ci of the tracked lock; no installed package is provided by a checkout`);
    return 'locked';
  }
  npmLink(project, folders, npm, env, print);
  print(`npm-install ${project}: npm ci of the tracked lock, then linked ${folders.map(item => item.name).join(', ')} to their checkouts`);
  return 'linked';
}

if (isMain(import.meta.url)) {
  const [directory, ...rest] = process.argv.slice(2);
  // `--add <checkout>` names a checkout whose package the project does not declare (K485); every other argument is a checkout (K448-7).
  const given: string[] = [];
  const added: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === undefined) break;
    if (argument === '--add') {
      const checkout = rest[index + 1];
      if (checkout === undefined) throw new Error('--add takes a checkout');
      added.push(path.resolve(checkout));
      index += 1;
    } else {
      given.push(argument);
    }
  }
  if (directory === undefined) {
    process.stderr.write('Usage: node scripts/kit/npm-install.mts <dir> [<checkout>...] [--add <checkout>...]\n');
    process.exitCode = 2;
  } else {
    // The checkouts that the caller names are linked whatever their origin; without them the sibling checkouts of the repository are used.
    const { siblingCheckouts } = await import('./link-providers.mts');
    const checkouts = given.length ? given.map(checkout => path.resolve(checkout)) : siblingCheckouts(path.resolve(directory)).checkouts;
    try {
      npmInstall({ directory, checkouts, added, explicit: given.length > 0, npm: process.env.NPM_BIN ?? 'npm', print: text => process.stdout.write(`${text}\n`) });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
