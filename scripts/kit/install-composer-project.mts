// Installs a Composer project of kit (config/phpunit, config/php-lint) into its folder of var/tools, with the wrappers of its
// commands in var/tools/bin. `composer install`, with the Composer of mise.toml (its shim, mise-tools.mts; mise.lock pins its
// sha256), runs in the checkout root with Composer's --working-dir of the project, so the shim reads the mise.toml of the checkout
// and not the one of a linked kit checkout that holds the project (K885), and resolves its committed lock into the vendor
// directory var/tools/<folder>/vendor (COMPOSER_VENDOR_DIR); an install over a vendor directory that already holds the lock does
// nothing, and Composer checks the platform requirements of the lock under the PHP of var/tools/bin on each run. Each package is
// pinned by the commit reference of its dist and source in the lock; the lock holds no digest of an archive (Packagist gives an
// empty shasum for a GitHub archive), so Composer checks none (K258). Composer runs with the environment of the caller and no
// flag beside --working-dir: its home, its cache, the plugins that the composer.json of the project allows and the scripts it
// runs are the caller's and the project's (K1095). The Composer is that of the checkout, else the one on PATH (K947).
import path from 'node:path';
import { quote, run, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';
import { toolCommand } from './mise-tools.mts';

/**
 * Installs the Composer project of the folder `project` (relative to `root`) into var/tools/<folder> with `composer install`;
 * `wrappers` maps each command of var/tools/bin to its path in the installation, and `comment` names the release in the wrappers.
 */
export function installComposerProject({ root, folder, project, wrappers, comment, print = () => {} }: {
  root: string; folder: string; project: string; wrappers: Record<string, string>; comment: string; print?: (text: string) => void;
}): void {
  const prefix = toolsPath(root, folder);
  const environment = { ...process.env, COMPOSER_VENDOR_DIR: path.join(prefix, 'vendor') };
  run(toolCommand(root, 'composer'), ['install', `--working-dir=${path.join(root, project)}`], { cwd: root, env: environment }, print);
  for (const [name, command] of Object.entries(wrappers)) writeWrapper(root, name, wrapperText(`${comment} of this checkout`, `exec ${quote(path.join(prefix, command))} "$@"`), print);
}
