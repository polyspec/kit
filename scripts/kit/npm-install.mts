// Installs the npm packages of a consumer in place of its npm ci (K448-2, `make npm-install DIR=<project>`). A polyspec package that a
// sibling checkout provides is linked from the start: the install runs in a temporary folder whose package.json names each such
// package as a file: dependency of its checkout (an absolute path), so npm links the folder and fetches no release. The result is
// moved into the project, with each link made absolute. The tracked package.json and package-lock.json are never written. Without a
// sibling that provides a package the project declares, as in CI, npm ci runs on the tracked lock.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJsonObject } from './bootstrap/files.mts';
import { isMain } from './paths.mts';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** The name of the package that `checkout` provides, read from its package.json; undefined when it has none. */
function nameOf(checkout: string): string | undefined {
  if (!existsSync(path.join(checkout, 'package.json'))) return undefined;
  const name = readJsonObject(checkout, 'package.json').name;
  return typeof name === 'string' ? name : undefined;
}

/** The package folders that a repository root holds under packages/: each directory there with a package.json, sorted. */
function packageFoldersOf(checkout: string): string[] {
  const packages = path.join(checkout, 'packages');
  if (!existsSync(packages) || !lstatSync(packages).isDirectory()) return [];
  return readdirSync(packages).sort().map(entry => path.join(packages, entry))
    .filter(folder => lstatSync(folder).isDirectory() && existsSync(path.join(folder, 'package.json')));
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
  const declared = new Set(SECTIONS.flatMap(section => Object.keys(sectionOf(section))));
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
  for (const checkout of checkouts) {
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
  const temporary = mkdtempSync(path.join(tmpdir(), 'kit-npm-install-'));
  try {
    const linked: Record<string, unknown> = { ...manifest };
    for (const section of SECTIONS) {
      const deps: Record<string, unknown> = sectionOf(section);
      if (Object.keys(deps).length === 0) continue;
      for (const [name, folder] of provided) if (name in deps) deps[name] = `file:${folder}`;
      linked[section] = deps;
    }
    // The packages that only the lock names, transitively, are linked through overrides (K448-7).
    const overrides: Record<string, string> = {};
    for (const [name, folder] of provided) if (!declared.has(name)) overrides[name] = `file:${folder}`;
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
