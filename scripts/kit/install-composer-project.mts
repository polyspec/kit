// Installs a Composer project of kit (config/phpunit, config/php-lint) into its folder of var/tools, with the wrappers of
// its commands in var/tools/bin. The composer.json and composer.lock of the project are copied into the temporary directory
// of the install, and `composer install` with the composer.phar of var/tools/composer, the Composer that install-composer.mts
// installs with its sha256, resolves the locked packages; Composer checks the digest of each archive against the lock.
// Composer keeps its home and cache in var/tools/composer and writes no link, so the install of var/tools holds no symbolic
// link. A project runs the Composer plugins that its composer.json allows only when `plugins` says so. An installed release
// is kept, and the Composer of the machine is never used.
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { installOnce } from './bootstrap/install-tool.mts';
import { bootstrapEnvironment, quote, run, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';

/**
 * Installs the Composer project of the folder `project` (relative to `root`) into var/tools/<folder>. `recorded` is the release
 * that `installedRelease(directory)` reads from an installation; `wrappers` maps each command of var/tools/bin to its path
 * in the installation, and `comment` names the release in the wrappers.
 */
export function installComposerProject({ root, label, folder, project, recorded, installedRelease, plugins, wrappers, comment, print = () => {} }: {
  root: string; label: string; folder: string; project: string; recorded: string; installedRelease: (directory: string) => string | undefined;
  plugins: boolean; wrappers: Record<string, string>; comment: string; print?: (text: string) => void;
}) {
  const composer = toolsPath(root, 'composer', 'composer.phar');
  if (!existsSync(composer)) throw new Error(`${label} needs ${path.relative(root, composer)}, the Composer that config/toolchain.json composer declares; declare composer and run make install-tools TOOLS=composer`);
  const prefix = toolsPath(root, folder);
  const environment = bootstrapEnvironment(root, { COMPOSER_HOME: toolsPath(root, 'composer', 'home'), COMPOSER_CACHE_DIR: toolsPath(root, 'composer', 'cache') });
  const result = installOnce({
    root, label, prefix, recorded, installedRelease, print,
    install: (next: string) => {
      for (const file of ['composer.json', 'composer.lock']) copyFileSync(path.join(root, project, file), path.join(next, file));
      run('php', [composer, 'install', '--no-interaction', '--no-progress', '--no-scripts', ...(plugins ? [] : ['--no-plugins']), '--prefer-dist'], { cwd: next, env: environment }, print);
    },
  });
  for (const [name, command] of Object.entries(wrappers)) writeWrapper(root, name, wrapperText(`${comment} of this checkout`, `exec ${quote(path.join(prefix, command))} "$@"`), print);
  return result;
}
