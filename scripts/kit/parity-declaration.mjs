// The declaration of the language-parity check (config/parity.json): reading it against its schema, resolving its references
// against the tree, and the finding that every rule of the check reports. A declaration that names a missing file, an unknown
// implementation or profile, or a stale entry is a finding of the rule `declaration`, and the other rules do not run on it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readConfig } from './schema-validate.mjs';

export const DECLARATION = 'config/parity.json';

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

/** A finding of `rule` with the unit, implementation and place (a file or file:line) it names, when it names them. */
export const finding = (rule, message, { unit, implementation, place } = {}) => ({ rule, unit, implementation, place, message });

/** The finding as a line: `<rule> <name> [<unit>] [<implementation>] [<place>]: <message>`. */
export const findingLine = item => `${[item.rule, RULES[item.rule], item.unit, item.implementation, item.place].filter(Boolean).join(' ')}: ${item.message}`;

/** The words that the first group of the matches of `pattern` (a multiline regular expression) holds in `text`, each with its line. */
export function captured(text, pattern) {
  return [...text.matchAll(new RegExp(pattern, 'gm'))].map(match => ({ text: match[1] ?? '', line: text.slice(0, match.index).split('\n').length }));
}

/** How `found` differs from `expected`: `missing <names>; not in <source>: <names>`, or an empty string when the sets are equal. */
export function difference(expected, found, source) {
  const missing = expected.filter(name => !found.includes(name));
  const extra = found.filter(name => !expected.includes(name));
  return [missing.length && `missing ${missing.join(', ')}`, extra.length && `not in ${source}: ${extra.join(', ')}`].filter(Boolean).join('; ');
}

/** The error of a pattern of the declaration that is no regular expression or has no group, or undefined. */
function patternError(source) {
  try {
    return new RegExp(`${source}|`).exec('').length < 2 ? `the pattern ${source} has no group` : undefined;
  } catch (error) {
    return `the pattern ${source} is no regular expression: ${error.message}`;
  }
}

/** The case names that the path `cases` ($ followed by .<key> and [*] steps) selects in `value`, with an error for each step that finds nothing. */
export function casesOf(value, cases) {
  let selected = [{ value, where: '$' }];
  const errors = [];
  for (const [step, key] of cases.slice(1).matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)|\[\*\]/g)) {
    selected = selected.flatMap(({ value: item, where }) => {
      if (key !== undefined) {
        if (item && typeof item === 'object' && !Array.isArray(item) && key in item) return [{ value: item[key], where: `${where}${step}` }];
        errors.push(`${where} has no ${key}`);
        return [];
      }
      if (Array.isArray(item)) return item.map((entry, index) => ({ value: entry, where: `${where}[${index}]` }));
      errors.push(`${where} is no array`);
      return [];
    });
  }
  for (const { value: name, where } of selected) if (typeof name !== 'string' || !name) errors.push(`${where} is no case name`);
  return { names: selected.map(entry => entry.value).filter(name => typeof name === 'string' && name), errors };
}

/** Whether `file` lies in the directory `root` (. is the whole repository). */
export const within = (root, file) => root === '.' || file.startsWith(`${root.replace(/\/+$/, '')}/`);

/** The JSON value of a tracked file, or an error of the declaration. */
function readTrackedJson(root, files, file, where, errors) {
  if (!files.has(file)) {
    errors.push(finding('declaration', `${where}: ${file} does not exist`, { place: DECLARATION }));
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    errors.push(finding('declaration', `${where}: ${file} is no JSON: ${error.message}`, { place: DECLARATION }));
    return undefined;
  }
}

