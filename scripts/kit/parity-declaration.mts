// The declaration of the language-parity check (config/parity.json): reading it against its schema, resolving its references
// against the tree, and the finding that every rule of the check reports. A declaration that names a missing file, an unknown
// implementation, or a stale entry is a finding of the rule `declaration`, and the other rules do not run on it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { ConfigError, parseJson, readConfigFindings, SchemaError } from './schema-validate.mts';
import { isJsonList, isJsonObject } from './bootstrap/files.mts';
import { present } from './present.mts';

export const DECLARATION = 'config/parity.json';

/** The runner of an implementation or a test pattern. */
/** The runners of the implementations and the test patterns. */
export const RUNNERS = ['go', 'cargo', 'node', 'vitest', 'php', 'python'] as const;
export type Runner = (typeof RUNNERS)[number];

/** The extractor of the public symbols of an implementation (parity-symbols.mts). */
export type Extractor = 'go' | 'php' | 'python' | 'rust' | 'ts';

/** An implementation of the declaration (parity.schema.json). */
export interface ParityImplementation {
  name: string;
  runner: Runner;
  prose?: string[];
  roots: string[];
  tests?: string[];
  support?: string[];
  /** Globs of the internal tests of the implementation, each with its reason (K313). */
  internal?: { glob: string; reason: string }[];
  command?: string;
  args?: string[];
  env?: { name: string; value: string }[];
  symbols?: { extractor: Extractor; entry: string };
  errors?: { file: string; pattern: string };
  /** The implementation whose test files this one runs in its own runtime (K232). */
  shares?: string;
}

/**
 * The roots of the implementations whose test files `entry` runs in its own runtime: the one it declares with `shares`, or, by
 * the layout of S10, the roots of the implementations of the PHP libraries, `packages/php` and `packages/<component>/php`, for
 * the extension `packages/php-ext` of the same runner (K285, K293).
 */
export function sharedRoots(entry: ParityImplementation, implementations: ReadonlyMap<string, ParityImplementation>): string[] {
  if (entry.shares !== undefined) return implementations.get(entry.shares)?.roots ?? [];
  if (!entry.roots.includes('packages/php-ext')) return [];
  return [...implementations.values()].filter(other => other.runner === entry.runner && other.name !== entry.name && other.roots.some(root => /^packages\/(?:[^/]+\/)?php$/.test(root))).flatMap(other => other.roots);
}

/** The native test of an implementation in a suite unit. */
export interface ParityBinding {
  implementation: string;
  test: string;
  symbol?: string;
  id?: string;
  command?: string[] | undefined;
  /** The runner of this binding in place of the runner of its implementation, with its reason (K422). */
  runner?: Runner | undefined;
  reason?: string | undefined;
}

/** The symbol id of an implementation in an API unit. */
export interface ParitySymbol {
  implementation: string;
  symbol: string;
}

/** A unit of the declaration: a suite of shared cases, a feature of one native test per implementation, or an API symbol. */
export interface ParityUnit {
  id: string;
  kind: 'suite' | 'feature' | 'api';
  /** The ids of the spec requirements that the unit tests (K273). */
  requirements: string[];
  file?: string;
  cases?: string;
  /** A directory suite: the file that each of its case directories holds, so only those cases are its cases (K277). */
  caseFile?: string;
  bindings?: ParityBinding[];
  symbols?: ParitySymbol[];
}

/** config/parity.json as parity.schema.json describes it. */
export interface ParityConfig {
  schema: 1;
  comment?: string;
  implementations: ParityImplementation[];
  suites?: string[];
  comparators?: string[];
  tools?: { root: string; reason: string }[];
  testPatterns?: { runner: Runner; globs: string[] }[];
  /** The pattern of the requirement ids that docs/spec defines (K273). */
  requirements: { pattern: string };
  units: ParityUnit[];
  errors?: { catalog: { file: string; pattern: string } };
  languageLists?: { file: string; pattern: string }[];
  documents?: { globs: string[]; nouns: string[] };
}

/** The declaration resolved against the tree; readDeclaration describes it. */
export interface ParityModel {
  config: ParityConfig;
  implementations: Map<string, ParityImplementation>;
  cases: Map<string, string[]>;
  tests: Map<string, string[]>;
  testRunners: Map<string, Runner[]>;
}

/** The environment that the references of a runner value read. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** The name of each rule, printed after its number. */
export const RULES = {
  declaration: 'declaration',
  R1: 'missing-implementation',
  R2: 'missing-binding',
  R3: 'not-executed',
  R4: 'undeclared-suite',
  R5: 'undeclared-test',
  R6: 'misplaced-test',
  R7: 'error-catalog',
  R9: 'language-set-drift',
  R10: 'docs-count',
  R11: 'undeclared-public',
  R12: 'duplicate-binding',
  R13: 'untraced-requirement',
  R14: 'unknown-requirement',
  R15: 'unnamed-requirement',
  R16: 'internal-contract',
  R17: 'leaked-internal',
  R18: 'duplicate-suite',
  R19: 'spec-without-requirement',
};

