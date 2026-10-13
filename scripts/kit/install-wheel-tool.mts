// Installs a Python tool that config/toolchain.json declares by the release of its wheel (ruff, vulture) into its own virtual
// environment of var/tools, with the wrapper of its command in var/tools/bin. The wheel is downloaded by installBackend with
// every declared sha256, so pip refuses a wheel that is not declared; the environment is made by `uv venv` from
// var/tools/bin/python3, the Python that install-python.mts installs, as uv makes it, and `uv pip install` installs the wheel
// into it without dependencies. An installed release is kept. The Python of the machine is never used.
//
// A tool whose command is a binary of its wheel (ruff) runs as that binary. A pure-Python tool (vulture) runs as
// `<environment>/bin/python -m <tool>`: the console script that pip writes names the interpreter of the temporary directory
// of the install in its first line, which no longer exists once the directory is renamed into place.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { installOnce } from './bootstrap/install-tool.mts';
import { installBackend } from './release-backend.mts';
import { bootstrapEnvironment, quote, run, RELEASE_OUTPUT, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';

/**
 * A wheel tool: its command, which is also its distribution name, its module name and its key of RELEASE_OUTPUT; its folder
 * of var/tools; and whether it runs as a module of the environment's Python instead of a binary.
 */
export type WheelTool = { name: keyof typeof RELEASE_OUTPUT; folder: string; module: boolean };

// The command of `tool` in the environment `directory`: the program and the arguments before the arguments of a call.
const commandOf = (tool: WheelTool, directory: string): string[] => (tool.module ? [path.join(directory, 'bin/python'), '-m', tool.name] : [path.join(directory, 'bin', tool.name)]);

// The release that the command of `tool` in `directory` prints, or undefined when the environment has no such command.
function releaseIn(tool: WheelTool, directory: string): string | undefined {
  const [program, ...prefix] = commandOf(tool, directory) as [string, ...string[]];
  if (!existsSync(program) || (tool.module && !existsSync(path.join(directory, 'bin', tool.name)))) return undefined;
  const { args, pattern } = RELEASE_OUTPUT[tool.name];
  return pattern.exec(execFileSync(program, [...prefix, ...args], { encoding: 'utf8' }))?.[1];
}

/** Installs the wheel tool `tool` at the declared `{ version, digests, source }` into var/tools/<folder> of `root` and writes the wrapper. */
export function installWheelTool({ root, tool, declared, print = () => {} }: { root: string; tool: WheelTool; declared: { version: string; digests: unknown[]; source: string }; print?: (text: string) => void }) {
  const python = toolsPath(root, 'bin', 'python3');
  if (!existsSync(python)) throw new Error(`${tool.name} needs ${path.relative(root, python)}, the Python that config/toolchain.json pythonBuild declares; declare pythonBuild and run make install-tools TOOLS=python`);
  const prefix = toolsPath(root, tool.folder);
  const result = installOnce({
    root, label: tool.name, prefix, recorded: declared.version, installedRelease: (directory: string) => releaseIn(tool, directory), print,
    install: (next: string) => {
      const environment = bootstrapEnvironment(root);
      const { file } = installBackend({ root, env: environment, requirement: `${tool.name}==${declared.version}`, digests: declared.digests, source: declared.source, print });
      const uv = toolsPath(root, 'bin', 'uv');
      run(uv, ['venv', '--quiet', '--python', python, next], { cwd: root, env: environment }, print);
      run(uv, ['pip', 'install', '--quiet', '--python', path.join(next, 'bin/python'), '--no-index', '--no-deps', file], { cwd: root, env: environment }, print);
    },
  });
  writeWrapper(root, tool.name, wrapperText(`${tool.name} ${declared.version} of this checkout`, `exec ${commandOf(tool, prefix).map(quote).join(' ')} "$@"`), print);
  return result;
}
