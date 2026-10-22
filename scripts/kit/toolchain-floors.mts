// The .npmrc files of a checkout: an .npmrc may not keep npm from linking (S1: our rules never block the links of npm), so
// install-links=true and bin-links=false fail, read by npm in the directory of the file. No toolchain declaration or manifest floor is
// compared with a pin: kit enforces no version (S4, K448).
import path from 'node:path';
import { readNpmConfig } from './toolchain-files.mts';
import { checkedFiles } from './tracked-files.mts';



// The manifests of the repository named `name`. .mise holds the tool environments that mise writes for the pypi: tools of
// mise.lock (K127), which are mise's, not manifests of the repository.
const named = (root: string, name: string): string[] => checkedFiles(root).filter(file => path.posix.basename(file) === name && !file.startsWith('.mise/'));










// The npm keys that keep npm from linking, the value that does, and what npm then does instead.
const LINK_BLOCKERS: Record<string, [string, string]> = {
  'install-links': ['true', 'npm packs each file: dependency instead of linking it'],
  'bin-links': ['false', 'npm does not link the bins of the packages'],
};

/** One line for each key of a tracked .npmrc that keeps npm from linking; `env` runs npm. */
export const npmrcFindings = (root: string, env: NodeJS.ProcessEnv): string[] => named(root, '.npmrc').flatMap((file) => {
  const values = readNpmConfig(root, file, Object.keys(LINK_BLOCKERS), env);
  return Object.entries(LINK_BLOCKERS).filter(([key, [blocking]]) => values[key] === blocking)
    .map(([key, [blocking, effect]]) => `${file}: ${key} is ${blocking}, so ${effect}; remove the key`);
});
