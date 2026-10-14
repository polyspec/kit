// The PEP 751 lock of a Python project, pylock.toml (or pylock.<name>.toml), as uv and pip write it, read as TOML by
// smol-toml (toml.mts).
//
// `readPylock` returns the lock version, the writer named by `created-by` (null when absent) and each package with its source:
// `registry` (sdist and wheels, each with its sha256 or null), `archive` (one URL file), `vcs` (git with its requested revision
// and commit), `directory` (a local path) or `none` (no source table). The gate judges the hashes, the commit and the sources.
// PEP 751 makes each of these fields a string; a value of another type fails with the field and the package.
import { isTable, readToml, type TomlTable, type TomlValue } from './toml.mts';

/** The field `key` of `value`; undefined for a value that is not a table, as reading the property of such a value gives. */
const field = (value: TomlValue | undefined, key: string): TomlValue | undefined => (isTable(value) ? value[key] : undefined);

/** The string field `key` of `value`, null when it is absent; throws for a value of another type. */
function stringField(value: TomlValue | undefined, key: string, where: string): string | null {
  const item = field(value, key);
  if (item === undefined) return null;
  if (typeof item !== 'string') throw new Error(`${where}: ${key} is ${JSON.stringify(item)}, PEP 751 makes it a string`);
  return item;
}

/** The vcs table of a package as the lock holds it; a field the lock lacks is null. */
export type PylockVcs = { type: string | null; url: string | null; requestedRevision: string | null; commitId: string | null; subdirectory: string | null };

/** A file of a package as the lock holds it; a field the lock lacks is null. */
export type PylockFile = { url: string | null; path: string | null; sha256: string | null };

/** The source of a package: a vcs table, or the archive file, or the registry files, or none. */
export type PylockSource<File> =
  | { kind: 'vcs'; vcs: PylockVcs; files: [] }
  | { kind: 'archive'; vcs: null; files: [File] }
  | { kind: 'registry' | 'directory' | 'none'; vcs: null; files: File[] };

/** A package of a lock. */
export type PylockPackage = { name: string; version: string } & PylockSource<PylockFile>;

/** A PEP 751 lock as readPylock reads it. */
export type Pylock = { lockVersion: string; createdBy: string | null; packages: PylockPackage[] };

/** The source of a package of a lock: the first table of `vcs`, `directory`, `archive`, else the registry files. */
function sourceOf(entry: TomlTable, lock: string, name: string): PylockSource<TomlValue> {
  if (entry.vcs !== undefined) {
    const vcs = entry.vcs;
    const where = `${lock}: the vcs of ${name}`;
    return { kind: 'vcs', vcs: {
      type: stringField(vcs, 'type', where),
      url: stringField(vcs, 'url', where),
      requestedRevision: stringField(vcs, 'requested-revision', where),
      commitId: stringField(vcs, 'commit-id', where),
      subdirectory: stringField(vcs, 'subdirectory', where),
    }, files: [] };
  }
  if (entry.directory !== undefined) return { kind: 'directory', vcs: null, files: [] };
  if (entry.archive !== undefined) return { kind: 'archive', vcs: null, files: [entry.archive] };
  if (entry.sdist !== undefined || entry.wheels !== undefined) {
    const wheels = entry.wheels ?? [];
    if (!Array.isArray(wheels)) throw new Error(`${lock}: the wheels of ${name} is not an array`);
    return { kind: 'registry', vcs: null, files: [...(entry.sdist === undefined ? [] : [entry.sdist]), ...wheels] };
  }
  return { kind: 'none', vcs: null, files: [] };
}

/** `source` with each of its files read by `read`; each variant keeps its form of files. */
function readFiles(source: PylockSource<TomlValue>, read: (file: TomlValue) => PylockFile): PylockSource<PylockFile> {
  if (source.kind === 'vcs') return { kind: 'vcs', vcs: source.vcs, files: [] };
  if (source.kind === 'archive') return { kind: 'archive', vcs: null, files: [read(source.files[0])] };
  return { kind: source.kind, vcs: null, files: source.files.map(read) };
}

/** Reads a PEP 751 lock: { lockVersion, createdBy, packages: [{ name, version, kind, vcs, files: [{ url, path, sha256 }] }] }. */
export function readPylock(text: string, lock: string): Pylock {
  const data = readToml(text, lock);
  if (data['lock-version'] !== '1.0') throw new Error(`${lock}: lock-version is ${JSON.stringify(data['lock-version'])}, PEP 751 requires "1.0"`);
  const createdBy = typeof data['created-by'] === 'string' ? data['created-by'] : null;
  const listed = data.packages ?? [];
  // .map below failed with a TypeError for a value that is not an array.
  if (!Array.isArray(listed)) throw new Error(`${lock}: packages is not an array of tables`);
  const packages = listed.map((entry) => {
    // A value that is not a table has no name, so it failed the same check.
    if (!isTable(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string') throw new Error(`${lock}: a package has no name or no version`);
    const name = entry.name;
    const source = sourceOf(entry, lock, name);
    const where = `${lock}: a file of ${name}`;
    const file = (value: TomlValue): PylockFile => ({ url: stringField(value, 'url', where), path: stringField(value, 'path', where), sha256: stringField(field(value, 'hashes'), 'sha256', where) });
    return { name, version: entry.version, ...readFiles(source, file) };
  });
  return { lockVersion: data['lock-version'], createdBy, packages };
}
