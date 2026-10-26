// Installs a locked Python environment with uv sync, then delegates local source dependencies to uv's editable installer.
// The tracked pyproject.toml and uv.lock remain the release inputs; the editable environment is a separate development state.
import path from 'node:path';
import { lstatSync } from 'node:fs';
import { checkoutProviders, editableFolder, providedFolders } from './link-folders.mts';
import { siblingCheckouts, type Provider } from './link-providers.mts';
import { isMain } from './paths.mts';
import { run } from './process.mts';
import { normalizeName } from './pyproject-dependencies.mts';
import { isJsonList, isJsonObject } from './bootstrap/files.mts';

const SYNC_FLAGS = new Set(['--no-install-project', '--all-groups']);

/** Reads legacy package-folder links without changing the environment or invoking uv. */
export function legacyPythonLinks(project: string, providers: Iterable<Provider>, env: NodeJS.ProcessEnv): string[] {
  return providedFolders(project, [...providers].filter(provider => provider.ecosystem === 'python'), { environment: env.UV_PROJECT_ENVIRONMENT }).filter(folder =>
    lstatSync(folder.folder).isSymbolicLink() && editableFolder(project, folder.name.split(' ')[0] ?? folder.name, env.UV_PROJECT_ENVIRONMENT) === undefined).map(folder => folder.folder);
}

/** Refuses legacy package-folder links before uv can write through them into a provider checkout. */
function refuseLegacyLinks(project: string, providers: readonly Provider[], env: NodeJS.ProcessEnv): void {
  const legacy = legacyPythonLinks(project, providers, env);
  if (legacy.length > 0) {
    throw new Error(`legacy Python package links require migration to native editable installation before uv runs: ${legacy.join(', ')}; create a fresh environment with uv and install the declared local sources with uv pip install --editable`);
  }
}

/** Installs provided distributions that the environment already contains through uv's native editable installation. */
export function uvEditable({ directory, providers, uv = 'uv', env = process.env, print = () => {} }: {
  directory: string; providers: Iterable<Provider>; uv?: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void;
}): string[] {
  const project = path.resolve(directory);
  const provided = [...providers].filter(provider => provider.ecosystem === 'python' && path.resolve(provider.folder) !== project);
  if (provided.length === 0) return [];
  refuseLegacyLinks(project, provided, env);
  const python = path.join(path.resolve(project, env.UV_PROJECT_ENVIRONMENT || '.venv'), 'bin/python');
  print('uv editable: reading installed distributions');
  const parsed: unknown = JSON.parse(run(uv, ['pip', 'list', '--python', python, '--format', 'json'], { cwd: project, env }));
  if (!isJsonList(parsed)) {
    throw new Error('uv pip list --format json returned no array of named distributions');
  }
  const installed = new Set<string>();
  for (const item of parsed) {
    if (!isJsonObject(item) || typeof item.name !== 'string') throw new Error('uv pip list returned an unnamed distribution');
    installed.add(normalizeName(item.name));
  }
  const selected = provided.filter(provider => installed.has(normalizeName(provider.name)));
  if (selected.length === 0) return [];
  print(`uv editable: ${selected.map(provider => provider.name).join(', ')}: started`);
  const output = run(uv, ['pip', 'install', '--python', python, ...selected.flatMap(provider => ['--editable', provider.folder])], { cwd: project, env });
  if (output.trim()) print(output.trim());
  print('uv editable: passed');
  return selected.map(provider => provider.name);
}

/** Runs locked installation and the native editable local-source step; returns the exit code. */
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
    refuseLegacyLinks(project, providers, env);
    write('uv-install: installing the release lock with uv sync\n');
    run(env.UV ?? 'uv', ['sync', '--frozen', ...sync], { cwd: project, env });
    const linked = uvEditable({ directory: project, providers, uv: env.UV ?? 'uv', env, print: text => write(`${text}\n`) });
    write(`uv-install ${project}: locked sync passed${linked.length ? `; editable development sources: ${linked.join(', ')}` : ''}\n`);
    return 0;
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = uvInstallCommand(process.argv.slice(2), process.env, text => process.stdout.write(text));
}
