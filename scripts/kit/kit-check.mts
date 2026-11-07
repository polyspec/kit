#!/usr/bin/env node
// Checks the configuration of kit's utilities in a repository without a network (`make kit-check`): each config/*.json against
// its schema of kit. The recipes, the workflows, the paths and the tool starts of a repository are its own, and kit-check judges
// none of them (K1051); the names of the targets, the suite and the tracked files are its own too (K810). Whether the copies
// of kit match the installed package is make kit-inject-check's, which compares them without writing (K799, K851, K1058).
//
//   node scripts/kit/kit-check.mts
//
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFindings, SCHEMAS } from './schema-validate.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readNpmManifest } from './manifests.mts';
import { PHPUNIT_MANIFEST } from './bootstrap/toolchain-declared.mts';
import { MISE_LOCKS } from './toolchain-mise.mts';

export const PACKAGE = '@polyspec/kit';
export const INSTALLED = `node_modules/${PACKAGE}`;

/** The part of the package.json of @polyspec/kit that a sync and a check read: its version and its copies. */
export type KitPackage = { name?: string; version?: string; kit?: { copies?: Record<string, string> } };

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

/**
 * The package.json of the @polyspec/kit that runs this module, found by Node's self-reference of the package by its name:
 * kit's own in its checkout, and the linked package's in a repository, which runs it from the scripts/kit of the kit checkout (K613).
 */
export function runningKit(): KitPackage {
  const manifest = fileURLToPath(import.meta.resolve(`${PACKAGE}/package.json`));
  return readNpmManifest(path.dirname(manifest), 'package.json');
}

/**
 * Whether kit writes the file `file` (relative to the repository root) of every repository: a copy of kit.copies of the
 * running package (make kit-sync), the Composer project of PHPUnit that install-tools installs, or a file of the lock tree that
 * mise writes under .mise/locks (make toolchain-lock). Such a file belongs to kit, not to a package of the repository (K167).
 */
export function writtenByKit(copies: readonly { file: string }[]): (file: string) => boolean {
  const files = new Set([...copies.map(({ file }) => file), PHPUNIT_MANIFEST]);
  return file => files.has(file) || file.startsWith(MISE_LOCKS);
}

/**
 * The installed package of `root`: its version and its copies; otherwise the finding that names the cause and the fix. The
 * version is not compared with package-lock.json: npm ci enforces the lock at install time by its integrity, and a local link of
 * a kit checkout is the development state (K267), so the copies are those of the installed content.
 */
export function installedKit(root: string): { version: string; copies: { file: string; from: string }[] } | { finding: string } {
  if (!existsSync(path.join(root, 'package-lock.json'))) return { finding: `package-lock.json is missing; it locks ${PACKAGE}. Fix: run make install-packages and commit package-lock.json` };
  if (!existsSync(path.join(root, INSTALLED, 'package.json'))) return { finding: `${INSTALLED} is not installed. Fix: make install-packages` };
  const installed = readNpmManifest(root, `${INSTALLED}/package.json`);
  return { version: installed.version ?? 'without a version', copies: copiesOf(installed) };
}

// The release configuration, whose Composer packages and consumer need PHP.
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
    // The check needs the errors of the schema only, so the value stays unknown.
    const { errors } = readConfigFindings<unknown>(root, config, schemaFile);
    for (const error of errors ?? []) found.push(`${error}. Rule: the schema ${schemaFile} of ${PACKAGE}`);
  }
  return found;
}

/** Whether `root` is kit itself, the source of the copies: its package.json names the package. */
export function isSource(root: string): boolean {
  return existsSync(path.join(root, 'package.json')) && readNpmManifest(root, 'package.json').name === PACKAGE;
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

/**
 * The files that an earlier kit copied into the repository and that no kit copies now: the gates workflow, which the CI
 * pipeline replaced (K910). kit-sync removes it, and kit-check names it when a consumer still holds it (K514-1). The lint
 * configurations are the repository's own files, which the lint tools read (K1050), so neither removes them.
 */
export const RETIRED_COPIES = ['.github/workflows/gates.yml'] as const;

/** The findings of `root`: the configuration of kit's utilities against their schemas; empty when it matches. */
export function check(root: string): string[] {
  return checkConfig(root);
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const found = check(root);
  for (const line of found) console.error(`[kit-check] ${line}`);
  if (found.length) {
    console.error(`[kit-check] ${found.length} findings in the configuration`);
    process.exit(1);
  }
  console.log('[kit-check] the configuration matches its schemas');
}
