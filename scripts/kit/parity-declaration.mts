// The declaration of the language-parity check (config/parity.json): reading it against its schema, resolving its references
// against the tree, and the finding that every rule of the check reports. A declaration that names a missing file, an unknown
// implementation or profile, or a stale entry is a finding of the rule `declaration`, and the other rules do not run on it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { anchors, headingAnchors } from './markdown.mts';
import { ConfigError, readConfigFindings } from './schema-validate.mts';
import { isJsonList, isJsonObject, isStringList } from './bootstrap/files.mts';
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
  command?: string;
  args?: string[];
  env?: { name: string; value: string }[];
  symbols?: { extractor: Extractor; entry: string };
  errors?: { file: string; pattern: string };
  /** The implementation whose test files this one runs in its own runtime (K232). */
  shares?: string;
}

/** A profile of the declaration. */
export interface ParityProfile {
  name: string;
  implementations: string[];
  reason?: string;
  spec?: string[];
}

/** The native test of an implementation in a suite unit. */
export interface ParityBinding {
  implementation: string;
  test: string;
  symbol?: string;
  id?: string;
  command?: string[] | undefined;
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
  profile: string;
  file?: string;
  cases?: string;
  admit?: string;
  bindings?: ParityBinding[];
  symbols?: ParitySymbol[];
}

/** A unit that an implementation of its profile does not hold yet. */
export interface ParityExclusion {
  unit: string;
  implementation: string;
  reason: string;
  item: string;
}

/** config/parity.json as parity.schema.json describes it. */
export interface ParityConfig {
  schema: 1;
  comment?: string;
  implementations: ParityImplementation[];
  profiles: ParityProfile[];
  suites?: string[];
  comparators?: string[];
  tools?: { root: string; reason: string }[];
  testPatterns?: { runner: Runner; globs: string[] }[];
  units: ParityUnit[];
  nativeOnly?: { implementation: string; symbol: string; reason: string; spec: string[] }[];
  exclusions?: ParityExclusion[];
  errors?: { profile: string; catalog: { file: string; pattern: string } };
  languageLists?: { file: string; pattern: string; profile: string }[];
  documents?: { globs: string[]; nouns: string[] };
}

/** A profile narrower than every implementation, with the implementations it omits and its reason. */
export interface NarrowProfile {
  name: string;
  omitted: string[];
  reason: string;
}

/** The declaration resolved against the tree; readDeclaration describes it. */
export interface ParityModel {
  config: ParityConfig;
  implementations: Map<string, ParityImplementation>;
  profiles: Map<string, string[]>;
  narrow: NarrowProfile[];
  cases: Map<string, string[]>;
  admit: (unit: ParityUnit) => string | undefined;
  admitted: (unit: ParityUnit, implementation: string) => string[];
  notAdmitted: (unit: ParityUnit) => { name: string; list: string[]; omitted: string[] }[];
  tests: Map<string, string[]>;
  testRunners: Map<string, Runner[]>;
  members: (unit: ParityUnit) => string[];
  exclusion: (unit: ParityUnit, implementation: string) => ParityExclusion | undefined;
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
  R8: 'exclusion',
  R9: 'language-set-drift',
  R10: 'docs-count',
  R11: 'undeclared-public',
  R12: 'duplicate-binding',
};

/** A rule of the check, a key of RULES. */
export type Rule = keyof typeof RULES;

/** What a finding names besides its rule and message. */
export interface FindingPlace {
  unit?: string | undefined;
  implementation?: string | undefined;
  place?: string | undefined;
}

/** A finding of the check. */
export interface Finding {
  rule: Rule;
  unit: string | undefined;
  implementation: string | undefined;
  place: string | undefined;
  message: string;
}

/** A finding of `rule` with the unit, implementation and place (a file or file:line) it names, when it names them. */
export const finding = (rule: Rule, message: string, { unit, implementation, place }: FindingPlace = {}): Finding => ({ rule, unit, implementation, place, message });

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
 * which carries the admit list of its case; the case of a .~ name is the value of its key.
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
 * `directory`; the files inside a case are not examined. A file that a step matches is an error, and so is a ** step.
 */
