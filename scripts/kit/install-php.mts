// Provides the PHP of .php-version to the checkout (`make install-tools`, K283): the machine provides PHP, and install-tools
// finds the release of the checkout's minor on it and writes exec wrappers in var/tools/bin for php and, when they exist beside
// it, php-config and phpize, so that every tool of the checkout runs the pinned PHP whatever PHP the machine puts first on PATH.
// Discovery runs with the PATH of the bootstrap (no var/tools/bin, so it never finds its own wrapper) and the first match wins:
//   1. `php` on PATH whose release is the minor (the PHP that CI's setup-php installs)
//   2. `php<minor>` on PATH (Debian and Ubuntu), with `phpize<minor>` and `php-config<minor>` beside it
//   3. the keg `$(brew --prefix)/opt/php@<minor>/bin/php` of Homebrew, by its stable opt/ path; skipped without brew
// A wrapper holds the absolute path of the matched binary. No match fails with the attempts in order.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { bootstrapEnvironment, quote, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';

/** The wrappers that install-tools writes for the PHP of the checkout, the command of the machine they stand for being found beside php. */
export const PHP_WRAPPERS = ['php', 'php-config', 'phpize'] as const;

/** What to install when the PHP of `minor` is missing. */
export const phpInstall = (minor: string): string => `brew install php@${minor} or apt install php${minor}-cli`;

type Found = { php: string; suffix: string };
const minorOf = (release: string): string => release.split('.').slice(0, 2).join('.');

/** The absolute path of the command `name` on the PATH of `env`, or undefined. */
function onPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const found = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', name], { env, encoding: 'utf8' });
  const file = found.stdout.trim();
  return found.status === 0 && path.isAbsolute(file) ? file : undefined;
}

/** The minor release that the php `file` prints, or the reason that it prints none. */
function phpMinor(file: string, env: NodeJS.ProcessEnv): { minor: string } | { failure: string } {
  const result = spawnSync(file, ['-r', 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'], { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) return { failure: `${file} failed (${result.error?.message ?? `exit status ${result.status}`})` };
  return { minor: result.stdout.trim() };
}

/** The PHP of `minor`, or the attempts that found none. */
function discover(minor: string, env: NodeJS.ProcessEnv): Found | string[] {
  const attempts: string[] = [];
  const check = (label: string, file: string | undefined, suffix: string): Found | undefined => {
    if (file === undefined) {
      attempts.push(`${label}: not found`);
      return undefined;
    }
    const printed = phpMinor(file, env);
    if ('failure' in printed) {
      attempts.push(`${label}: ${printed.failure}`);
      return undefined;
    }
    if (printed.minor !== minor) {
      attempts.push(`${label}: ${file} is ${printed.minor}, not ${minor}`);
      return undefined;
    }
    return { php: file, suffix };
  };
  const first = check('1. php on PATH', onPath('php', env), '') ?? check(`2. php${minor} on PATH`, onPath(`php${minor}`, env), minor);
  if (first) return first;
  const label = `3. $(brew --prefix)/opt/php@${minor}/bin/php`;
  const brew = onPath('brew', env);
  if (brew === undefined) {
    attempts.push(`${label}: brew is not installed`);
    return attempts;
  }
  const file = path.join(execFileSync(brew, ['--prefix'], { env, encoding: 'utf8' }).trim(), 'opt', `php@${minor}`, 'bin', 'php');
  const third = existsSync(file) ? check(label, file, '') : undefined;
  if (!existsSync(file)) attempts.push(`${label}: ${file} does not exist`);
  return third ?? attempts;
}

/**
 * Writes var/tools/bin/php of `root` for the PHP of .php-version, and php-config and phpize when they exist beside it, and removes
 * those companions' wrappers of an earlier run that no longer exist. Throws when .php-version is missing or no PHP matches.
 */
export function installPhp({ root, print }: { root: string; print: (text: string) => void }): void {
  const file = path.join(root, '.php-version');
  if (!existsSync(file)) throw new Error('PHP is declared by config/toolchain.json php only; install-tools provides the PHP of .php-version, so create .php-version with the minor release (such as 8.4)');
  const minor = readFileSync(file, 'utf8').trim();
  const env = bootstrapEnvironment(root);
  const found = discover(minor, env);
  if (Array.isArray(found)) {
    throw new Error(`PHP ${minor} of .php-version was not found; tried in order:\n${found.map(line => `  ${line}`).join('\n')}\ninstall it with ${phpInstall(minor)}, or change .php-version`);
  }
  const directory = path.dirname(found.php);
  const needsExtension = existsSync(path.join(root, 'packages/php-ext'));
  const written: Record<string, string> = { php: found.php };
  for (const name of ['php-config', 'phpize'] as const) {
    const companion = path.join(directory, `${name}${found.suffix}`);
    if (!existsSync(companion)) {
      if (needsExtension) throw new Error(`${companion} is missing beside ${found.php}, and packages/php-ext needs phpize and php-config; install php${minor}-dev or brew reinstall php@${minor}`);
      continue;
    }
    if (name === 'php-config') {
      const release = execFileSync(companion, ['--version'], { env, encoding: 'utf8' }).trim();
      if (minorOf(release) !== minor) throw new Error(`${companion} is ${minorOf(release)}, not ${minor} of .php-version; install the php-config of PHP ${minor}`);
    }
    written[name] = companion;
  }
  for (const name of PHP_WRAPPERS) {
    const target = written[name];
    if (target === undefined) {
      if (existsSync(toolsPath(root, 'bin', name))) {
        rmSync(toolsPath(root, 'bin', name));
        print(`removed ${path.relative(root, toolsPath(root, 'bin', name))}`);
      }
      continue;
    }
    writeWrapper(root, name, wrapperText(`${name} ${minor} of .php-version`, `exec ${quote(target)} "$@"`), print);
  }
}
