#!/usr/bin/env node
// Writes the copies of the installed package @polyspec/kit into this repository (`make kit-sync`):
//
//   node scripts/kit/kit-sync.mts
//
// The copies are those of the package under node_modules, whatever its version: npm ci installs the version of
// package-lock.json by its integrity, and a local link of a kit checkout is the development state (K267); there is no tag or ref
// to give. Each copy of `kit.copies` (the package.json of the package) is written
// to its path, and a copy that is already the same bytes is not written, so a second sync writes nothing. A file of scripts/kit
// that the package does not declare is removed: that directory holds the copies of kit only. The command reads
// no network; it prints a line for each change.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { COPY_DIRECTORY, installedKit, INSTALLED, PACKAGE, strayCopies } from './kit-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { readNpmManifest } from './manifests.mts';

const USAGE = 'Usage: node scripts/kit/kit-sync.mts';

/**
 * The files that an earlier kit copied into the repository and that kit now reads from its package (K514): the lint
 * configurations, which each lint of kit.mk names by their path in the package.
 */
export const RETIRED_COPIES = ['ruff.toml', 'phpcs.xml.dist', 'phpstan.dist.neon', '.golangci.yml', 'clippy.toml', '.oxlintrc.json', 'knip.json', 'config/api-extractor.kit.json'] as const;

/** Writes the copies of the installed package into `root`; returns the lines of the changes, empty when the copies match. */
export function sync(root: string): string[] {
  const kit = installedKit(root);
  if ('finding' in kit) throw new Error(kit.finding);
  const changes: string[] = [];
  for (const { file, from } of kit.copies) {
    const target = path.join(root, file);
    const content = readFileSync(path.join(root, INSTALLED, from));
    const existed = existsSync(target);
    if (existed && readFileSync(target).equals(content)) continue;
    writeAtomic(target, content);
    changes.push(`${existed ? 'written' : 'added'} ${file}`);
  }
  // scripts/kit holds the copies of kit only: a file that the package no longer declares is removed, and so is a directory
  // that it leaves empty.
  for (const file of strayCopies(root, kit.copies)) {
    rmSync(path.join(root, file));
    changes.push(`removed ${file}`);
    for (let directory = path.dirname(file); directory !== COPY_DIRECTORY && readdirSync(path.join(root, directory)).length === 0; directory = path.dirname(directory)) rmSync(path.join(root, directory), { recursive: true });
  }
  // A file that an earlier kit copied and that this kit reads from its package (K514) is removed, with the folder it leaves empty.
  for (const file of RETIRED_COPIES) {
    if (!existsSync(path.join(root, file))) continue;
    rmSync(path.join(root, file));
    changes.push(`removed ${file}`);
    const directory = path.dirname(file);
    if (directory !== '.' && readdirSync(path.join(root, directory)).length === 0) rmSync(path.join(root, directory), { recursive: true });
  }
  return changes;
}

if (isMain(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error(`[kit-sync] kit-sync takes no argument: it writes the copies of the installed package. ${USAGE}`);
    process.exit(2);
  }
  try {
    const changes = sync(repositoryRoot());
    for (const line of changes) console.log(`[kit-sync] ${line}`);
    const { version } = readNpmManifest(repositoryRoot(), `${INSTALLED}/package.json`);
    console.log(changes.length ? `[kit-sync] ${changes.length} changes from ${PACKAGE} ${version}` : `[kit-sync] unchanged: ${PACKAGE} ${version}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // The installed package, the copies and the writes fail with an Error.
    console.error(`[kit-sync] ${error.message}`);
    process.exit(1);
  }
}
