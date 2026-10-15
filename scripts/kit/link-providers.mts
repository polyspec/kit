// The providers of the local links of 0.0.x development (docs/plans/local-links.md): the polyspec root that
// POLYSPEC_CHECKOUTS declares holds the main checkout of each polyspec repository, and each tracked manifest of a package
// there names what it provides: package.json `name` (npm, a private package provides nothing), composer.json `name`,
// pyproject.toml `project.name` (normalized, PEP 503) and go.mod `module` (go mod edit -json). A repository is identified
// by its common Git directory, which every worktree of it shares, so a consumer never links a package of its own
// repository, from whichever worktree it runs; a provider is always a main checkout, never a linked worktree.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { gitResult } from './git.mts';
import { readComposerManifestFile, readNpmManifestFile } from './manifests.mts';
import { run } from './process.mts';
import { normalizeName } from './pyproject-dependencies.mts';
import { isTable, readToml } from './toml.mts';

/** The environment variable that declares the polyspec root; without it, linking does nothing. */
export const ROOT_VARIABLE = 'POLYSPEC_CHECKOUTS';

export type Ecosystem = 'npm' | 'composer' | 'python' | 'go';

/** The manifest file of each ecosystem. */
export const MANIFESTS: Readonly<Record<Ecosystem, string>> = { npm: 'package.json', composer: 'composer.json', python: 'pyproject.toml', go: 'go.mod' };

// A manifest in one of these folders is a test, example, benchmark or fixture project, not a published package.
const NOT_PACKAGE = /(^|\/)(tests?|examples|benchmarks|docs|config|\.mise|[^/]*fixtures?)\//;

/** The declared polyspec root, or undefined when POLYSPEC_CHECKOUTS is unset or empty. */
export function declaredRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[ROOT_VARIABLE];
  return value ? realpathSync(value) : undefined;
}

/** The absolute paths of git rev-parse `args` in `directory`, or undefined outside a work tree. */
function revParse(directory: string, ...args: string[]): string[] | undefined {
  const outcome = gitResult(directory, 'rev-parse', '--path-format=absolute', ...args);
  return outcome.status === 0 ? outcome.stdout.trim().split('\n') : undefined;
}

/** The repository of `directory`: the real path of its common Git directory, shared by every worktree; the folder outside Git. */
export function repositoryOf(directory: string): string {
  const found = revParse(directory, '--git-common-dir')?.[0];
  return realpathSync(found ?? directory);
}

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
  const outcome = gitResult(root, 'ls-files', '-z', '--', ...names.flatMap(name => [name, `*/${name}`]));
  return outcome.status === 0 ? outcome.stdout.split('\0').filter(file => file && names.includes(path.basename(file))) : [];
}

/**
 * The module path and requirements of the go.mod `file`, as go mod edit -json reads it. The go runs in `cwd`, the consumer
 * whose go it is: a shim of mise reads the mise.toml of the directory it runs in, which only the consumer trusts (K199).
 */
export function goModule(go: string, file: string, cwd: string, env: NodeJS.ProcessEnv): { module: string; requires: string[] } {
  const parsed = JSON.parse(run(go, ['mod', 'edit', '-json', file], { cwd, env })) as unknown;
  if (!isJsonObject(parsed) || !isJsonObject(parsed.Module) || typeof parsed.Module.Path !== 'string') throw new Error(`${file}: go mod edit -json printed no module`);
  const requires = Array.isArray(parsed.Require) ? parsed.Require.flatMap(item => (isJsonObject(item) && typeof item.Path === 'string' ? [item.Path] : [])) : [];
  return { module: parsed.Module.Path, requires };
}

/** The pyproject.toml `file` as a table. */
export const readPyproject = (file: string): Record<string, unknown> => readToml(readFileSync(file, 'utf8'), file);

/** The normalized project.name of the pyproject `file`, or undefined. */
function pyprojectName(file: string): string | undefined {
  const project = readPyproject(file).project;
  return isTable(project) && typeof project.name === 'string' ? normalizeName(project.name) : undefined;
}

/** A provider: the package folder of a main checkout under the root that provides `name` of `ecosystem`. */
export type Provider = { ecosystem: Ecosystem; name: string; folder: string; repository: string };

/** The key of a package name of an ecosystem. */
export const providerKey = (ecosystem: Ecosystem, name: string): string => `${ecosystem}:${name}`;

/**
 * Every provider under `root`: each main checkout among its folders and each tracked manifest of a package there. A name
 * that a package folder and the repository root both provide is provided by the package folder; the root is the development
 * project. `go` runs go mod edit -json in `cwd`; without it, the Go modules provide nothing.
 */
export function providers(root: string, go: string | undefined, cwd: string, env: NodeJS.ProcessEnv): Map<string, Provider> {
  const found = new Map<string, Provider>();
  for (const entry of readdirSync(root).sort()) {
    const checkout = path.join(root, entry);
    if (!statSync(checkout).isDirectory() || !isMainCheckout(checkout)) continue;
    const repository = repositoryOf(checkout);
    for (const file of trackedManifests(checkout, Object.values(MANIFESTS)).sort()) {
      if (NOT_PACKAGE.test(file)) continue;
      const absolute = path.join(checkout, file);
      const provided = providedName(absolute, go, cwd, env);
      if (!provided) continue;
      const key = providerKey(provided.ecosystem, provided.name);
      if (!found.has(key) || file.includes('/')) found.set(key, { ...provided, folder: path.dirname(absolute), repository });
    }
  }
  return found;
}

/** The ecosystem and name that the manifest `file` publishes, or undefined. */
function providedName(file: string, go: string | undefined, cwd: string, env: NodeJS.ProcessEnv): { ecosystem: Ecosystem; name: string } | undefined {
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
      return go ? { ecosystem: 'go', name: goModule(go, file, cwd, env).module } : undefined;
  }
}

/** The raw JSON object of the manifest `file`, for the fields that the manifest types leave out (exports, main, types). */
export const rawManifest = (file: string): Record<string, unknown> => readJsonObject(file);
