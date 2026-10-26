// The build state of a provider of the local links (docs/operations/local-links.md). link never builds: a provider repository
// is built by `link.mjs rebuild <repository>` or its own target, with the targets of its own Makefile that its release
// builds before packing (the prerequisites of release-assets), else its build target, else none (its packages ship their
// sources), and a build never links. After a rebuild, the content digest of each npm
// package's build inputs is recorded in var/link/built/ of the provider. A linked npm package is STALE while an output that
// its package.json names is missing, or an input is newer than the oldest output and the inputs differ from that record (a
// touch, or a build cache that keeps unchanged output, is no staleness).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isJsonObject, readJsonObject, writeAtomic } from './bootstrap/files.mts';
import { assertIgnored, EXCLUDED, foreignEnvironment, linkGit, MANIFESTS, trackedManifests } from './link-providers.mts';
import { execute } from './process.mts';

/** The prerequisites of `target` in the Makefile of `repository`, or undefined when make reports no rule for it (make -pq). */
function prerequisites(repository: string, target: string): string[] | undefined {
  const outcome = execute('make', ['-C', repository, '-pq', target], { env: foreignEnvironment() });
  if (outcome.error) throw new Error(`make could not start in ${repository}: ${outcome.error.message}`);
  if (outcome.status === 2) {
    // Only the target itself is missing, not a prerequisite; GNU make uses a backtick or single quote to open the name.
    if (new RegExp(`No rule to make target ['\`]${RegExp.escape(target)}'\\.`).test(outcome.stderr)) return undefined;
    throw new Error(`make -pq ${target} failed in ${repository}: ${outcome.stderr.trim()}`);
  }
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
  const outcome = linkGit(folder, 'ls-files', '-z', '--', '.');
  if (outcome.error || outcome.status !== 0) throw new Error(`git ls-files failed in ${folder}: ${outcome.error?.message ?? outcome.stderr.trim()}`);
  return outcome.stdout.split('\0').filter(Boolean).map(file => path.join(folder, file));
}

/** The build inputs of the package `folder`: its tracked files under src/ or scripts/, else those outside tests and docs. */
function inputs(folder: string, files: readonly string[]): string[] {
  const relative = (file: string) => path.relative(folder, file);
  const sources = files.filter(file => /^(src|scripts)\//.test(relative(file)));
  return (sources.length ? sources : files.filter(file => !/^(tests?|docs)\/|\.md$/.test(relative(file)))).filter(file => existsSync(file)).sort();
}

/** The sha256 of the names and contents of the build inputs of the package `folder`. */
function digest(folder: string): string {
  const hash = createHash('sha256');
  for (const file of inputs(folder, trackedFiles(folder))) hash.update(path.relative(folder, file)).update(readFileSync(file));
  return hash.digest('hex');
}

/** The record of the last rebuild of the package `folder` of `repository`. */
const recordFile = (repository: string, folder: string): string =>
  path.join(repository, 'var/link/built', `${path.relative(repository, folder).replaceAll('/', '_') || 'root'}.sha256`);

/** Builds `repository` with its build targets and records the input digest of each npm package. */
export function rebuild(repository: string, print: (text: string) => void, env: NodeJS.ProcessEnv = process.env): void {
  const targets = buildTargets(repository);
  if (!targets.length) { print(`  rebuild    ${repository}: no build target; its packages ship their sources`); return; }
  print(`  rebuild    ${repository}: make ${targets.join(' ')}`);
  const outcome = execute('make', ['-C', repository, '--no-print-directory', ...targets], { env: foreignEnvironment(env) });
  if (outcome.error || outcome.status !== 0) throw new Error(`the build of the provider ${repository} (make ${targets.join(' ')}) failed: ${outcome.error?.message ?? `${outcome.stdout}${outcome.stderr}`.trim().split('\n').slice(-20).join('\n')}`);
  for (const file of trackedManifests(repository, [MANIFESTS.npm])) {
    if (EXCLUDED.test(file)) continue;
    const folder = path.join(repository, path.dirname(file));
    const record = recordFile(repository, folder);
    assertIgnored(record);
    writeAtomic(record, digest(folder));
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
  const manifest = readJsonObject(folder, MANIFESTS.npm);
  const files = trackedFiles(folder);
  const named = new Set(strings([manifest.main, manifest.types, manifest.bin, manifest.exports]).filter(file => !file.includes('*')).map(file => path.join(folder, file)));
  const outputs = [...named].filter(file => !files.includes(file)).sort();
  if (!outputs.length) return 'source';
  const missing = outputs.find(file => !existsSync(file));
  if (missing) return `stale (missing ${path.relative(folder, missing)})`;
  const mtime = (file: string) => statSync(file).mtimeMs;
  const sources = inputs(folder, files);
  if (!sources.length) return 'fresh';
  const newest = sources.reduce((a, b) => (mtime(b) > mtime(a) ? b : a));
  const oldest = outputs.reduce((a, b) => (mtime(b) < mtime(a) ? b : a));
  const record = recordFile(repository, folder);
  const built = existsSync(record) ? readFileSync(record, 'utf8') : undefined;
  if (mtime(newest) > mtime(oldest) && built !== digest(folder)) return `stale (${path.relative(folder, newest)} is newer than ${path.relative(folder, oldest)})`;
  return 'fresh';
}
