#!/usr/bin/env node
// Checks a repository against the installed package @polyspec/kit, without a network (`make kit-check`): the package under
// node_modules is the version that package-lock.json resolves, and each copy that the package declares (`kit.copies` of its
// package.json) is byte for byte its file of the package. Both together tie the copies to the locked version. The
// configuration of config/*.json is checked against the schemas of the package as well. kit itself, the source of the copies,
// checks its configuration only.
//
//   node scripts/kit/kit-check.mts
//
// A change of a copy is made in kit and written with `make kit-sync`, never in the repository; the check names each copy that
// is missing or differs, and the fix.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SCHEMAS, validate, type Schema } from './schema-validate.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readJson } from './bootstrap/files.mts';

export const PACKAGE = '@polyspec/kit';
export const INSTALLED = `node_modules/${PACKAGE}`;

/** The part of the package.json of @polyspec/kit that a sync and a check read: its version and its copies. */
export type KitPackage = { name: string; version: string; kit?: { copies?: Record<string, string> } };

/**
 * The copies of `manifest`: `kit.copies` maps the path of a file in the repository to its file in the package. Both are
 * relative paths that stay inside their directory.
 */
export function copiesOf(manifest: Pick<KitPackage, 'kit'>): { file: string; from: string }[] {
  return Object.entries(manifest.kit?.copies ?? {}).map(([file, from]) => {
    for (const value of [file, from]) {
      if (path.isAbsolute(value) || value.split('/').includes('..') || value.includes('\\')) throw new Error(`kit.copies path ${JSON.stringify(value)} is not a relative path inside its directory`);
    }
    return { file, from };
  });
}

/** The version of @polyspec/kit that package-lock.json of `root` resolves, or undefined when the lock resolves none. */
export function lockedVersion(root: string): string | undefined {
  const lock = readJson(root, 'package-lock.json') as { packages?: Record<string, { version?: string }> };
  return lock.packages?.[INSTALLED]?.version;
}

/**
 * The installed package of `root` when it is the version that package-lock.json resolves: its version and its copies; otherwise
 * the finding that names the cause and the fix.
 */
export function installedKit(root: string): { version: string; copies: { file: string; from: string }[] } | { finding: string } {
  if (!existsSync(path.join(root, 'package-lock.json'))) return { finding: `package-lock.json is missing; it locks ${PACKAGE}. Fix: run make install-packages and commit package-lock.json` };
  const locked = lockedVersion(root);
  if (locked === undefined) return { finding: `package-lock.json resolves no ${PACKAGE}. Fix: add ${PACKAGE} to devDependencies and run make install-packages` };
  if (!existsSync(path.join(root, INSTALLED, 'package.json'))) return { finding: `${INSTALLED} is not installed; package-lock.json resolves ${locked}. Fix: make install-packages` };
  const installed = readJson(root, INSTALLED, 'package.json') as KitPackage;
  if (installed.version !== locked) return { finding: `${INSTALLED} is ${installed.version}, but package-lock.json resolves ${locked}. Fix: make install-packages` };
  return { version: installed.version, copies: copiesOf(installed) };
}

// The configurations that a command writes, and the command, which is the fix of a file that breaks its schema.
const WRITTEN: Record<string, string> = { 'config/dependency-review.json': 'make dependency-review RECORD=1' };

/**
 * The findings of the configuration of `root` against the schemas of the package: each config/<name>.json that the repository
 * has must validate against its schema <name>.schema.json; an error names the file, the location and the rule.
 */
export function checkConfig(root: string): string[] {
  const found: string[] = [];
  for (const schemaFile of readdirSync(SCHEMAS).filter(name => name.endsWith('.schema.json')).sort()) {
    const name = schemaFile.slice(0, -'.schema.json'.length);
    const config = `config/${name}.json`;
    // A repository declares a configuration by having its file; the schema checks the declared file only.
    if (!existsSync(path.join(root, config))) continue;
    const schema = readJson(SCHEMAS, schemaFile) as Schema;
    const value = readJson(root, config);
    const fix = WRITTEN[config] ? `. Fix: ${WRITTEN[config]}` : '';
    for (const error of validate(value, schema)) found.push(`${config}: ${error}. Rule: the schema ${schemaFile} of ${PACKAGE}${fix}`);
  }
  return found;
}

/** Whether `root` is kit itself, the source of the copies: its package.json names the package. */
export function isSource(root: string): boolean {
  return existsSync(path.join(root, 'package.json')) && (readJson(root, 'package.json') as { name?: string }).name === PACKAGE;
}

/** The directory of a repository that holds the copies of kit only (K133). */
export const COPY_DIRECTORY = 'scripts/kit';

/** The files of scripts/kit of `root` that `copies` does not declare, as paths of the repository, sorted. */
export function strayCopies(root: string, copies: { file: string }[]): string[] {
  const directory = path.join(root, COPY_DIRECTORY);
  if (!existsSync(directory)) return [];
  const declared = new Set(copies.map(({ file }) => file));
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => !entry.isDirectory())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter(file => !declared.has(file))
    .sort();
}

/** The findings of `root`: the configuration, and the installed package and its copies; empty when they match. */
export function check(root: string): string[] {
  const config = checkConfig(root);
  if (isSource(root)) return config;
  const kit = installedKit(root);
  if ('finding' in kit) return [...config, kit.finding];
  const found: string[] = [];
  for (const { file, from } of kit.copies) {
    if (!existsSync(path.join(root, file))) {
      found.push(`${file}: the copy of ${PACKAGE} ${kit.version} is missing. Fix: make kit-sync`);
    } else if (!readFileSync(path.join(root, file)).equals(readFileSync(path.join(root, INSTALLED, from)))) {
      found.push(`${file}: differs from ${INSTALLED}/${from} of ${PACKAGE} ${kit.version}. Fix: make kit-sync`);
    }
  }
  for (const file of strayCopies(root, kit.copies)) found.push(`${file} is no copy of ${PACKAGE} ${kit.version}; ${COPY_DIRECTORY} holds the copies of kit only. Fix: make kit-sync, which removes it`);
  return [...config, ...found];
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = check(root);
  for (const line of found) console.error(`[kit-check] ${line}`);
  if (found.length) {
    console.error(`[kit-check] ${found.length} findings in the configuration and the copies of ${PACKAGE}`);
    process.exit(1);
  }
  console.log(isSource(root) ? '[kit-check] the configuration matches its schemas' : `[kit-check] the configuration matches its schemas and the copies match ${PACKAGE} ${lockedVersion(root)}`);
}