/** A rule of the check, a key of RULES. */
export type Rule = keyof typeof RULES;

/** What a finding names besides its rule and message. */
export interface FindingPlace {
  unit?: string | undefined;
  implementation?: string | undefined;
  place?: string | undefined;
  requirements?: string[] | undefined;
}

/** A finding of the check. */
export interface Finding {
  rule: Rule;
  unit: string | undefined;
  implementation: string | undefined;
  place: string | undefined;
  // The requirement ids the finding is about, a list so that R18 names each shared id; IDS (K414-1) selects by it.
  requirements?: string[] | undefined;
  message: string;
}

/** A finding of `rule` with the unit, implementation, place (a file or file:line) and requirements it names, when it names them. */
export const finding = (rule: Rule, message: string, { unit, implementation, place, requirements }: FindingPlace = {}): Finding => ({ rule, unit, implementation, place, requirements, message });

/** The finding as a line: `<rule> <name> [<unit>] [<implementation>] [<place>]: <message>`. */
export const findingLine = (item: Finding): string => `${[item.rule, RULES[item.rule], item.unit, item.implementation, item.place].filter(Boolean).join(' ')}: ${item.message}`;

/** The words that the first group of the matches of `pattern` (a multiline regular expression) holds in `text`, each with its line. */
export function captured(text: string, pattern: string): { text: string; line: number }[] {
  return [...text.matchAll(new RegExp(pattern, 'gm'))].map(match => ({ text: match[1] ?? '', line: text.slice(0, match.index).split('\n').length }));
}

/** How `found` differs from `expected`: `missing <names>; not in <source>: <names>`, or an empty string when the sets are equal. */
export function difference(expected: readonly string[], found: readonly string[], source: string): string {
  const missing = expected.filter(name => !found.includes(name));
  const extra = found.filter(name => !expected.includes(name));
  return [missing.length && `missing ${missing.join(', ')}`, extra.length && `not in ${source}: ${extra.join(', ')}`].filter(Boolean).join('; ');
}

/** The error of a pattern of the declaration that is no regular expression or has no group, or undefined. */
function patternError(source: string): string | undefined {
  try {
    // The empty alternative always matches '', so exec finds a match.
    return present(new RegExp(`${source}|`).exec(''), 'new RegExp(`${source}|`).exec(\'\')').length < 2 ? `the pattern ${source} has no group` : undefined;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return `the pattern ${source} is no regular expression: ${error.message}`;
  }
}

/**
 * The case names that the path `cases` ($ followed by .<key> and [*] steps, and an optional last .~ step) selects in `value`,
 * with an error for each step that finds nothing. `entries` pairs each name with `parent`, the object or array that holds it,
 * which holds the case; the case of a .~ name is the value of its key.
 */
export function casesOf(value: unknown, cases: string): { names: string[]; entries: CaseEntry[]; errors: string[] } {
  let selected: Selected[] = [{ value, where: '$', parent: undefined }];
  const errors: string[] = [];
  for (const [step, key] of cases.slice(1).matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)|\[\*\]|\.~/g)) {
    selected = selected.flatMap(({ value: item, where }): Selected[] => {
      if (step === '.~') {
        if (isJsonObject(item)) {
          return Object.entries(item).map(([name, entry]) => ({ value: name, where: `${where}.~`, parent: isJsonObject(entry) || isJsonList(entry) ? entry : undefined }));
        }
        errors.push(`${where} is no object`);
        return [];
      }
      if (key !== undefined) {
        if (isJsonObject(item) && key in item) return [{ value: item[key], where: `${where}${step}`, parent: item }];
        errors.push(`${where} has no ${key}`);
        return [];
      }
      if (isJsonList(item)) return item.map((entry, index) => ({ value: entry, where: `${where}[${index}]`, parent: item }));
      errors.push(`${where} is no array`);
      return [];
    });
  }
  for (const { value: name, where } of selected) if (typeof name !== 'string' || !name) errors.push(`${where} is no case name`);
  const entries = selected.filter((entry): entry is Selected & { value: string } => typeof entry.value === 'string' && entry.value !== '').map(entry => ({ name: entry.value, parent: entry.parent }));
  return { names: entries.map(entry => entry.name), entries, errors };
}

/**
 * The case directories that `glob` selects in the directory `directory`, read from the checked `files`: each / step of the glob
 * matches one directory level, and each directory that the whole glob matches is a case named by its path relative to
 * `directory`. With `caseFile`, only a selected directory that holds that file is a case (K277). A file that a step matches is
 * an error, and so is a ** step.
 */
