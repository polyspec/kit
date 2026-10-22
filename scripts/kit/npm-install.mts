// Installs the npm packages of a consumer (`make npm-install DIR=<project>`, K448): npm ci of the tracked lock as it is, then each
// installed package that a checkout provides becomes a direct symlink to the checkout's package folder (link-folders.mts). No file:
// spec, no temporary manifest and no npm resolution touch a provided package, so no version is read. The tracked package.json and
// package-lock.json are never written.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { readJsonObject } from './bootstrap/files.mts';
import { isMain } from './paths.mts';
import { declaredFor } from './polyspec-lock-check.mts';
import { checkoutProviders, linkFolders, providedFolders } from './link-folders.mts';
import { workTreeOf } from './link-providers.mts';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

/**
 * Installs the packages of `directory` and returns the path that it took: `linked` (a package of the project is linked to its checkout)
 * or `locked` (no checkout provides one). The tracked lock is installed as it is, with npm ci, and each installed package that a checkout
 * provides is then replaced by a direct symlink to its checkout (K448), so npm resolves nothing of a provided package and no version is
 * read. `npm` is the npm to run; the environment is `env`.
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
  // The packages that config/polyspec.json declares for the project are declared too (K468): the tracked manifest names none.
  const declared = new Set([...SECTIONS.flatMap(section => Object.keys(sectionOf(section))), ...declaredFor(workTreeOf(project), 'npm', project)]);
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
  // npm ci empties node_modules and keeps the directory itself, so a node_modules that is a mount point stays (K486).
  const ci = spawnSync(npm, ['ci', '--no-audit', '--no-fund'], { cwd: project, env, encoding: 'utf8' });
  if (ci.status !== 0) throw new Error(`npm ci of ${project} exited ${ci.status}: ${ci.stderr}`);
  const folders = providedFolders(project, [...provided].map(([name, folder]) => ({ ecosystem: 'npm' as const, name, folder, repository: folder, checkout: folder })));
  for (const [name, folder] of forced) {
    const installed = path.join(project, 'node_modules', name);
    if (!folders.some(item => item.folder === installed)) {
      mkdirSync(path.dirname(installed), { recursive: true });
      if (!existsSync(installed)) symlinkSync(folder, installed);
      folders.push({ ecosystem: 'npm', name, folder: installed, target: folder });
    }
  }
  if (folders.length === 0) {
    print(`npm-install ${project}: npm ci of the tracked lock; no installed package is provided by a checkout`);
    return 'locked';
  }
  linkFolders(folders);
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
