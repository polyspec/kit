// The providers of the local links of 0.0.x development (docs/plans/local-links.md): the polyspec root that
// POLYSPEC_CHECKOUTS declares holds the main checkout of each polyspec repository, and each tracked manifest of a package
// there names what it provides: package.json `name` (npm, a private package provides nothing), composer.json `name`,
// pyproject.toml `project.name` (normalized, PEP 503) and go.mod `module` (go mod edit -json). A repository is identified
// by its common Git directory, which every worktree of it shares, so a consumer never links a package of its own
// repository, from whichever worktree it runs; a provider is always a main checkout, never a linked worktree.
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject } from './bootstrap/files.mts';
import { readComposerManifestFile, readNpmManifestFile } from './manifests.mts';
import { execute, run } from './process.mts';
import { normalizeName } from './pyproject-dependencies.mts';
import { isTable, readToml } from './toml.mts';

/** The repository-local variables of Git, from `git rev-parse --local-env-vars` once per run: a Git hook exports them for its repository. */
let repositoryVariables: string[] | undefined;
const localVariables = (): string[] => {
  repositoryVariables ??= run('git', ['rev-parse', '--local-env-vars']).split('\n').filter(Boolean);
  return repositoryVariables;
};

/**
 * The environment `env` without the repository-local variables: a git command or a make that runs in another repository
 * must not read the repository of the hook that started it (K201-4). This is what git itself does when it enters a submodule.
 */
export function foreignEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const foreign = { ...env };
  for (const name of localVariables()) delete foreign[name];
  return foreign;
}

/** `git <args>` in `directory`, a repository other than the one of the process: the outcome, with the repository variables removed. */
export const linkGit = (directory: string, ...args: string[]) => execute('git', args, { cwd: directory, env: foreignEnvironment() });

/** The environment variable that declares the polyspec root; without it, linking does nothing. */
export const ROOT_VARIABLE = 'POLYSPEC_CHECKOUTS';

export type Ecosystem = 'npm' | 'composer' | 'python' | 'go';

/** The manifest file of each ecosystem. */
export const MANIFESTS: Readonly<Record<Ecosystem, string>> = { npm: 'package.json', composer: 'composer.json', python: 'pyproject.toml', go: 'go.mod' };

/**
 * The folders whose manifests are neither a provided package nor a linked consumer project: tests (the release-consumer
 * projects among them), examples, benchmarks, documents, the tool projects of config/ and .mise, and fixtures.
 */
export const EXCLUDED = /(^|\/)(tests?|examples|benchmarks|docs|config|\.mise|[^/]*fixtures?|release-consumer)\//;

/** A command of a tool and the environment that it runs in. */
export type Tool = { command: string; env: NodeJS.ProcessEnv };

/** The declared polyspec root, or undefined when POLYSPEC_CHECKOUTS is unset or empty. */
export function declaredRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[ROOT_VARIABLE];
  return value ? realpathSync(value) : undefined;
}

/**
 * Whether `directory` or a folder above it holds a `.git` entry, a directory or a gitfile, even a broken one. Without one the
 * folder is outside Git; with one, every git failure is an error, never a sign of a folder outside Git (K201-3).
 */
function insideRepository(directory: string): boolean {
  for (let folder = path.resolve(directory); ; folder = path.dirname(folder)) {
    if (entryExists(path.join(folder, '.git'))) return true;
    if (folder === path.dirname(folder)) return false;
  }
}

