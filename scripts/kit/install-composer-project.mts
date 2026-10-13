// Installs a Composer project of kit (config/phpunit, config/php-lint) into its folder of var/tools, with the wrappers of
// its commands in var/tools/bin. The composer.json and composer.lock of the project are copied into the temporary directory
// of the install, and `composer install` with the Composer of mise.toml (its shim, mise-tools.mts; mise.lock pins its sha256),
// run in that directory of the checkout, resolves the locked packages; Composer checks the digest of each archive against the
// lock. Composer keeps its home and cache in var/tools/composer and writes no link, so the project holds no symbolic link. A project runs the Composer plugins that its composer.json allows only when `plugins` says so. An installed release
// is kept, and the Composer of the machine is never used.
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { installOnce } from './bootstrap/install-tool.mts';
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
 * Installs the Composer project of the folder `project` (relative to `root`) into var/tools/<folder>. `recorded` is the release
 * that `installedRelease(directory)` reads from an installation; `wrappers` maps each command of var/tools/bin to its path
 * in the installation, and `comment` names the release in the wrappers.
 */
export function installComposerProject({ root, label, folder, project, recorded, installedRelease, plugins, wrappers, comment, print = () => {} }: {
  root: string; label: string; folder: string; project: string; recorded: string; installedRelease: (directory: string) => string | undefined;
  plugins: boolean; wrappers: Record<string, string>; comment: string; print?: (text: string) => void;
}) {
  const composer = composerCommand(root, label);
  const prefix = toolsPath(root, folder);
  const environment = composerEnvironment(root);
  const result = installOnce({
    root, label, prefix, recorded, installedRelease, print,
    install: (next: string) => {
      for (const file of ['composer.json', 'composer.lock']) copyFileSync(path.join(root, project, file), path.join(next, file));
      run(composer, ['install', '--no-interaction', '--no-progress', '--no-scripts', ...(plugins ? [] : ['--no-plugins']), '--prefer-dist'], { cwd: next, env: environment }, print);
    },
  });
  for (const [name, command] of Object.entries(wrappers)) writeWrapper(root, name, wrapperText(`${comment} of this checkout`, `exec ${quote(path.join(prefix, command))} "$@"`), print);
  return result;
}
