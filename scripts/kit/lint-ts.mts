#!/usr/bin/env node
// Lints the TypeScript of the checkout with the oxlint, knip and API Extractor of node_modules/.bin (`make lint-ts`):
//   - `oxlint --type-aware --deny-warnings -c .oxlintrc.json`, the configuration that kit copies, on the checkout; oxlint
//     reads the files that Git does not ignore, and oxlint-tsgolint checks the rules that need the types of TypeScript 7.
//   - `knip`, the files, exports and dependencies that nothing uses, from the root with knip.json, which kit copies, and the
//     plugins that read the manifests.
//   - `api-extractor run` for each package with an api-extractor.json, which extends config/api-extractor.kit.json: every export
//     is documented and reachable, and the public API equals the committed API report. It reads the .d.ts that the build of
//     the package wrote.
// A missing tool or configuration is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-ts.mts
import { foldersOf, lintCommands, lintMain, requireConfigurations, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { ROOT } from './paths.mts';

/** The steps of the lint of `root`; throws when a tool or a configuration is missing. */
export function lintSteps(root: string): LintStep[] {
  const tools = lintCommands(root, 'node_modules/.bin', ['oxlint', 'knip', 'api-extractor'], 'run npm ci');
  requireConfigurations(root, [['.oxlintrc.json', 'oxlint'], ['knip.json', 'knip']]);
  const packages = foldersOf(root, 'api-extractor.json');
  return [
    // The unix format names the file, line, column and rule of each finding on one line; oxlint picks the github format under CI, whose annotations
    // leave the rule out, so the format is fixed and the output is the same everywhere.
    { label: 'oxlint', command: tools.oxlint!, args: ['--type-aware', '--deny-warnings', '--format', 'unix', '-c', '.oxlintrc.json'], cwd: '.' },
    { label: 'knip', command: tools.knip!, args: ['--no-progress'], cwd: '.' },
    ...packages.map(folder => ({ label: `api-extractor ${folder}`, command: tools['api-extractor']!, args: ['run'], cwd: folder })),
  ];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-ts', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-ts', ROOT, lintSteps);