function caseDirectories(files: ReadonlySet<string>, directory: string, glob: string): { names: string[]; errors: string[] } {
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
  return { names: [...names], errors };
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

/**
 * Why the spec anchor `anchor` (<file>#<fragment>, the file under contracts/ or docs/spec/) does not resolve among the
 * checked `files`, or undefined when it does: a Markdown file defines the fragment as an explicit anchor or a heading anchor,
 * and the fragment of a JSON file is a JSON Pointer (RFC 6901) to a value of it.
 */
function unresolvedAnchor(root: string, files: ReadonlySet<string>, anchor: string): string | undefined {
  const hash = anchor.indexOf('#');
  const file = anchor.slice(0, hash);
  const fragment = anchor.slice(hash + 1);
  if (!files.has(file)) return `${file} does not exist`;
  const text = readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.md')) return anchors(text).includes(fragment) || headingAnchors(text).includes(fragment.toLowerCase()) ? undefined : `${file} defines no anchor ${fragment}`;
  if (!file.endsWith('.json')) return `${file} is no Markdown or JSON file, so it has no anchor`;
  if (!fragment.startsWith('/')) return `${fragment} is no JSON Pointer; it starts with /`;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return `${file} is no JSON: ${error.message}`;
  }
  for (const token of fragment.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (!(isJsonObject(value) || isJsonList(value)) || !Object.hasOwn(value, token)) return `${file} has no value at ${fragment}`;
    value = isJsonList(value) ? value[Number(token)] : value[token];
  }
  return undefined;
}

/**
 * The declaration of `root` resolved against `files` (the checked files): `{ errors, model }`. The model holds the config, the
 * implementations and profiles by name, the case names of each suite unit, and `members(unit)`,
 * the implementations of the unit's profile, and `exclusion(unit, implementation)`. The environment references of the runner
 * values are checked as forms only; the runs resolve them (resolveReferences).
 */
