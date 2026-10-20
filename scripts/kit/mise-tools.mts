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

/** The directory of the shims of mise, relative to the root of the checkout. */
export const SHIMS = 'var/tools/mise/shims';

/**
 * The command `name` of the checkout `root`: its wrapper in var/tools/bin when install-tools wrote one, else the shim of the command
 * in var/tools/mise/shims. A tool that the checkout lacks throws with the fix; PATH is never searched (K393-1).
 */
export function toolCommand(root: string, name: string): string {
  const tried = [toolsPath(root, 'bin', name), path.join(root, SHIMS, name)];
  const found = tried.find(file => existsSync(file));
  if (found === undefined) throw new Error(`${name} of the checkout is missing (${tried.map(file => path.relative(root, file)).join(', ')}); run make install`);
  return found;
}

/** The shim of the command `name` in the checkout `root`, whether or not it exists: UV_PYTHON names it, and a missing shim is not an error there. */
const shimPath = (root: string, name: string): string => path.join(root, SHIMS, name);

/**
 * `base` with the environment of mise of the checkout `root`, UV_PYTHON on the python3 of mise, and var/tools/bin and the shims
 * first on PATH, each once.
 */
export function toolsEnvironment(root: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const first = [toolsPath(root, 'bin'), path.join(root, SHIMS)];
  const rest = (base.PATH ?? '').split(path.delimiter).filter(entry => entry && !first.includes(path.resolve(entry)));
  return { ...base, ...miseEnvironment(root), UV_PYTHON: shimPath(root, 'python3'), PATH: [...first, ...rest].join(path.delimiter) };
}
