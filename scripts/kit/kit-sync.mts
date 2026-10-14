#!/usr/bin/env node
// Writes the copies of the installed package @polyspec/kit into this repository (`make kit-sync`):
//
//   node scripts/kit/kit-sync.mts
//
// The package under node_modules must be the version that package-lock.json resolves; there is no tag or ref to give, so a
// sync writes the copies of the locked version only. Each copy of `kit.copies` (the package.json of the package) is written
// to its path, and a copy that is already the same bytes is not written, so a second sync writes nothing. A file of scripts/kit
// that the package does not declare is removed: that directory holds the copies of kit only. The command reads
// no network; it prints a line for each change.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { COPY_DIRECTORY, installedKit, INSTALLED, PACKAGE, strayCopies } from './kit-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { writeAtomic } from './bootstrap/files.mts';

const USAGE = 'Usage: node scripts/kit/kit-sync.mts';

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
  return changes;
}

if (isMain(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error(`[kit-sync] kit-sync takes no argument: the version is the one that package-lock.json resolves. ${USAGE}`);
    process.exit(2);
  }
  try {
    const changes = sync(repositoryRoot());
    for (const line of changes) console.log(`[kit-sync] ${line}`);
    // sync returned, so the installed package is the version that package-lock.json resolves.
    const version = JSON.parse(readFileSync(path.join(repositoryRoot(), INSTALLED, 'package.json'), 'utf8')).version;
    console.log(changes.length ? `[kit-sync] ${changes.length} changes from ${PACKAGE} ${version}` : `[kit-sync] unchanged: ${PACKAGE} ${version}`);
  } catch (error) {
    // The installed package, the copies and the writes fail with an Error.
    console.error(`[kit-sync] ${(error as Error).message}`);
    process.exit(1);
  }
}