/** The symbols of a snapshot: a map from each id to whether it is exported, or errors for an entry without a boolean exported. */
function snapshotOf(value, file, errors) {
  const symbols = new Map();
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
 * the implementations of the unit's profile, and `exclusion(unit, implementation)`.
 */
export function readDeclaration(root, files) {
  if (!existsSync(path.join(root, DECLARATION))) return { errors: [finding('declaration', `${DECLARATION} does not exist; declare the implementations and units there (scripts/kit/schema/parity.schema.json)`)] };
  let read;
  try {
    read = readConfig(root, DECLARATION, 'parity.schema.json');
  } catch (error) {
    return { errors: [finding('declaration', `${DECLARATION} is no JSON: ${error.message}`, { place: DECLARATION })] };
  }
  if (read.errors.length) return { errors: read.errors.map(message => finding('declaration', message, { place: DECLARATION })) };
  const config = read.value;
  const errors = [];
  const fail = message => errors.push(finding('declaration', message, { place: DECLARATION }));
  const implementations = new Map();
  for (const entry of config.implementations) {
    if (implementations.has(entry.name)) fail(`the implementation ${entry.name} is declared twice`);
    implementations.set(entry.name, entry);
  }
  const profiles = new Map();
  for (const profile of config.profiles) {
    if (profiles.has(profile.name)) fail(`the profile ${profile.name} is declared twice`);
    profiles.set(profile.name, profile.implementations);
    for (const name of profile.implementations) if (!implementations.has(name)) fail(`profile ${profile.name} names ${name}, which is no implementation`);
    if (new Set(profile.implementations).size !== profile.implementations.length) fail(`profile ${profile.name} names an implementation twice`);
  }
  const knownProfile = (name, where) => profiles.has(name) || (fail(`${where} names the profile ${name}, which is not declared`), false);
  const snapshots = new Map();
  for (const entry of config.implementations) {
    if (entry.symbols !== undefined) {
      const value = readTrackedJson(root, files, entry.symbols, `implementation ${entry.name}`, errors);
      if (value !== undefined) snapshots.set(entry.name, snapshotOf(value, entry.symbols, errors));
    }
    if (entry.errors && !files.has(entry.errors.file)) fail(`implementation ${entry.name}: ${entry.errors.file} does not exist`);
  }
  const patterns = [
    ...config.implementations.filter(entry => entry.errors).map(entry => [`implementation ${entry.name}`, entry.errors.pattern]),
    ...(config.errors ? [['errors catalog', config.errors.catalog.pattern]] : []),
    ...(config.languageLists ?? []).map(list => [`languageLists ${list.file}`, list.pattern]),
  ];
  for (const [where, source] of patterns) {
    const error = patternError(source);
    if (error) fail(`${where}: ${error}`);
  }
  const units = new Map();
  const cases = new Map();
  for (const unit of config.units) {
    if (units.has(unit.id)) fail(`the unit ${unit.id} is declared twice`);
    units.set(unit.id, unit);
    const where = `unit ${unit.id}`;
    const members = knownProfile(unit.profile, where) ? profiles.get(unit.profile) : [];
    const owned = unit.kind === 'suite' ? unit.bindings ?? [] : unit.symbols ?? [];
    const misplaced = unit.kind === 'suite' ? ['symbols'] : ['file', 'cases', 'bindings'];
    for (const key of misplaced) if (key in unit) fail(`${where}: a unit of kind ${unit.kind} has no ${key}`);
    const seen = new Set();
    for (const entry of owned) {
      if (!members.includes(entry.implementation)) fail(`${where} names ${entry.implementation}, which is not an implementation of the profile ${unit.profile}`);
      if (seen.has(entry.implementation)) fail(`${where} names ${entry.implementation} twice`);
      seen.add(entry.implementation);
    }
    if (unit.kind === 'api') {
      for (const name of members) if (implementations.has(name) && !implementations.get(name).symbols) fail(`${where}: the implementation ${name} declares no symbols snapshot`);
      continue;
    }
    for (const key of ['file', 'cases', 'bindings']) if (!(key in unit)) fail(`${where}: a unit of kind suite needs ${key}`);
    for (const entry of unit.bindings ?? []) {
      if (!files.has(entry.test)) fail(`${where}: the test ${entry.test} of ${entry.implementation} does not exist`);
      const runner = implementations.get(entry.implementation)?.runner;
      if ((runner === 'go' || runner === 'cargo') && !entry.symbol) fail(`${where}: the binding of ${entry.implementation} needs symbol, the ${runner === 'go' ? 'test function' : 'exact test path'} that runs the cases`);
    }
    if (!unit.file || !unit.cases) continue;
    const value = readTrackedJson(root, files, unit.file, where, errors);
    if (value === undefined) continue;
    const found = casesOf(value, unit.cases);
    for (const error of found.errors) fail(`${where}: ${unit.file}: ${error}`);
    if (!found.errors.length && !found.names.length) fail(`${where}: ${unit.cases} selects no case in ${unit.file}`);
    const repeated = found.names.filter((name, index) => found.names.indexOf(name) !== index);
    for (const name of new Set(repeated)) fail(`${where}: ${unit.file} repeats the case ${name}`);
    cases.set(unit.id, found.names);
  }
  for (const entry of config.nativeOnly ?? []) {
    if (!implementations.has(entry.implementation)) fail(`nativeOnly names ${entry.implementation}, which is no implementation`);
    else if (!snapshots.get(entry.implementation)?.get(entry.symbol)) fail(`nativeOnly: ${entry.symbol} is not an exported symbol of ${entry.implementation}; remove the entry`);
  }
  const exclusions = new Map();
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
  const model = {
    config,
    implementations,
    profiles,
    cases,
    snapshots,
    members: unit => (profiles.get(unit.profile) ?? []).filter(name => implementations.has(name)),
    exclusion: (unit, implementation) => exclusions.get(`${unit.id}\0${implementation}`),
  };
  return { errors, model };
}
