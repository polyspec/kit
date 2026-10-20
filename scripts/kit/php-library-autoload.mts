// The autoloader of an extension run of the PHP library's tests (K329, S10): the tests of `packages/php` run with the extension loaded
// and none of the library's sources. Composer dumps it from a root package with the autoload-dev of the library alone, over the
// vendor directory of the library, which is linked in, so it holds the dependencies and the tests and not the autoload (psr-4,
// classmap and files) of the library itself. The vendor directory of the library is left as it is.
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { run } from './process.mts';

/** What a run needs: the PHPUnit script, the file to prepend and the environment that tells it the autoloader and the library sources. */
export type LibraryRun = { phpunit: string; prepend: string; env: Record<string, string> };

type Autoload = Record<string, unknown>;

/** The items of a list as unknown values, else none. */
const listOf = (value: unknown): unknown[] => {
  const list: unknown[] = Array.isArray(value) ? value : [];
  return list;
};

/** The paths of an autoload section as absolute paths below `folder`: the directories of psr-4 and psr-0, the classmap and the files. */
function absolute(section: unknown, folder: string): Autoload {
  const result: Autoload = {};
  if (!isJsonObject(section)) return result;
  const resolve = (item: unknown) => path.resolve(folder, String(item));
  for (const [kind, value] of Object.entries(section)) {
    if (kind === 'psr-4' || kind === 'psr-0') {
      result[kind] = isJsonObject(value) ? Object.fromEntries(Object.entries(value).map(([prefix, target]) => [prefix, Array.isArray(target) ? listOf(target).map(resolve) : resolve(target)])) : {};
    } else if (kind === 'classmap' || kind === 'files' || kind === 'exclude-from-classmap') {
      result[kind] = listOf(value).map(resolve);
    }
  }
  return result;
}

/** The directories and files of an autoload section, absolute. */
function pathsOf(section: Autoload): string[] {
  return Object.entries(section).flatMap(([kind, value]) => (kind === 'psr-4' || kind === 'psr-0'
    ? (isJsonObject(value) ? Object.values(value) : []).flatMap(target => (Array.isArray(target) ? listOf(target) : [target]).map(String))
    : kind === 'classmap' || kind === 'files' ? listOf(value).map(String) : []));
}

/**
 * Prepares the autoloader for the tests of the library in `folder` (relative to `root`) under var/php-ext/library-tests, and returns
 * what the PHPUnit run needs. Throws when the library has no vendor directory with PHPUnit.
 */
export function libraryTestRun(root: string, folder: string, env: NodeJS.ProcessEnv = process.env): LibraryRun {
  const library = path.join(root, folder);
  const manifest = readJsonObject(path.join(library, 'composer.json'));
  const tools = { command: composerCommand(root, 'the tests of the PHP extension'), env: toolsEnvironment(root, env) };
  const vendor = composerVendor(library, tools);
  const script = path.join(vendor, 'phpunit/phpunit/phpunit');
  if (!existsSync(script)) throw new Error(`${path.relative(root, script)} does not exist; run composer install in ${folder}`);
  const work = path.join(root, 'var/php-ext/library-tests', folder.replaceAll('/', '_'));
  rmSync(work, { recursive: true, force: true });
  const linked = path.join(work, 'vendor');
  mkdirSync(path.join(linked, 'composer'), { recursive: true });
  for (const entry of readdirSync(vendor)) {
    if (!['composer', 'autoload.php', 'bin'].includes(entry)) symlinkSync(realpathSync(path.join(vendor, entry)), path.join(linked, entry));
  }
  cpSync(path.join(vendor, 'composer/installed.json'), path.join(linked, 'composer/installed.json'));
  const config = typeof manifest.config === 'object' && manifest.config !== null ? manifest.config : {};
  writeFileSync(path.join(work, 'composer.json'), `${JSON.stringify({ name: 'polyspec/kit-library-tests', config: { ...config, 'vendor-dir': linked }, 'autoload-dev': absolute(manifest['autoload-dev'], library) }, null, 4)}\n`);
  const dumpEnv = { ...tools.env };
  delete dumpEnv.COMPOSER_VENDOR_DIR;
  run(tools.command, ['dump-autoload', '--dev', '--no-scripts', '--no-interaction', '--working-dir', work], { env: dumpEnv });
  const sources = pathsOf(absolute(manifest.autoload, library));
  return {
    phpunit: script,
    prepend: path.join(path.dirname(fileURLToPath(import.meta.url)), 'php-library/prepend.php'),
    env: { KIT_PHP_AUTOLOAD: path.join(linked, 'autoload.php'), KIT_PHP_LIBRARY_SOURCES: JSON.stringify(sources) },
  };
}
