// uv owns development installation from the application source/workspace declarations and its native lock.
// kit neither chooses installed source versions nor rewrites manifests or distribution metadata.
import path from 'node:path';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
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

/** Synchronizes the application's native source/workspace declarations and verifies the resulting dependencies. */
export function uvEditable({ directory, providers = [], uv = 'uv', env = process.env, print = () => {}, sync = [] }: {
  directory: string; providers?: Iterable<Provider>; uv?: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void; sync?: readonly string[];
}): string[] {
  const project = path.resolve(directory);
  const provided = [...providers].filter(provider => provider.ecosystem === 'python');
  refuseLegacyLinks(project, provided, env);
  const workspace = run(uv, ['workspace', 'dir'], { cwd: project, env }).trim();
  if (!path.isAbsolute(workspace)) throw new Error('uv workspace dir returned no absolute project root');
  const python = path.join(path.resolve(workspace, env.UV_PROJECT_ENVIRONMENT || '.venv'), 'bin/python');
  print('uv development: synchronizing the application source declarations with uv sync --locked');
  try {
    const output = run(uv, ['sync', '--locked', ...sync], { cwd: project, env });
    if (output.trim()) print(output.trim());
    run(uv, ['pip', 'check', '--python', python], { cwd: project, env });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`native Python development installation failed: declare compatible local paths/workspaces in the application and prepare its uv.lock with uv lock; dependency or lock conflicts are not a successful development overlay: ${error.message}`, { cause: error });
  }
  const parsed: unknown = JSON.parse(run(uv, ['pip', 'list', '--python', python, '--format', 'json'], { cwd: project, env }));
  if (!isJsonList(parsed)) throw new Error('uv pip list --format json returned no array of named distributions');
  const names: string[] = [];
  for (const item of parsed) {
    if (!isJsonObject(item) || typeof item.name !== 'string') throw new Error('uv pip list returned an unnamed distribution');
    const name = item.name;
    const location = item.editable_project_location;
    const provider = provided.find(candidate => normalizeName(candidate.name) === normalizeName(name));
    if (provider !== undefined && (typeof location !== 'string' || !existsSync(location) || realpathSync(location) !== realpathSync(provider.folder))) {
      throw new Error(`Python distribution ${item.name} is installed from ${typeof location === 'string' ? location : 'a non-editable release'}, not the expected development source ${provider.folder}; declare that source as an editable path/workspace in the application and prepare its uv.lock with uv lock`);
    }
    if (typeof location === 'string') names.push(item.name);
  }
  print('uv development: native installed-distribution dependency check passed');
  return names;
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
    const linked = uvEditable({ directory: project, providers, uv: env.UV ?? 'uv', env, sync, print: text => write(`${text}\n`) });
    write(`uv-install ${project}: native locked development sync passed${linked.length ? `; editable sources: ${linked.join(', ')}` : ''}\n`);
    return 0;
  } catch (error) {
    write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = uvInstallCommand(process.argv.slice(2), process.env, text => process.stdout.write(text));
}
