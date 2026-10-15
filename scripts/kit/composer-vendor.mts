// The vendor directory of a Composer project, shared by run-tests (PHPUnit of the vendor directory), lint-php (the
// autoloader of PHPStan) and the php runner of parity (PHPUnit of the package). Composer decides it, not kit (K184):
// `composer config vendor-dir`, run in the folder of the composer.json with the Composer of mise.toml of the checkout, applies
// Composer's own rule (the folder `vendor`, COMPOSER_VENDOR_DIR, config.vendor-dir of the composer.json or of the global
// configuration, with ~ and the environment expanded), offline. Without --absolute it answers relative to that folder, which
// kit resolves against the folder as kit names it; --absolute would join it to the real path of the folder, which differs
// under a symbolic link, such as /var on macOS.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { composerCommand } from './install-composer-project.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { repositoryRoot } from './paths.mts';
import { run } from './process.mts';

/**
 * The vendor directory that Composer gives the Composer project in the folder `project` (which has a composer.json), absolute
 * when `project` is; the Composer of the checkout that kit runs in answers.
 */
export function composerVendor(project: string): string {
  const checkout = repositoryRoot();
  const composer = composerCommand(checkout, 'the vendor directory of a Composer project');
  const answer = run(composer, ['config', '--no-interaction', '--no-plugins', 'vendor-dir'], { cwd: project, env: toolsEnvironment(checkout) });
  return path.resolve(project, answer.trim());
}

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
