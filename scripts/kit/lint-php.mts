#!/usr/bin/env node
// Lints the PHP of the checkout with the phpcs and the PHPStan of var/tools (`make lint-php`), the Composer project of
// config/php-lint:
//   - phpcs with the root phpcs.xml.dist, the PSR-12 rules that kit copies, on the PHP files of the checkout; PSR-1
//     MultipleClasses holds one class per file (S2).
//   - PHPStan with the root phpstan.dist.neon, the disallowed calls of S2 (spl_autoload_register and a ClassLoader changed at
//     run time), on the PHP files of each Composer package, a folder with a composer.json, from the package folder and with
//     the autoloader of its vendor/, so a call through a variable or an object is resolved. A package with PHP files and no
//     vendor/autoload.php fails with the install it needs.
// The stubs of a PHP extension (*.stub.php) are the input of php-src's gen_stub.php and are left out. A missing tool or
// configuration is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-php.mts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { foldersOf, lintCommands, lintMain, packageOwner, requireConfigurations, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { ROOT } from './paths.mts';
import { checkedFiles } from './tracked-files.mts';

/** The steps of the lint of `root`; throws when a tool, a configuration or the autoloader of a package is missing. */
export function lintSteps(root: string): LintStep[] {
  const tools = lintCommands(root, 'var/tools/bin', ['phpcs', 'phpstan'], 'run make install-tools TOOLS=phpLint, which installs config/php-lint');
  requireConfigurations(root, [['phpcs.xml.dist', 'PHP lint'], ['phpstan.dist.neon', 'PHP lint']]);
  const files = checkedFiles(root);
  const sources = files.filter(file => file.endsWith('.php') && !file.endsWith('.stub.php'));
  if (sources.length === 0) return [];
  const packages = foldersOf(root, 'composer.json');
  const owner = packageOwner(packages);
  const steps: LintStep[] = [{ label: 'phpcs', command: tools.phpcs!, args: ['-q', '-s', '--report=emacs', '--standard=phpcs.xml.dist', ...sources], cwd: '.' }];
  for (const folder of packages) {
    const own = sources.filter(file => owner(file) === folder).map(file => path.posix.relative(folder, file));
    if (own.length === 0) continue;
    if (!existsSync(path.join(root, folder, 'vendor/autoload.php'))) throw new Error(`${path.posix.join(folder, 'vendor/autoload.php')} is missing; PHPStan resolves the calls of the package with its autoloader: run composer install in ${folder}`);
    steps.push({ label: `phpstan ${folder}`, command: tools.phpstan!, args: ['analyse', '--no-progress', '--error-format=raw', `--configuration=${path.join(root, 'phpstan.dist.neon')}`, '--autoload-file=vendor/autoload.php', ...own], cwd: folder });
  }
  return steps;
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-php', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-php', ROOT, lintSteps);
