// The one way kit reaches a tool that mise installs (K127): the shim of mise in var/tools/mise/shims, which runs the release of
// mise.lock for the checkout. A shim needs the environment of mise of the checkout (miseEnvironment of
// bootstrap/install-mise.mts), and a tool that a shim starts finds the others on PATH: the caller passes both, as the recipes of
// kit.mk export MISE_* and put var/tools/bin and the shims first on PATH; a utility starts a tool with the environment it was
// given and sets no MISE_* or PATH of its own (K1093). kit names no Python for uv (K1048). A shim resolves the tools from the
// directory that it runs in, so a tool of mise runs in the checkout.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toolsPath } from './bootstrap/tool-wrappers.mts';

/** The directory of the shims of mise, relative to the root of the checkout; for messages. */
export const SHIMS = 'var/tools/mise/shims';

/** The shims of mise that the checkout `root` runs, those of its own var/tools (toolsPath, K858), or one shim in them. */
export const shimsPath = (root: string, ...name: string[]): string => toolsPath(root, 'mise', 'shims', ...name);

/**
 * The command `name` of the checkout `root`: its wrapper in var/tools/bin when install-tools wrote one, else the shim of the command
 * in var/tools/mise/shims, else the bare name, which PATH resolves: which tool a machine provides is not kit's to judge (K947).
 */
export function toolCommand(root: string, name: string): string {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const tried = [toolsPath(root, 'bin'), shimsPath(root)].flatMap(directory => extensions.map(extension => path.join(directory, `${name}${extension}`)));
  return tried.find(file => existsSync(file)) ?? name;
}
