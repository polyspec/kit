// The dependency arrays of a pyproject.toml, read from its parsed document, the tables of either TOML reader of kit:
// `dependencies` of [project], each extra of [project.optional-dependencies] and each group of [dependency-groups]
// (PEP 735), whose `{ include-group = "…" }` tables are resolved as PEP 735 specifies; link reads the polyspec names of them (K177).
import { isJsonList, isJsonObject } from './bootstrap/files.mts';
import { parsePipRequirementsLine } from 'pip-requirements-js';

/** The kind of a dependency array: `dependencies` of [project], an extra or a dependency group. */
export type DependencyArrayKind = 'dependencies' | 'build-system' | `optional:${string}` | `group:${string}`;

/** A dependency array of a pyproject.toml: its kind, its TOML key and its items, as the document holds them. */
export type DependencyArray = { kind: DependencyArrayKind; where: string; list: unknown[] };

/** The normalized name of a distribution or a dependency group (PEP 503, which PEP 735 applies to group names). */
export const normalizeName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** The table `value` at the key `where` of `manifest`, or an empty table when the document lacks it. */
function table(value: unknown, where: string, manifest: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isJsonObject(value)) throw new Error(`${manifest}: ${where} is not a table`);
  return value;
}

/** The array `value` at the key `where` of `manifest`. */
function array(value: unknown, where: string, manifest: string): unknown[] {
  if (!isJsonList(value)) throw new Error(`${manifest}: ${where} is not an array`);
  return value;
}

/** Each dependency array of the pyproject `document` of `manifest`, in the order of the file. */
export function dependencyArrays(document: Record<string, unknown>, manifest: string): DependencyArray[] {
  const project = table(document['project'], 'project', manifest);
  const arrays: DependencyArray[] = [];
  // The requirements of the build backend are pinned and updated like the others (K296).
  const build = document['build-system'];
  if (build !== undefined) {
    const requires = table(build, 'build-system', manifest)['requires'];
    if (requires !== undefined) arrays.push({ kind: 'build-system', where: 'build-system.requires', list: array(requires, 'build-system.requires', manifest) });
  }
  if (project['dependencies'] !== undefined) arrays.push({ kind: 'dependencies', where: 'project.dependencies', list: array(project['dependencies'], 'project.dependencies', manifest) });
  for (const [extra, list] of Object.entries(table(project['optional-dependencies'], 'project.optional-dependencies', manifest))) {
    const where = `project.optional-dependencies.${extra}`;
    arrays.push({ kind: `optional:${extra}`, where, list: array(list, where, manifest) });
  }
  for (const [group, list] of Object.entries(table(document['dependency-groups'], 'dependency-groups', manifest))) {
    const where = `dependency-groups.${group}`;
    arrays.push({ kind: `group:${group}`, where, list: array(list, where, manifest) });
  }
  return arrays;
}

/**
 * The requirements of each dependency group of the pyproject `document` of `manifest`, by its name as written, with each
 * `{ include-group = "…" }` table replaced by the requirements of that group, as the reference implementation of PEP 735
 * resolves it: group names compare normalized, two names that normalize alike fail, and so do an include of a group that
 * does not exist, an include that leads back to its group, and an item that is neither a string nor an include table.
 */
export function dependencyGroups(document: Record<string, unknown>, manifest: string): Map<string, string[]> {
  const arrays = dependencyArrays(document, manifest).flatMap(({ kind, where, list }) => (kind.startsWith('group:') ? [{ name: kind.slice('group:'.length), where, list }] : []));
  const byName = new Map<string, { where: string; list: unknown[] }>();
  for (const { name, where, list } of arrays) {
    const key = normalizeName(name);
    if (byName.has(key)) throw new Error(`${manifest}: dependency-groups holds two groups whose names normalize to ${key}`);
    byName.set(key, { where, list });
  }
  const resolve = (key: string, path: string[]): string[] => {
    const group = byName.get(key);
    if (!group) throw new Error(`${manifest}: dependency-groups.${path.at(-1) ?? key} includes ${key}, which is no dependency group`);
    if (path.includes(key)) throw new Error(`${manifest}: dependency-groups.${key} includes itself through ${[...path, key].join(' -> ')}`);
    return group.list.flatMap((item, index) => {
      if (typeof item === 'string') return [item];
      const include = isJsonObject(item) && Object.keys(item).length === 1 ? item['include-group'] : undefined;
      if (typeof include !== 'string') throw new Error(`${manifest}: ${group.where}[${index}] is neither a requirement nor an { include-group } table`);
      return resolve(normalizeName(include), [...path, key]);
    });
  };
  return new Map(arrays.map(({ name }) => [name, resolve(normalizeName(name), [])]));
}

/** The normalized package names required by a pyproject's build, project, extra and group requirements. */
function manifestRequirements(document: Record<string, unknown>, manifest: string): unknown[] {
  return [
    ...dependencyArrays(document, manifest).filter(item => !item.kind.startsWith('group:')).flatMap(item => item.list),
    ...[...dependencyGroups(document, manifest).values()].flat(),
  ];
}

/** The normalized package names of the project's build, project, extra and group requirements. */
export function manifestPackageNames(document: Record<string, unknown>, manifest: string): string[] {
  return requirementPackageNames(manifestRequirements(document, manifest));
}

/** Explicit requirement extras forwarded to native editable requests without resolving versions or markers. */
export function manifestPackageExtras(document: Record<string, unknown>, manifest: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const requirement of manifestRequirements(document, manifest)) {
    if (typeof requirement !== 'string') continue;
    const parsed = parsePipRequirementsLine(requirement);
    if (!parsed || (parsed.type !== 'ProjectName' && parsed.type !== 'ProjectURL')) continue;
    const name = normalizeName(parsed.name);
    result.set(name, [...new Set([...(result.get(name) ?? []), ...(parsed.extras ?? [])])]);
  }
  return result;
}

/** The normalized names of PEP 508 requirements; version and marker resolution remains native. */
export function requirementPackageNames(requirements: readonly unknown[]): string[] {
  const names = requirements.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const parsed = parsePipRequirementsLine(item);
    return parsed && (parsed.type === 'ProjectName' || parsed.type === 'ProjectURL') ? [normalizeName(parsed.name)] : [];
  });
  return [...new Set(names)];
}

/** The normalized polyspec distributions named by a pyproject's requirements. */
export function manifestPolyspecNames(document: Record<string, unknown>, manifest: string): string[] {
  return manifestPackageNames(document, manifest).filter(name => name.startsWith('polyspec-'));
}

/** The names of a source project's runtime dependencies, without interpreting versions or markers. */
export function runtimePackageNames(document: Record<string, unknown>, manifest: string): string[] {
  return requirementPackageNames(dependencyArrays(document, manifest).filter(item => item.kind === 'dependencies').flatMap(item => item.list));
}
