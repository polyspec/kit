// Installs the PHP lint of kit, the Composer project of config/php-lint (phpcs, PHPStan, spaze/phpstan-disallowed-calls and
// phpstan/extension-installer), into var/tools/php-lint, with the wrappers phpcs and phpstan in var/tools/bin, by
// install-composer-project.mts. The release of the project is the sha256 of its composer.lock: an installation holds the
// lock it was installed from, so a changed lock installs again. extension-installer is a Composer plugin, which the
// composer.json of the project allows; it registers the disallowed calls of PHPStan, so phpstan.dist.neon names no path.
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import { installComposerProject } from './install-composer-project.mts';

/** Installs the declared PHP lint `{ lock, manifest }` (lock: the sha256 of its composer.lock) into var/tools/php-lint of `root`. */
export function installPhpLint({ root, declared, print = () => {} }: { root: string; declared: { lock: string; manifest: string }; print?: (text: string) => void }) {
  return installComposerProject({
    root, label: 'php-lint', folder: 'php-lint', project: path.dirname(declared.manifest), recorded: declared.lock, plugins: true,
    installedRelease: (directory: string) => (statSync(path.join(directory, 'composer.lock'), { throwIfNoEntry: false }) && statSync(path.join(directory, 'vendor'), { throwIfNoEntry: false }) ? fileDigest(path.join(directory, 'composer.lock')) : undefined),
    wrappers: { phpcs: 'vendor/bin/phpcs', phpstan: 'vendor/bin/phpstan' }, comment: `The PHP lint of the composer.lock ${declared.lock.slice(0, 12)}`, print,
  });
}
