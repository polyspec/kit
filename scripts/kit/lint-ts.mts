#!/usr/bin/env node
// Lints the TypeScript of the checkout with the oxlint, knip and API Extractor of node_modules/.bin (`make lint-ts`):
//   - `oxlint --type-aware --deny-warnings -c .oxlintrc.json`, the configuration that kit copies, on the checkout; oxlint
//     reads the files that Git does not ignore, and oxlint-tsgolint checks the rules that need the types of TypeScript 7.
//   - `knip`, the files, exports and dependencies that nothing uses, from the root with knip.json, which kit copies, and the
//     plugins that read the manifests.
//   - `api-extractor run` for each package with an api-extractor.json, which extends config/api-extractor.kit.json: every export
//     is documented and reachable, and the public API equals the committed API report. It reads the .d.ts that the build of
//     the package wrote.
// A missing tool or configuration is a failure with its fix, never a skip. Every step runs, also after a failure of an
// earlier one, and each prints one line.
//
//   node scripts/kit/lint-ts.mts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain, ROOT } from './paths.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** A step of the lint: the command, its arguments and the folder it runs in, relative to the root. */
export type LintStep = { label: string; command: string; args: string[]; cwd: string };

/** The steps of the lint of `root`; throws when a tool or a configuration is missing. */
export function lintSteps(root: string): LintStep[] {
  const tools: Record<string, string> = {};
  for (const tool of ['oxlint', 'knip', 'api-extractor']) {
    const command = path.join(root, 'node_modules/.bin', tool);
    if (!existsSync(command)) throw new Error(`${path.relative(root, command)} is missing; run npm ci`);
    tools[tool] = command;
  }
  for (const [file, tool] of [['.oxlintrc.json', 'oxlint'], ['knip.json', 'knip']]) {
    if (!existsSync(path.join(root, file!))) throw new Error(`${file} is missing; it is the ${tool} configuration that kit copies into every repository (make kit-sync)`);
  }
  const packages = checkedFiles(root).filter(file => path.posix.basename(file) === 'api-extractor.json').map(file => path.posix.dirname(file));
  return [
    { label: 'oxlint', command: tools.oxlint!, args: ['--type-aware', '--deny-warnings', '-c', '.oxlintrc.json'], cwd: '.' },
    { label: 'knip', command: tools.knip!, args: ['--no-progress'], cwd: '.' },
    ...packages.map(folder => ({ label: `api-extractor ${folder}`, command: tools['api-extractor']!, args: ['run'], cwd: folder })),
  ];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  const failed: string[] = [];
  for (const step of lintSteps(root)) {
    const result = execute(step.command, step.args, { cwd: path.join(root, step.cwd) });
    print(`${result.stdout}${result.stderr}`);
    if (result.error || result.status !== 0) {
      failed.push(step.label);
      console.log(`[lint-ts] ${step.label}: failed with ${result.error?.message ?? `exit status ${result.status}`}`);
    } else {
      console.log(`[lint-ts] ${step.label}: passed`);
    }
  }
  return failed;
}

if (isMain(import.meta.url)) {
  try {
    const failed = lint(ROOT);
    if (failed.length) {
      console.error(`[lint-ts] ${failed.length} steps failed: ${failed.join('; ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // lint and the modules it calls throw only an Error.
    console.error(`[lint-ts] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