function caseDirectories(files: ReadonlySet<string>, directory: string, glob: string, caseFile?: string): { names: string[]; errors: string[] } {
  const steps = glob.split('/');
  if (steps.some(step => step.includes('**'))) return { names: [], errors: [`the case glob ${glob} holds **; each / step of the glob matches one directory level`] };
  const names = new Set<string>();
  const errors: string[] = [];
  for (const file of [...files].filter(name => within(directory, name)).sort()) {
    const parts = path.posix.relative(directory, file).split('/');
    for (let depth = 1; depth <= Math.min(parts.length, steps.length); depth++) {
      const entry = parts.slice(0, depth).join('/');
      if (!matchesAny([steps.slice(0, depth).join('/')], entry)) break;
      if (depth === parts.length) errors.push(`${file} is a file where the case glob ${glob} matches a directory`);
      else if (depth === steps.length) names.add(entry);
    }
  }
  const held = caseFile === undefined ? [...names] : [...names].filter(name => files.has(`${directory}/${name}/${caseFile}`));
  return { names: held, errors };
}

/** A value that a step of a case path selects, with where it lies and the object or array that holds it. */
interface Selected {
  value: unknown;
  where: string;
  parent: Record<string, unknown> | unknown[] | undefined;
}

/** A case name with the object or array that holds it. */
export interface CaseEntry {
  name: string;
  parent: Record<string, unknown> | unknown[] | undefined;
}

/** Whether `file` lies in the directory `root`. */
export const within = (root: string, file: string): boolean => file.startsWith(`${root.replace(/\/+$/, '')}/`);

