#!/usr/bin/env node
// Lints the Go of the checkout with the golangci-lint and the deadcode of var/tools/bin (`make lint-go`), in the folder of each
// Go module, a go.mod of the checkout:
//   - `golangci-lint run --config <root>/.golangci.yml ./...`, the configuration that kit copies: the standard linters and
//     gomoddirectives, which forbids a replace (the modules of a repository resolve each other through its go.work) and a
//     toolchain line.
//   - `deadcode -test ./...`, the functions that neither a main package nor a test of the module reaches. deadcode exits 0
//     when it reports one, so a step with any output fails.
// A missing tool or configuration is a failure with its fix, never a skip. Every step runs, also after a failure of an
// earlier one, and each prints one line.
//
//   node scripts/kit/lint-go.mts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain, ROOT } from './paths.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** A step of the lint: the command, its arguments, the folder it runs in relative to the root, and whether output fails it. */
export type LintStep = { label: string; command: string; args: string[]; cwd: string; quiet: boolean };

/** The steps of the lint of `root`; throws when a tool or .golangci.yml is missing. */
export function lintSteps(root: string): LintStep[] {
  const modules = checkedFiles(root).filter(file => path.posix.basename(file) === 'go.mod').map(file => path.posix.dirname(file));
  if (modules.length === 0) return [];
  const tools: Record<string, string> = {};
  for (const tool of ['golangci-lint', 'deadcode']) {
    const command = path.join(root, 'var/tools/bin', tool);
    if (!existsSync(command)) throw new Error(`${path.relative(root, command)} is missing; run make install-tools`);
    tools[tool] = command;
  }
  if (!existsSync(path.join(root, '.golangci.yml'))) throw new Error('.golangci.yml is missing; it is the golangci-lint configuration that kit copies into every repository (make kit-sync)');
  return modules.flatMap(folder => [
    { label: `golangci-lint ${folder}`, command: tools['golangci-lint']!, args: ['run', `--config=${path.join(root, '.golangci.yml')}`, './...'], cwd: folder, quiet: false },
    { label: `deadcode ${folder}`, command: tools.deadcode!, args: ['-test', './...'], cwd: folder, quiet: true },
  ]);
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  const failed: string[] = [];
  for (const step of lintSteps(root)) {
    const result = execute(step.command, step.args, { cwd: path.join(root, step.cwd) });
    const output = `${result.stdout}${result.stderr}`;
    print(output);
    const failure = result.error?.message ?? (result.status !== 0 ? `exit status ${result.status}` : step.quiet && output.trim() ? 'a finding' : undefined);
    if (failure) {
      failed.push(step.label);
      console.log(`[lint-go] ${step.label}: failed with ${failure}`);
    } else {
      console.log(`[lint-go] ${step.label}: passed`);
    }
  }
  return failed;
}

if (isMain(import.meta.url)) {
  try {
    const failed = lint(ROOT);
    if (failed.length) {
      console.error(`[lint-go] ${failed.length} steps failed: ${failed.join('; ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // lint and the modules it calls throw only an Error.
    console.error(`[lint-go] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
