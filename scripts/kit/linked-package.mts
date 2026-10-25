// Whether a dependency of a repository is a package that a link provides (K328). The local checkout is canonical during
// development: a linked polyspec package is judged by its link (a symbolic link of its install folder, link-state-check), and the
// comparison with the latest release of the registry belongs to the check of the batch release.
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { composerVendorDir } from './link-folders.mts';

/**
 * Whether the package `name` of `ecosystem`, locked by `lock` (relative to `root`), is linked: its install folder, in the vendor folder
 * of the Composer project or in node_modules, is a symbolic link (K591).
 */
export function isLinked(root: string, ecosystem: string, lock: string | null, name: string): boolean {
  if (lock === null) return false;
  const directory = path.join(root, path.posix.dirname(lock));
  const isLink = (folder: string) => lstatSync(folder, { throwIfNoEntry: false })?.isSymbolicLink() === true;
  if (ecosystem === 'composer') return isLink(path.join(path.resolve(directory, composerVendorDir(directory, process.env) ?? 'vendor'), name));
  if (ecosystem === 'npm') return isLink(path.join(directory, 'node_modules', name));
  return false;
}
