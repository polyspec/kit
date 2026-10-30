// Provides the PHP of the checkout (`make install-tools`, K283, K862): the machine provides PHP, and install-tools wraps the php
// that PATH names, as it is, in var/tools/bin, with php-config and phpize when they exist beside it, so that every tool of the
// checkout runs that php whatever PATH a later step has. Kit compares no release: Composer's platform check refuses a PHP that
// the packages' require excludes. The PATH is that of the bootstrap (no var/tools/bin, so it never finds its own wrapper); a wrapper holds
// the absolute path of the command. PHP itself refuses to load an extension built by the php-config and phpize of another
// install (its module API and build ID), so kit judges no install either.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { bootstrapEnvironment, quote, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';

/**
 * The wrappers that install-tools writes for the PHP of the checkout, the command of the machine they stand for being found beside
 * php, or in the sbin of its prefix for php-fpm (K341): the php-fpm of PATH may be another PHP's, as a php-ext store took it for 8.4.
 */
export const PHP_WRAPPERS = ['php', 'php-config', 'phpize', 'php-fpm'] as const;

/** The absolute path of the command `name` on the PATH of `env`, or undefined. */
function onPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const found = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', name], { env, encoding: 'utf8' });
  const file = found.stdout.trim();
  return found.status === 0 && path.isAbsolute(file) ? file : undefined;
}

/**
 * Writes var/tools/bin/php of `root` for the php of PATH, and php-config and phpize when they exist beside it, and php-fpm when
 * `<prefix>/sbin/php-fpm` exists (K341), and removes those companions' wrappers of an earlier run that no longer exist. Throws
 * when php is not on PATH.
 */
export function installPhp({ root, print }: { root: string; print: (text: string) => void }): void {
  const env = bootstrapEnvironment(root);
  const php = onPath('php', env);
  if (php === undefined) throw new Error('php is not on PATH; install PHP so that php is on PATH');
  const directory = path.dirname(php);
  const needsExtension = existsSync(path.join(root, 'packages/php-ext'));
  const written: Record<string, string> = { php };
  // The prefix of php is the parent of its bin directory; a PHP without sbin/php-fpm gets no wrapper, and nothing fails (K341).
  const fpm = path.join(path.dirname(directory), 'sbin', 'php-fpm');
  if (existsSync(fpm)) written['php-fpm'] = fpm;
  for (const name of ['php-config', 'phpize'] as const) {
    const companion = path.join(directory, name);
    if (!existsSync(companion)) {
      if (needsExtension) throw new Error(`${companion} is missing beside ${php}, and packages/php-ext needs phpize and php-config; install the development files of that PHP`);
      continue;
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
    writeWrapper(root, name, wrapperText(`${name} of PATH for the checkout`, `exec ${quote(target)} "$@"`), print);
  }
}