/** Whether the directory `root` is the whole repository. */
const wholeRepository = (root: string): boolean => /^(?:\.?\/*|\.\/+\.?)$/.test(root);

// A reference to the invoking environment in a runner value is ${NAME}; any other ${ form, such as a default, is no reference.
const REFERENCE = /\$\{([^}]*)(\}?)/g;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The first path of `value` that leaves the checkout `root`: a word (the parts between =, : and whitespace) that starts with ~,
 * an absolute path outside `root`, or a path with a .. segment; or undefined. The schema rejects such a path written in the
 * declaration, and this rejects one that a reference brings in.
 */
function leavingPath(value: string, root: string): string | undefined {
  return value.split(/[=:\s]/).find(word => word.startsWith('~') || (path.isAbsolute(word) && word !== root && !within(root, word)) || /(?:^|[^\w.-])\.\.(?:\/|$)/.test(word));
}

/**
 * `value` with each ${NAME} replaced by its value in `env`. A form that is no reference is an error of `where`; without `env`
 * only the forms are checked, and with it an unset or empty name is an error too, and so is a value whose path leaves `root`.
 */
function expand(value: string, env: Environment | undefined, where: string, fail: (message: string) => void, root = ''): string {
  let referenced = false;
  const expanded = value.replace(REFERENCE, (whole: string, name: string, close: string) => {
    if (!close || !NAME.test(name)) fail(`${where} holds ${whole}, which is no reference; a reference is \${NAME} and has no default`);
    else if (!env) return whole;
    else if (env[name] === undefined) fail(`${where} references ${whole}, which the environment does not set`);
    else if (env[name] === '') fail(`${where} references ${whole}, which the environment sets to an empty string`);
    else {
      referenced = true;
      return env[name];
    }
    return whole;
  });
  // The value of a reference is never printed, so the error names the value as declared.
  if (referenced && leavingPath(expanded, root) !== undefined) fail(`${where} ${value} resolves to a path that leaves the repository; a runner path lies inside the checkout`);
  return expanded;
}

/**
 * The implementation with the references of its command, args and env values expanded from `env`, each value kept inside the
 * checkout `root`, or only checked without `env`.
 */
function expanded(entry: ParityImplementation, env: Environment | undefined, fail: (message: string) => void, root = ''): ParityImplementation {
  return {
    ...entry,
    ...(entry.command === undefined ? {} : { command: expand(entry.command, env, 'command', fail, root) }),
    ...(entry.args === undefined ? {} : { args: entry.args.map(arg => expand(arg, env, 'args', fail, root)) }),
    ...(entry.env === undefined ? {} : { env: entry.env.map(variable => ({ ...variable, value: expand(variable.value, env, `env ${variable.name}`, fail, root) })) }),
  };
}

/**
 * The implementation with its references resolved from the invoking environment `env`, for the runs of its bindings in the
 * checkout `root`: `{ implementation, errors }`, each error naming the value and the name that is unset or empty, or the value
 * whose resolved path leaves `root`.
 */
export function resolveReferences(entry: ParityImplementation, env: Environment, root: string): { implementation: ParityImplementation; errors: string[] } {
  const errors: string[] = [];
  return { implementation: expanded(entry, env, message => errors.push(message), root), errors };
}

/**
 * The words of the command of a binding with their references resolved from the invoking environment `env`, by the rules of
 * resolveReferences: `{ command, errors }`, each error naming the word and the name that is unset or empty.
 */
export function resolveCommand(command: string[], env: Environment, root: string): { command: string[]; errors: string[] } {
  const errors: string[] = [];
  return { command: command.map(word => expand(word, env, 'binding command', message => errors.push(message), root)), errors };
}

// The symbol of a php suite binding: a test method of a fully qualified class, as PHPUnit names it (Ns\\ClassTest::testX).
const PHP_METHOD = /^(?:[A-Za-z_]\w*\\)*[A-Za-z_]\w*::[A-Za-z_]\w*$/;

// The test functions that go test runs (testing: Test, Benchmark and Fuzz followed by no lower-case letter, and Example) and
// the attributes that make a Rust function a test (#[test], #[bench], #[tokio::test], #[test_case(..)], #[rstest]).
const GO_TEST = /^func\s+((?:Test|Benchmark|Fuzz)(?![a-z])\w*|Example\w*)\s*\(/gm;
const CARGO_TEST = /#\[\s*((?:\w+::)*(?:test|bench|test_case|rstest))\b[^\]]*\]/g;

// The text of a Rust file as the compiler reads it: every comment (line, doc and nested block) and the contents of every string
// and char literal are blanked, newlines kept, so an attribute is read from code only and a doc comment that quotes one is no
// test (K204). A lifetime is no char literal; a raw string closes at its quote and the same number of hashes.
function rustCode(text: string): string {
  const blank = (span: string) => span.replace(/[^\n]/g, ' ');
  const rawString = /b?r(#*)"/y;
  const charLiteral = /'(?:\\u\{[0-9a-fA-F_]*\}|\\x[0-9a-fA-F]{2}|\\.|[^'\\\n])'/y;
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (text.startsWith('/*', i)) {
      let depth = 0;
      let j = i;
      do {
        if (text.startsWith('/*', j)) { depth++; j += 2; } else if (text.startsWith('*/', j)) { depth--; j += 2; } else j++;
      } while (depth > 0 && j < text.length);
      out += blank(text.slice(i, j));
      i = j;
    } else if (text[i] === 'b' || text[i] === 'r') {
      rawString.lastIndex = i;
      const raw = /\w/.test(text[i - 1] ?? '') ? null : rawString.exec(text);
      if (raw === null) {
        out += text[i];
        i++;
      } else {
        const close = `"${raw[1]}`;
        const end = text.indexOf(close, i + raw[0].length);
        const stop = end === -1 ? text.length : end + close.length;
        out += blank(text.slice(i, stop));
        i = stop;
      }
    } else if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, text.length);
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (text[i] === "'") {
      charLiteral.lastIndex = i;
      const char = charLiteral.exec(text);
      if (char === null) {
        out += text[i];
        i++;
      } else {
        out += blank(char[0]);
        i += char[0].length;
      }
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/**
 * The test files of each runner by kit's convention (S3). A declaration adds files with the tests of an implementation and the
 * testPatterns of a runner, and never removes one; cargo also runs every .rs file that holds a test attribute.
 */
export const CONVENTIONS: Readonly<Record<Runner, readonly string[]>> = {
  go: ['**/*_test.go'],
  cargo: ['**/tests/**/*.rs'],
  node: ['**/*.test.{ts,mts,cts,mjs,cjs,js}'],
  vitest: ['**/*.{test,spec}.{ts,mts,cts,js,mjs,cjs,tsx,jsx}'],
  php: ['**/*Test.php'],
  python: ['**/test_*.py'],
};

// The names of test files in the common conventions of every runner: *_test.*, test_*.*, *Test.*, *.test.* and *.spec.*. A file
// in the roots of an implementation with such a name is a test that a binding runs, unless it is a support file.
const TEST_NAME = /(?:_test\.[^/]+|(?:^|\/)test_[^/]*\.[^/]+|Test\.[^/]+|\.test\.[^/]+|\.spec\.[^/]+)$/;

/** Whether the name of `file` is the name of a test file in a common convention. */
export const testNamed = (file: string): boolean => TEST_NAME.test(file);

/** The tests that the native runner of a go or cargo support file would run in `text`, as the names to print. */
function supportTests(runner: Runner, text: string): string[] {
  if (runner === 'go') return [...text.matchAll(GO_TEST)].map(match => `declares func ${match[1]}, which go test runs`);
  if (runner === 'cargo') return [...rustCode(text).matchAll(CARGO_TEST)].map(match => `holds ${match[0]}, which cargo test runs`);
  return [];
}

/** The support files of `entry` among `files`. */
export const supportFiles = (entry: ParityImplementation, files: Iterable<string>): string[] => [...files].filter(file => matchesAny(entry.support ?? [], file));

/** The JSON value of a tracked file, or an error of the declaration. */
function readTrackedJson(root: string, files: ReadonlySet<string>, file: string, where: string, errors: Finding[]): unknown {
  if (!files.has(file)) {
    errors.push(finding('declaration', `${where}: ${file} does not exist`, { place: DECLARATION }));
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    errors.push(finding('declaration', `${where}: ${file} is no JSON: ${error.message}`, { place: DECLARATION }));
    return undefined;
  }
}

// The runtimes of an implementation folder (S5): packages/<runtime>/ holds a port of the main spec, and
// packages/<component>/<runtime>/ a port of a component; config/layout.kit.yml names the same runtimes.
const RUNTIMES = new Set(['go', 'php', 'php-ext', 'python', 'rust', 'ts', 'js']);

/** The implementation folders of the checked `files`, sorted: packages/<runtime> and packages/<component>/<runtime>. */
export function implementationFolders(files: Iterable<string>): string[] {
  const folders = new Set<string>();
  for (const file of files) {
    const [top, first, second, third] = file.split('/');
    if (top !== 'packages' || first === undefined || second === undefined) continue;
    if (RUNTIMES.has(first)) folders.add(`packages/${first}`);
    else if (third !== undefined && RUNTIMES.has(second)) folders.add(`packages/${first}/${second}`);
  }
  return [...folders].sort();
}

/**
 * The schema lines of the declaration scoped to `units` (K400-1): a line at /units/<index> counts only when the unit at that
 * index, read from the raw JSON, is named; the lines of other paths count. `ids` holds the ids of the raw units, and is
 * undefined when the raw JSON cannot be read as units, so that every line counts.
 */
function scopeSchemaLines(root: string, lines: string[], units: readonly string[]): { kept: string[]; dropped: number; ids?: Set<string> } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(root, DECLARATION), 'utf8'));
  } catch {
    return { kept: lines, dropped: 0 };
  }
  if (!isJsonObject(raw) || !isJsonList(raw.units)) return { kept: lines, dropped: 0 };
  const idAt = raw.units.map(unit => (isJsonObject(unit) && typeof unit.id === 'string' ? unit.id : undefined));
  const named = new Set(units);
  const prefix = `${DECLARATION}: /units/`;
  const kept: string[] = [];
  let dropped = 0;
  for (const line of lines) {
    const index = line.startsWith(prefix) ? /^\d+(?=[ /]|$)/.exec(line.slice(prefix.length))?.[0] : undefined;
    if (index === undefined || named.has(idAt[Number(index)] ?? '')) kept.push(line);
    else dropped++;
  }
  return { kept, dropped, ids: new Set(idAt.filter((id): id is string => id !== undefined)) };
}

