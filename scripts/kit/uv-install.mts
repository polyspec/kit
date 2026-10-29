// uv owns the locked installation; kit links each installed polyspec package folder to its checkout (K765, the user's rule of K591).
// kit neither chooses installed versions nor rewrites manifests or distribution metadata: the release's dist-info stays the record.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { checkoutProviders, linkFolders, providedFolders, releaseEnvironmentLinks } from './link-folders.mts';
import { siblingCheckouts, type Provider } from './link-providers.mts';
import { isMain } from './paths.mts';
import { run } from './process.mts';

const SYNC_FLAGS = new Set(['--no-install-project', '--all-groups']);

type UvSourcesOptions = {
  directory: string; providers?: Iterable<Provider>; uv?: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void;
};

/**
 * Optionally installs the native lock, then makes each installed package folder that a provider provides one directory symlink to the
 * same package of its checkout, and runs uv pip check; returns the linked distributions. No build backend runs: the release installed
 * the distribution, and the link only replaces its package folder.
 */
function installSources({ directory, providers = [], uv = 'uv', env = process.env, print = () => {} }: UvSourcesOptions, sync?: readonly string[]): string[] {
  const project = path.resolve(directory);
  const workspace = run(uv, ['workspace', 'dir'], { cwd: project, env }).trim();
  if (!path.isAbsolute(workspace)) throw new Error('uv workspace dir returned no absolute project root');
  const venv = path.resolve(workspace, env.UV_PROJECT_ENVIRONMENT || '.venv');
  if (sync === undefined && !existsSync(path.join(venv, 'pyvenv.cfg'))) {
    throw new Error(`Python source linking requires an existing native environment at ${venv}; run the application's locked installer first`);
  }
  try {
    if (sync !== undefined) {
      // uv writes and deletes through a package link, so the links go before it installs (K539).
      for (const link of releaseEnvironmentLinks(workspace, venv)) print(`uv development: unlinked ${link}, so uv writes no provider checkout`);
      print('uv development: synchronizing the native lock');
      const output = run(uv, ['sync', '--locked', ...sync], { cwd: project, env });
      if (output.trim()) print(output.trim());
    }
    const folders = providedFolders(workspace, [...providers].filter(provider => provider.ecosystem === 'python'), { environment: venv });
    for (const text of linkFolders(folders)) print(`uv development: ${text}`);
    run(uv, ['pip', 'check', '--python', path.join(venv, 'bin/python')], { cwd: project, env });
    print('uv development: native installed-distribution dependency check passed');
    return [...new Set(folders.map(folder => folder.name.split(' ')[0] ?? folder.name))];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`native Python development installation failed: ${sync !== undefined ? 'prepare the locked release dependency with uv lock and ' : ''}ensure each local provider is compatible; the package link or dependency check failed: ${error.message}`, { cause: error });
  }
}

/** Links the installed package folders of selected local sources in an existing environment without reconciling the application's lock. */
export function uvLink(options: UvSourcesOptions): string[] {
  return installSources(options);
}

/** Runs the native declared development installation once; returns its exit code. */
export function uvInstallCommand(args: readonly string[], env: NodeJS.ProcessEnv, write: (text: string) => void): number {
  const [directory, ...given] = args;
  if (directory === undefined) {
    write('Usage: node scripts/kit/uv-install.mts <dir> [<checkout>...]\n');
    return 2;
  }
  const project = path.resolve(directory);
  const checkouts = given.length ? given.map(checkout => path.resolve(checkout)) : siblingCheckouts(project).checkouts;
  try {
    const sync = (env.UV_SYNC ?? '').split(/\s+/).filter(flag => flag !== '');
    const refused = sync.filter(flag => !SYNC_FLAGS.has(flag));
    if (refused.length) throw new Error(`SYNC takes ${[...SYNC_FLAGS].join(' and ')}, not ${refused.join(' ')}`);
    const providers = checkoutProviders(checkouts, 'python');
    const linked = installSources({ directory: project, providers, uv: env.UV ?? 'uv', env, print: text => write(`${text}\n`) }, sync);
    write(`uv-install ${project}: native locked development sync passed${linked.length ? `; linked sources: ${linked.join(', ')}` : ''}\n`);
    return 0;
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = uvInstallCommand(process.argv.slice(2), process.env, text => process.stdout.write(text));
}
