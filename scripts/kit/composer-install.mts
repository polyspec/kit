// Installs the Composer project of a consumer (K432, K448, `make composer-install DIR=<project>`): composer install of the tracked lock as it
// is, with the Composer and environment of install-composer-project.mts, then each installed package that a checkout provides becomes a
// direct symlink to the checkout's package folder (link-folders.mts). Composer reconciles stale source requirements in run-specific records.
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { isJsonList, isJsonObject, readJsonObject, writeJson } from './bootstrap/files.mts';
import { acquireHolderLock } from './holder-lock.mts';
import type { ProvidedFolder } from './link-folders.mts';
import type { Tool } from './link-providers.mts';
import { checkoutProviders, composerVendorDir, linkFolders, providedFolders } from './link-folders.mts';
import { siblingCheckouts, workTreeOf } from './link-providers.mts';
import { isMain } from './paths.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { run } from './process.mts';

/**
 * Reconciles stale runtime requirements of installed Composer source links through Composer. The release lock remains
 * unchanged; Composer resolves only the linked packages in a run-specific manifest and writes its own runtime records.
 */
export function reconcileComposerLinks(project: string, folders: readonly ProvidedFolder[], composer: () => Tool, print: (text: string) => void): boolean {
  const linked = folders.filter(folder => folder.ecosystem === 'composer');
  const first = linked[0];
  if (!first) return false;
  const vendor = path.dirname(path.dirname(first.folder));
  const installedFile = path.join(vendor, 'composer/installed.json');
  if (!existsSync(installedFile)) return false;
  const record = readJsonObject(installedFile);
  if (!isJsonList(record.packages)) throw new Error(`${installedFile}: expected packages to be an array`);
  if (!record.packages.every(isJsonObject)) throw new Error(`${installedFile}: expected every package record to be an object`);
  const packages = record.packages;
  const stale = linked.filter(folder => {
    const source = readJsonObject(folder.target, 'composer.json');
    const installed = packages.find(item => item.name === folder.name);
    if (!installed) throw new Error(`${installedFile}: expected installed package ${folder.name}, found no record`);
    return !isDeepStrictEqual(source.require ?? {}, installed.require ?? {});
  });
  if (stale.length === 0) return false;
  const workspace = path.join(project, 'var/link/composer');
  mkdirSync(workspace, { recursive: true });
  const held = acquireHolderLock(path.join(workspace, 'metadata.lock'), { checkout: project, command: 'Composer source metadata reconciliation' });
  let directory: string | undefined;
  try {
    directory = mkdtempSync(path.join(workspace, 'run-'));
    const manifest = readJsonObject(project, 'composer.json');
    const repositories = linked.map(folder => {
      const installed = packages.find(item => item.name === folder.name);
      if (typeof installed?.version !== 'string') throw new Error(`${installedFile}: expected a version for ${folder.name}`);
      return { type: 'path', url: path.relative(project, folder.target).split(path.sep).join('/'), options: { symlink: true, versions: { [folder.name]: installed.version } } };
    });
    const existing = manifest.repositories ?? [];
    if (!isJsonList(existing) && !isJsonObject(existing)) throw new Error(`${project}/composer.json: expected repositories to be an array or object`);
    const combined = isJsonList(existing) ? [...repositories, ...existing]
      : { ...Object.fromEntries(repositories.map((repository, index) => [`kit-source-${index}`, repository])), ...existing };
    const file = path.join(directory, 'composer.json');
    writeJson(file, { ...manifest, repositories: combined });
    copyFileSync(path.join(project, 'composer.lock'), path.join(directory, 'composer.lock'));
    const tool = composer();
    const environment = { ...tool.env, COMPOSER: path.relative(project, file), COMPOSER_DISABLE_NETWORK: '1' };
    const common = ['--no-interaction', '--no-scripts', '--no-plugins'];
    print(`Composer metadata: reconciling ${stale.map(folder => folder.name).join(', ')}: started`);
    run(tool.command, ['update', ...linked.map(folder => folder.name), '--no-install', ...common, '--no-audit'], { cwd: project, env: environment });
    const original = readJsonObject(project, 'composer.lock');
    const resolved = readJsonObject(directory, 'composer.lock');
    const names = new Set(linked.map(folder => folder.name));
    for (const section of ['packages', 'packages-dev']) {
      const unlinked = (lock: Record<string, unknown>) => {
        const entries = lock[section] ?? [];
        if (!isJsonList(entries)) throw new Error(`${section}: expected a package array`);
        return entries.filter(entry => !isJsonObject(entry) || !names.has(String(entry.name)));
      };
      if (!isDeepStrictEqual(unlinked(original), unlinked(resolved))) throw new Error(`Composer metadata: expected unchanged external ${section}; Composer resolved different records`);
    }
    run(tool.command, ['install', ...common, ...(record.dev === false ? ['--no-dev'] : [])], { cwd: project, env: environment });
    linkFolders(linked);
    print('Composer metadata: reconciled linked source requirements: passed');
    return true;
  } finally {
    try {
      if (directory) rmSync(directory, { recursive: true, force: true });
    } finally {
      held.release();
    }
  }
}

/**
 * Installs the Composer project of `directory` and returns the path that it took: `linked` (a package of the project is linked to its
 * checkout) or `locked`. COMPOSER_BIN names the Composer when the recipe gives it. `noDev` installs with --no-dev (K483-2).
 */
export function composerInstall({ directory, checkouts, env = process.env, print, noDev = false }: {
  directory: string; checkouts: readonly string[]; env?: NodeJS.ProcessEnv; print: (text: string) => void; noDev?: boolean;
}): 'linked' | 'locked' {
  const project = path.resolve(directory);
  const composer = { command: env.COMPOSER_BIN ?? composerCommand(workTreeOf(project), 'make composer-install'), env: composerEnvironment(workTreeOf(project)) };
  run(composer.command, ['install', '--no-interaction', ...(noDev ? ['--no-dev'] : [])], { cwd: project, env: composer.env });
  const folders = providedFolders(project, checkoutProviders(checkouts, 'composer'), { vendorDir: composerVendorDir(project, process.env) });
  if (folders.length === 0) {
    print(`composer-install ${project}: composer install of the tracked lock; no installed package is provided by a checkout`);
    return 'locked';
  }
  linkFolders(folders);
  reconcileComposerLinks(project, folders, () => composer, print);
  print(`composer-install ${project}: composer install of the tracked lock, then linked ${folders.map(item => item.name).join(', ')} to their checkouts`);
  return 'linked';
}

if (isMain(import.meta.url)) {
  // Arguments after DIR are the checkouts that provide the polyspec packages (K501), and --no-dev.
  const [directory, ...given] = process.argv.slice(2);
  const checkouts = given.filter(argument => argument !== '--no-dev');
  if (directory === undefined || checkouts.some(argument => argument.startsWith('--'))) {
    process.stderr.write('Usage: node scripts/kit/composer-install.mts <dir> [--no-dev] [<checkout>...]\n');
    process.exitCode = 2;
  } else {
    composerInstall({
      directory,
      checkouts: checkouts.length ? checkouts.map(checkout => path.resolve(checkout)) : siblingCheckouts(path.resolve(directory)).checkouts,
      noDev: given.includes('--no-dev'),
      print: text => process.stdout.write(`${text}\n`),
    });
  }
}
