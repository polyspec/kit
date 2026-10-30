// Installs declared Composer dependencies with Composer from the lock of the selected manifest (COMPOSER, or composer.json), then makes
// each installed polyspec package folder one plain directory symlink to its checkout (K761).
import path from 'node:path';
import { checkoutProviders, linkFolders, providedFolders } from './link-folders.mts';
import { declaredCheckouts, workTreeOf } from './link-providers.mts';
import { isMain } from './paths.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { composerVendor } from './composer-vendor.mts';
import { run } from './process.mts';

/** The explicit Composer manifest of a project, following Composer's COMPOSER environment variable. */
function manifestOf(project: string, env: NodeJS.ProcessEnv): string {
  return path.resolve(project, env.COMPOSER || 'composer.json');
}

/**
 * Installs the selected manifest with its native lock, then makes each installed folder of a provided package one plain directory symlink
 * to its checkout (K761); Composer's autoload names vendor/<vendor>/<package> and reads the checkout through the link.
 */
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
  for (const text of linkFolders(folders)) print(text);
  print(`composer-install ${project}: linked ${folders.map(item => item.name).join(', ')} to their checkouts`);
  return 'linked';
}

if (isMain(import.meta.url)) {
  // The providers are the checkouts of the link declaration (K869); --no-dev is the only option.
  const [directory, ...given] = process.argv.slice(2);
  if (directory === undefined || given.some(argument => argument !== '--no-dev')) {
    process.stderr.write('Usage: node scripts/kit/composer-install.mts <dir> [--no-dev]\n');
    process.exitCode = 2;
  } else {
    composerInstall({
      directory,
      checkouts: declaredCheckouts(path.resolve(directory)) ?? [],
      noDev: given.includes('--no-dev'),
      print: text => process.stdout.write(`${text}\n`),
    });
  }
}
