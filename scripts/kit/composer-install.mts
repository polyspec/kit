// Installs the Composer project of a consumer in place of its composer install (K432, `make composer-install DIR=<project>`). Where a
// sibling checkout provides a polyspec package that the composer.lock of the project holds, the packages are installed through the
// link (linkComposerInstall of link.mts): composer.link.json and composer.link.lock, then a partial update from them with
// COMPOSER=composer.link.json, so the provided folders resolve from their checkouts and the released metadata is never read. Without
// such a sibling, as in CI, composer install runs on the tracked lock, with the Composer and environment of install-composer-project.mts.
import path from 'node:path';
import { siblingCheckouts, workTreeOf } from './link-providers.mts';
import { linkComposerInstall } from './link.mts';
import { isMain } from './paths.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { run } from './process.mts';

/**
 * Installs the Composer project of `directory` and returns the path that it took: `linked` (the polyspec packages of the link) or
 * `locked` (composer install of the tracked lock). COMPOSER_BIN names the Composer when the recipe gives it, as the links do.
 * `noDev` installs the tracked lock with --no-dev, the production install (K483-2).
 */
export function composerInstall({ directory, checkouts, env = process.env, print, noDev = false }: {
  directory: string; checkouts: readonly string[]; env?: NodeJS.ProcessEnv; print: (text: string) => void; noDev?: boolean;
}): 'linked' | 'locked' {
  const project = path.resolve(directory);
  const composer = { command: env.COMPOSER_BIN ?? composerCommand(workTreeOf(project), 'make composer-install'), env: composerEnvironment(workTreeOf(project)) };
  const linked = linkComposerInstall({ directory: project, checkouts, composer, print, env });
  if (linked.length > 0) {
    print(`composer-install ${project}: installed through the link of ${linked.join(', ')}`);
    return 'linked';
  }
  print(`composer-install ${project}: no sibling checkout provides a polyspec package of its composer.lock; composer install of the tracked lock`);
  run(composer.command, ['install', '--no-interaction', ...(noDev ? ['--no-dev'] : [])], { cwd: project, env: composer.env });
  return 'locked';
}

if (isMain(import.meta.url)) {
  const [directory, ...options] = process.argv.slice(2);
  const unknown = options.filter(option => option !== '--no-dev');
  if (directory === undefined || unknown.length > 0) {
    process.stderr.write('Usage: node scripts/kit/composer-install.mts <dir> [--no-dev]\n');
    process.exitCode = 2;
  } else {
    composerInstall({ directory, checkouts: siblingCheckouts(path.resolve(directory)).checkouts, noDev: options.includes('--no-dev'), print: text => process.stdout.write(`${text}\n`) });
  }
}
