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

/**
 * Installs the packages of `directory` and returns the path that it took: `linked` (a sibling package of the project is linked from
 * its checkout) or `locked` (npm ci of the tracked lock). `npm` is the npm to run; the environment is `env`.
 */
export function npmInstall({ directory, checkouts, npm = 'npm', env = process.env, print }: {
  directory: string; checkouts: readonly string[]; npm?: string; env?: NodeJS.ProcessEnv; print: (text: string) => void;
}): 'linked' | 'locked' {
  const project = path.resolve(directory);
  const manifest = readJsonObject(project, 'package.json');
  const sectionOf = (section: string): Record<string, unknown> => {
    const value = manifest[section];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
  };
  const declared = new Set(SECTIONS.flatMap(section => Object.keys(sectionOf(section))));
  const provided = new Map<string, string>();
  for (const checkout of checkouts) {
    const name = nameOf(checkout);
    if (name !== undefined && declared.has(name) && !provided.has(name)) provided.set(name, path.resolve(checkout));
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
    writeFileSync(path.join(temporary, 'package.json'), JSON.stringify(linked, null, 2) + '\n');
    const lock = path.join(project, 'package-lock.json');
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
  const [directory] = process.argv.slice(2);
  if (directory === undefined) {
    process.stderr.write('Usage: node scripts/kit/npm-install.mts <dir>\n');
    process.exitCode = 2;
  } else {
    const { siblingCheckouts } = await import('./link-providers.mts');
    npmInstall({ directory, checkouts: siblingCheckouts(path.resolve(directory)).checkouts, npm: process.env.NPM_BIN ?? 'npm', print: text => process.stdout.write(`${text}\n`) });
  }
}
