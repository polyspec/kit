// uv owns locked installation and editable source linking into existing native environments.
// kit neither chooses installed source versions nor rewrites manifests or distribution metadata.
import path from 'node:path';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { checkoutProviders, editableFolder, providedFolders } from './link-folders.mts';
import { siblingCheckouts, type Provider } from './link-providers.mts';
import { isMain } from './paths.mts';
import { run } from './process.mts';
import { manifestPackageExtras, manifestPolyspecNames, normalizeName, runtimePackageNames } from './pyproject-dependencies.mts';
import { isJsonList, isJsonObject } from './bootstrap/files.mts';
import { readToml } from './toml.mts';

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

type UvSourcesOptions = {
  directory: string; providers?: Iterable<Provider>; uv?: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void;
};

/** Applies native source installation and validation, optionally following the explicit locked installer step. */
function installSources({ directory, providers = [], uv = 'uv', env = process.env, print = () => {} }: UvSourcesOptions, sync?: readonly string[]): string[] {
  const project = path.resolve(directory);
  const provided = [...providers].filter(provider => provider.ecosystem === 'python');
  refuseLegacyLinks(project, provided, env);
  const manifest = path.join(project, 'pyproject.toml');
  const document = readToml(readFileSync(manifest, 'utf8'), manifest);
  const declared = new Set(manifestPolyspecNames(document, manifest));
  const extras = manifestPackageExtras(document, manifest);
  const local: Provider[] = [];
  const selected = new Set<string>();
  const visit = (provider: Provider): void => {
    const name = normalizeName(provider.name);
    if (selected.has(name)) return;
    selected.add(name);
    local.push(provider);
    const file = path.join(provider.folder, 'pyproject.toml');
    const names = new Set(runtimePackageNames(readToml(readFileSync(file, 'utf8'), file), file));
    for (const dependency of provided) if (names.has(normalizeName(dependency.name))) visit(dependency);
  };
  for (const provider of provided) if (declared.has(normalizeName(provider.name))) visit(provider);
  const workspace = run(uv, ['workspace', 'dir'], { cwd: project, env }).trim();
  if (!path.isAbsolute(workspace)) throw new Error('uv workspace dir returned no absolute project root');
  const python = path.join(path.resolve(workspace, env.UV_PROJECT_ENVIRONMENT || '.venv'), 'bin/python');
  if (sync === undefined && !existsSync(path.join(path.dirname(path.dirname(python)), 'pyvenv.cfg'))) {
    throw new Error(`Python source linking requires an existing native environment at ${path.dirname(path.dirname(python))}; run the application's locked installer first`);
  }
  try {
    if (sync !== undefined) {
      print('uv development: synchronizing the native lock and excluding local providers from release installation');
      const output = run(uv, ['sync', '--locked', ...sync, ...local.flatMap(provider => ['--no-install-package', provider.name])], { cwd: project, env });
      if (output.trim()) print(output.trim());
    }
    if (local.length > 0) {
      print(`uv development: resolving editable sources together: ${local.map(provider => provider.name).join(', ')}`);
      const linked = run(uv, ['pip', 'install', '--offline', '--python', python, ...local.flatMap(provider => {
        const requested = extras.get(normalizeName(provider.name)) ?? [];
        return ['--reinstall-package', provider.name, '--editable', `${provider.folder}${requested.length ? `[${requested.join(',')}]` : ''}`];
      })], { cwd: project, env });
      if (linked.trim()) print(linked.trim());
    }
    run(uv, ['pip', 'check', '--python', python], { cwd: project, env });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`native Python development installation failed: ${sync !== undefined ? 'prepare the locked release dependency with uv lock and ' : ''}ensure each local provider is compatible; the editable source overlay or dependency check failed: ${error.message}`, { cause: error });
  }
  const parsed: unknown = JSON.parse(run(uv, ['pip', 'list', '--python', python, '--format', 'json'], { cwd: project, env }));
  if (!isJsonList(parsed)) throw new Error('uv pip list --format json returned no array of named distributions');
  const names: string[] = [];
  const installed = new Set<string>();
  for (const item of parsed) {
    if (!isJsonObject(item) || typeof item.name !== 'string') throw new Error('uv pip list returned an unnamed distribution');
    const name = item.name;
    installed.add(normalizeName(name));
    const location = item.editable_project_location;
    const provider = local.find(candidate => normalizeName(candidate.name) === normalizeName(name));
    if (provider !== undefined && (typeof location !== 'string' || !existsSync(location) || realpathSync(location) !== realpathSync(provider.folder))) {
      throw new Error(`Python distribution ${item.name} is installed from ${typeof location === 'string' ? location : 'a non-editable release'}, not the expected development source ${provider.folder}; run uv-install again to apply its native editable source`);
    }
    if (typeof location === 'string') names.push(item.name);
  }
  for (const provider of local) {
    if (!installed.has(normalizeName(provider.name))) throw new Error(`selected local Python provider ${provider.name} is missing from the installed distributions; run uv-install again to apply its native editable source`);
  }
  print('uv development: native installed-distribution dependency check passed');
  return names;
}

/** Links selected local sources into an existing environment without reconciling the application's release lock. */
export function uvEditable(options: UvSourcesOptions): string[] {
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