/**
 * The declaration of `root` without the units that break its schema, the units at the indices that the schema lines `lines` name
 * (K517): the rest, which must pass the schema, and the ids of the units left out; or the schema lines of the rest.
 */
function withoutBrokenUnits(root: string, lines: readonly string[]): { value: ParityConfig; leftOut: string[] } | { errors: string[] } {
  const raw: unknown = JSON.parse(readFileSync(path.join(root, DECLARATION), 'utf8'));
  if (!isJsonObject(raw) || !isJsonList(raw.units)) return { errors: [...lines] };
  const prefix = `${DECLARATION}: /units/`;
  const broken = new Set(lines.map(line => (line.startsWith(prefix) ? /^\d+(?=[ /]|$)/.exec(line.slice(prefix.length))?.[0] : undefined)).filter((index): index is string => index !== undefined).map(Number));
  const leftOut = raw.units.flatMap((unit, index) => (broken.has(index) ? [isJsonObject(unit) && typeof unit.id === 'string' ? unit.id : `#${index}`] : []));
  try {
    return { value: parseJson<ParityConfig>(JSON.stringify({ ...raw, units: raw.units.filter((_, index) => !broken.has(index)) }), 'parity.schema.json', DECLARATION), leftOut };
  } catch (error) {
    if (error instanceof SchemaError) return { errors: error.lines };
    throw error;
  }
}

/**
 * The declaration of `root` resolved against `files` (the checked files): `{ errors, model }`. The model holds the config, the
 * implementations by name and the case names of each suite unit. The environment references of the runner values are checked
 * as forms only; the runs resolve them (resolveReferences). With `units` a declaration that breaks the schema gives
 * the schema lines of the named units and of the paths outside them; when only other units break it, they are left out,
 * `leftOut` names them, and the model holds the rest (K517).
 */
