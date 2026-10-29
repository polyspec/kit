// Installs a Composer project of kit (config/phpunit, config/php-lint) into its folder of var/tools, with the wrappers of
// its commands in var/tools/bin. `composer install`, with the Composer of mise.toml (its shim, mise-tools.mts; mise.lock pins its
// sha256), runs in the folder of the project and resolves its committed lock into the vendor directory var/tools/<folder>/vendor
// (COMPOSER_VENDOR_DIR); an install over a vendor directory that already holds the lock does nothing, and Composer checks the
// platform requirements of the lock under the PHP of var/tools/bin on each run. Each package is pinned by the commit reference of
// its dist and source in the lock; the lock holds no digest of an archive (Packagist gives an empty shasum for a GitHub archive),
// so Composer checks none (K258). Composer keeps its home and cache in var/tools/composer. A project runs the Composer plugins
// that its composer.json allows only when `plugins` says so. The Composer of the machine is never used.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { quote, run, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';

/** The shim of the Composer of mise.toml; `user` names what needs it in the error that a missing Composer throws. */
export function composerCommand(root: string, user: string): string {
  const composer = toolCommand(root, 'composer');
  if (!existsSync(composer)) throw new Error(`${user} needs ${path.relative(root, composer)}, the Composer of mise.toml; declare http:composer in mise.toml and run make install-tools`);
  return composer;
}

/** The environment of a Composer of kit: the tools of mise, with the home and the cache of Composer in var/tools/composer. */
export const composerEnvironment = (root: string): NodeJS.ProcessEnv => toolsEnvironment(root, { ...process.env, COMPOSER_HOME: toolsPath(root, 'composer', 'home'), COMPOSER_CACHE_DIR: toolsPath(root, 'composer', 'cache') });

/**
 * Installs the Composer project of the folder `project` (relative to `root`) into var/tools/<folder> with `composer install`;
 * `wrappers` maps each command of var/tools/bin to its path in the installation, and `comment` names the release in the wrappers.
 */
export function installComposerProject({ root, label, folder, project, plugins, wrappers, comment, print = () => {} }: {
  root: string; label: string; folder: string; project: string; plugins: boolean; wrappers: Record<string, string>; comment: string; print?: (text: string) => void;
}): void {
  const prefix = toolsPath(root, folder);
  const environment = { ...composerEnvironment(root), COMPOSER_VENDOR_DIR: path.join(prefix, 'vendor') };
  run(composerCommand(root, label), ['install', '--no-interaction', '--no-progress', '--no-scripts', ...(plugins ? [] : ['--no-plugins']), '--prefer-dist'], { cwd: path.join(root, project), env: environment }, print);
  for (const [name, command] of Object.entries(wrappers)) writeWrapper(root, name, wrapperText(`${comment} of this checkout`, `exec ${quote(path.join(prefix, command))} "$@"`), print);
}
