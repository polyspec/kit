// Installs the PHP lint of kit, the Composer project of config/php-lint (phpcs, PHPStan, spaze/phpstan-disallowed-calls,
// ShipMonk's caught-exception cause rule and phpstan/extension-installer), into var/tools/php-lint, with the wrappers phpcs
// and phpstan in var/tools/bin, by install-composer-project.mts, whose composer install of the committed lock installs again
// when the lock changes. extension-installer is a Composer plugin, which the composer.json of the project allows; it registers
// the PHPStan extensions, so phpstan.dist.neon names no package path.
import path from 'node:path';
import { installComposerProject } from './install-composer-project.mts';

/** The wrappers of var/tools/bin that run the installed PHP lint, with their paths in the installation. */
export const PHP_LINT_WRAPPERS = { phpcs: 'vendor/bin/phpcs', phpstan: 'vendor/bin/phpstan' };

/** Installs the declared PHP lint `{ lock, manifest }` (lock: the sha256 of its composer.lock) into var/tools/php-lint of `root`. */
export function installPhpLint({ root, declared, print = () => {} }: { root: string; declared: { lock: string; manifest: string }; print?: (text: string) => void }) {
  installComposerProject({
    root, folder: 'php-lint', project: path.dirname(declared.manifest), plugins: true,
    wrappers: PHP_LINT_WRAPPERS, comment: `The PHP lint of the composer.lock ${declared.lock.slice(0, 12)}`, print,
  });
}
