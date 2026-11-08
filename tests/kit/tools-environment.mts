// The environment of the tools of a checkout as a test passes it to a utility of kit, which starts its tools with the
// environment of its caller and sets no MISE_* or PATH of its own (K1093): the environment of mise of the checkout `root`, and
// var/tools/bin and the shims of mise first on PATH, each once, as the recipes of kit.mk export them.
import path from 'node:path';
import { miseEnvironment } from '../../scripts/kit/bootstrap/install-mise.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { shimsPath } from '../../scripts/kit/mise-tools.mts';

/** `base` with the environment of mise of the checkout `root`, and var/tools/bin and the shims first on PATH, each once. */
export function toolsEnvironment(root: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const first = [toolsPath(root, 'bin'), shimsPath(root)];
  const rest = (base.PATH ?? '').split(path.delimiter).filter(entry => entry && !first.includes(path.resolve(entry)));
  return { ...base, ...miseEnvironment(root), PATH: [...first, ...rest].join(path.delimiter) };
}
