#!/usr/bin/env node
// Copies the vendored files of kit at a tag into this checkout and writes `.kit/kit.lock.json` (`make kit-sync`):
//
//   node scripts/kit/kit-sync.mts --tag <tag> [--repository <url or path>]
//
// The tag is cloned into a temporary directory, the files of kit.json and of its vendored directories are copied to the
// same paths, a file that is identical is not written, a vendored file that kit no longer has is removed, and the lock
// records the commit, the tag and the sha256 of every file. A second run at the same tag writes nothing. The command
// queries the network only for the clone; it prints a line for each change and has no time limit.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { LOCK, vendoredFilesOf, walk } from './kit-check.mts';
import { isMain, ROOT } from './paths.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { jsonText, readJson, writeAtomic } from './bootstrap/files.mts';
import { git, gitResult } from './git.mts';

export const DEFAULT_REPOSITORY = 'https://github.com/polyspec/kit';

// The part of kit.json that a sync reads: the vendored directories and the single vendored files.
type KitManifest = { vendored: string[]; vendoredFiles?: Record<string, string> };

const USAGE = 'usage: node scripts/kit/kit-sync.mts --tag <tag> [--repository <url or path>]';

/**
 * Reads the arguments of kit-sync: `tag` is required, `repository` is DEFAULT_REPOSITORY when it is not given. Throws an
 * Error that names the option when an option has no value, when an option is followed by another option, or when the tag
 * is missing.
 */
export function parseSyncArguments(argv: string[]) {
  let values: { tag?: string[]; repository?: string[] };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { tag: { type: 'string', multiple: true }, repository: { type: 'string', multiple: true } },
      strict: true,
    }));
  } catch (error) {
    // parseArgs fails with a TypeError, and split returns at least one string.
    const reason = (error as Error).message.split('\n')[0]!.replace(/\.?$/, '.');
    throw new Error(`${reason} ${USAGE}`);
  }
  for (const name of ['tag', 'repository'] as const) {
    if (values[name] !== undefined && values[name].length > 1) throw new Error(`--${name} is given more than once. ${USAGE}`);
  }
  const [tag] = values.tag ?? [];
  const [repository] = values.repository ?? [];
  if (!tag) throw new Error('--tag is required. Fix: make kit-sync KIT_TAG=vX.Y.Z');
  if (repository === '') throw new Error(`--repository has no value. ${USAGE}`);
  return { tag, repository: repository ?? DEFAULT_REPOSITORY };
}

/**
 * Syncs the vendored files of kit at `tag` from `repository` into `root`; returns the lines that describe the changes
 * (empty when the checkout already matches the tag).
 */
export function sync({ root, repository, tag }: { root: string; repository: string; tag: string }) {
  const clone = mkdtempSync(path.join(tmpdir(), 'kit-sync-'));
  try {
    git(root, 'clone', '--quiet', '--depth', '1', '--branch', tag, repository, clone);
    // `git clone --branch` takes a branch as well as a tag, and a branch is no release: the lock would record it as the tag
    // (flowmark's lock held a branch of a removed worktree, K83). Only a tag is synced.
    // A branch of the same name as the tag would be cloned in its place, so the tag must name the commit cloned.
    const tagged = gitResult(clone, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
    const commit = git(clone, 'rev-parse', 'HEAD').trim();
    if (tagged.status !== 0 || tagged.stdout.trim() !== commit) {
      throw new Error(`${tag} is not a tag of ${repository}; kit-sync takes only a release tag. Fix: make kit-sync KIT_TAG=vX.Y.Z`);
    }
    const kit: KitManifest = readJson(clone, 'kit.json');
    // Each entry copies the source file `from` of kit to the path `file` of the checkout.
    const entries = [
      { file: 'kit.json', from: 'kit.json' },
      ...kit.vendored.flatMap(directory => walk(clone, directory)).map(file => ({ file, from: file })),
      ...vendoredFilesOf(kit).map(({ file, from }) => ({ file, from })),
    ];
    const changes: string[] = [];
    for (const { file, from } of entries) {
      const target = path.join(root, file);
      const existed = existsSync(target);
      if (existed && fileDigest(path.join(root, file)) === fileDigest(path.join(clone, from))) continue;
      writeAtomic(target, readFileSync(path.join(clone, from)));
      changes.push(`${existed ? 'written' : 'added'} ${file}`);
    }
    const expected = new Set(entries.map(({ file }) => file));
    for (const directory of kit.vendored) {
      for (const file of walk(root, directory)) {
        if (!expected.has(file)) {
          rmSync(path.join(root, file));
          changes.push(`removed ${file}`);
        }
      }
    }
    const files = Object.fromEntries(entries.map(({ file, from }): [string, string] => [file, fileDigest(path.join(clone, from))]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const lock = jsonText({ schema: 1, repository, tag, commit, files });
    if (!existsSync(path.join(root, LOCK)) || readFileSync(path.join(root, LOCK), 'utf8') !== lock) {
      writeAtomic(path.join(root, LOCK), lock);
      changes.push(`written ${LOCK}`);
    }
    return changes;
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  let options: ReturnType<typeof parseSyncArguments>;
  try {
    options = parseSyncArguments(process.argv.slice(2));
  } catch (error) {
    // parseSyncArguments fails with an Error.
    console.error(`[kit-sync] ${(error as Error).message}`);
    process.exit(2);
  }
  const root = ROOT;
  try {
    const { tag, repository } = options;
    const changes = sync({ root, repository, tag });
    for (const line of changes) console.log(`[kit-sync] ${line}`);
    console.log(changes.length ? `[kit-sync] ${changes.length} changes from ${tag}` : `[kit-sync] unchanged: ${tag}`);
  } catch (error) {
    // git, the files and the digests fail with an Error.
    console.error(`[kit-sync] ${(error as Error).message}`);
    process.exit(1);
  }
}
