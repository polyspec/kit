#!/usr/bin/env node
// Lints the TypeScript of the checkout with the oxlint, knip and API Extractor dependencies of the installed kit package (`make lint-ts`):
//   - `oxlint` on the checkout, which reads the .oxlintrc.json of the repository (K1050), its `options.typeAware` included;
//     oxlint reads the files that Git does not ignore, and oxlint-tsgolint, whose bin directory the step puts on PATH, checks
//     the rules that need the types of TypeScript 7. Every file of the repository is its own, so oxlint lints each one
//     (K1052).
//   - `knip`, the files, exports and dependencies that nothing uses, from the root, which reads the knip.json of the
//     repository (K1050). knip's Svelte plugin compiles the .svelte files of a workspace that depends on svelte.
//   - `api-extractor run` for each package with an api-extractor.json, which extends config/api-extractor.kit.json: every export
//     is documented and reachable, and the public API equals the committed API report. It reads the .d.ts that the build of
//     the package wrote.
// A missing tool is a failure with its fix, never a skip; lint-steps.mts runs the steps.
//
//   node scripts/kit/lint-ts.mts
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';
import { foldersOf, lintMain, runLint } from './lint-steps.mts';
import type { LintStep } from './lint-steps.mts';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { isSource } from './kit-check.mts';
import { present } from './present.mts';
import { checkedFiles } from './tracked-files.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { checkerOf, tsconfigFolders } from './ts-typecheck.mts';

/** Resolve a declared lint dependency through Node's native package lookup, including linked providers and hoisted installs. */
function lintDependency(provider: string, name: string, binary: string): { command: string; binDirectory: string } {
  const manifest = findPackageJSON(name, pathToFileURL(path.join(provider, 'package.json')));
  if (manifest === undefined) throw new Error(`${name} is missing from the kit installation; run npm ci in the provider`);
  const bin = readJsonObject(manifest).bin;
  const entry = typeof bin === 'string' ? bin : isJsonObject(bin) ? bin[binary] : undefined;
  if (typeof entry !== 'string') throw new Error(`${name} declares no ${binary} executable; reinstall the kit dependencies`);
  const command = path.resolve(path.dirname(manifest), entry);
  if (!existsSync(command)) throw new Error(`${command} is missing; run npm ci in the provider`);
  const modules = path.resolve(path.dirname(manifest), ...name.split('/').map(() => '..'));
  return { command, binDirectory: path.join(modules, '.bin') };
}

/** The steps of the lint of `root`; throws when a tool is missing. */
export function lintSteps(root: string): LintStep[] {
  const provider = isSource(root) ? root : realpathSync(path.join(root, 'node_modules/@polyspec/kit'));
  const tools = Object.fromEntries(Object.entries({ oxlint: 'oxlint', knip: 'knip', 'api-extractor': '@microsoft/api-extractor' })
    .map(([binary, name]) => [binary, lintDependency(provider, name, binary).command]));
  const backend = lintDependency(provider, 'oxlint-tsgolint', 'tsgolint');
  const env = { PATH: [backend.binDirectory, toolsEnvironment(root).PATH ?? ''].join(path.delimiter) };
  const packages = foldersOf(root, 'api-extractor.json');
  return [
    // The unix format names the file, line, column and rule of each finding on one line; oxlint picks the github format under CI, whose annotations
    // leave the rule out, so the format is fixed and the output is the same everywhere.
    { label: 'oxlint', env, command: present(tools.oxlint, 'tools.oxlint'), args: ['--format', 'unix'], cwd: '.' },
    { label: 'knip', command: present(tools.knip, 'tools.knip'), args: ['--no-progress'], cwd: '.' },
    // The types of each project (K309): the tests transpile without checking them.
    ...tsconfigFolders(checkedFiles(root)).map((folder) => {
      const checker = checkerOf(root, folder);
      return { label: `${checker.command === 'tsc' || checker.args[0] !== 'run' ? 'tsc' : 'typecheck'} ${folder}`, command: checker.command, args: checker.args, cwd: folder };
    }),
    ...packages.map(folder => ({ label: `api-extractor ${folder}`, command: present(tools['api-extractor'], 'tools[\'api-extractor\']'), args: ['run'], cwd: folder })),
  ];
}

/** Runs the steps of `root` and returns the labels of those that failed; the output of each step goes through `print`. */
export function lint(root: string, print: (text: string) => unknown = text => process.stdout.write(text)): string[] {
  return runLint('lint-ts', lintSteps(root), root, print);
}

lintMain(import.meta.url, 'lint-ts', lintSteps);
