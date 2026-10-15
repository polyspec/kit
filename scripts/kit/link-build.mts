// The build of a provider of the local links (docs/plans/local-links.md): a provider repository is built before it is
// linked, with the targets of its own Makefile that its release builds before packing (the prerequisites of
// release-assets), else its build target, else none (its packages ship their sources). After a build, the content digest
// of each npm package's build inputs is recorded in var/link/built/ of the provider, and a linked npm package is stale while
// an output that its package.json names is missing, or an input is newer than the oldest output and the inputs differ
// from that record (a touch, or a build cache that keeps unchanged output, is no staleness).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, writeAtomic } from './bootstrap/files.mts';
import { gitResult } from './git.mts';
import { MANIFESTS, rawManifest, trackedManifests } from './link-providers.mts';
import { execute, run } from './process.mts';

// A package.json outside these folders is a package whose build is recorded.
const NOT_PACKAGE = /(^|\/)(tests?|examples|benchmarks|docs|fixtures?)\//;

/** The prerequisites of `target` in the Makefile of `repository`, or undefined when it has no such target (make -pq). */
function prerequisites(repository: string, target: string): string[] | undefined {
  const outcome = execute('make', ['-C', repository, '-pq', target]);
  if (outcome.status === 2) return undefined;
  const line = outcome.stdout.split('\n').find(text => text.startsWith(`${target}:`) && !text.startsWith(`${target}::`));
  return (line?.slice(target.length + 1).split('|')[0] ?? '').split(/\s+/).filter(Boolean);
}

/** The make targets that build the published packages of `repository`. */
export function buildTargets(repository: string): string[] {
  const released = prerequisites(repository, 'release-assets');
  if (released?.length) return released;
  return prerequisites(repository, 'build') ? ['build'] : [];
}

/** The tracked files of `folder`, absolute. */
function trackedFiles(folder: string): string[] {
  const outcome = gitResult(folder, 'ls-files', '-z', '--', '.');
  return outcome.stdout.split('\0').filter(Boolean).map(file => path.join(folder, file));
}

/** The build inputs of the package `folder`: its tracked files under src/ or scripts/, else those outside tests and docs. */
function inputs(folder: string, files: readonly string[]): string[] {
  const relative = (file: string) => path.relative(folder, file);
  const sources = files.filter(file => /^(src|scripts)\//.test(relative(file)));
  return (sources.length ? sources : files.filter(file => !/^(tests?|docs)\/|\.md$/.test(relative(file)))).sort();
}

/** The sha256 of the names and contents of the build inputs of the package `folder`. */
function digest(folder: string): string {
  const hash = createHash('sha256');
  for (const file of inputs(folder, trackedFiles(folder))) {
    hash.update(path.relative(folder, file));
    if (existsSync(file)) hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

/** The record of the last build of the package `folder` of `repository`. */
const recordFile = (repository: string, folder: string): string =>
  path.join(repository, 'var/link/built', `${path.relative(repository, folder).replaceAll('/', '_') || 'root'}.sha256`);

/** Builds `repository` with its build targets and records the input digest of each of its npm packages. */
export function build(repository: string, print: (text: string) => void): void {
  const targets = buildTargets(repository);
  if (!targets.length) { print(`  build      ${repository}: no build target; its packages ship their sources`); return; }
  print(`  build      ${repository}: make ${targets.join(' ')}`);
  run('make', ['-C', repository, '--no-print-directory', ...targets]);
  for (const file of trackedManifests(repository, [MANIFESTS.npm])) {
    if (NOT_PACKAGE.test(file)) continue;
    const folder = path.join(repository, path.dirname(file));
    writeAtomic(recordFile(repository, folder), digest(folder));
  }
}

/** Every string that `value` holds, at any depth: the paths of package.json main, types, bin and exports. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return isJsonObject(value) ? Object.values(value).flatMap(strings) : [];
}

/** "source", "fresh" or "stale (…)" for the built output of the npm package `folder` of `repository`. */
export function buildState(repository: string, folder: string): string {
  const manifest = rawManifest(path.join(folder, MANIFESTS.npm));
  const files = trackedFiles(folder);
  const named = new Set(strings([manifest.main, manifest.types, manifest.bin, manifest.exports]).filter(file => !file.includes('*')).map(file => path.join(folder, file)));
  const outputs = [...named].filter(file => !files.includes(file)).sort();
  if (!outputs.length) return 'source';
  const missing = outputs.find(file => !existsSync(file));
  if (missing) return `stale (missing ${path.relative(folder, missing)})`;
  const mtime = (file: string) => statSync(file).mtimeMs;
  const sources = inputs(folder, files).filter(file => existsSync(file));
  if (!sources.length) return 'fresh';
  const newest = sources.reduce((a, b) => (mtime(b) > mtime(a) ? b : a));
  const oldest = outputs.reduce((a, b) => (mtime(b) < mtime(a) ? b : a));
  const record = recordFile(repository, folder);
  const built = existsSync(record) ? readFileSync(record, 'utf8') : undefined;
  if (mtime(newest) > mtime(oldest) && built !== digest(folder)) return `stale (${path.relative(folder, newest)} is newer than ${path.relative(folder, oldest)})`;
  return 'fresh';
}
