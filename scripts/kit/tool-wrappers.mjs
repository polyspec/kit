// What the installers of var/tools share: the directories, the environment of the bootstrap commands, a command that
// prints itself before it runs, and the wrapper scripts of var/tools/bin. A wrapper starts the installed file by its
// absolute path; there is no symbolic link.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TOOLS = 'var/tools';
export const toolsPath = (root, ...parts) => path.join(root, TOOLS, ...parts);

/**
 * The environment of the commands that install a tool: PATH without var/tools/bin, so that a wrapper of an earlier
 * install never installs its own replacement and the tool of the machine is the bootstrap.
 */
export function bootstrapEnvironment(root, extra = {}) {
  const bin = toolsPath(root, 'bin');
  const PATH = (process.env.PATH ?? '').split(path.delimiter).filter(entry => path.resolve(entry) !== bin).join(path.delimiter);
  return { ...process.env, PATH, ...extra };
}

/** Runs `command` with its output on the output of this process, after printing it; throws when it does not end with status 0. */
export function run(command, args, options, print) {
  print(`${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}; install ${command} on the machine to bootstrap ${TOOLS}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} ended with exit status ${result.status}`);
}

/** `text` quoted for sh. */
export const quote = text => `'${text.replaceAll("'", "'\\''")}'`;

/** Writes the wrapper `name` of var/tools/bin unless it has this text; the file is written beside its path and renamed. */
export function writeWrapper(root, name, text, print) {
  const file = toolsPath(root, 'bin', name);
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const next = `${file}.next-${process.pid}`;
  writeFileSync(next, text, { mode: 0o755 });
  chmodSync(next, 0o755);
  renameSync(next, file);
  print(`wrote ${path.relative(root, file)}`);
}

/** The text of a wrapper that runs `command`, with the comment line `comment`. */
export const wrapperText = (comment, command) => `#!/bin/sh\n# ${comment} (scripts/kit/install-tools.mjs).\n${command}\n`;
