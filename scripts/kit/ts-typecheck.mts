// The type-check of the TypeScript of a checkout (K309): vitest and node transpile without checking the types, so a type error
// reached CI before. `tsc --noEmit -p <folder>/tsconfig.json` of each tsconfig.json that a TypeScript file lies below runs in the
// lint-ts gate (a gate of kit-gates), and in the local commit path (`make commit`, `make item-test`) for the owning tsconfig of each
// changed TypeScript file, so a type error is refused before the commit.
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';
import { git } from './git.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { execute } from './process.mts';
import { checkedFiles } from './tracked-files.mts';

/** A TypeScript source file. */
export const TYPESCRIPT = /\.[cm]?tsx?$/;

/** The tsc of the checkout; throws with the fix when it is not installed. */
export function tscOf(root: string): string {
  const tsc = path.join(root, 'node_modules/.bin/tsc');
  if (!existsSync(tsc)) throw new Error('node_modules/.bin/tsc is missing; run npm ci (typescript is a dependency of the checkout)');
  return tsc;
}

/** The folders of `files` that hold a tsconfig.json with a TypeScript file below it, relative to the root, sorted. */
export function tsconfigFolders(files: readonly string[]): string[] {
  const sources = files.filter(file => TYPESCRIPT.test(file) && !file.endsWith('.d.ts'));
  return files.filter(file => path.posix.basename(file) === 'tsconfig.json').map(file => path.posix.dirname(file))
    .filter(folder => sources.some(source => folder === '.' || source.startsWith(`${folder}/`))).sort();
}

/** The deepest folder of `folders` that holds `file`, or undefined. */
export const owningFolder = (folders: readonly string[], file: string): string | undefined =>
  folders.filter(folder => folder === '.' || file.startsWith(`${folder}/`)).sort((a, b) => b.length - a.length)[0];

/** The files that differ from the last commit in the working tree of `root`: staged, modified and new, relative to the root. */
export function changedFiles(root: string): string[] {
  return git(root, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).map(line => line.slice(3).split(' -> ').pop() ?? '');
}

/**
 * The tsconfig folders to check for `changed` files: the owning folder of each changed TypeScript file, once. A changed file below no
 * tsconfig.json has no project to check and is not an error.
 */
export function foldersOfChanged(root: string, changed: readonly string[]): string[] {
  const folders = tsconfigFolders(checkedFiles(root));
  return [...new Set(changed.filter(file => TYPESCRIPT.test(file)).flatMap((file) => { const folder = owningFolder(folders, file); return folder === undefined ? [] : [folder]; }))].sort();
}

/**
 * Builds the workspace packages that the tsc output says it cannot find (TS2307 Cannot find module '<name>'): a name that
 * node_modules resolves to a folder with a package.json that has a build script is built there with npm run build. Returns the number
 * of packages built; throws when a build fails, naming it.
 */
function builtFor(root: string, output: string, env: NodeJS.ProcessEnv): number {
  const names = [...new Set([...output.matchAll(/Cannot find module '([^']+)'/g)].map(match => match[1] ?? ''))].filter(name => name !== '' && !name.startsWith('.') && !name.startsWith('node:'));
  let built = 0;
  for (const name of names) {
    const folder = path.join(root, 'node_modules', ...name.split('/'));
    if (!existsSync(path.join(folder, 'package.json'))) continue;
    const manifest = readJsonObject(path.join(folder, 'package.json'));
    if (!isJsonObject(manifest.scripts) || typeof manifest.scripts.build !== 'string') continue;
    const result = execute('npm', ['run', 'build'], { cwd: realpathSync(folder), env });
    if (result.error || result.status !== 0) throw new Error(`npm run build of ${name} failed: ${result.error?.message ?? `${result.stdout}${result.stderr}`.trim()}`);
    built += 1;
  }
  return built;
}

/** Runs `tsc --noEmit -p` in each of `folders` and returns the failures with the output of tsc. */
export function typeErrors(root: string, folders: readonly string[]): { folder: string; output: string }[] {
  if (folders.length === 0) return [];
  const tsc = tscOf(root);
  const failures: { folder: string; output: string }[] = [];
  const env = toolsEnvironment(root);
  const compile = (folder: string) => execute(tsc, ['--noEmit', '-p', 'tsconfig.json'], { cwd: path.join(root, folder), env });
  for (const folder of folders) {
    let result = compile(folder);
    if (result.error) throw new Error(`tsc could not start in ${folder}: ${result.error.message}`);
    // A workspace package that is not built has no declarations yet (K353): build the ones tsc cannot find, once each, and compile again.
    const missing = builtFor(root, `${result.stdout}${result.stderr}`, env);
    if (result.status !== 0 && missing > 0) result = compile(folder);
    if (result.status !== 0) failures.push({ folder, output: `${result.stdout}${result.stderr}`.trim() });
  }
  return failures;
}

/** The message that refuses a commit or an item test for `failures`, or undefined when there are none. */
export const typeErrorMessage = (failures: readonly { folder: string; output: string }[]): string | undefined =>
  failures.length === 0 ? undefined : failures.map(({ folder, output }) => `tsc --noEmit -p ${path.posix.join(folder, 'tsconfig.json')} failed:\n${output}`).join('\n');
