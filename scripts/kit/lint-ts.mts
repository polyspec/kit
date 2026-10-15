#!/usr/bin/env node
// Lints the TypeScript of the checkout with the oxlint, knip and API Extractor of node_modules/.bin (`make lint-ts`):
//   - `oxlint --type-aware --deny-warnings -c .oxlintrc.json`, the configuration that kit copies, on the checkout; oxlint
//     reads the files that Git does not ignore, and oxlint-tsgolint checks the rules that need the types of TypeScript 7. In a
//     consumer it leaves out the copies of kit (`kit.copies` of the installed package, which kit-sync writes and kit-check
//     compares byte for byte): kit lints them with its own tsconfig and the types of node, and outside the consumer's project
//     oxlint-tsgolint would check them without those types (K157). It leaves out the files that `ignore` of
//     config/knip-entries.json declares, which are not code of the repository, such as inputs of tests that are broken on
//     purpose (K172).
//   - `knip`, the files, exports and dependencies that nothing uses, from the root with knip.json, which kit copies, and the
//     plugins that read the manifests. knip has no `extends`, so the entries that the repository adds in config/knip-entries.json
//     (K145) are added to `node.entry` of knip.json, its binaries (K152) to `ignoreBinaries`, the root dependencies that only
//     make runs (K159) to `ignoreDependencies`, the files that are not code of the repository (K162, K172), such as a sample
//     that a site shows and nothing runs, to `ignore`, and its nested npm projects (K154) to `workspaces`, each with its entries and
//     ignored dependencies, in var/lint-ts/knip.json, which knip then reads with --config. knip's Svelte plugin compiles the
//     .svelte files of a workspace that depends on svelte.
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
import { writeJson } from './bootstrap/files.mts';
import { installedKit, isSource } from './kit-check.mts';
import { ConfigError, readConfig } from './schema-validate.mts';
import { present } from './present.mts';

/**
 * The entries that a repository adds to the layout entries of knip.json, the binaries to its ignoreBinaries, the root
 * dependencies to its ignoreDependencies, the ignored files to its ignore, and its nested npm projects as workspaces
 * (scripts/kit/schema/knip-entries.schema.json).
 */
export const KNIP_ENTRIES = 'config/knip-entries.json';
/** config/knip-entries.json: each key with its reason. */
interface KnipEntries {
  entries?: Record<string, string>;
  binaries?: Record<string, string>;
  ignoreDependencies?: Record<string, string>;
  ignore?: Record<string, string>;
  workspaces?: Record<string, { reason: string; entries?: Record<string, string>; ignoreDependencies?: Record<string, string> }>;
}

/** config/knip-entries.json of `root`, validated by its schema, or undefined when the repository has none. */
function knipEntries(root: string): KnipEntries | undefined {
  return existsSync(path.join(root, KNIP_ENTRIES)) ? readConfig<KnipEntries>(root, KNIP_ENTRIES, 'knip-entries.schema.json') : undefined;
}

/** The fields of knip.json that knipArguments extends; it keeps the others as they are. */
interface KnipJson {
  node?: { entry?: string[] };
  ignoreBinaries?: string[];
  ignoreDependencies?: string[];
  ignore?: string[];
  workspaces?: Record<string, unknown>;
}

/** The knip configuration of a repository with entries of its own: knip.json with those entries, written by lintSteps. */
export const MERGED_KNIP = 'var/lint-ts/knip.json';

/**
 * The arguments of knip for `root`: knip.json alone, or, when the repository declares config/knip-entries.json, the
 * configuration of MERGED_KNIP, which this function writes: knip.json with the declared entries after its own `node.entry`,
 * the declared binaries after its own `ignoreBinaries`, the declared root dependencies after its own `ignoreDependencies`,
 * the declared ignored files after its own `ignore`,
 * and each declared workspace with its entries and ignored dependencies.
 */
export function knipArguments(root: string): string[] {
  const value = knipEntries(root);
  if (!value) return ['--no-progress'];
  const base = readConfig<KnipJson>(root, 'knip.json', 'knip.schema.json');
  const merged = { ...base };
  if (value.entries) merged.node = { ...base.node, entry: [...(base.node?.entry ?? []), ...Object.keys(value.entries)] };
  if (value.binaries) merged.ignoreBinaries = [...(base.ignoreBinaries ?? []), ...Object.keys(value.binaries)];
  if (value.ignoreDependencies) {
    merged.ignoreDependencies = [...(base.ignoreDependencies ?? []), ...Object.keys(value.ignoreDependencies)];
  }
  if (value.ignore) merged.ignore = [...(base.ignore ?? []), ...Object.keys(value.ignore)];
  if (value.workspaces) {
    const workspaces = Object.entries(value.workspaces).map(([directory, { entries, ignoreDependencies }]) => [directory, {
      ...(entries ? { entry: Object.keys(entries) } : {}),
      ...(ignoreDependencies ? { ignoreDependencies: Object.keys(ignoreDependencies) } : {}),
    }] as const);
    merged.workspaces = { ...base.workspaces, ...Object.fromEntries(workspaces) };
  }
  writeJson(path.join(root, MERGED_KNIP), merged);
  return ['--no-progress', '--config', MERGED_KNIP];
}

/**
 * The arguments of oxlint that leave out the copies of kit in `root`: one `--ignore-pattern` for each file of `kit.copies` of
 * the installed package, the record that kit-sync writes and kit-check compares; none in kit itself, which lints its sources.
 * A pattern of a configuration file is rooted at the directory of that file, so the copies, outside var/lint-ts, are given on
 * the command line. Throws when the installed package is not the version that package-lock.json resolves.
 */
export function kitCopyIgnores(root: string): string[] {
  if (isSource(root)) return [];
  const kit = installedKit(root);
  if ('finding' in kit) throw new ConfigError(kit.finding);
  return kit.copies.map(({ file }) => `--ignore-pattern=/${file}`);
}

/**
 * The arguments of oxlint that leave out the files that `ignore` of config/knip-entries.json declares, which are not code of
 * the repository: one `--ignore-pattern` for each glob, rooted at the root, on the command line for the reason of
 * kitCopyIgnores, so that one declaration keeps them out of oxlint and knip.
 */
function declaredIgnores(root: string): string[] {
  return Object.keys(knipEntries(root)?.ignore ?? {}).map(glob => `--ignore-pattern=/${glob}`);
}

/** The steps of the lint of `root`; throws when a tool or a configuration is missing. */
export function lintSteps(root: string): LintStep[] {
  const tools = lintCommands(root, 'node_modules/.bin', ['oxlint', 'knip', 'api-extractor'], 'run npm ci');
  requireConfigurations(root, [['.oxlintrc.json', 'oxlint'], ['knip.json', 'knip']]);
  const packages = foldersOf(root, 'api-extractor.json');
  return [
    // The unix format names the file, line, column and rule of each finding on one line; oxlint picks the github format under CI, whose annotations
    // leave the rule out, so the format is fixed and the output is the same everywhere.
    { label: 'oxlint', command: present(tools.oxlint, 'tools.oxlint'), args: ['--type-aware', '--deny-warnings', '--format', 'unix', '-c', '.oxlintrc.json', ...kitCopyIgnores(root), ...declaredIgnores(root)], cwd: '.' },
    { label: 'knip', command: present(tools.knip, 'tools.knip'), args: knipArguments(root), cwd: '.' },
    ...packages.map(folder => ({ label: `api-extractor ${folder}`, command: present(tools['api-extractor'], 'tools[\'api-extractor\']'), args: ['run'], cwd: folder })),
  ];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-ts', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-ts', lintSteps);
