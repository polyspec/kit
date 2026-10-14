// Where a tool of kit runs: the root of the repository, which is the top level of the Git work tree of the working
// directory, and whether a module is the command that Node.js started.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitResult } from './git.mts';

let root: string | undefined;

/**
 * The root of the repository: the top level of the Git work tree that holds the working directory, as `git rev-parse
 * --show-toplevel` names it, the directory to which the pre-push hook of git-hooks.mts changes as well. A tool may start below
 * the root, as `npm -w` starts it in a package directory, and still reads and writes the paths of the repository. The root
 * is not derived from the location of the module, since the tools also run from node_modules/@polyspec/kit/dist of a
 * repository. It is read on the first call, so a module that a project outside a repository imports reads no root; outside
 * a Git work tree the call throws with the cause.
 */
export function repositoryRoot(): string {
  if (root === undefined) {
    const cwd = process.cwd();
    const found = gitResult(cwd, 'rev-parse', '--show-toplevel');
    if (found.error) throw new Error(`git rev-parse --show-toplevel could not start in ${cwd}: ${found.error.message}`);
    if (found.status !== 0) throw new Error(`${cwd} is not inside a Git work tree; a tool of kit runs in a checkout of a repository, whose top level is its root: ${found.stderr.trim()}`);
    root = found.stdout.trim();
  }
  return root;
}

/**
 * The file of the tool `name` beside the module `moduleUrl` (its `import.meta.url`), with the extension of that module: a
 * source of scripts/kit (.mts) starts a source, a module of the package's dist (.mjs) a module of dist.
 */
export const siblingTool = (moduleUrl: string, name: string): string => {
  const file = fileURLToPath(moduleUrl);
  return path.join(path.dirname(file), `${name}${path.extname(file)}`);
};

/**
 * Whether the module `moduleUrl` (its `import.meta.url`) is the command that Node.js started. Both paths are resolved to their real
 * files before the comparison, so a command named through a link of its directory is that module; the comparison never reads a
 * link as a different file, which would make the tool skip its work and exit 0.
 */
export const isMain = (moduleUrl: string): boolean =>
  // Boolean() above checked process.argv[1]; TypeScript does not narrow through Boolean().
  Boolean(process.argv[1]) && realpathSync(process.argv[1]!) === realpathSync(fileURLToPath(moduleUrl));

/** The variable in which run-tests names the repository root to the reporters that it loads into a test run. */
export const TEST_ROOT = 'KIT_TEST_ROOT';

/**
 * The repository root of a test run, for a reporter that run-tests loads into the test tool: that process runs in the
 * --cwd directory of the run, so its working directory names no repository root, and run-tests passes its own root in
 * TEST_ROOT. Throws while the variable is unset, as it is outside run-tests.
 */
export function testRoot(): string {
  const root = process.env[TEST_ROOT];
  if (!root) throw new Error(`${TEST_ROOT} is not set; the test reporters of kit run under scripts/kit/run-tests.mts, which sets it to the repository root`);
  return root;
}
