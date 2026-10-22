// Installs the Composer project of a consumer (K432, K448, `make composer-install DIR=<project>`): composer install of the tracked lock as it
// is, with the Composer and environment of install-composer-project.mts, then each installed package that a checkout provides becomes a
// direct symlink to the checkout's package folder (link-folders.mts). No link manifest, no partial update and no version is read.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkoutProviders, composerVendorDir, linkFolders, providedFolders } from './link-folders.mts';
import { siblingCheckouts, workTreeOf } from './link-providers.mts';
import { isMain } from './paths.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { run } from './process.mts';

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
