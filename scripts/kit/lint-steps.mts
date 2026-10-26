// The run of a lint tool of kit (lint-go, lint-php, lint-python, lint-rust, lint-ts): each tool gives the steps of the
// checkout, the commands of the linters of its language, and this module runs them. Every step runs, also after a failure
// of an earlier one, its output goes through `print`, and each prints one line, `[<name>] <label>: passed` or
// `failed with <reason>`. A missing tool or configuration is a failure with its fix, never a skip.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { execute } from './process.mts';
import type { Outcome } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/**
 * A step of the lint: the command, its arguments, the folder it runs in relative to the root, and whether any output fails
 * it (`quiet`), for a linter that exits 0 when it reports a finding.
 */
export type LintStep = { label: string; command: string; args: string[]; cwd: string; quiet?: boolean; env?: Record<string, string>; isolatedTemporaryDirectory?: boolean };

/** The path of each command of `names` in the folder `folder` of `root`; throws `${folder}/<name> is missing; ${fix}` for a missing one. */
export function lintCommands(root: string, folder: string, names: readonly string[], fix: string): Record<string, string> {
  return Object.fromEntries(names.map((name) => {
    // A folder of the checkout, such as node_modules/.bin, or an absolute folder of the tools of the main checkout (K519).
    const command = path.resolve(root, folder, name);
    if (!existsSync(command)) throw new Error(`${path.relative(root, command)} is missing; ${fix}`);
    return [name, command];
  }));
}

/** The folders of the checked files of `root` named `name`, such as the Go modules (go.mod), relative to `root`. */
export const foldersOf = (root: string, name: string): string[] =>
  checkedFiles(root).filter(file => path.posix.basename(file) === name).map(file => path.posix.dirname(file));

/** The owner of a file among the package folders `packages`: the deepest folder that holds it. */
export const packageOwner = (packages: readonly string[]) => (file: string): string | undefined =>
  packages.filter(folder => folder === '.' || file.startsWith(`${folder}/`)).sort((a, b) => b.length - a.length)[0];

/** Runs `steps` in `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function runLint(name: string, steps: readonly LintStep[], root: string, print: (text: string) => unknown): string[] {
  const failed: string[] = [];
  for (const step of steps) {
    // A step runs the tools of mise.toml from their shims, in the environment of mise of the checkout.
    const env = { ...toolsEnvironment(root), ...step.env };
    const temporaryDirectory = step.isolatedTemporaryDirectory
      ? mkdtempSync(path.join(env.TMPDIR ?? tmpdir(), 'kit-lint-step-'))
      : undefined;
    if (temporaryDirectory !== undefined) env.TMPDIR = temporaryDirectory;
    let result: Outcome;
    try {
      result = execute(step.command, step.args, { cwd: path.join(root, step.cwd), env });
    } finally {
      if (temporaryDirectory !== undefined) rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    const output = `${result.stdout}${result.stderr}`;
    print(output);
    const failure = result.error?.message ?? (result.status !== 0 ? `exit status ${result.status}` : step.quiet && output.trim() ? 'a finding' : undefined);
    if (failure) {
      failed.push(step.label);
      console.log(`[${name}] ${step.label}: failed with ${failure}`);
    } else {
      console.log(`[${name}] ${step.label}: passed`);
    }
  }
  return failed;
}

/** Runs the lint `name` of the repository root with the steps of `lintSteps` when the module `url` is the main module, and sets the exit code. */
export function lintMain(url: string, name: string, lintSteps: (root: string) => LintStep[]): void {
  if (!isMain(url)) return;
  try {
    const root = repositoryRoot();
    const steps = lintSteps(root);
    const failed = runLint(name, steps, root, text => process.stdout.write(text));
    if (failed.length) {
      console.error(`[${name}] ${failed.length} of ${steps.length} steps failed: ${failed.join('; ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // lintSteps and the modules it calls throw only an Error.
    console.error(`[${name}] ${error.message}`);
    process.exitCode = 1;
  }
}
