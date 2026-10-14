// Installs the PHPUnit release that config/toolchain.json phpunit declares into var/tools/phpunit, with the wrapper phpunit
// in var/tools/bin, from the Composer project of config/phpunit by install-composer-project.mts, without Composer plugins.
import path from 'node:path';
import { printedRelease } from './bootstrap/tool-wrappers.mts';
import { installComposerProject } from './install-composer-project.mts';

/** The wrapper of var/tools/bin that runs the installed PHPUnit, with its path in the installation. */
export const PHPUNIT_WRAPPERS = { phpunit: 'vendor/bin/phpunit' };

/** Installs the declared PHPUnit `{ version, manifest }` into var/tools/phpunit of `root` and writes the wrapper. */
export function installPhpunit({ root, declared, print = () => {} }: { root: string; declared: { version: string; manifest: string }; print?: (text: string) => void }) {
  return installComposerProject({
    root, label: 'PHPUnit', folder: 'phpunit', project: path.dirname(declared.manifest), recorded: declared.version, plugins: false,
    installedRelease: (directory: string) => printedRelease(path.join(directory, 'vendor/bin/phpunit'), 'phpunit'),
    wrappers: PHPUNIT_WRAPPERS, comment: `PHPUnit ${declared.version}`, print,
  });
}
