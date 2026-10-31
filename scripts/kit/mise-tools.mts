// The one way kit reaches a tool that mise installs (K127): the shim of mise in var/tools/mise/shims, which runs the release of
// mise.lock for the checkout. A shim needs the environment of mise of the checkout (miseEnvironment of
// bootstrap/install-mise.mts), which kit.mk exports to every recipe; toolsEnvironment builds it for a command that kit starts
// itself, with var/tools/bin (npm, npx, mise and the wrappers of the Composer projects) and the shims first on PATH, and uv on
// the Python of mise (UV_PYTHON). A shim resolves the tools from the directory that it runs in, so a tool of mise runs in the
// checkout.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { miseEnvironment } from './bootstrap/install-mise.mts';
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

/** The shim of the command `name` in the checkout `root`, whether or not it exists: UV_PYTHON names it, and a missing shim is not an error there. */
const shimPath = (root: string, name: string): string => shimsPath(root, name);

/**
 * `base` with the environment of mise of the checkout `root`, UV_PYTHON on the python3 of mise, and var/tools/bin and the shims
 * first on PATH, each once.
 */
export function toolsEnvironment(root: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const first = [toolsPath(root, 'bin'), shimsPath(root)];
  const rest = (base.PATH ?? '').split(path.delimiter).filter(entry => entry && !first.includes(path.resolve(entry)));
  return { ...base, ...miseEnvironment(root), UV_PYTHON: shimPath(root, 'python3'), PATH: [...first, ...rest].join(path.delimiter) };
}
