// Installs the uv environment of a consumer (K448, `make uv-install DIR=<project> CHECKOUTS="<checkout>..."`): uv sync of the tracked uv.lock as
// it is, then each installed package of site-packages that a checkout provides becomes a direct symlink to the checkout's package folder
// (link-folders.mts). Without CHECKOUTS, the sibling checkouts of the repository are used. No editable wheel is written and no version is
// read; the tracked pyproject.toml and uv.lock are never written.
import path from 'node:path';
import { lstatSync } from 'node:fs';
import { checkoutProviders, linkFolders, providedFolders } from './link-folders.mts';
import { siblingCheckouts } from './link-providers.mts';
import { isMain } from './paths.mts';
import { run } from './process.mts';

// The flags of uv sync that a consumer passes through SYNC (K487): the project itself left out, and every dependency group.
const SYNC_FLAGS = new Set(['--no-install-project', '--all-groups']);

/** Runs the install of the arguments `[directory, ...checkouts]`, printing to `write`; returns the exit code. */
export function uvInstallCommand(args: readonly string[], env: NodeJS.ProcessEnv, write: (text: string) => void): number {
  const [directory, ...given] = args;
  if (directory === undefined) {
    write('Usage: node scripts/kit/uv-install.mts <dir> [<checkout>...]\n');
    return 2;
  }
  const project = path.resolve(directory);
  const checkouts = given.length ? given.map(checkout => path.resolve(checkout)) : siblingCheckouts(project).checkouts;
  try {
    // UV_SYNC carries the sync flags of make uv-install SYNC (K487).
    const sync = (env.UV_SYNC ?? '').split(/\s+/).filter(flag => flag !== '');
    const refused = sync.filter(flag => !SYNC_FLAGS.has(flag));
    if (refused.length) throw new Error(`SYNC takes ${[...SYNC_FLAGS].join(' and ')}, not ${refused.join(' ')}`);
    const providers = checkoutProviders(checkouts, 'python');
    const environment = env.UV_PROJECT_ENVIRONMENT;
    // K548: the project that uv-install installs is no provided package, though a checkout that holds it names it.
    const others = providers.filter(provider => path.resolve(provider.folder) !== project);
    // K592: uv never writes through a package link: each provided package whose folder is a symlink is skipped, and --inexact keeps uv
    // from uninstalling it, which --no-install-package alone does through the link; a package not linked yet installs, then links.
    const linked = [...new Set(providedFolders(project, others, { environment }).filter(item => lstatSync(item.folder).isSymbolicLink()).map(item => item.name.split(' ')[0] ?? ''))].sort();
    const skip = linked.length ? ['--inexact', ...linked.flatMap(name => ['--no-install-package', name])] : [];
    run(env.UV ?? 'uv', ['sync', '--frozen', ...sync, ...skip], { cwd: project, env });
    const folders = providedFolders(project, others, { environment });
    linkFolders(folders);
    write(`uv-install ${project}: uv sync of the tracked lock${folders.length ? `, then linked ${folders.map(item => item.name).join(', ')} to their checkouts` : ''}\n`);
    return 0;
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = uvInstallCommand(process.argv.slice(2), process.env, text => process.stdout.write(text));
}
