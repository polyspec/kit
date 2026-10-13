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
// configuration is a failure with its fix, never a skip. Every step runs, also after a failure of an earlier one, and each
// prints one line.
//
//   node scripts/kit/lint-php.mts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain, ROOT } from './paths.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** A step of the lint: the command, its arguments and the folder it runs in, relative to the root. */
export type LintStep = { label: string; command: string; args: string[]; cwd: string };

/** The steps of the lint of `root`; throws when a tool, a configuration or the autoloader of a package is missing. */
export function lintSteps(root: string): LintStep[] {
  const tools: Record<string, string> = {};
  for (const tool of ['phpcs', 'phpstan']) {
    const command = path.join(root, 'var/tools/bin', tool);
    if (!existsSync(command)) throw new Error(`${path.relative(root, command)} is missing; run make install-tools TOOLS=phpLint, which installs config/php-lint`);
    tools[tool] = command;
  }
  for (const file of ['phpcs.xml.dist', 'phpstan.dist.neon']) {
    if (!existsSync(path.join(root, file))) throw new Error(`${file} is missing; it is the PHP lint configuration that kit copies into every repository (make kit-sync)`);
  }
  const files = checkedFiles(root);
  const sources = files.filter(file => file.endsWith('.php') && !file.endsWith('.stub.php'));
  if (sources.length === 0) return [];
  const packages = files.filter(file => path.posix.basename(file) === 'composer.json').map(file => path.posix.dirname(file));
  // Each file belongs to the package of the deepest folder that holds it.
  const owner = (file: string) => packages.filter(folder => folder === '.' || file.startsWith(`${folder}/`)).sort((a, b) => b.length - a.length)[0];
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
  const failed: string[] = [];
  for (const step of lintSteps(root)) {
    const result = execute(step.command, step.args, { cwd: path.join(root, step.cwd) });
    print(`${result.stdout}${result.stderr}`);
    if (result.error || result.status !== 0) {
      failed.push(step.label);
      console.log(`[lint-php] ${step.label}: failed with ${result.error?.message ?? `exit status ${result.status}`}`);
    } else {
      console.log(`[lint-php] ${step.label}: passed`);
    }
  }
  return failed;
}

if (isMain(import.meta.url)) {
  try {
    const failed = lint(ROOT);
    if (failed.length) {
      console.error(`[lint-php] ${failed.length} steps failed: ${failed.join('; ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // lint and the modules it calls throw only an Error.
    console.error(`[lint-php] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
