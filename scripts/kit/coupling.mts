// K1002: the parts of polyspec meet only through interfaces (PRINCIPLES S15). A part reaches another part through the interface that
// its installed manifest declares, the exports of its package.json for an npm package, and finds it through the JSON written at
// installation; it never reaches past those exports into the source of the other part, and names no path to a sibling checkout.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gitResult } from './git.mts';
import { isJsonObject } from './bootstrap/files.mts';
import { kitPackageRoot } from './kit-files.mts';

/** A reference to a file of a scoped package: an import specifier `@scope/x/sub` or, after `<folder>/node_modules/`, its path. */
const DEEP = /((?:[\w.@+-]+\/)*node_modules\/)?(@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)\/([A-Za-z0-9_@.+-][A-Za-z0-9_@.+/-]*)/g;
/** A file of kit that a recipe runs through the folder of the installed kit, `$(KIT)/<name>.$(KIT_EXT)`. */
const KIT_FILE = /\$\(KIT\)\/([A-Za-z0-9_-]+)/g;
/** A path that starts with `../`, quoted or a word of its line. */
const PARENT = /(?:^|[\s"'`:=,([{])(\.\.\/[^\s"'`,)\]}]*)/g;
/** A module specifier of a JavaScript or TypeScript file: `from '…'`, `import('…')`, `require('…')` and `import '…'`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(["'])([^"']+)\1/g;
/** The tracked files that are text of another kind than code and configuration: documents, change logs and the records of locks. */
const NOT_CODE = /(?:\.md|\.lock|(?:^|\/)package-lock\.json|(?:^|\/)pnpm-lock\.yaml|\.svg|\.png|\.jpe?g|\.gif|\.ico|\.woff2?|\.zip|\.tgz|\.whl)$/;
/** A file of a fixture, which holds the text that a test judges, not the code of its part. */
const FIXTURE = /(?:^|\/)fixtures?\//;

/** Whether `pattern`, an exports key or target that may hold one `*`, matches `subpath`. */
function matches(pattern: string, subpath: string): boolean {
  const [head = '', tail] = pattern.split('*');
  return tail === undefined ? pattern === subpath : subpath.length >= head.length + tail.length && subpath.startsWith(head) && subpath.endsWith(tail);
}

/** The string targets of an exports value with its conditions; null, which closes a subpath, gives none. */
function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(targets);
  return isJsonObject(value) ? Object.values(value).flatMap(targets) : [];
}

/** The subpath map of `exports`: a string or conditions without subpath keys stand for `.`. */
function subpaths(exports: unknown): Array<[string, unknown]> {
  return isJsonObject(exports) && Object.keys(exports).some(key => key.startsWith('.')) ? Object.entries(exports) : [['.', exports]];
}

/**
 * Whether the specifier subpath `subpath` (`./x`) resolves through `exports` as Node resolves it: the exact key, or else the matching
 * key with the longest text before its `*`; a key whose target is null closes it.
 */
function importable(exports: unknown, subpath: string): boolean {
  const entries = subpaths(exports);
  const exact = entries.find(([key]) => key === subpath);
  const pattern = entries.filter(([key]) => key.includes('*') && matches(key, subpath)).sort(([a], [b]) => b.indexOf('*') - a.indexOf('*'))[0];
  const chosen = exact ?? pattern;
  return chosen !== undefined && targets(chosen[1]).length > 0;
}

/** Whether the file path `subpath` (`./x`) of the package is a target of `exports`, which the package publishes as its interface. */
function published(exports: unknown, subpath: string): boolean {
  return subpaths(exports).some(([, value]) => targets(value).some(target => matches(target, subpath)));
}

/** The installed package.json of `name` that Node finds from the folder `from` of `root`: the nearest node_modules upward. */
function installedManifest(root: string, from: string, name: string): string | undefined {
  for (let folder = from; ; folder = path.posix.dirname(folder)) {
    const manifest = path.join(root, folder === '.' ? '' : folder, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return manifest;
    if (folder === '.') return undefined;
  }
}

/** The exports of the package.json `manifest`, or undefined when it declares none, which opens every file of the package. */
function exportsOf(manifest: string): unknown {
  const text: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  return isJsonObject(text) ? text.exports : undefined;
}

/** The tracked files of `root` that hold code or configuration: no document, lock record, binary or fixture. */
function codeFiles(root: string, source: boolean): string[] {
  const listed = gitResult(root, 'ls-files', '-z');
  if (listed.error || listed.status !== 0) throw new Error(`git ls-files failed in ${root}: ${listed.error?.message ?? listed.stderr.trim()}`);
  // The tests of kit itself write the layouts of consumers, sibling checkouts included, as their fixtures.
  return listed.stdout.split('\0').filter(file => file && !NOT_CODE.test(file) && !FIXTURE.test(file) && !/(?:^|\/)CHANGELOG/.test(file)
    && !(source && file.startsWith('tests/')));
}

/** The name of the package of `root`, whose own files are its own, not those of another part. */
function ownName(root: string): string {
  const manifest = path.join(root, 'package.json');
  if (!existsSync(manifest)) return '';
  const text: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  return isJsonObject(text) && typeof text.name === 'string' ? text.name : '';
}

/** The findings of the line `line` of `file` that reach a package past its exports. */
function packageFindings(root: string, file: string, line: string, own: string): string[] {
  return [...line.matchAll(DEEP)].flatMap(([, onDisk, name = '', sub = '']) => {
    // A package that no node_modules of the checkout holds is no installed part; an import of it fails by itself.
    // A path names its copy by its folder; a specifier, and a path a recipe reads after cd, find the nearest node_modules upward.
    const named = onDisk ? path.join(root, onDisk, name, 'package.json') : '';
    const manifest = name === own || sub === 'package.json' || sub.startsWith('-/') ? undefined
      : named && existsSync(named) ? named : installedManifest(root, path.posix.dirname(file), name);
    const exports = manifest === undefined ? undefined : exportsOf(manifest);
    const subpath = `./${sub.replace(/\.$/, '')}`;
    if (exports === undefined || (onDisk ? published(exports, subpath) : importable(exports, subpath))) return [];
    return [`reaches ${name}/${sub}, which the package.json of ${name} does not export; use an export of it, or have ${name} export it`];
  });
}

/** The findings of the line `line` of a recipe that runs a file of the installed kit that kit does not export. */
function kitFileFindings(line: string, kitExports: unknown): string[] {
  return [...line.matchAll(KIT_FILE)].flatMap(([, name = '']) => importable(kitExports, `./${name}`) ? []
    : [`runs $(KIT)/${name}, a file of kit that its package.json does not export; run a make target of kit or an export of it`]);
}

/** Whether the position `index` of `line` lies inside a string literal, the text of a fixture rather than a statement. */
function quoted(line: string, index: number): boolean {
  let quote = '';
  let escaped = false;
  for (const character of line.slice(0, index)) {
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (quote ? character === quote : '"\'`'.includes(character)) quote = quote ? '' : character;
  }
  return quote !== '';
}

/**
 * Whether a template literal is open after `line`, given whether one was open before it: a backtick counts outside `'` and `"`
 * strings and before a `//` comment, which end with their line; inside a template only an unescaped backtick closes it.
 */
function endsInTemplate(line: string, open: boolean): boolean {
  let template = open;
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\') { index += 1; continue; }
    if (template) { if (character === '`') template = false; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '/' && line[index + 1] === '/') break;
    if (character === '`') template = true;
    else if (character === '"' || character === "'") quote = character;
  }
  return template;
}

/**
 * Whether each line of `file` with the lines `lines` states paths from the root or its own folder: no line of a `run:` of a workflow,
 * which runs in its working-directory, and no line that a template literal of a script spans, the text of a fixture.
 */
function judgedLines(file: string, lines: readonly string[]): boolean[] {
  let block = -1;
  let template = false;
  return lines.map(line => {
    if (file.startsWith('.github/')) {
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (block >= 0 && (line.trim() === '' || indent > block)) return false;
      block = -1;
      // The column of the key run itself: its continuations lie deeper, the other keys of its step at that column.
      const run = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(line);
      if (run) block = (run[1] ?? '').length;
      return run === null;
    }
    if (!/\.(?:[mc]?[jt]s|tsx|jsx)$/.test(file)) return true;
    const inside = template;
    template = endsInTemplate(line, template);
    return !inside;
  });
}

/** The findings of the line `line` of `file` that name a path out of the repository, by the kind of the file. */
function pathFindings(file: string, line: string): string[] {
  const out = (target: string) => [`names the path ${target} out of the repository; another part is known by its installed package and the JSON written at installation`];
  if (/^(?:config|\.github)\/.*\.(?:ya?ml|json)$/.test(file)) {
    // A tool reads a path of its configuration from the root, except extends and $ref, which resolve from their own file.
    const base = /["']?(?:extends|\$ref)["']?\s*:/.test(line) ? path.posix.dirname(file) : '.';
    return [...line.matchAll(PARENT)].flatMap(([, target = '']) => /^\.\.\/[^/]/.test(path.posix.normalize(path.posix.join(base, target))) ? out(target) : []);
  }
  if (/(?:^|\/)(?:Makefile|[^/]*\.mk)$/.test(file)) {
    // A variable, a rule or an include reads its path from the root, where make runs; a recipe line may enter a folder with cd first.
    return /^\s*#/.test(line) || line.startsWith('\t') ? [] : [...line.matchAll(PARENT)].flatMap(([, target = '']) => /^\.\.\/[^/]/.test(path.posix.normalize(target)) ? out(target) : []);
  }
  if (/\.(?:[mc]?[jt]s|tsx|jsx)$/.test(file)) {
    return [...line.matchAll(SPECIFIER)].flatMap(({ index, 2: target = '' }) => !quoted(line, index) && target.startsWith('../') && path.posix.normalize(path.posix.join(path.posix.dirname(file), target)).startsWith('../') ? out(target) : []);
  }
  return [];
}

/**
 * The findings of `root` (S15): each line of its code and configuration that reaches a file of an installed package past the exports
 * of its package.json, each recipe that runs a file of kit that kit does not export, each path of config/ or .github/ out of the
 * repository, each recipe path to a sibling checkout, and each module specifier that leaves the repository. A path that code computes
 * while it runs is judged at review. `source` is kit itself, whose files are its own.
 */
export function couplingFindings(root: string, source = false): string[] {
  const own = ownName(root);
  const kitExports = source ? undefined : exportsOf(path.join(kitPackageRoot(), 'package.json'));
  return codeFiles(root, source).flatMap(file => {
    const text = readFileSync(path.join(root, file), 'utf8');
    if (text.includes('\0')) return [];
    const recipe = !source && /(?:^|\/)(?:Makefile|[^/]*\.mk)$/.test(file) && !file.startsWith('scripts/kit/');
    const lines = text.split('\n');
    const judged = judgedLines(file, lines);
    return lines.flatMap((line, index) => [
      ...packageFindings(root, file, line, own),
      ...(recipe && kitExports !== undefined ? kitFileFindings(line, kitExports) : []),
      ...(judged[index] ? pathFindings(file, line) : []),
    ].map(finding => `${file}:${index + 1} ${finding} (S15)`));
  });
}
