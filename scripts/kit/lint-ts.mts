#!/usr/bin/env node
// Lints the TypeScript of the checkout with the oxlint, knip and API Extractor of node_modules/.bin (`make lint-ts`):
//   - `oxlint --type-aware --deny-warnings -c .oxlintrc.json`, the configuration that kit copies, on the checkout; oxlint
//     reads the files that Git does not ignore, and oxlint-tsgolint checks the rules that need the types of TypeScript 7.
//   - `knip`, the files, exports and dependencies that nothing uses, from the root with knip.json, which kit copies, and the
//     plugins that read the manifests. knip has no `extends`, so the entries that the repository adds in config/knip-entries.json
//     (K145) are added to `node.entry` of knip.json, its binaries (K152) to `ignoreBinaries`, and its nested npm projects
//     (K154) to `workspaces`, each with its entries and ignored dependencies, in var/lint-ts/knip.json, which knip then reads
//     with --config. knip's Svelte plugin compiles the .svelte files of a workspace that depends on svelte.
//   - `api-extractor run` for each package with an api-extractor.json, which extends config/api-extractor.kit.json: every export
//     is documented and reachable, and the public API equals the committed API report. It reads the .d.ts that the build of
//     the package wrote.
// A missing tool or configuration is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-ts.mts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { foldersOf, lintCommands, lintMain, requireConfigurations, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { readJson, writeJson } from './bootstrap/files.mts';
import { ConfigError, readConfig } from './schema-validate.mts';

/**
 * The entries that a repository adds to the layout entries of knip.json, the binaries to its ignoreBinaries, and its nested
 * npm projects as workspaces (scripts/kit/schema/knip-entries.schema.json).
 */
export const KNIP_ENTRIES = 'config/knip-entries.json';
/** config/knip-entries.json: each key with its reason. */
interface KnipEntries {
  entries?: Record<string, string>;
  binaries?: Record<string, string>;
  workspaces?: Record<string, { reason: string; entries?: Record<string, string>; ignoreDependencies?: Record<string, string> }>;
}

/** The knip configuration of a repository with entries of its own: knip.json with those entries, written by lintSteps. */
export const MERGED_KNIP = 'var/lint-ts/knip.json';

/**
 * The arguments of knip for `root`: knip.json alone, or, when the repository declares config/knip-entries.json, the
 * configuration of MERGED_KNIP, which this function writes: knip.json with the declared entries after its own `node.entry`,
 * the declared binaries after its own `ignoreBinaries`, and each declared workspace with its entries and ignored dependencies.
 */
export function knipArguments(root: string): string[] {
  if (!existsSync(path.join(root, KNIP_ENTRIES))) return ['--no-progress'];
  const { value, errors } = readConfig<KnipEntries>(root, KNIP_ENTRIES, 'knip-entries.schema.json');
  if (errors.length) throw new ConfigError(errors.join('\n'));
  const base = readJson(root, 'knip.json');
  const merged = { ...base };
  if (value.entries) merged.node = { ...base.node, entry: [...(base.node?.entry ?? []), ...Object.keys(value.entries)] };
  if (value.binaries) merged.ignoreBinaries = [...(base.ignoreBinaries ?? []), ...Object.keys(value.binaries)];
  if (value.workspaces) {
    const workspaces = Object.entries(value.workspaces).map(([directory, { entries, ignoreDependencies }]) => [directory, {
      ...(entries ? { entry: Object.keys(entries) } : {}),
      ...(ignoreDependencies ? { ignoreDependencies: Object.keys(ignoreDependencies) } : {}),
    }]);
    merged.workspaces = { ...base.workspaces, ...Object.fromEntries(workspaces) };
  }
  writeJson(path.join(root, MERGED_KNIP), merged);
  return ['--no-progress', '--config', MERGED_KNIP];
}

/** The steps of the lint of `root`; throws when a tool or a configuration is missing. */
export function lintSteps(root: string): LintStep[] {
  const tools = lintCommands(root, 'node_modules/.bin', ['oxlint', 'knip', 'api-extractor'], 'run npm ci');
  requireConfigurations(root, [['.oxlintrc.json', 'oxlint'], ['knip.json', 'knip']]);
  const packages = foldersOf(root, 'api-extractor.json');
  return [
    // The unix format names the file, line, column and rule of each finding on one line; oxlint picks the github format under CI, whose annotations
    // leave the rule out, so the format is fixed and the output is the same everywhere.
    { label: 'oxlint', command: tools.oxlint!, args: ['--type-aware', '--deny-warnings', '--format', 'unix', '-c', '.oxlintrc.json'], cwd: '.' },
    { label: 'knip', command: tools.knip!, args: knipArguments(root), cwd: '.' },
    ...packages.map(folder => ({ label: `api-extractor ${folder}`, command: tools['api-extractor']!, args: ['run'], cwd: folder })),
  ];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-ts', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-ts', lintSteps);
