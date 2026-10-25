// The refresh of what the consumers read after main moves (K583, K609): every consumer links main live, so a commit on main and a land
// rebuild an npm package of the repository with a built output whose build the change made stale, with link-build's rebuild. kit itself
// builds nothing: its consumers run its sources (K613), and npm's prepack builds dist at release (K646). A failed build throws, naming it.
import path from 'node:path';
import { git } from './git.mts';
import { buildState, rebuild } from './link-build.mts';

/**
 * The files of `files` that are build inputs of an npm package of the repository `root` with a built output, each with the folder of
 * its package (K583): a file of the package outside docs/, in a package whose build state is no `source`.
 */
function buildInputs(root: string, files: readonly string[]): { file: string; folder: string }[] {
  const packages = git(root, 'ls-files', '-z', '--', 'package.json', '*/package.json').split('\0').filter(Boolean).map(file => path.dirname(file));
  const built = packages.filter(folder => buildState(root, path.join(root, folder)) !== 'source');
  const inside = (folder: string, file: string) => folder === '.' || file.startsWith(`${folder}/`);
  return files.filter(file => !file.startsWith('docs/')).flatMap(file => built.filter(folder => inside(folder, file)).map(folder => ({ file, folder })));
}

/** Rebuilds what the consumers of `root` read after main moved by the change of `files`, printing to `print`. */
export function refreshLinked(root: string, files: readonly string[], print: (text: string) => void): void {
  const stale = [...new Set(buildInputs(root, files).map(input => input.folder))].filter(folder => buildState(root, path.join(root, folder)).startsWith('stale'));
  if (stale.length === 0) return;
  try {
    rebuild(root, text => print(`${text.trim()} (${stale.join(', ')} stale after main moved)`));
  } catch (error) {
    // Main has moved; the failure of the build names it and its fix, keeping its cause.
    throw new Error(`main moved, but the build of ${stale.join(', ')} failed, so the linked outputs are older than their sources; fix the build and run node <kit>/dist/link.mjs rebuild .`, { cause: error });
  }
}
