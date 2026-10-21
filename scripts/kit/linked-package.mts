// Whether a dependency of a repository is a package that a link provides (K328). The local checkout is canonical during
// development: a linked polyspec package is judged by its link (a path dist of the link lock, a symbolic link, link-state-check),
// and the comparison with the latest release of the registry belongs to the check of the batch release.
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { judgedComposerFiles } from './composer-project.mts';
import { readComposerLock } from './manifests.mts';

/** Whether the package `name` of `ecosystem`, locked by `lock` (relative to `root`), is linked: its dist in the link lock is a path, or its node_modules folder is a link. */
export function isLinked(root: string, ecosystem: string, lock: string | null, name: string): boolean {
  if (lock === null) return false;
  const directory = path.posix.dirname(lock);
  if (ecosystem === 'composer') {
    const judged = judgedComposerFiles(root, directory);
    if (!judged.linked) return false;
    const linked = readComposerLock(root, judged.lock);
    return [...(linked.packages ?? []), ...(linked['packages-dev'] ?? [])].some(item => item.name === name && item.dist?.type === 'path');
  }
  if (ecosystem === 'npm') return lstatSync(path.join(root, directory, 'node_modules', name), { throwIfNoEntry: false })?.isSymbolicLink() === true;
  return false;
}
