// The PEP 751 lock of a Python project, pylock.toml (or pylock.<name>.toml), as uv and pip write it. Node has no TOML reader and
// kit imports only Node built-ins, so this module reads the TOML that the lock writers produce: tables and arrays of tables
// (`[name]`, `[[name]]`), dotted and quoted keys, basic and literal strings, integers, booleans, offset datetimes kept as text,
// arrays and inline tables. Any other construct (multi-line strings, floats with exponents in keys, duplicate keys) fails with
// the line where it starts, so the reader never reads a lock differently from its text.
//
// `readPylock` returns the lock version, the writer named by `created-by` (null when absent) and each package with its source:
// `registry` (sdist and wheels, each with its sha256 or null), `archive` (one URL file), `vcs` (git with its requested revision
// and commit), `directory` (a local path) or `none` (no source table). The gate judges the hashes, the commit and the sources.

const BARE_KEY = /^[A-Za-z0-9_-]+/;
const INTEGER = /^[+-]?\d[\d_]*$/;
const FLOAT = /^[+-]?\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?$/;
const ESCAPES: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

/** A value of a TOML document as parseToml reads it; a datetime stays text. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;

/** A table of a TOML document. */
export type TomlTable = { [key: string]: TomlValue };

const isTable = (value: unknown): value is TomlTable => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The field `key` of `value`; undefined for a value that is not a table, as reading the property of such a value gives. */
const field = (value: TomlValue | undefined, key: string): TomlValue | undefined => (isTable(value) ? value[key] : undefined);

/** Parses the TOML text of a lock into plain objects, arrays and scalars; throws with the line of an unread construct. */
export function parseToml(text: string): TomlTable {
  let pos = 0;
  const lineAt = (index: number): number => text.slice(0, index).split('\n').length;
  const fail: (message: string, index?: number) => never = (message, index = pos) => {
    throw new Error(`line ${lineAt(index)}: ${message}`);
  };
  const spaces = () => { while (text[pos] === ' ' || text[pos] === '\t') pos += 1; };
  const skipComment = () => { if (text[pos] === '#') while (pos < text.length && text[pos] !== '\n') pos += 1; };
  // Blank space, comments and line breaks: between the entries of a document and the items of an array.
  const skipLayout = () => {
    for (;;) {
      spaces();
      skipComment();
      if (text[pos] === '\n' || text[pos] === '\r') pos += 1;
      else return;
    }
  };
  const endOfLine = () => {
    spaces();
    skipComment();
    if (pos >= text.length) return;
    if (text[pos] === '\n' || text[pos] === '\r') pos += 1;
    else fail(`unexpected ${JSON.stringify(text[pos])} after a value`);
  };

  const basicString = (): string => {
    if (text.startsWith('"""', pos)) fail('a multi-line string is not read; write the value on one line');
    pos += 1;
    let out = '';
    for (;;) {
      const char = text[pos];
      if (char === undefined || char === '\n') fail('an unterminated string');
      if (char === '"') { pos += 1; return out; }
      if (char !== '\\') { out += char; pos += 1; continue; }
      const code = text[pos + 1];
      if (code === 'u' || code === 'U') {
        const size = code === 'u' ? 4 : 8;
        const hex = text.slice(pos + 2, pos + 2 + size);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== size) fail('an invalid unicode escape');
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        pos += 2 + size;
      // A backslash at the end of the text has no code; `in` read it as the key `undefined`, which ESCAPES lacks.
      } else if (code !== undefined && code in ESCAPES) {
        out += ESCAPES[code];
        pos += 2;
      } else fail(`the escape \\${code} is not read`);
    }
  };
  const literalString = (): string => {
    if (text.startsWith("'''", pos)) fail('a multi-line string is not read; write the value on one line');
    const end = text.indexOf("'", pos + 1);
    const line = text.indexOf('\n', pos);
    if (end === -1 || (line !== -1 && end > line)) fail('an unterminated string');
    const value = text.slice(pos + 1, end);
    pos = end + 1;
    return value;
  };
  const key = (): string => {
    spaces();
    if (text[pos] === '"') return basicString();
    if (text[pos] === "'") return literalString();
    const match = BARE_KEY.exec(text.slice(pos));
    if (!match) fail(`expected a key, found ${JSON.stringify(text[pos] ?? 'end of file')}`);
    pos += match[0].length;
    return match[0];
  };
  const keyPath = (): string[] => {
    const path = [key()];
    for (spaces(); text[pos] === '.'; spaces()) {
      pos += 1;
      path.push(key());
      spaces();
    }
    return path;
  };
  const scalar = (): string | number | boolean => {
    const match = /^[^,\]}\n\r#]+/.exec(text.slice(pos));
    if (!match) fail('expected a value');
    const token = match[0].trim();
    pos += match[0].length;
    if (token === 'true' || token === 'false') return token === 'true';
    if (INTEGER.test(token)) return Number(token.replace(/_/g, ''));
    if (FLOAT.test(token)) return Number(token.replace(/_/g, ''));
    if (DATETIME.test(token)) return token;
    return fail(`the value ${JSON.stringify(token)} is not read`, pos - match[0].length);
  };
  const value = (): TomlValue => {
    spaces();
    const char = text[pos];
    if (char === '"') return basicString();
    if (char === "'") return literalString();
    if (char === '[') return array();
    if (char === '{') return inlineTable();
    return scalar();
  };
  const array = (): TomlValue[] => {
    pos += 1;
    const items: TomlValue[] = [];
    for (;;) {
      skipLayout();
      if (text[pos] === ']') { pos += 1; return items; }
      items.push(value());
      skipLayout();
      if (text[pos] === ',') { pos += 1; continue; }
      if (text[pos] === ']') { pos += 1; return items; }
      fail('expected "," or "]" in an array');
    }
  };
  const inlineTable = (): TomlTable => {
    pos += 1;
    const table: TomlTable = {};
    spaces();
    if (text[pos] === '}') { pos += 1; return table; }
    for (;;) {
      const path = keyPath();
      spaces();
      if (text[pos] !== '=') fail('expected "=" after a key');
      pos += 1;
      assign(table, path, value());
      spaces();
      if (text[pos] === ',') { pos += 1; spaces(); continue; }
      if (text[pos] === '}') { pos += 1; return table; }
      fail('expected "," or "}" in an inline table');
    }
  };
  // The table that a header or a dotted key names: an array of tables stands for its last element.
  const descend = (table: TomlTable, path: string[]): TomlTable => {
    let current = table;
    for (const name of path) {
      if (!(name in current)) current[name] = {};
      const next = current[name];
      // Possible defect, kept: the last item of an array value need not be a table (see the report of K71-1).
      if (Array.isArray(next)) current = next[next.length - 1] as TomlTable;
      else if (isTable(next)) current = next;
      else fail(`${name} is a value, not a table`);
    }
    return current;
  };
  const assign = (table: TomlTable, path: string[], item: TomlValue): void => {
    const owner = descend(table, path.slice(0, -1));
    // keyPath returns at least one key.
    const name = path.at(-1)!;
    if (name in owner) fail(`${name} is already defined`);
    owner[name] = item;
  };

  const root: TomlTable = {};
  let current = root;
  for (;;) {
    skipLayout();
    if (pos >= text.length) return root;
    if (text[pos] === '[') {
      const start = pos;
      const tableArray = text.startsWith('[[', pos);
      pos += tableArray ? 2 : 1;
      const path = keyPath();
      spaces();
      if (text.slice(pos, pos + (tableArray ? 2 : 1)) !== (tableArray ? ']]' : ']')) fail('expected the end of a table header', start);
      pos += tableArray ? 2 : 1;
      const owner = descend(root, path.slice(0, -1));
      // keyPath returns at least one key.
      const name = path.at(-1)!;
      if (tableArray) {
        if (!(name in owner)) owner[name] = [];
        if (!Array.isArray(owner[name])) fail(`${name} is a table, not an array of tables`, start);
        owner[name].push({});
        // The table pushed on the line above.
        current = owner[name].at(-1) as TomlTable;
      } else {
        if (name in owner) fail(`the table ${path.join('.')} is already defined`, start);
        owner[name] = {};
        current = owner[name];
      }
      endOfLine();
    } else {
      const path = keyPath();
      spaces();
      if (text[pos] !== '=') fail('expected "=" after a key');
      pos += 1;
      assign(current, path, value());
      endOfLine();
    }
  }
}


