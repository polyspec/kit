#!/usr/bin/env node
// Lints the PHP of the checkout with the phpcs and the PHPStan of var/tools (`make lint-php`), the Composer project of
// config/php-lint:
//   - phpcs with the phpcs.xml.dist of the kit package (K514), the PSR-12 rules, on the PHP files of the checkout; PSR-1
//     MultipleClasses holds one class per file (S2).
//   - PHPStan with the root phpstan.dist.neon, the disallowed calls of S2 (spl_autoload_register and a ClassLoader changed at
//     run time), on the PHP files of each Composer package, a folder with a composer.json, from the package folder and with
//     the autoloader that Composer gives its files, so a call through a variable or an object is resolved: the
//     vendor/autoload.php of the package, or of the nearest Composer project above it, such as the development project at
//     the root of a Composer monorepo, whose path repositories require the libraries (composer-vendor.mts, which asks
//     Composer for the vendor directory). A package with PHP files and no such autoloader fails with the install it needs.
//   - the autoload files of each Composer package (`autoload.files` of its composer.json) hold only declarations of namespaced
//     functions and constants (S2), read with nikic/php-parser by autoload-files.php beside the symbol extractor (K377).
// The stubs of a PHP extension (*.stub.php) are the input of php-src's gen_stub.php and are left out. A missing tool or
// configuration is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-php.mts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { composerVendor, packageAutoloader } from './composer-vendor.mts';
import { readComposerManifestFile } from './manifests.mts';
import { SYMBOLS, symbolsPrefix } from './install-symbols.mts';
import { foldersOf, lintCommands, lintMain, packageOwner, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { checkedFiles } from './tracked-files.mts';
import { present } from './present.mts';
import { kitFile } from './kit-files.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';

// PHPStan needs more memory as a package grows, and php.ini stops it at 128M; a limit only stops the analysis (K346).
const PHPSTAN_MEMORY_LIMIT = '--memory-limit=-1';

/** The autoload files of the Composer package `folder` (relative to `root`), as the paths of `root`: `autoload.files` (K377). */
function autoloadFilesOf(root: string, folder: string): string[] {
  const composer = readComposerManifestFile(path.join(root, folder, 'composer.json'));
  return (composer.autoload?.files ?? []).map(file => path.posix.join(folder, file));
}

/**
 * The autoloader of nikic/php-parser, which reads the autoload files: the PHP symbol extractor installed into var/tools, or the
 * one of kit's own checkout (kit-install-symbols-php, K412), which a consumer does not have; throws when neither is installed.
 */
export function parserAutoloader(root: string): string {
  const installed = path.join(symbolsPrefix(root, 'php'), 'vendor', 'autoload.php');
  const own = path.join(SYMBOLS, 'php', 'vendor', 'autoload.php');
  const found = [installed, own].find(file => existsSync(file));
  if (found === undefined) throw new Error(`${path.relative(root, installed)} is missing; the autoload files of a Composer package are read with the nikic/php-parser of the PHP symbol extractor: name php in symbolExtractors of config/toolchain.json and run make install, whose install-kit runs make kit-install-symbols (K861)`);
  return found;
}

/** The steps of the lint of `root`; throws when a tool, a configuration or the autoloader of a package is missing. */
export function lintSteps(root: string): LintStep[] {
  // A repository without PHP sources has nothing to lint: no tool and no configuration is needed (K319).
  const files = checkedFiles(root);
  const sources = files.filter(file => file.endsWith('.php') && !file.endsWith('.stub.php'));
  if (sources.length === 0) return [];
  const tools = lintCommands(root, toolsPath(root, 'bin'), ['phpcs', 'phpstan'], 'run make install-tools, which installs config/php-lint');
  const packages = foldersOf(root, 'composer.json');
  const owner = packageOwner(packages);
  const steps: LintStep[] = [{ label: 'phpcs', command: present(tools.phpcs, 'tools.phpcs'), args: ['-q', '-s', '--report=emacs', `--standard=${kitFile('phpcs.xml.dist')}`, ...sources], cwd: '.' }];
  const autoloadFiles = packages.flatMap(folder => autoloadFilesOf(root, folder));
  if (autoloadFiles.length > 0) steps.push({ label: 'autoload files', command: 'php', args: [path.join(SYMBOLS, 'php', 'autoload-files.php'), parserAutoloader(root), ...autoloadFiles], cwd: '.' });
  for (const folder of packages) {
    const own = sources.filter(file => owner(file) === folder).map(file => path.posix.relative(folder, file));
    if (own.length === 0) continue;
    const autoloader = packageAutoloader(root, folder, packages);
    if (!autoloader) throw new Error(`${path.relative(root, path.join(composerVendor(path.join(root, folder)), 'autoload.php'))} is missing, and no Composer project above ${folder} has one; PHPStan resolves the calls of the package with its autoloader: run composer install in ${folder}, or in the project that requires it`);
    steps.push({ label: `phpstan ${folder}`, command: present(tools.phpstan, 'tools.phpstan'), args: ['analyse', '--no-progress', '--error-format=raw', PHPSTAN_MEMORY_LIMIT, `--configuration=${kitFile('phpstan.dist.neon')}`, `--autoload-file=${path.relative(path.join(root, folder), path.join(root, autoloader))}`, ...own], cwd: folder, isolatedTemporaryDirectory: true });
  }
  return steps;
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-php', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-php', lintSteps);
