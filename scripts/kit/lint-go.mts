#!/usr/bin/env node
// Lints the Go of the checkout with the golangci-lint and the deadcode of var/tools/bin (`make lint-go`), in the folder of each
// Go module, a go.mod of the checkout:
//   - `golangci-lint run --config <root>/.golangci.yml ./...`, the configuration that kit copies: the standard linters and
//     gomoddirectives, which forbids a replace (the modules of a repository resolve each other through its go.work) and a
//     toolchain line.
//   - `deadcode -test ./...`, the functions that neither a main package nor a test of the module reaches. deadcode exits 0
//     when it reports one, so a step with any output fails.
// A missing tool or configuration is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-go.mts
import path from 'node:path';
import { foldersOf, lintCommands, lintMain, requireConfigurations, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { ROOT } from './paths.mts';

/** The steps of the lint of `root`; throws when a tool or .golangci.yml is missing. */
export function lintSteps(root: string): LintStep[] {
  const modules = foldersOf(root, 'go.mod');
  if (modules.length === 0) return [];
  const tools = lintCommands(root, 'var/tools/bin', ['golangci-lint', 'deadcode'], 'run make install-tools');
  requireConfigurations(root, [['.golangci.yml', 'golangci-lint']]);
  return modules.flatMap(folder => [
    { label: `golangci-lint ${folder}`, command: tools['golangci-lint']!, args: ['run', `--config=${path.join(root, '.golangci.yml')}`, './...'], cwd: folder },
    // deadcode exits 0 when it reports a function, so its output fails the step.
    { label: `deadcode ${folder}`, command: tools.deadcode!, args: ['-test', './...'], cwd: folder, quiet: true },
  ]);
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-go', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-go', ROOT, lintSteps);
