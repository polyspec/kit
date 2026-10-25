// The refresh of what the consumers read after main moves (K551, K583, K609): every consumer links main live, so a commit on main and
// a land rebuild the outputs that the change makes stale. In kit, a change of a build input builds dist; elsewhere, an npm package with
// a built output whose build is stale is rebuilt with link-build's rebuild. A failed build throws, naming it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { git } from './git.mts';
import { isSource } from './kit-check.mts';
import { buildState, rebuild } from './link-build.mts';

// The inputs of the build of the kit package (K551): the sources of its tools and the files that configure their build.
const BUILD_INPUT = /^(?:scripts\/kit\/.*\.mts$|tsconfig\.build\.json$|package\.json$)/;

/** Builds the kit package `root` with make kit-build (K551); a failed build throws, naming it. */
function buildKit(root: string): void {
  const result = spawnSync('make', ['--no-print-directory', 'kit-build'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error) throw new Error(`make kit-build could not start in ${root}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`main moved, but make kit-build failed in ${root} with exit status ${result.status}, so dist is older than its sources; fix the build and run make kit-build:\n${`${result.stdout}${result.stderr}`.trim().split('\n').slice(-20).join('\n')}`);
}

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
  if (isSource(root)) {
    if (files.some(file => BUILD_INPUT.test(file))) buildKit(root);
    return;
  }
  const stale = [...new Set(buildInputs(root, files).map(input => input.folder))].filter(folder => buildState(root, path.join(root, folder)).startsWith('stale'));
  if (stale.length === 0) return;
  try {
    rebuild(root, text => print(`${text.trim()} (${stale.join(', ')} stale after main moved)`));
  } catch (error) {
    // Main has moved; the failure of the build names it and its fix, keeping its cause.
    throw new Error(`main moved, but the build of ${stale.join(', ')} failed, so the linked outputs are older than their sources; fix the build and run node <kit>/dist/link.mjs rebuild .`, { cause: error });
  }
}
