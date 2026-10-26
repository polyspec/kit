// Installs declared Composer dependencies with Composer. Local source dependencies use the path repositories of the
// selected manifest (COMPOSER, or composer.json); Composer owns the lock, links, installed records and autoload.
import path from 'node:path';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isJsonList, isJsonObject, readJsonObject } from './bootstrap/files.mts';
import type { ProvidedFolder } from './link-folders.mts';
import type { Tool } from './link-providers.mts';
import { checkoutProviders, providedFolders } from './link-folders.mts';
import { siblingCheckouts, workTreeOf } from './link-providers.mts';
import { isMain } from './paths.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { composerVendor } from './composer-vendor.mts';
import { run } from './process.mts';

/** The explicit Composer manifest of a project, following Composer's COMPOSER environment variable. */
function manifestOf(project: string, env: NodeJS.ProcessEnv): string {
  return path.resolve(project, env.COMPOSER || 'composer.json');
}

/** Refuses undeclared local source installs before running a Composer update. Composer interprets the repository URLs. */
function requirePathRepository(project: string, tool: Tool): string {
  const file = manifestOf(project, tool.env);
  const repositories = readJsonObject(file).repositories ?? [];
  if (!isJsonList(repositories) && !isJsonObject(repositories)) throw new Error(`${file}: repositories must be an array or object`);
  const entries = isJsonList(repositories) ? repositories : Object.values(repositories);
  if (!entries.some(entry => isJsonObject(entry) && entry.type === 'path')) {
    throw new Error(`${file}: local source linking requires a declared Composer path repository with options.symlink=true; declare the source path and compatible requirements, then run composer update`);
  }
  return file;
}

/**
 * Updates the selected manifest's declared local packages through Composer and verifies their source links. Composer may
 * update that manifest's lock and dependency graph; no synthetic manifest, version alias or runtime metadata is written.
 */
export function composerLink(project: string, folders: readonly ProvidedFolder[], tool: Tool, print: (text: string) => void, noDev = false): boolean {
  const linked = folders.filter(folder => folder.ecosystem === 'composer');
  if (linked.length === 0) return false;
  const file = requirePathRepository(project, tool);
  const names = [...new Set(linked.map(folder => folder.name))];
  print(`Composer local sources: updating ${names.join(', ')} with ${file}; its lock and dependent packages may change: started`);
  const output = run(tool.command, ['update', ...names, '--with-dependencies', '--no-interaction', '--no-audit', ...(noDev ? ['--no-dev'] : [])], { cwd: project, env: tool.env });
  if (output.trim()) print(output.trim());
  for (const folder of linked) {
    if (!existsSync(folder.folder) || !lstatSync(folder.folder).isSymbolicLink() || realpathSync(folder.folder) !== realpathSync(folder.target)) {
      throw new Error(`${file}: Composer did not link ${folder.name} to ${folder.target}; declare its path repository with options.symlink=true and compatible requirements`);
    }
  }
  print('Composer local sources: native update and links passed');
  return true;
}

/** Installs the selected Composer manifest, then updates declared local sources through Composer when checkouts provide them. */
export function composerInstall({ directory, checkouts, env = process.env, print, noDev = false }: {
  directory: string; checkouts: readonly string[]; env?: NodeJS.ProcessEnv; print: (text: string) => void; noDev?: boolean;
}): 'linked' | 'locked' {
  const project = path.resolve(directory);
  const root = workTreeOf(project);
  const composer = { command: env.COMPOSER_BIN ?? composerCommand(root, 'make composer-install'), env: { ...composerEnvironment(root), ...env } };
  print(`composer-install ${project}: Composer install of ${manifestOf(project, composer.env)}: started`);
  const output = run(composer.command, ['install', '--no-interaction', ...(noDev ? ['--no-dev'] : [])], { cwd: project, env: composer.env });
  if (output.trim()) print(output.trim());
  const folders = providedFolders(project, checkoutProviders(checkouts, 'composer'), { vendorDir: composerVendor(project, composer) });
  if (folders.length === 0) {
    print(`composer-install ${project}: Composer install passed; no installed package is provided by a checkout`);
    return 'locked';
  }
  composerLink(project, folders, composer, print, noDev);
  print(`composer-install ${project}: Composer owns the links of ${folders.map(item => item.name).join(', ')}`);
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
