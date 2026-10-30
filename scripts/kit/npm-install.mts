// Installs the locked npm dependencies with npm ci, then makes each installed folder of a provided package one plain directory symlink
// to its checkout (K761); the tracked manifest and lock stay as they are.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isMain } from './paths.mts';
import { checkoutProviders, linkFolders, providedFolders } from './link-folders.mts';


/**
 * Installs the packages of `directory` and returns the path that it took: `linked` (a package of the project is linked to its checkout)
 * or `locked` (no checkout provides one). The tracked lock is installed as it is, with npm ci, and each installed package that a checkout
 * provides becomes one plain directory symlink to its checkout (K761). `npm` is the npm to run;
 * the environment is `env`.
 */
export function npmInstall({ directory, checkouts, npm = 'npm', env = process.env, print }: {
  directory: string; checkouts: readonly string[]; npm?: string; env?: NodeJS.ProcessEnv; print: (text: string) => void;
}): 'linked' | 'locked' {
  const project = path.resolve(directory);
  const provided = new Map(checkoutProviders(checkouts, 'npm').map(item => [item.name, item.folder]));
  // npm ci empties node_modules and keeps the directory itself, so a node_modules that is a mount point stays (K486). The lock
  // resolves @polyspec/kit from the URL of its release asset, which npm refuses unless allow-remote opts in: root allows only the
  // URLs that package.json names, as install-packages does (K526).
  const ci = spawnSync(npm, ['ci', '--no-audit', '--no-fund'], { cwd: project, env: { ...env, npm_config_allow_remote: 'root' }, encoding: 'utf8' });
  if (ci.status !== 0) throw new Error(`npm ci of ${project} exited ${ci.status}: ${ci.stderr}`);
  const folders = providedFolders(project, [...provided].map(([name, folder]) => ({ ecosystem: 'npm' as const, name, folder, repository: folder, checkout: folder })));
  if (folders.length === 0) {
    print(`npm-install ${project}: npm ci of the tracked lock; no installed package is provided by a checkout`);
    return 'locked';
  }
  for (const text of linkFolders(folders)) print(text);
  print(`npm-install ${project}: npm ci of the tracked lock, then linked ${folders.map(item => item.name).join(', ')} to their checkouts`);
  return 'linked';
}

if (isMain(import.meta.url)) {
  // The providers are the checkouts of the link declaration (K869).
  const [directory, ...rest] = process.argv.slice(2);
  if (directory === undefined || rest.length) {
    process.stderr.write('Usage: node scripts/kit/npm-install.mts <dir>\n');
    process.exitCode = 2;
  } else {
    const { declaredCheckouts } = await import('./link-providers.mts');
    try {
      npmInstall({ directory, checkouts: declaredCheckouts(path.resolve(directory)) ?? [], npm: process.env.NPM_BIN ?? 'npm', print: text => process.stdout.write(`${text}\n`) });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
