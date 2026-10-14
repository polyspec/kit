#!/usr/bin/env node
// Lints the PHP of the checkout with the phpcs and the PHPStan of var/tools (`make lint-php`), the Composer project of
// config/php-lint:
//   - phpcs with the root phpcs.xml.dist, the PSR-12 rules that kit copies, on the PHP files of the checkout; PSR-1
//     MultipleClasses holds one class per file (S2).
//   - PHPStan with the root phpstan.dist.neon, the disallowed calls of S2 (spl_autoload_register and a ClassLoader changed at
//     run time), on the PHP files of each Composer package, a folder with a composer.json, from the package folder and with
//     the autoloader that Composer gives its files, so a call through a variable or an object is resolved: the
//     vendor/autoload.php of the package, or of the nearest Composer project above it, such as the development project at
//     the root of a Composer monorepo, whose path repositories require the libraries (composer-vendor.mts; COMPOSER_VENDOR_DIR
//     names another vendor directory). A package with PHP files and no such autoloader fails with the install it needs.
// The stubs of a PHP extension (*.stub.php) are the input of php-src's gen_stub.php and are left out. A missing tool or
// configuration is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-php.mts
import path from 'node:path';
import { composerVendor, packageAutoloader } from './composer-vendor.mts';
import { foldersOf, lintCommands, lintMain, packageOwner, requireConfigurations, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { checkedFiles } from './tracked-files.mts';
import { present } from './present.mts';

/** The steps of the lint of `root`; throws when a tool, a configuration or the autoloader of a package is missing. */
export function lintSteps(root: string): LintStep[] {
  const tools = lintCommands(root, 'var/tools/bin', ['phpcs', 'phpstan'], 'run make install-tools TOOLS=phpLint, which installs config/php-lint');
  requireConfigurations(root, [['phpcs.xml.dist', 'PHP lint'], ['phpstan.dist.neon', 'PHP lint']]);
  const files = checkedFiles(root);
  const sources = files.filter(file => file.endsWith('.php') && !file.endsWith('.stub.php'));
  if (sources.length === 0) return [];
  const packages = foldersOf(root, 'composer.json');
  const owner = packageOwner(packages);
  const steps: LintStep[] = [{ label: 'phpcs', command: present(tools.phpcs, 'tools.phpcs'), args: ['-q', '-s', '--report=emacs', '--standard=phpcs.xml.dist', ...sources], cwd: '.' }];
  for (const folder of packages) {
    const own = sources.filter(file => owner(file) === folder).map(file => path.posix.relative(folder, file));
    if (own.length === 0) continue;
    const autoloader = packageAutoloader(root, folder, packages);
    if (!autoloader) throw new Error(`${path.relative(root, path.join(composerVendor(path.join(root, folder)), 'autoload.php'))} is missing, and no Composer project above ${folder} has one; PHPStan resolves the calls of the package with its autoloader: run composer install in ${folder}, or in the project that requires it`);
    steps.push({ label: `phpstan ${folder}`, command: present(tools.phpstan, 'tools.phpstan'), args: ['analyse', '--no-progress', '--error-format=raw', `--configuration=${path.join(root, 'phpstan.dist.neon')}`, `--autoload-file=${path.relative(path.join(root, folder), path.join(root, autoloader))}`, ...own], cwd: folder });
  }
  return steps;
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-php', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-php', lintSteps);
