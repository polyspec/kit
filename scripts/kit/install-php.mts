// Provides the PHP of the checkout (`make install-tools`, K283, K862, K1293): the machine provides PHP, and install-tools wraps the
// php of `--php=<path>` (make `PHP=<path>`), else the php that PATH names, in var/tools/bin, with php-config and phpize when they
// exist beside it, so that every tool of the checkout runs that php whatever PATH a later step has. The selected php is run first:
// a minor that no declared release names fails and nothing is written, since Composer's platform check refuses nothing when a
// repository pins its platform to the lowest minor (K1293). The wrappers are written beside their paths, the php wrapper is run,
// and then each is renamed, so a wrapper of another php is replaced and a rerun with the same php writes nothing. The PATH is that
// of the bootstrap (no var/tools/bin, so it never finds its own wrapper); a wrapper holds the absolute path of the command. PHP
// itself refuses to load an extension built by the php-config and phpize of another install (its module API and build ID).
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bootstrapEnvironment, quote, toolsPath, wrapperText } from './bootstrap/tool-wrappers.mts';

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

/** The `major.minor` that the php `file` reports, or undefined when it cannot run or reports none. */
function phpMinor(file: string): string | undefined {
  const found = spawnSync(file, ['-r', 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;'], { encoding: 'utf8' });
  const minor = found.status === 0 ? found.stdout.trim() : '';
  return /^\d+\.\d+$/.test(minor) ? minor : undefined;
}

/** The `major.minor` of a release as written, such as 8.4 of `8.4.27`. */
const minorOf = (release: string): string => release.split('.').slice(0, 2).join('.');

/**
 * Writes var/tools/bin/php of `root` for the php `explicit`, else the php of PATH, and php-config and phpize when they exist beside
 * it, and php-fpm when `<prefix>/sbin/php-fpm` exists (K341), and removes those companions' wrappers of an earlier run that no
 * longer exist. Throws, writing nothing, when no php is found or its minor is none of the minors of `declared` (K1293).
 */
export function installPhp({ root, explicit, declared, print }: { root: string; explicit?: string | undefined; declared: { minors: readonly string[]; source: string }; print: (text: string) => void }): void {
  if (explicit !== undefined && !path.isAbsolute(explicit)) throw new Error(`--php=${explicit} is not an absolute path; pass PHP=<absolute path of php>`);
  const php = explicit ?? onPath('php', bootstrapEnvironment(root));
  if (php === undefined) throw new Error('php is not on PATH; install PHP so that php is on PATH, or pass PHP=<path of php>');
  const releases = declared.minors.map(minorOf);
  const minor = phpMinor(php);
  if (minor === undefined) throw new Error(`php ${php} reports no PHP_MAJOR_VERSION.PHP_MINOR_VERSION; pass PHP=<path> of a PHP ${releases.join(' or ')}`);
  if (!releases.includes(minor)) throw new Error(`php ${minor} (${php}) is not a release that ${declared.source} declares (${releases.join(', ')}); pass PHP=<path> of a PHP ${releases.join(' or ')}`);
  const directory = path.dirname(php);
  const written: Record<string, string> = { php };
  // The prefix of php is the parent of its bin directory; a PHP without sbin/php-fpm gets no wrapper, and nothing fails (K341).
  const fpm = path.join(path.dirname(directory), 'sbin', 'php-fpm');
  if (existsSync(fpm)) written['php-fpm'] = fpm;
  for (const name of ['php-config', 'phpize'] as const) {
    const companion = path.join(directory, name);
    // A missing companion gets no wrapper in any repository (K1117): the build of an extension runs phpize and fails without it.
    if (!existsSync(companion)) continue;
    written[name] = companion;
  }
  // Each changed wrapper is staged beside its path; the staged php is run before any rename, so a wrapper that cannot run the
  // selected php is never published.
  const staged: [string, string][] = [];
  for (const name of PHP_WRAPPERS) {
    const target = written[name];
    if (target === undefined) continue;
    const file = toolsPath(root, 'bin', name);
    const text = wrapperText(`${name} of PATH for the checkout`, `exec ${quote(target)} "$@"`);
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
    const next = `${file}.next-${process.pid}`;
    writeFileSync(next, text);
    chmodSync(next, 0o755);
    staged.push([next, file]);
  }
  const stagedPhp = staged.find(([, file]) => path.basename(file) === 'php')?.[0];
  if (stagedPhp !== undefined && phpMinor(stagedPhp) !== minor) {
    for (const [next] of staged) rmSync(next);
    throw new Error(`the staged wrapper of php ${php} does not report ${minor}; nothing is written`);
  }
  for (const [next, file] of staged) {
    renameSync(next, file);
    print(`wrote ${path.relative(root, file)}`);
  }
  for (const name of PHP_WRAPPERS) {
    if (written[name] !== undefined || !existsSync(toolsPath(root, 'bin', name))) continue;
    rmSync(toolsPath(root, 'bin', name));
    print(`removed ${path.relative(root, toolsPath(root, 'bin', name))}`);
  }
}
