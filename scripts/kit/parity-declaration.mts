// The declaration of the language-parity check (config/parity.json): reading it against its schema, resolving its references
// against the tree, and the finding that every rule of the check reports. A declaration that names a missing file, an unknown
// implementation or profile, or a stale entry is a finding of the rule `declaration`, and the other rules do not run on it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { readConfig } from './schema-validate.mts';

export const DECLARATION = 'config/parity.json';

/** The runner of an implementation or a test pattern. */
export type Runner = 'go' | 'cargo' | 'node' | 'php' | 'python';

/** An implementation of the declaration (parity.schema.json). */
export interface ParityImplementation {
  name: string;
  runner: Runner;
  roots: string[];
  tests: string[];
  support?: string[];
  command?: string;
  args?: string[];
  env?: { name: string; value: string }[];
  symbols?: string;
  errors?: { file: string; pattern: string };
}

/** A profile of the declaration. */
export interface ParityProfile {
  name: string;
  implementations: string[];
  reason?: string;
}

/** The native test of an implementation in a suite unit. */
export interface ParityBinding {
  implementation: string;
  test: string;
  symbol?: string;
}

/** The symbol id of an implementation in an API unit. */
export interface ParitySymbol {
  implementation: string;
  symbol: string;
}

/** A unit of the declaration: a suite of shared cases or an API symbol. */
export interface ParityUnit {
  id: string;
  kind: 'suite' | 'api';
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
  testPatterns: { runner: Runner; globs: string[] }[];
  units: ParityUnit[];
  nativeOnly?: { implementation: string; symbol: string; reason: string }[];
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
  snapshots: Map<string, Map<string, boolean>>;
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
    return new RegExp(`${source}|`).exec('')!.length < 2 ? `the pattern ${source} has no group` : undefined;
  } catch (error) {
    return `the pattern ${source} is no regular expression: ${(error as SyntaxError).message}`;
  }
}

/**
 * The case names that the path `cases` ($ followed by .<key> and [*] steps) selects in `value`, with an error for each step that
 * finds nothing. `entries` pairs each name with `parent`, the object or array that holds it, which carries the admit list of its case.
 */
export function casesOf(value: unknown, cases: string): { names: string[]; entries: CaseEntry[]; errors: string[] } {
  let selected: Selected[] = [{ value, where: '$', parent: undefined }];
  const errors: string[] = [];
  for (const [step, key] of cases.slice(1).matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)|\[\*\]/g)) {
    selected = selected.flatMap(({ value: item, where }): Selected[] => {
      if (key !== undefined) {
        if (item && typeof item === 'object' && !Array.isArray(item) && key in item) return [{ value: (item as Record<string, unknown>)[key], where: `${where}${step}`, parent: item as Record<string, unknown> }];
        errors.push(`${where} has no ${key}`);
        return [];
      }
      if (Array.isArray(item)) return item.map((entry, index) => ({ value: entry, where: `${where}[${index}]`, parent: item }));
      errors.push(`${where} is no array`);
      return [];
    });
  }
  for (const { value: name, where } of selected) if (typeof name !== 'string' || !name) errors.push(`${where} is no case name`);
  const entries = selected.filter((entry): entry is Selected & { value: string } => typeof entry.value === 'string' && entry.value !== '').map(entry => ({ name: entry.value, parent: entry.parent }));
  return { names: entries.map(entry => entry.name), entries, errors };
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
 * `value` with each ${NAME} replaced by its value in `env`. A form that is no reference is an error of `where`; without `env`
 * only the forms are checked, and with it an unset or empty name is an error too.
 */
function expand(value: string, env: Environment | undefined, where: string, fail: (message: string) => void): string {
  return value.replace(REFERENCE, (whole: string, name: string, close: string) => {
    if (!close || !NAME.test(name)) fail(`${where} holds ${whole}, which is no reference; a reference is \${NAME} and has no default`);
    else if (!env) return whole;
    else if (env[name] === undefined) fail(`${where} references ${whole}, which the environment does not set`);
    else if (env[name] === '') fail(`${where} references ${whole}, which the environment sets to an empty string`);
    else return env[name];
    return whole;
  });
}

/** The implementation with the references of its command, args and env values expanded from `env`, or only checked without it. */
function expanded(entry: ParityImplementation, env: Environment | undefined, fail: (message: string) => void): ParityImplementation {
  return {
    ...entry,
    ...(entry.command === undefined ? {} : { command: expand(entry.command, env, 'command', fail) }),
    ...(entry.args === undefined ? {} : { args: entry.args.map(arg => expand(arg, env, 'args', fail)) }),
    ...(entry.env === undefined ? {} : { env: entry.env.map(variable => ({ ...variable, value: expand(variable.value, env, `env ${variable.name}`, fail) })) }),
  };
}

/**
 * The implementation with its references resolved from the invoking environment `env`, for the runs of its bindings:
 * `{ implementation, errors }`, each error naming the value and the name that is unset or empty.
 */
export function resolveReferences(entry: ParityImplementation, env: Environment): { implementation: ParityImplementation; errors: string[] } {
  const errors: string[] = [];
  return { implementation: expanded(entry, env, message => errors.push(message)), errors };
}

