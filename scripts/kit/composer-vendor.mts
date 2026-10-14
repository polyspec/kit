// The vendor directory of a Composer project, shared by run-tests (PHPUnit of the vendor directory) and lint-php (the
// autoloader of PHPStan). Composer installs into the folder `vendor` beside the composer.json of the project, or into the
// folder that COMPOSER_VENDOR_DIR, the vendor directory setting of Composer, names relative to it.
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The vendor directory of the Composer project in the folder `project`, absolute when `project` is. */
export const composerVendor = (project: string): string => path.resolve(project, process.env.COMPOSER_VENDOR_DIR || 'vendor');

/**
 * The autoloader that Composer gives the PHP files of the package `folder` (relative to `root`): the `autoload.php` of the
 * vendor directory of the nearest project among `projects` (the folders with a composer.json, relative to `root`) that is
 * `folder` or a folder above it and has one. A library of a Composer monorepo commits no lock and has no vendor directory;
 * the development project at the root requires it through a path repository and its autoloader loads it. Returns the path
 * relative to `root`, or undefined when no such project has installed its vendor directory.
 */
export function packageAutoloader(root: string, folder: string, projects: readonly string[]): string | undefined {
  for (let project = folder; ; project = path.posix.dirname(project)) {
    if (projects.includes(project)) {
      const autoloader = path.join(composerVendor(path.join(root, project)), 'autoload.php');
      if (existsSync(autoloader)) return path.relative(root, autoloader);
    }
    if (project === '.') return undefined;
  }
}
