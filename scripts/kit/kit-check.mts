#!/usr/bin/env node
// Checks the configuration of kit's utilities in a repository without a network (`make kit-check`): each config/*.json against
// its schema of kit. The recipes, the workflows, the paths and the tool starts of a repository are its own, and kit-check judges
// none of them (K1051); the names of the targets, the suite and the tracked files are its own too (K810).
//
//   node scripts/kit/kit-check.mts
//
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readConfigFindings, SCHEMAS } from './schema-validate.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readNpmManifest } from './manifests.mts';
import { PHPUNIT_MANIFEST } from './bootstrap/toolchain-declared.mts';
import { MISE_LOCKS } from './toolchain-mise.mts';

export const PACKAGE = '@polyspec/kit';
export const INSTALLED = `node_modules/${PACKAGE}`;

/**
 * Whether a kit utility writes the file `file` (relative to the repository root): the Composer project of PHPUnit that
 * install-tools installs, or a file of the lock tree that mise writes under .mise/locks (make toolchain-lock). Such a file
 * belongs to the tools, not to a package of the repository (K167).
 */
export function writtenByKit(file: string): boolean {
  return file === PHPUNIT_MANIFEST || file.startsWith(MISE_LOCKS);
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