// The test functions that go test runs (testing: Test, Benchmark and Fuzz followed by no lower-case letter, and Example) and
// the attributes that make a Rust function a test (#[test], #[bench], #[tokio::test], #[test_case(..)], #[rstest]).
const GO_TEST = /^func\s+((?:Test|Benchmark|Fuzz)(?![a-z])\w*|Example\w*)\s*\(/gm;
const CARGO_TEST = /#\[\s*((?:\w+::)*(?:test|bench|test_case|rstest))\b[^\]]*\]/g;

/** The tests that the native runner of a go or cargo support file would run in `text`, as the names to print. */
function supportTests(runner: Runner, text: string): string[] {
  if (runner === 'go') return [...text.matchAll(GO_TEST)].map(match => `declares func ${match[1]}, which go test runs`);
  if (runner === 'cargo') return [...text.matchAll(CARGO_TEST)].map(match => `holds ${match[0]}, which cargo test runs`);
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
    errors.push(finding('declaration', `${where}: ${file} is no JSON: ${(error as Error).message}`, { place: DECLARATION }));
    return undefined;
  }
}

/** The symbols of a snapshot: a map from each id to whether it is exported, or errors for an entry without a boolean exported. */
function snapshotOf(value: unknown, file: string, errors: Finding[]): Map<string, boolean> {
  const symbols = new Map<string, boolean>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(finding('declaration', `${file} is no object of symbols`, { place: file }));
    return symbols;
  }
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry?.exported !== 'boolean') errors.push(finding('declaration', `${file}: the symbol ${id} has no boolean exported`, { place: file }));
    else symbols.set(id, entry.exported);
  }
  return symbols;
}

/**
 * The declaration of `root` resolved against `files` (the checked files): `{ errors, model }`. The model holds the config, the
 * implementations and profiles by name, the case names of each suite unit, the symbols of each snapshot, and `members(unit)`,
 * the implementations of the unit's profile, and `exclusion(unit, implementation)`. The environment references of the runner
 * values are checked as forms only; the runs resolve them (resolveReferences).
 */
