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
// no network; it prints a line for each change. With --check (`make kit-inject-check`, S13, K851) it writes no file (K1058):
// it fails on each copy that is missing or differs from the installed kit, each file of scripts/kit that the package does not
// declare, each retired copy that is present, and each copy path whose working tree differs from the index (K1007).
import { execFileSync } from 'node:child_process';
import { lstatSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { COPY_DIRECTORY, isSource, installedKit, INSTALLED, PACKAGE, RETIRED_COPIES, strayCopies } from './kit-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { readNpmManifest } from './manifests.mts';

const USAGE = 'Usage: node scripts/kit/kit-sync.mts [--check]';

/** Writes the copies of the installed package into `root`; returns the lines of the changes, empty when the copies match. */
export function sync(root: string): string[] {
  if (isSource(root)) throw new Error("kit-sync writes consumer copies, not the kit source checkout; edit the source files directly");
  const kit = installedKit(root);
  if ('finding' in kit) throw new Error(kit.finding);
  const changes: string[] = [];
  for (const { file, from } of kit.copies) {
    const target = path.join(root, file);
    const content = readFileSync(path.join(root, INSTALLED, from));
    const entry = lstatSync(target, { throwIfNoEntry: false });
    const existed = entry !== undefined;
    if (entry?.isFile() && readFileSync(target).equals(content)) continue;
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
  // A file that an earlier kit copied and that no kit copies now is removed, with the folder it leaves empty.
  for (const file of RETIRED_COPIES) {
    if (!existsSync(path.join(root, file))) continue;
    rmSync(path.join(root, file));
    changes.push(`removed ${file}`);
    const directory = path.dirname(file);
    if (directory !== '.' && readdirSync(path.join(root, directory)).length === 0) rmSync(path.join(root, directory), { recursive: true });
  }
  return changes;
}

/** The paths of `root` that the copies of the installed kit own: each copy, scripts/kit and the retired copies. */
export function copyPaths(root: string): string[] {
  const kit = installedKit(root);
  if ('finding' in kit) throw new Error(kit.finding);
  return [...kit.copies.map(({ file }) => file), COPY_DIRECTORY, ...RETIRED_COPIES];
}

/**
 * The findings of `root` against the installed kit, without writing a file (K1058): each copy that is missing or whose bytes
 * differ from the package, each file of scripts/kit that the package does not declare, and each retired copy that is present.
 */
export function copyFindings(root: string): string[] {
  const kit = installedKit(root);
  if ('finding' in kit) throw new Error(kit.finding);
  const found: string[] = [];
  for (const { file, from } of kit.copies) {
    const target = path.join(root, file);
    const entry = lstatSync(target, { throwIfNoEntry: false });
    if (entry === undefined) found.push(`${file} is missing; run make kit-sync`);
    else if (!entry.isFile()) found.push(`${file} is not a file; run make kit-sync`);
    else if (!readFileSync(target).equals(readFileSync(path.join(root, INSTALLED, from)))) found.push(`${file} differs from the installed kit; run make kit-sync`);
  }
  for (const file of strayCopies(root, kit.copies)) found.push(`${file} is not a copy of the installed kit; run make kit-sync`);
  for (const file of RETIRED_COPIES) if (existsSync(path.join(root, file))) found.push(`${file} is retired; run make kit-sync`);
  return found;
}

/**
 * The lines of git status of `root` for the copy paths whose working tree differs from the index, empty when every copy is staged
 * or committed: a staged copy is the one the commit will hold (K1007).
 */
export function changedCopies(root: string): string[] {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...copyPaths(root)], { cwd: root, encoding: 'utf8' });
  return status.split('\n').filter(line => line !== '' && line[1] !== ' ');
}

if (isMain(import.meta.url)) {
  const check = process.argv[2] === '--check';
  if (process.argv.length > (check ? 3 : 2)) {
    console.error(`[kit-sync] kit-sync takes only --check: it writes the copies of the installed package. ${USAGE}`);
    process.exit(2);
  }
  try {
    if (check) {
      const root = repositoryRoot();
      if (isSource(root)) throw new Error('kit is the source of the copies; nothing to check');
      const found = [...copyFindings(root), ...changedCopies(root)];
      for (const line of found) console.error(`[kit-sync] ${line}`);
      if (found.length) {
        console.error('[kit-sync] the copies differ from the installed kit or from the index; kit-sync --check writes no file');
        process.exit(1);
      }
      console.log('[kit-sync] the copies match the installed kit and the index');
      process.exit(0);
    }
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