export function readDeclaration(root: string, files: ReadonlySet<string>): { errors: Finding[]; model?: ParityModel } {
  if (!existsSync(path.join(root, DECLARATION))) return { errors: [finding('declaration', `${DECLARATION} does not exist; declare the implementations and units there (scripts/kit/schema/parity.schema.json)`)] };
  let read: ReturnType<typeof readConfigFindings<ParityConfig>>;
  try {
    read = readConfigFindings<ParityConfig>(root, DECLARATION, 'parity.schema.json');
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { errors: [finding('declaration', error.message, { place: DECLARATION })] };
  }
  if (read.errors) return { errors: read.errors.map(message => finding('declaration', message, { place: DECLARATION })) };
  const config = read.value;
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
  // R10 reads a name or a prose name, in any case, as one implementation, so no written name belongs to two.
  for (const entry of config.implementations) {
    for (const name of entry.prose ?? []) {
      const other = config.implementations.find(owner => owner !== entry && [owner.name, ...owner.prose ?? []].some(written => written.toLowerCase() === name.toLowerCase()));
      if (other) fail(`implementation ${entry.name}: the prose name ${name} is also a name of ${other.name}`);
    }
  }
  const profiles = new Map<string, string[]>();
  for (const profile of config.profiles) {
    if (profiles.has(profile.name)) fail(`the profile ${profile.name} is declared twice`);
    profiles.set(profile.name, profile.implementations);
    for (const name of profile.implementations) if (!implementations.has(name)) fail(`profile ${profile.name} names ${name}, which is no implementation`);
    if (new Set(profile.implementations).size !== profile.implementations.length) fail(`profile ${profile.name} names an implementation twice`);
  }
  // A profile narrower than every implementation removes the omitted ones from its units, so it states why, every run prints
  // it, and it groups at least two units: a profile of one unit would be an exclusion that never fails.
  const narrow = config.profiles.map(profile => ({ name: profile.name, omitted: config.implementations.map(entry => entry.name).filter(name => !profile.implementations.includes(name)), reason: profile.reason?.trim() ?? '' }))
    .filter(profile => profile.omitted.length);
  // A narrow profile is a permanent difference, so its reason cites the spec that makes it one (S6); a profile of every
  // implementation is no difference and cites none.
  const unresolved = (where: string, spec: string[]) => {
    for (const anchor of spec) {
      const problem = unresolvedAnchor(root, files, anchor);
      if (problem) fail(`${where}: the spec anchor ${anchor} does not resolve: ${problem}`);
    }
  };
  for (const profile of config.profiles) {
    if (narrow.some(entry => entry.name === profile.name)) {
      if (!profile.spec) fail(`profile ${profile.name} omits implementations and cites no spec anchor; write the anchors of its reason in spec`);
    } else if (profile.spec) fail(`profile ${profile.name} omits no implementation, so it cites no spec anchor; remove spec`);
    unresolved(`profile ${profile.name}`, profile.spec ?? []);
  }
  for (const entry of config.nativeOnly ?? []) unresolved(`nativeOnly ${entry.symbol}`, entry.spec);
  for (const profile of narrow) {
    if (!profile.reason) fail(`profile ${profile.name} omits ${profile.omitted.join(', ')} and gives no reason; write the reason in reason`);
    const users = config.units.filter(unit => unit.profile === profile.name);
    // users[0] below exists: it is read only when users holds one unit.
    if (users.length === 1) fail(`profile ${profile.name} omits implementations and only the unit ${present(users[0], 'users[0]').id} uses it; a profile groups the units that share its reason, so put the unit in a wider profile or exclude what it lacks`);
  }
  for (const entry of config.implementations) {
    if (!config.profiles.some(profile => profile.implementations.includes(entry.name))) fail(`the implementation ${entry.name} is in no profile, so no unit applies to it`);
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
  const knownProfile = (name: string, where: string): boolean => profiles.has(name) || (fail(`${where} names the profile ${name}, which is not declared`), false);
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
  const patterns: [string, string][] = [
    ...config.implementations.filter((entry): entry is ParityImplementation & { errors: { file: string; pattern: string } } => entry.errors !== undefined).map((entry): [string, string] => [`implementation ${entry.name}`, entry.errors.pattern]),
    ...(config.errors ? [['errors catalog', config.errors.catalog.pattern] as [string, string]] : []),
    ...(config.languageLists ?? []).map((list): [string, string] => [`languageLists ${list.file}`, list.pattern]),
  ];
  for (const [where, source] of patterns) {
    const error = patternError(source);
    if (error) fail(`${where}: ${error}`);
  }
  const units = new Map<string, ParityUnit>();
  const cases = new Map<string, string[]>();
  const admissions = new Map<string, Map<string, string[]>>();
  for (const unit of config.units) {
    if (units.has(unit.id)) fail(`the unit ${unit.id} is declared twice`);
    units.set(unit.id, unit);
    const where = `unit ${unit.id}`;
    // A known profile is in profiles.
    const members = knownProfile(unit.profile, where) ? present(profiles.get(unit.profile), 'profiles.get(unit.profile)') : [];
    const owned = unit.kind === 'api' ? unit.symbols ?? [] : unit.bindings ?? [];
    const misplaced = { suite: ['symbols'], feature: ['file', 'cases', 'admit', 'symbols'], api: ['file', 'cases', 'bindings', 'admit'] }[unit.kind];
    for (const key of misplaced) if (key in unit) fail(`${where}: a unit of kind ${unit.kind} has no ${key}`);
    const seen = new Set();
    for (const entry of owned) {
      if (!members.includes(entry.implementation)) fail(`${where} names ${entry.implementation}, which is not an implementation of the profile ${unit.profile}`);
      if (seen.has(entry.implementation)) errors.push(finding('R12', `${where} names ${entry.implementation} twice; a unit binds each implementation once, so keep one binding and remove the other`, { unit: unit.id, implementation: entry.implementation, place: DECLARATION }));
      seen.add(entry.implementation);
    }
    if (unit.kind === 'api') {
      if (!('symbols' in unit)) fail(`${where}: a unit of kind api needs symbols`);
      // has(name) holds before get(name).
      for (const name of members) if (implementations.has(name) && !present(implementations.get(name), 'implementations.get(name)').symbols) fail(`${where}: the implementation ${name} declares no symbols`);
      continue;
    }
    for (const key of unit.kind === 'suite' ? ['file', 'cases', 'bindings'] : ['bindings']) if (!(key in unit)) fail(`${where}: a unit of kind ${unit.kind} needs ${key}`);
    for (const entry of unit.bindings ?? []) {
      if (!files.has(entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} does not exist`);
      if (matchesAny(implementations.get(entry.implementation)?.support ?? [], entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} matches its support globs`);
      for (const word of entry.command ?? []) expand(word, undefined, 'binding command', message => fail(`${where}: the binding of ${entry.implementation}: ${message}`));
      if (unit.kind === 'feature') {
        if (entry.id === undefined) fail(`${where}: the binding of ${entry.implementation} needs id, the native test id that its runner reports`);
        if (entry.symbol !== undefined) fail(`${where}: the binding of ${entry.implementation} has symbol, which a feature binding does not take; its id names the test`);
        continue;
      }
      if (entry.id !== undefined) fail(`${where}: the binding of ${entry.implementation} has id, which a suite binding does not take; its cases come from ${unit.file}`);
      const runner = implementations.get(entry.implementation)?.runner;
      if ((runner === 'go' || runner === 'cargo') && !entry.symbol) fail(`${where}: the binding of ${entry.implementation} needs symbol, the ${runner === 'go' ? 'test function' : 'exact test path'} that runs the cases`);
      // A go binding without symbol took the branch above.
      else if (runner === 'go' && !/^Test\w*$/.test(present(entry.symbol, 'entry.symbol'))) fail(`${where}: the go binding names ${entry.symbol}, which is no test function (^Test\\w*$)`);
      else if (runner === 'php' && entry.symbol !== undefined && !PHP_METHOD.test(entry.symbol)) fail(`${where}: the php binding names ${entry.symbol}, which is no test method <class>::<method> of a fully qualified class`);
    }
    if (unit.kind === 'feature') continue;
    const goBound = (unit.bindings ?? []).some(entry => implementations.get(entry.implementation)?.runner === 'go');
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
    let found: { names: string[]; entries: CaseEntry[]; errors: string[] };
    if (directory) {
      const read = caseDirectories(files, unit.file, unit.cases);
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
    if (unit.admit !== undefined) {
      const admitted = new Map<string, string[]>();
      let carriers = 0;
      for (const { name, parent } of found.entries) {
        if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
          fail(`${where}: case ${name} is no object, so ${unit.admit} cannot list the implementations that admit it`);
          continue;
        }
        if (!(unit.admit in parent)) continue;
        carriers++;
        const list = parent[unit.admit];
        if (!isStringList(list)) {
          fail(`${where}: case ${name} has ${unit.admit} that is no array of implementation names`);
          continue;
        }
        // An empty list admits nothing, which is no list; a name twice is a copy that the list does not need.
        if (list.length === 0) fail(`${where}: case ${name} has ${unit.admit} that is empty; list the implementations that admit it, or remove the key`);
        for (const repeat of new Set(list.filter((entry, index) => list.indexOf(entry) !== index))) fail(`${where}: case ${name} lists ${repeat} twice in ${unit.admit}`);
        for (const implementation of list) if (!members.includes(implementation)) fail(`${where}: case ${name} admits ${implementation}, which is not an implementation of the profile ${unit.profile}`);
        admitted.set(name, list);
      }
      if (!found.errors.length && carriers === 0) fail(`${where}: no case of ${unit.file} has ${unit.admit}; remove the admit key or add it to the cases that it admits`);
      admissions.set(unit.id, admitted);
    }
  }
  for (const entry of config.nativeOnly ?? []) {
    if (!implementations.has(entry.implementation)) fail(`nativeOnly names ${entry.implementation}, which is no implementation`);
    else if (!present(implementations.get(entry.implementation), 'implementations.get(entry.implementation)').symbols) fail(`nativeOnly names ${entry.symbol} of ${entry.implementation}, which declares no symbols`);
  }
  const exclusions = new Map<string, ParityExclusion>();
  for (const entry of config.exclusions ?? []) {
    const unit = units.get(entry.unit);
    const key = `${entry.unit}\0${entry.implementation}`;
    if (!unit) fail(`exclusions names the unit ${entry.unit}, which is not declared`);
    else if (!(profiles.get(unit.profile) ?? []).includes(entry.implementation)) fail(`exclusions: ${entry.implementation} is not an implementation of the profile of ${entry.unit}`);
    else if ((unit.bindings ?? unit.symbols ?? []).some(owned => owned.implementation === entry.implementation)) fail(`exclusions: ${entry.unit} declares ${entry.implementation}; remove the exclusion or the declaration`);
    if (exclusions.has(key)) fail(`exclusions names ${entry.unit} of ${entry.implementation} twice`);
    exclusions.set(key, entry);
  }
  if (config.errors) {
    knownProfile(config.errors.profile, 'errors');
    if (!files.has(config.errors.catalog.file)) fail(`errors: the catalog ${config.errors.catalog.file} does not exist`);
  }
  for (const list of config.languageLists ?? []) {
    knownProfile(list.profile, `languageLists ${list.file}`);
    if (!files.has(list.file)) fail(`languageLists: ${list.file} does not exist`);
  }
  // The case names of a suite that `implementation` runs: every case, except those whose admit list omits it.
  // The second operand runs only when the admissions of the unit hold the name.
  const admitted = (unit: ParityUnit, implementation: string): string[] => (cases.get(unit.id) ?? []).filter(name => !admissions.get(unit.id)?.has(name) || present(present(admissions.get(unit.id), 'admissions.get(unit.id)').get(name), 'admissions.get(unit.id).get(name)').includes(implementation));
  // An implementation of the profile of an admit suite that admits no case runs nothing: it leaves the profile, or R8 excludes
  // it. An excluded one is already an R8 finding, so it is not repeated here.
  for (const unit of config.units.filter(entry => entry.kind === 'suite' && entry.admit !== undefined && cases.has(entry.id))) {
    for (const name of (profiles.get(unit.profile) ?? []).filter(member => implementations.has(member))) {
      if (exclusions.has(`${unit.id}\0${name}`) || admitted(unit, name).length) continue;
      fail(`unit ${unit.id}: no case of ${unit.file} admits ${name}, so the suite runs nothing for it; take ${name} out of the profile ${unit.profile}, or exclude it under R8 with its reason and item`);
    }
  }
  const model: ParityModel = {
    config,
    implementations,
    profiles,
    narrow,
    cases,
    admit: unit => unit.admit,
    admitted,
    // The cases that an admit list keeps from some implementation of the profile, as `case`, its list and the implementations it omits.
    notAdmitted: unit => (cases.get(unit.id) ?? []).flatMap((name) => {
      const list = admissions.get(unit.id)?.get(name);
      return list === undefined ? [] : [{ name, list, omitted: (profiles.get(unit.profile) ?? []).filter(member => implementations.has(member) && !list.includes(member)) }];
    }).filter(entry => entry.omitted.length),
    tests,
    testRunners,
    members: unit => (profiles.get(unit.profile) ?? []).filter(name => implementations.has(name)),
    exclusion: (unit, implementation) => exclusions.get(`${unit.id}\0${implementation}`),
  };
  return { errors, model };
}