export function readDeclaration(root: string, files: ReadonlySet<string>, only?: readonly string[]): { errors: Finding[]; model?: ParityModel; leftOut?: string[] | undefined } {
  let read: ReturnType<typeof readConfigFindings<ParityConfig>>;
  try {
    read = readConfigFindings<ParityConfig>(root, DECLARATION, 'parity.schema.json');
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { errors: [finding('declaration', error.message, { place: DECLARATION })] };
  }
  let config: ParityConfig;
  let leftOut: string[] | undefined;
  if (read.errors && only !== undefined) {
    const scoped = scopeSchemaLines(root, read.errors, only);
    const known = scoped.ids;
    const unknown = known === undefined ? [] : only.filter(id => !known.has(id));
    const errors = [...scoped.kept.map(message => finding('declaration', message, { place: DECLARATION })), ...unknown.map(id => finding('declaration', `--unit ${id} names no unit of ${DECLARATION}`, { place: DECLARATION }))];
    if (errors.length > 0) return { errors };
    // K517: only other units break the schema; they are left out, and the rules run on the rest, so a check that did not run never
    // passes.
    const reduced = withoutBrokenUnits(root, read.errors);
    if ('errors' in reduced) return { errors: reduced.errors.map(message => finding('declaration', message, { place: DECLARATION })) };
    config = reduced.value;
    leftOut = reduced.leftOut;
  } else if (read.errors) {
    return { errors: read.errors.map(message => finding('declaration', message, { place: DECLARATION })) };
  } else {
    config = read.value;
  }
  const errors: Finding[] = [];
  const fail = (message: string) => errors.push(finding('declaration', message, { place: DECLARATION }));
  const implementations = new Map<string, ParityImplementation>();
  for (const entry of config.implementations) {
    if (implementations.has(entry.name)) fail(`the implementation ${entry.name} is declared twice`);
    implementations.set(entry.name, entry);
    expanded(entry, undefined, message => fail(`implementation ${entry.name}: ${message}`));
  }
  // An implementation that shares the tests of another runs that implementation's test files in its own runtime: the other is
  // a declared implementation of the same runner, never itself (K232).
  for (const entry of config.implementations.filter(entry => entry.shares !== undefined)) {
    const shared = implementations.get(entry.shares ?? '');
    if (entry.shares === entry.name) fail(`implementation ${entry.name} shares its own tests; shares names the implementation whose tests it runs`);
    else if (shared === undefined) fail(`implementation ${entry.name} shares the tests of ${entry.shares}, which is no implementation`);
    else if (shared.runner !== entry.runner) fail(`implementation ${entry.name} shares the tests of ${shared.name}, whose runner ${shared.runner} is not its runner ${entry.runner}`);
  }
  // An implementation is a source root with the manifest of its ecosystem, never a set of test globs (K336): a root holds a package.json
  // (node, vitest), composer.json (php), pyproject.toml (python), go.mod (go) or Cargo.toml (cargo), at the root or below it, and
  // no two implementations have the same roots, which would only split the tests of one package.
  const MANIFEST: Record<Runner, string> = { node: 'package.json', vitest: 'package.json', php: 'composer.json', python: 'pyproject.toml', go: 'go.mod', cargo: 'Cargo.toml' };
  for (const entry of config.implementations) {
    const manifest = MANIFEST[entry.runner];
    // The whole repository as a root is a finding of its own (below).
    const sources = entry.roots.filter(root => !/^\.\/?$/.test(root));
    if (sources.length > 0 && ![...files].some(file => path.posix.basename(file) === manifest && sources.some(root => within(root, file)))) {
      fail(`implementation ${entry.name}: no root of ${entry.roots.join(', ')} holds a ${manifest}; an implementation is a source root with the manifest of its ecosystem, never only test globs`);
    }
    const same = config.implementations.find(other => other !== entry && other.roots.length === entry.roots.length && other.roots.every(root => entry.roots.includes(root)));
    if (same && entry.name > same.name) fail(`implementation ${entry.name}: it has the roots of ${same.name}; two implementations of one package only split its tests`);
  }
  // R10 reads a name or a prose name, in any case, as one implementation, so no written name belongs to two.
  for (const entry of config.implementations) {
    for (const name of entry.prose ?? []) {
      const other = config.implementations.find(owner => owner !== entry && [owner.name, ...owner.prose ?? []].some(written => written.toLowerCase() === name.toLowerCase()));
      if (other) fail(`implementation ${entry.name}: the prose name ${name} is also a name of ${other.name}`);
    }
  }
  // A root of the whole repository would hold every test of every runner, so no test could lie outside it.
  for (const entry of config.implementations) {
    for (const root of entry.roots.filter(wholeRepository)) fail(`implementation ${entry.name}: the root ${root} is the whole repository; name the directories of the implementation`);
  }
  for (const root of (config.comparators ?? []).filter(wholeRepository)) fail(`comparators: the root ${root} is the whole repository; name the directories of the comparators`);
  // A tools root holds tests that implement no contract, so it shares no directory with an implementation and holds no bound test.
  const overlap = (left: string, right: string) => [[left, right], [right, left]].some(([outer, inner]) => `${present(inner, 'inner').replace(/\/+$/, '')}/`.startsWith(`${present(outer, 'outer').replace(/\/+$/, '')}/`));
  for (const tool of config.tools ?? []) {
    for (const entry of config.implementations) {
      for (const directory of entry.roots.filter(directory => overlap(tool.root, directory))) fail(`tools: the root ${tool.root} overlaps ${directory}, a root of the implementation ${entry.name}`);
    }
    if (!tool.reason.trim()) fail(`tools: the root ${tool.root} gives no reason; write why its tests belong to no implementation`);
    for (const unit of config.units) {
      for (const entry of (unit.bindings ?? []).filter(entry => within(tool.root, entry.test))) fail(`tools: the root ${tool.root} holds ${entry.test}, the test of the ${unit.kind} ${unit.id} in ${entry.implementation}`);
    }
  }
  for (const entry of config.implementations) {
    if (entry.symbols !== undefined && !existsSync(path.join(root, entry.symbols.entry))) fail(`implementation ${entry.name}: the symbols entry ${entry.symbols.entry} does not exist`);
    if (entry.errors && !files.has(entry.errors.file)) fail(`implementation ${entry.name}: ${entry.errors.file} does not exist`);
  }
  // The runners whose convention or declared testPatterns select each file, and the test files of each implementation: those of
  // its runner in its roots, and those of its tests globs.
  const testRunners = new Map<string, Runner[]>();
  for (const file of files) {
    const runners = RUNNERS.filter(runner => matchesAny([...CONVENTIONS[runner], ...(config.testPatterns ?? []).filter(pattern => pattern.runner === runner).flatMap(pattern => pattern.globs)], file)
      || (runner === 'cargo' && file.endsWith('.rs') && rustCode(readFileSync(path.join(root, file), 'utf8')).search(CARGO_TEST) !== -1));
    if (runners.length) testRunners.set(file, runners);
  }
  const tests = new Map(config.implementations.map(entry => [entry.name, [...files].filter(file => matchesAny(entry.tests ?? [], file) || (entry.roots.some(directory => within(directory, file)) && Boolean(testRunners.get(file)?.includes(entry.runner))))]));
  // A support glob names files in the roots of its implementation that a test glob selects or that are named like a test, and
  // that hold no test; one that selects none is stale. A Go or Rust support file holds no function that its native runner would run.
  for (const entry of config.implementations) {
    for (const file of supportFiles(entry, files)) {
      for (const test of supportTests(entry.runner, readFileSync(path.join(root, file), 'utf8'))) fail(`implementation ${entry.name}: the support file ${file} ${test}; a support file holds no test`);
      if (!entry.roots.some(directory => within(directory, file))) fail(`implementation ${entry.name}: the support file ${file} lies outside ${entry.roots.join(', ')}, the roots of ${entry.name}`);
    }
    for (const glob of entry.support ?? []) {
      if (![...files].some(file => matchesAny([glob], file) && (matchesAny(entry.tests ?? [], file) || Boolean(testRunners.get(file)?.includes(entry.runner)) || testNamed(file)))) fail(`implementation ${entry.name}: the support glob ${glob} selects no test file; remove it`);
    }
  }
  // An internal glob names test files of its implementation (K313); one that selects none is stale, and a file outside its roots is
  // none of its tests.
  for (const entry of config.implementations) {
    for (const { glob } of entry.internal ?? []) {
      const selected = [...files].filter(file => matchesAny([glob], file));
      if (!selected.some(file => tests.get(entry.name)?.includes(file))) fail(`implementation ${entry.name}: the internal glob ${glob} selects no test file of ${entry.name}`);
      for (const file of selected) if (!entry.roots.some(directory => within(directory, file))) fail(`implementation ${entry.name}: the internal test ${file} lies outside ${entry.roots.join(', ')}, the roots of ${entry.name}`);
    }
  }
  const patterns: [string, string][] = [
    ...config.implementations.filter((entry): entry is ParityImplementation & { errors: { file: string; pattern: string } } => entry.errors !== undefined).map((entry): [string, string] => [`implementation ${entry.name}`, entry.errors.pattern]),
    ...(config.errors ? [['errors catalog', config.errors.catalog.pattern] as [string, string]] : []),
    ...(config.languageLists ?? []).map((list): [string, string] => [`languageLists ${list.file}`, list.pattern]),
  ];
  for (const [where, source] of patterns) {
    const error = patternError(source);
    if (error) fail(`${where}: ${error}`);
  }
  const names = [...implementations.keys()];
  const units = new Map<string, ParityUnit>();
  const cases = new Map<string, string[]>();
  for (const unit of config.units) {
    if (units.has(unit.id)) fail(`the unit ${unit.id} is declared twice`);
    units.set(unit.id, unit);
    const where = `unit ${unit.id}`;
    const owned = unit.kind === 'api' ? unit.symbols ?? [] : unit.bindings ?? [];
    const misplaced = { suite: ['symbols'], feature: ['file', 'cases', 'symbols'], api: ['file', 'cases', 'bindings'] }[unit.kind];
    for (const key of misplaced) if (key in unit) fail(`${where}: a unit of kind ${unit.kind} has no ${key}`);
    const seen = new Set();
    for (const entry of owned) {
      if (!implementations.has(entry.implementation)) fail(`${where} names ${entry.implementation}, which is no implementation`);
      if (seen.has(entry.implementation)) errors.push(finding('R12', `${where} names ${entry.implementation} twice; a unit binds each implementation once, so keep one binding and remove the other`, { unit: unit.id, implementation: entry.implementation, place: DECLARATION }));
      seen.add(entry.implementation);
    }
    if (unit.kind === 'api') {
      if (!('symbols' in unit)) fail(`${where}: a unit of kind api needs symbols`);
      // has(name) holds before get(name).
      for (const name of names) if (!present(implementations.get(name), 'implementations.get(name)').symbols) fail(`${where}: the implementation ${name} declares no symbols`);
      continue;
    }
    for (const key of unit.kind === 'suite' ? ['file', 'cases', 'bindings'] : ['bindings']) if (!(key in unit)) fail(`${where}: a unit of kind ${unit.kind} needs ${key}`);
    for (const entry of unit.bindings ?? []) {
      if (!files.has(entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} does not exist`);
      if (matchesAny(implementations.get(entry.implementation)?.support ?? [], entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} matches its support globs`);
      if (matchesAny((implementations.get(entry.implementation)?.internal ?? []).map(item => item.glob), entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} matches its internal globs; an internal test is no parity unit`);
      for (const word of entry.command ?? []) expand(word, undefined, 'binding command', message => fail(`${where}: the binding of ${entry.implementation}: ${message}`));
      // A binding runs with the runner of its own only with the reason of it, which says why its contract is checked there.
      if ((entry.runner === undefined) !== (entry.reason === undefined)) {
        const problem = entry.runner === undefined ? 'has reason without runner; name the runner that runs its test' : 'has runner without reason; say why the implementation checks its contract in that ecosystem';
        errors.push(finding('declaration', `${where}: the binding of ${entry.implementation} ${problem}`, { unit: unit.id, implementation: entry.implementation, place: DECLARATION }));
      }
      if (unit.kind === 'feature') {
        if (entry.id === undefined) fail(`${where}: the binding of ${entry.implementation} needs id, the native test id that its runner reports`);
        if (entry.symbol !== undefined) fail(`${where}: the binding of ${entry.implementation} has symbol, which a feature binding does not take; its id names the test`);
        continue;
      }
      if (entry.id !== undefined) fail(`${where}: the binding of ${entry.implementation} has id, which a suite binding does not take; its cases come from ${unit.file}`);
      // The runner that runs the binding: its own, else that of its implementation.
      const runner = entry.runner ?? implementations.get(entry.implementation)?.runner;
      if ((runner === 'go' || runner === 'cargo') && !entry.symbol) fail(`${where}: the binding of ${entry.implementation} needs symbol, the ${runner === 'go' ? 'test function' : 'exact test path'} that runs the cases`);
      // A go binding without symbol took the branch above.
      else if (runner === 'go' && !/^Test\w*$/.test(present(entry.symbol, 'entry.symbol'))) fail(`${where}: the go binding names ${entry.symbol}, which is no test function (^Test\\w*$)`);
      else if (runner === 'php' && entry.symbol !== undefined && !PHP_METHOD.test(entry.symbol)) fail(`${where}: the php binding names ${entry.symbol}, which is no test method <class>::<method> of a fully qualified class`);
    }
    if (unit.kind === 'feature') continue;
    const goBound = (unit.bindings ?? []).some(entry => (entry.runner ?? implementations.get(entry.implementation)?.runner) === 'go');
    if (!unit.file || !unit.cases) continue;
    // A suite file that is a directory holds a case directory for each case, which a glob selects; a vector file names its cases.
    const directory = !files.has(unit.file) && [...files].some(file => within(present(unit.file, 'unit.file'), file));
    const glob = !unit.cases.startsWith('$');
    if (directory && !glob) {
      fail(`${where}: ${unit.file} is a directory, so cases is a glob of its case directories, not ${unit.cases}`);
      continue;
    }
    if (!directory && glob && files.has(unit.file)) {
      fail(`${where}: ${unit.file} is a file, so cases is a path $… of its case names, not ${unit.cases}`);
      continue;
    }
    if (!directory && unit.caseFile !== undefined) {
      fail(`${where}: caseFile ${unit.caseFile} applies only to a suite whose file is a directory, and ${unit.file} is a file`);
      continue;
    }
    let found: { names: string[]; entries: CaseEntry[]; errors: string[] };
    if (directory) {
      const read = caseDirectories(files, unit.file, unit.cases, unit.caseFile);
      found = { names: read.names, entries: read.names.map(name => ({ name, parent: undefined })), errors: read.errors };
      for (const error of found.errors) fail(`${where}: ${error}`);
    } else {
      const value = readTrackedJson(root, files, unit.file, where, errors);
      if (value === undefined) continue;
      found = casesOf(value, unit.cases);
      for (const error of found.errors) fail(`${where}: ${unit.file}: ${error}`);
    }
    if (!found.errors.length && !found.names.length) fail(`${where}: ${unit.cases} selects no case in ${unit.file}`);
    const repeated = found.names.filter((name, index) => found.names.indexOf(name) !== index);
    for (const name of new Set(repeated)) fail(`${where}: ${unit.file} repeats the case ${name}`);
    // A case name holds no whitespace, which go test rewrites to _ in a subtest name, and Go nests a subtest at each /.
    for (const name of found.names) {
      if (/\s/.test(name)) fail(`${where}: ${unit.file}: the case ${JSON.stringify(name)} holds whitespace, which no test name of the check can match`);
      if (goBound && !directory && name.includes('/')) fail(`${where}: ${unit.file}: the case ${JSON.stringify(name)} holds /, which Go nests as a subtest; the unit has a go binding`);
    }
    cases.set(unit.id, found.names);
  }
  if (config.errors) {
    if (!files.has(config.errors.catalog.file)) fail(`errors: the catalog ${config.errors.catalog.file} does not exist`);
  }
  for (const list of config.languageLists ?? []) {
    if (!files.has(list.file)) fail(`languageLists: ${list.file} does not exist`);
  }
  const model: ParityModel = {
    config,
    implementations,
    cases,
    tests,
    testRunners,
  };
  return { errors, model, leftOut };
}