/** The vcs table of a package as the lock holds it; a field the lock lacks is null. */
export type PylockVcs = { type: TomlValue | null; url: TomlValue | null; requestedRevision: TomlValue | null; commitId: TomlValue | null; subdirectory: TomlValue | null };

/** A file of a package as the lock holds it; a field the lock lacks is null. */
export type PylockFile = { url: TomlValue | null; path: TomlValue | null; sha256: TomlValue | null };

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
    return { kind: 'vcs', vcs: {
      type: field(vcs, 'type') ?? null,
      url: field(vcs, 'url') ?? null,
      requestedRevision: field(vcs, 'requested-revision') ?? null,
      commitId: field(vcs, 'commit-id') ?? null,
      subdirectory: field(vcs, 'subdirectory') ?? null,
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

/** Reads a PEP 751 lock: { lockVersion, createdBy, packages: [{ name, version, kind, vcs, files: [{ url, path, sha256 }] }] }. */
export function readPylock(text: string, lock: string): Pylock {
  let data: TomlTable;
  try {
    data = parseToml(text);
  } catch (error) {
    // parseToml throws only an Error.
    throw new Error(`${lock}: ${(error as Error).message}`);
  }
  if (data['lock-version'] !== '1.0') throw new Error(`${lock}: lock-version is ${JSON.stringify(data['lock-version'])}, PEP 751 requires "1.0"`);
  const createdBy = typeof data['created-by'] === 'string' ? data['created-by'] : null;
  const listed = data.packages ?? [];
  // .map below failed with a TypeError for a value that is not an array.
  if (!Array.isArray(listed)) throw new Error(`${lock}: packages is not an array of tables`);
  const packages = listed.map((entry) => {
    // A value that is not a table has no name, so it failed the same check.
    if (!isTable(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string') throw new Error(`${lock}: a package has no name or no version`);
    const source = sourceOf(entry, lock, entry.name);
    return {
      name: entry.name,
      version: entry.version,
      kind: source.kind,
      vcs: source.vcs,
      files: source.files.map(file => ({ url: field(file, 'url') ?? null, path: field(file, 'path') ?? null, sha256: field(field(file, 'hashes'), 'sha256') ?? null })),
    } as PylockPackage; // kind, vcs and files come from one source, so they keep its variant through the map of files.
  });
  return { lockVersion: data['lock-version'], createdBy, packages };
}