export function readDeclaration(root: string, files: ReadonlySet<string>): { errors: Finding[]; model?: ParityModel } {
  if (!existsSync(path.join(root, DECLARATION))) return { errors: [finding('declaration', `${DECLARATION} does not exist; declare the implementations and units there (scripts/kit/schema/parity.schema.json)`)] };
  let read: ReturnType<typeof readConfig>;
  try {
    read = readConfig(root, DECLARATION, 'parity.schema.json');
  } catch (error) {
    return { errors: [finding('declaration', `${DECLARATION} is no JSON: ${(error as Error).message}`, { place: DECLARATION })] };
  }
  if (read.errors.length) return { errors: read.errors.map((message: string) => finding('declaration', message, { place: DECLARATION })) };
  // Validated against parity.schema.json above.
  const config = read.value as ParityConfig;
  const errors: Finding[] = [];
  const fail = (message: string) => errors.push(finding('declaration', message, { place: DECLARATION }));
  const implementations = new Map<string, ParityImplementation>();
  for (const entry of config.implementations) {
    if (implementations.has(entry.name)) fail(`the implementation ${entry.name} is declared twice`);
    implementations.set(entry.name, entry);
    expanded(entry, undefined, message => fail(`implementation ${entry.name}: ${message}`));
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
  for (const profile of narrow) {
    if (!profile.reason) fail(`profile ${profile.name} omits ${profile.omitted.join(', ')} and gives no reason; write the reason in reason`);
    const users = config.units.filter(unit => unit.profile === profile.name);
    // users[0] below exists: it is read only when users holds one unit.
    if (users.length === 1) fail(`profile ${profile.name} omits implementations and only the unit ${users[0]!.id} uses it; a profile groups the units that share its reason, so put the unit in a wider profile or exclude what it lacks`);
  }
  for (const entry of config.implementations) {
    if (!config.profiles.some(profile => profile.implementations.includes(entry.name))) fail(`the implementation ${entry.name} is in no profile, so no unit applies to it`);
  }
  // A root of the whole repository would hold every test of every runner, so no test could lie outside it.
  for (const entry of config.implementations) {
    for (const root of entry.roots.filter(wholeRepository)) fail(`implementation ${entry.name}: the root ${root} is the whole repository; name the directories of the implementation`);
  }
  for (const root of (config.comparators ?? []).filter(wholeRepository)) fail(`comparators: the root ${root} is the whole repository; name the directories of the comparators`);
  const knownProfile = (name: string, where: string): boolean => profiles.has(name) || (fail(`${where} names the profile ${name}, which is not declared`), false);
  const snapshots = new Map<string, Map<string, boolean>>();
  for (const entry of config.implementations) {
    if (entry.symbols !== undefined) {
      const value = readTrackedJson(root, files, entry.symbols, `implementation ${entry.name}`, errors);
      if (value !== undefined) snapshots.set(entry.name, snapshotOf(value, entry.symbols, errors));
    }
    if (entry.errors && !files.has(entry.errors.file)) fail(`implementation ${entry.name}: ${entry.errors.file} does not exist`);
  }
  // A support glob names files in the roots of its implementation that a test glob selects and that hold no test; one that
  // selects none is stale. A Go or Rust support file holds no function that its native runner would run.
  for (const entry of config.implementations) {
    const testGlobs = [...entry.tests, ...config.testPatterns.filter(pattern => pattern.runner === entry.runner).flatMap(pattern => pattern.globs)];
    for (const file of supportFiles(entry, files)) {
      for (const test of supportTests(entry.runner, readFileSync(path.join(root, file), 'utf8'))) fail(`implementation ${entry.name}: the support file ${file} ${test}; a support file holds no test`);
      if (!entry.roots.some(directory => within(directory, file))) fail(`implementation ${entry.name}: the support file ${file} lies outside ${entry.roots.join(', ')}, the roots of ${entry.name}`);
    }
    for (const glob of entry.support ?? []) {
      if (![...files].some(file => matchesAny([glob], file) && matchesAny(testGlobs, file))) fail(`implementation ${entry.name}: the support glob ${glob} selects no test file; remove it`);
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
    const members = knownProfile(unit.profile, where) ? profiles.get(unit.profile)! : [];
    const owned = unit.kind === 'suite' ? unit.bindings ?? [] : unit.symbols ?? [];
    const misplaced = unit.kind === 'suite' ? ['symbols'] : ['file', 'cases', 'bindings', 'admit'];
    for (const key of misplaced) if (key in unit) fail(`${where}: a unit of kind ${unit.kind} has no ${key}`);
    const seen = new Set();
    for (const entry of owned) {
      if (!members.includes(entry.implementation)) fail(`${where} names ${entry.implementation}, which is not an implementation of the profile ${unit.profile}`);
      if (seen.has(entry.implementation)) fail(`${where} names ${entry.implementation} twice`);
      seen.add(entry.implementation);
    }
    if (unit.kind === 'api') {
      // has(name) holds before get(name).
      for (const name of members) if (implementations.has(name) && !implementations.get(name)!.symbols) fail(`${where}: the implementation ${name} declares no symbols snapshot`);
      continue;
    }
    for (const key of ['file', 'cases', 'bindings']) if (!(key in unit)) fail(`${where}: a unit of kind suite needs ${key}`);
    for (const entry of unit.bindings ?? []) {
      if (!files.has(entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} does not exist`);
      if (matchesAny(implementations.get(entry.implementation)?.support ?? [], entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} matches its support globs`);
      const runner = implementations.get(entry.implementation)?.runner;
      if ((runner === 'go' || runner === 'cargo') && !entry.symbol) fail(`${where}: the binding of ${entry.implementation} needs symbol, the ${runner === 'go' ? 'test function' : 'exact test path'} that runs the cases`);
      // A go binding without symbol took the branch above.
      else if (runner === 'go' && !/^Test\w*$/.test(entry.symbol!)) fail(`${where}: the go binding names ${entry.symbol}, which is no test function (^Test\\w*$)`);
    }
    const goBound = (unit.bindings ?? []).some(entry => implementations.get(entry.implementation)?.runner === 'go');
    if (!unit.file || !unit.cases) continue;
    const value = readTrackedJson(root, files, unit.file, where, errors);
    if (value === undefined) continue;
    const found = casesOf(value, unit.cases);
    for (const error of found.errors) fail(`${where}: ${unit.file}: ${error}`);
    if (!found.errors.length && !found.names.length) fail(`${where}: ${unit.cases} selects no case in ${unit.file}`);
    const repeated = found.names.filter((name, index) => found.names.indexOf(name) !== index);
    for (const name of new Set(repeated)) fail(`${where}: ${unit.file} repeats the case ${name}`);
    // A case name holds no whitespace, which go test rewrites to _ in a subtest name, and Go nests a subtest at each /.
    for (const name of found.names) {
      if (/\s/.test(name)) fail(`${where}: ${unit.file}: the case ${JSON.stringify(name)} holds whitespace, which no test name of the check can match`);
      if (goBound && name.includes('/')) fail(`${where}: ${unit.file}: the case ${JSON.stringify(name)} holds /, which Go nests as a subtest; the unit has a go binding`);
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
        if (!Array.isArray(list) || list.some(entry => typeof entry !== 'string')) {
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
    else if (!snapshots.get(entry.implementation)?.get(entry.symbol)) fail(`nativeOnly: ${entry.symbol} is not an exported symbol of ${entry.implementation}; remove the entry`);
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
  const admitted = (unit: ParityUnit, implementation: string): string[] => (cases.get(unit.id) ?? []).filter(name => !admissions.get(unit.id)?.has(name) || admissions.get(unit.id)!.get(name)!.includes(implementation));
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
    snapshots,
    members: unit => (profiles.get(unit.profile) ?? []).filter(name => implementations.has(name)),
    exclusion: (unit, implementation) => exclusions.get(`${unit.id}\0${implementation}`),
  };
  return { errors, model };
}
