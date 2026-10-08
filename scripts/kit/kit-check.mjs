#!/usr/bin/env node
// Checks the vendored files of kit in this checkout against `.kit/kit.lock.json`, without a network (`make kit-check`):
// every file of the vendored directories has the sha256 that the lock records, and no other file is in them.
//
//   node scripts/kit/kit-check.mjs
//
// A change of a vendored file is made in kit and copied with `make kit-sync`, never in the checkout; the check names
// each file whose hash differs, each file that is missing and each unexpected file, with its expected and actual value.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCK = '.kit/kit.lock.json';

/** The vendored directories of the checkout at `root`, from kit.json. */
export function vendoredDirectories(root) {
  return JSON.parse(readFileSync(path.join(root, 'kit.json'), 'utf8')).vendored;
}

/** Every file below `directory` (relative to root), sorted; a missing directory has none. */
export function walk(root, directory) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  const files = [];
  const visit = (relative) => {
    for (const entry of readdirSync(path.join(root, relative)).sort()) {
      const next = path.join(relative, entry);
      if (statSync(path.join(root, next)).isDirectory()) visit(next);
      else files.push(next.split(path.sep).join('/'));
    }
  };
  visit(directory);
  return files;
}

export const sha256 = (root, file) => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');

/** The findings of the vendored files of `root` against its lock: a list of lines, empty when they match. */
export function check(root) {
  const lockFile = path.join(root, LOCK);
  if (!existsSync(lockFile)) return [`${LOCK}: the lock is missing. Fix: make kit-sync KIT_TAG=<tag>`];
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  const found = [];
  const present = new Set(vendoredDirectories(root).flatMap(directory => walk(root, directory)));
  if (existsSync(path.join(root, 'kit.json'))) present.add('kit.json');
  for (const [file, expected] of Object.entries(lock.files)) {
    if (!present.has(file)) {
      found.push(`${file}: the vendored file is missing; expected sha256 ${expected}. Fix: make kit-sync KIT_TAG=${lock.tag}`);
      continue;
    }
    const actual = sha256(root, file);
    if (actual !== expected) found.push(`${file}: sha256 is ${actual}, the lock records ${expected}. Fix: make kit-sync KIT_TAG=${lock.tag}`);
  }
  for (const file of [...present].sort()) {
    if (!(file in lock.files)) found.push(`${file}: the file is not in the lock. Fix: make kit-sync KIT_TAG=${lock.tag}`);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const found = check(root);
  for (const line of found) console.error(`[kit-check] ${line}`);
  if (found.length) {
    console.error(`[kit-check] ${found.length} findings in the vendored files of kit`);
    process.exit(1);
  }
  console.log(`[kit-check] the vendored files match ${LOCK}`);
}
