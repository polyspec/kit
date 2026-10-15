// The vendor directory of a Composer project, shared by run-tests (PHPUnit of the vendor directory), lint-php (the
// autoloader of PHPStan) and the php runner of parity (PHPUnit of the package). Composer installs into the folder `vendor` beside the composer.json of the project, or into the
// folder that COMPOSER_VENDOR_DIR, the vendor directory setting of Composer, names relative to it.
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The vendor directory of the Composer project in the folder `project`, absolute when `project` is. */
export const composerVendor = (project: string): string => path.resolve(project, process.env.COMPOSER_VENDOR_DIR || 'vendor');

/**
 * The file `file` of the vendor directory that Composer gives the package `folder` (relative to `root`): that of the nearest
 * project that is `folder` or a folder above it, is a Composer project (`isProject`, given a folder relative to `root`) and
 * has the file. A library of a Composer monorepo commits no lock and has no vendor directory; the development project at the
 * root requires it through a path repository and installs one vendor directory for both. Returns the path relative to
 * `root`, or undefined when no such project has the file.
 */
export function packageVendorFile(root: string, folder: string, file: string, isProject: (project: string) => boolean): string | undefined {
  for (let project = folder; ; project = path.posix.dirname(project)) {
    if (isProject(project)) {
      const found = path.join(composerVendor(path.join(root, project)), file);
      if (existsSync(found)) return path.relative(root, found);
    }
    if (project === '.') return undefined;
  }
}

/**
 * The autoloader that Composer gives the PHP files of the package `folder` (relative to `root`): the `autoload.php` of the
 * nearest project among `projects` (the folders with a composer.json, relative to `root`) that has one (packageVendorFile).
 */
export const packageAutoloader = (root: string, folder: string, projects: readonly string[]): string | undefined =>
  packageVendorFile(root, folder, 'autoload.php', project => projects.includes(project));
