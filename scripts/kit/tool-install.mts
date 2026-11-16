// The message of a tool that cannot start (K947, K1276): the runner and the link fail with the same form, its cause and its fix.
import path from 'node:path';

/** The fix for a tool that cannot start, by the name of the tool. */
export const INSTALL: Record<string, (options: { cwd: string; root: string }) => string> = {
  node: () => 'run make install-tools TOOLS=npm, which installs the Node.js of mise.toml',
  vitest: () => 'run make install',
  playwright: () => 'run make install, which installs the project-local Playwright package',
  go: () => 'declare go in mise.toml and run make install-tools, which installs it into var/tools/mise',
  cargo: () => 'install rustup and run make install, which installs the toolchain of rust-toolchain.toml',
  phpunit: ({ cwd, root }) => `run composer install in ${path.relative(root, cwd) || '.'}`,
  python: () => 'declare python in mise.toml and run make install-tools, which installs it into var/tools/mise',
};

/** `cannot start <command>: <cause>; <fix>`, the failure of a tool that could not start. */
export const cannotStart = (command: string, error: Error, fix: string): string => `cannot start ${command}: ${error.message}; ${fix}`;
