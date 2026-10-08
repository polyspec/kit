#!/usr/bin/env node
// Copies the vendored files of kit at a tag into this checkout and writes `.kit/kit.lock.json` (`make kit-sync`):
//
//   node scripts/kit/kit-sync.mjs --tag <tag> [--repository <url or path>]
//
// The tag is cloned into a temporary directory, the files of kit.json and of its vendored directories are copied to the
// same paths, a file that is identical is not written, a vendored file that kit no longer has is removed, and the lock
// records the commit, the tag and the sha256 of every file. A second run at the same tag writes nothing. The command
// queries the network only for the clone; it prints a line for each change and has no time limit.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK, sha256, walk } from './kit-check.mjs';

export const DEFAULT_REPOSITORY = 'https://github.com/polyspec/kit';

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed with status ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// Writes the file through a temporary file and a rename, so a reader never finds it half written.
function writeAtomic(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const next = `${file}.next-${process.pid}`;
  writeFileSync(next, content);
  renameSync(next, file);
}

/**
 * Syncs the vendored files of kit at `tag` from `repository` into `root`; returns the lines that describe the changes
 * (empty when the checkout already matches the tag).
 */
export function sync({ root, repository, tag }) {
  const clone = mkdtempSync(path.join(tmpdir(), 'kit-sync-'));
  try {
    git(['clone', '--quiet', '--depth', '1', '--branch', tag, repository, clone], root);
    const commit = git(['rev-parse', 'HEAD'], clone);
    const kit = JSON.parse(readFileSync(path.join(clone, 'kit.json'), 'utf8'));
    const sources = ['kit.json', ...kit.vendored.flatMap(directory => walk(clone, directory))];
    const changes = [];
    for (const file of sources) {
      const target = path.join(root, file);
      const existed = existsSync(target);
      if (existed && sha256(root, file) === sha256(clone, file)) continue;
      writeAtomic(target, readFileSync(path.join(clone, file)));
      changes.push(`${existed ? 'written' : 'added'} ${file}`);
    }
    const expected = new Set(sources);
    for (const directory of kit.vendored) {
      for (const file of walk(root, directory)) {
        if (!expected.has(file)) {
          rmSync(path.join(root, file));
          changes.push(`removed ${file}`);
        }
      }
    }
    const files = Object.fromEntries(sources.sort().map(file => [file, sha256(clone, file)]));
    const lock = `${JSON.stringify({ schema: 1, repository, tag, commit, files }, null, 2)}\n`;
    if (!existsSync(path.join(root, LOCK)) || readFileSync(path.join(root, LOCK), 'utf8') !== lock) {
      writeAtomic(path.join(root, LOCK), lock);
      changes.push(`written ${LOCK}`);
    }
    return changes;
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => args[args.indexOf(name) + 1];
  const tag = option('--tag');
  const repository = option('--repository') ?? DEFAULT_REPOSITORY;
  if (!tag) {
    console.error('[kit-sync] --tag is required. Fix: make kit-sync KIT_TAG=vX.Y.Z');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    const changes = sync({ root, repository, tag });
    for (const line of changes) console.log(`[kit-sync] ${line}`);
    console.log(changes.length ? `[kit-sync] ${changes.length} changes from ${tag}` : `[kit-sync] unchanged: ${tag}`);
  } catch (error) {
    console.error(`[kit-sync] ${error.message}`);
    process.exit(1);
  }
}
