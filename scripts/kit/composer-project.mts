// The Composer files that every rule of the dependency tools judges for one project (K326-2). While the project is linked, that is
// the link manifest and the link lock that link wrote beside it (composer.link.json and composer.link.lock), which Composer
// resolved from the path packages of the links; unlinked, the tracked composer.json and composer.lock. A project is linked when
// its composer.link.lock exists. The rules, the state and the review read a project only through this function.
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The manifest that link writes beside a linked Composer project. */
export const LINK_MANIFEST = 'composer.link.json';
/** The lock that link writes beside a linked Composer project. */
export const LINK_LOCK = 'composer.link.lock';

/** The Composer files that the rules judge for the project in `directory` (relative to `root`): their paths and whether it is linked. */
export type JudgedComposerFiles = { manifest: string; lock: string; linked: boolean };

/** The Composer manifest and lock that the rules judge for the project in `directory` of `root`, linked or not (K326-2). */
export function judgedComposerFiles(root: string, directory: string): JudgedComposerFiles {
  const linked = existsSync(path.join(root, directory, LINK_LOCK));
  return linked
    ? { manifest: path.posix.join(directory, LINK_MANIFEST), lock: path.posix.join(directory, LINK_LOCK), linked }
    : { manifest: path.posix.join(directory, 'composer.json'), lock: path.posix.join(directory, 'composer.lock'), linked };
}