/** Whether the entry `file` exists, without following a symbolic link; any other error is thrown. */
function entryExists(file: string): boolean {
  try { lstatSync(file); return true; } catch (error) {
    if (isJsonObject(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** The absolute paths of git rev-parse `args` in `directory`, or undefined outside a repository; git's failure throws with its stderr. */
function revParse(directory: string, ...args: string[]): string[] | undefined {
  if (!insideRepository(directory)) return undefined;
  const outcome = linkGit(directory, 'rev-parse', '--path-format=absolute', ...args);
  if (outcome.error) throw new Error(`git rev-parse could not start in ${directory}: ${outcome.error.message}`);
  if (outcome.status !== 0) throw new Error(`git rev-parse failed in ${directory}: ${outcome.stderr.trim()}`);
  return outcome.stdout.trim().split('\n');
}

/** The repository of `directory`: the real path of its common Git directory, shared by every worktree; the folder outside Git. */
export const repositoryOf = (directory: string): string => realpathSync(revParse(directory, '--git-common-dir')?.[0] ?? directory);

/** The top level of the work tree of `directory`, or `directory` itself outside Git. */
export const workTreeOf = (directory: string): string => realpathSync(revParse(directory, '--show-toplevel')?.[0] ?? directory);

/** Whether `directory` is the top level of a main checkout: its Git directory is the common one. */
function isMainCheckout(directory: string): boolean {
  const found = revParse(directory, '--show-toplevel', '--git-dir', '--git-common-dir');
  if (!found) return false;
  const [top, gitDir, common] = found.map(item => realpathSync(item));
  return top === realpathSync(directory) && gitDir === common;
}

/** The tracked files of the work tree `root` whose base name is one of `names`, relative to `root`. */
export function trackedManifests(root: string, names: readonly string[]): string[] {
  const outcome = linkGit(root, 'ls-files', '-z', '--', ...names.flatMap(name => [name, `*/${name}`]));
  if (outcome.error || outcome.status !== 0) throw new Error(`git ls-files failed in ${root}: ${outcome.error?.message ?? outcome.stderr.trim()}`);
  return outcome.stdout.split('\0').filter(file => file && names.includes(path.basename(file)));
}

/** A requirement of a go.mod: the module path and its version. */
export type GoRequirement = { path: string; version: string };

/**
 * The module path and requirements of the go.mod `file`, as go mod edit -json reads it. The go runs in `cwd`, the consumer
 * whose go it is: a shim of mise reads the mise.toml of the directory it runs in, which only the consumer trusts (K199).
 */
export function goModule(go: Tool, file: string, cwd: string): { module: string; requires: GoRequirement[] } {
  const parsed = JSON.parse(run(go.command, ['mod', 'edit', '-json', file], { cwd, env: go.env })) as unknown;
  if (!isJsonObject(parsed) || !isJsonObject(parsed.Module) || typeof parsed.Module.Path !== 'string') throw new Error(`${file}: go mod edit -json printed no module`);
  const requires = Array.isArray(parsed.Require)
    ? parsed.Require.flatMap(item => (isJsonObject(item) && typeof item.Path === 'string' && typeof item.Version === 'string' ? [{ path: item.Path, version: item.Version }] : []))
    : [];
  return { module: parsed.Module.Path, requires };
}

/** The TOML file `file` (a pyproject.toml or a Cargo.toml) as a table. */
export const readTomlFile = (file: string): Record<string, unknown> => readToml(readFileSync(file, 'utf8'), file);

/** The normalized project.name of the pyproject `file`, or undefined. */
function pyprojectName(file: string): string | undefined {
  const project = readTomlFile(file).project;
  return isTable(project) && typeof project.name === 'string' ? normalizeName(project.name) : undefined;
}

/** A provider: the package folder of a main checkout under the root that provides `name` of `ecosystem`. */
export type Provider = { ecosystem: Ecosystem; name: string; folder: string; repository: string; checkout: string };

/** The key of a package name of an ecosystem. */
export const providerKey = (ecosystem: Ecosystem, name: string): string => `${ecosystem}:${name}`;

/** The main checkouts among the folders of `root`. */
export const mainCheckouts = (root: string): string[] =>
  readdirSync(root).sort().map(entry => path.join(root, entry)).filter(folder => statSync(folder).isDirectory() && isMainCheckout(folder));

/**
 * Every provider under `root`: each main checkout among its folders and each tracked manifest of a package there. A name
 * that a package folder and the repository root both provide is provided by the package folder, since the root is the
 * development project; two package folders that provide one name fail with both. `go` reads go.mod in `cwd`; without it
 * the Go modules provide nothing.
 */
export function providers(root: string, go: Tool | undefined, cwd: string): Map<string, Provider> {
  const found = new Map<string, Provider>();
  for (const checkout of mainCheckouts(root)) {
    const repository = repositoryOf(checkout);
    for (const file of trackedManifests(checkout, Object.values(MANIFESTS)).sort()) {
      if (EXCLUDED.test(file)) continue;
      const absolute = path.join(checkout, file);
      const provided = providedName(absolute, go, cwd);
      if (!provided) continue;
      const key = providerKey(provided.ecosystem, provided.name);
      const provider = { ...provided, folder: path.dirname(absolute), repository, checkout };
      const earlier = found.get(key);
      const atRoot = (item: Provider) => item.folder === item.checkout;
      if (!earlier) { found.set(key, provider); continue; }
      // A root yields to a package folder; two of one kind (both roots, or both package folders) are a conflict.
      if (atRoot(earlier) === atRoot(provider)) throw new Error(`${provided.ecosystem} package ${provided.name} has two providers: ${earlier.folder} and ${provider.folder}`);
      if (!atRoot(provider)) found.set(key, provider);
    }
  }
  return found;
}

/** The ecosystem and name that the manifest `file` publishes, or undefined. */
function providedName(file: string, go: Tool | undefined, cwd: string): { ecosystem: Ecosystem; name: string } | undefined {
  switch (path.basename(file)) {
    case MANIFESTS.npm: {
      const manifest = readNpmManifestFile(file);
      return manifest.name && manifest.private !== true ? { ecosystem: 'npm', name: manifest.name } : undefined;
    }
    case MANIFESTS.composer: {
      const name = readComposerManifestFile(file).name;
      return name ? { ecosystem: 'composer', name } : undefined;
    }
    case MANIFESTS.python: {
      const name = pyprojectName(file);
      return name ? { ecosystem: 'python', name } : undefined;
    }
    default:
      return go ? { ecosystem: 'go', name: goModule(go, file, cwd).module } : undefined;
  }
}

/** Whether Git ignores `file` in the repository that holds it (git check-ignore); false outside a work tree. */
export function isIgnored(file: string): boolean {
  let existing = path.dirname(file);
  while (!statExists(existing)) existing = path.dirname(existing);
  // Outside a repository no file is ignored; inside one git decides, and any failure of git throws with its message.
  if (!insideRepository(existing)) return false;
  const outcome = linkGit(existing, 'check-ignore', '-q', '--', file);
  if (outcome.error) throw new Error(`git check-ignore could not start in ${existing}: ${outcome.error.message}`);
  if (outcome.status === 0) return true;
  if (outcome.status === 1) return false;
  throw new Error(`git check-ignore ${file} failed: ${outcome.stderr.trim()}`);
}

/**
 * Fails unless Git ignores `file` in its repository, so the links never leave an untracked file that Git would show: a link
 * that replaces an installed folder, var/link/built of a provider, and the files of linkFile.
 */
export function assertIgnored(file: string): void {
  if (!isIgnored(file)) throw new Error(`${file} is not ignored by Git in its repository; the links write only ignored files`);
}

/** Whether `file` exists. */
function statExists(file: string): boolean {
  try { statSync(file); return true; } catch (error) {
    if (isJsonObject(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}
