// The files of a checkout that its checks read: the tracked files and the new files that Git does not ignore, which
// exist in the working tree, as paths relative to `root` with `/` separators. A check that walks the tree reads
// these, so an ignored output, a lock, a run record or a stray copy under an ignored directory such as var/ never
// changes its result (AGENTS, "Idempotency").
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);

/** The files of the checkout under `root`, tracked or new and not ignored, that exist as regular files. */
export function trackedFiles(root = ROOT) {
  return git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .filter(file => existsSync(path.join(root, file)) && statSync(path.join(root, file)).isFile())
    .sort();
}

/** The paths under `root` that Git ignores, a directory with a trailing `/`. */
export function ignoredPaths(root = ROOT) {
  return git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']).sort();
}
