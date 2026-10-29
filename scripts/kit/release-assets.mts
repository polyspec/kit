#!/usr/bin/env node
// The release archives of other repositories that this repository uses (config/release-assets.json, schema
// scripts/kit/schema/release-assets.schema.json): each entry pins one archive by its version, URL and sha256.
//
//   node scripts/kit/release-assets.mts fetch            download each archive whose destination lacks its sha256, then
//                                                        extract each zip that declares `unpack`; make release-assets-fetch
//   node scripts/kit/release-assets.mts version <name>   print the version of the entry <name>, which a Makefile reads
//
// The version is declared once, in the entry; `{version}` of its url stands for it. The destination of an archive is its
// `directory` and the last path segment of its URL, and both the destination and `unpack` are directories under var/ that
// Git ignores. `fetch` is the one step that reads the network (Node fetch), and belongs to the install of a repository: it
// keeps a destination that already holds the sha256, refuses a download with another sha256, and writes through
// <destination>.next-<pid> and a rename. An unpacked directory records the sha256 of its archive in UNPACKED_MARK, and
// is extracted again only when the archive changed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileDigest, sha256 } from './bootstrap/digest.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { installOnce } from './bootstrap/install-tool.mts';
import { gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { run, Stop } from './process.mts';
import { readConfigFindings } from './schema-validate.mts';
import { present } from './present.mts';

export const CONFIG = 'config/release-assets.json';
/** The file in an unpacked directory that holds the sha256 of the archive it was extracted from. */
export const UNPACKED_MARK = '.release-asset.sha256';
export const FIX = 'run make release-assets-fetch, which downloads the archives of config/release-assets.json';

/** An entry of config/release-assets.json as its schema declares it. */
type Entry = { name: string; version: string; url: string; sha256: string; directory: string; unpack?: string };
/** An entry with its URL resolved and its destination, a path from the root. */
export type ReleaseAsset = { name: string; version: string; url: string; sha256: string; destination: string; unpack?: string };

/** The fetch of Node, or a stub of it in a test. */
type Fetch = (url: string) => Promise<Response>;

/**
 * Whether Git ignores `folder` of `root`: the folder or one of its ancestors, the shortest first. In a worktree a release archive
 * or an unpack directory is a link to that of the main checkout (K780), and Git names no path beyond a symbolic link (K780-1).
 */
function ignored(root: string, folder: string): boolean {
  const parts = folder.split('/');
  return parts.some((_, index) => gitResult(root, 'check-ignore', '--quiet', '--no-index', parts.slice(0, index + 1).join('/')).status === 0);
}

/**
 * The entries of config/release-assets.json of `root`, each with its URL and destination. Stop with every finding: a
 * schema error, a name or a destination that two entries share, a placeholder other than `{version}`, and a directory
 * that Git does not ignore.
 */
export function releaseAssets(root: string): ReleaseAsset[] {
  if (!existsSync(path.join(root, CONFIG))) throw new Stop(`${CONFIG} is missing; it declares the release archives of other repositories that this repository uses`);
  const { value, errors } = readConfigFindings<{ assets: Entry[] }>(root, CONFIG, 'release-assets.schema.json');
  if (errors) throw new Stop(errors.join('\n'));
  const problems: string[] = [];
  const names = new Set<string>();
  const destinations = new Set<string>();
  const assets = value.assets.map(({ name, version, url: pattern, sha256: digest, directory, unpack }): ReleaseAsset => {
    const url = pattern.replaceAll('{version}', version);
    const destination = `${directory}/${url.slice(url.lastIndexOf('/') + 1)}`;
    if (names.has(name)) problems.push(`${CONFIG}: the name ${name} is declared twice`);
    if (destinations.has(destination)) problems.push(`${CONFIG}: ${name}: the destination ${destination} is the destination of another entry`);
    if (/[{}]/.test(url)) problems.push(`${CONFIG}: ${name}: the url ${pattern} holds a placeholder other than {version}`);
    for (const folder of unpack === undefined ? [directory] : [directory, unpack]) {
      if (!ignored(root, folder)) problems.push(`${CONFIG}: ${name}: ${folder} is not ignored by Git; an archive and its extraction live under the ignored var/`);
    }
    names.add(name);
    destinations.add(destination);
    return { name, version, url, sha256: digest, destination, ...(unpack === undefined ? {} : { unpack }) };
  });
  if (problems.length) throw new Stop(problems.join('\n'));
  return assets;
}

/** The entry `name` of config/release-assets.json of `root`; Stop with the declared names when there is none. */
export function releaseAsset(root: string, name: string): ReleaseAsset {
  const assets = releaseAssets(root);
  const asset = assets.find(item => item.name === name);
  if (!asset) throw new Stop(`${CONFIG} declares no entry ${name}; it declares [${assets.map(item => item.name).join(', ')}]`);
  return asset;
}

/** Whether the destination of `asset` in `root` holds the archive with its sha256. */
const holds = (root: string, asset: ReleaseAsset): boolean => existsSync(path.join(root, asset.destination)) && fileDigest(path.join(root, asset.destination)) === asset.sha256;

/** The absolute path of the archive `name` of `root`, which must hold its sha256; Stop with the fix otherwise. */
export function fetchedAsset(root: string, name: string): string {
  const asset = releaseAsset(root, name);
  if (!holds(root, asset)) throw new Stop(`${asset.destination} does not hold the archive ${asset.name} ${asset.version} with sha256 ${asset.sha256}; ${FIX}`);
  return path.join(root, asset.destination);
}

/** Extracts the zip of `asset` into its `unpack` directory unless that directory records the sha256 of the archive. */
function unpack(root: string, asset: ReleaseAsset & { unpack: string }, print: (text: string) => void): void {
  installOnce({
    root,
    label: `${asset.name} ${asset.version} in ${asset.unpack}`,
    prefix: path.join(root, asset.unpack),
    recorded: asset.sha256,
    installedRelease: directory => (existsSync(path.join(directory, UNPACKED_MARK)) ? readFileSync(path.join(directory, UNPACKED_MARK), 'utf8').trim() : undefined),
    install: (next) => {
      run('unzip', ['-q', path.join(root, asset.destination), '-d', next], { cwd: root });
      writeFileSync(path.join(next, UNPACKED_MARK), `${asset.sha256}\n`);
    },
    print,
  });
}

/**
 * Downloads each archive of config/release-assets.json of `root` whose destination does not hold its sha256, refuses a
 * download with another sha256, and extracts each archive that declares `unpack`. Returns the names of the downloaded
 * archives.
 */
export async function fetchReleaseAssets({ root = repositoryRoot(), fetch = globalThis.fetch, print = () => {} }: { root?: string; fetch?: Fetch; print?: (text: string) => void } = {}): Promise<string[]> {
  const downloaded: string[] = [];
  for (const asset of releaseAssets(root)) {
    if (holds(root, asset)) {
      print(`${asset.destination} holds ${asset.name} ${asset.version} (sha256 ${asset.sha256})`);
    } else {
      print(`downloading ${asset.url}`);
      const response = await fetch(asset.url);
      if (!response.ok) throw new Stop(`the download of ${asset.url} failed with HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== asset.sha256) throw new Stop(`${asset.url} has the sha256 ${actual}, expected ${asset.sha256} of ${asset.name} in ${CONFIG}; nothing was written`);
      writeAtomic(path.join(root, asset.destination), bytes);
      print(`wrote ${asset.destination}`);
      downloaded.push(asset.name);
    }
    if (asset.unpack !== undefined) unpack(root, { ...asset, unpack: asset.unpack }, print);
  }
  return downloaded;
}

const USAGE = 'usage: node scripts/kit/release-assets.mts fetch | version <name>';

/** Runs the command line; the exit status. */
export async function main(argv: string[], { root = repositoryRoot(), fetch = globalThis.fetch, print = console.log, error = console.error }: { root?: string; fetch?: Fetch; print?: (text: string) => void; error?: (text: string) => void } = {}): Promise<number> {
  const [mode, name, ...rest] = argv;
  if (!((mode === 'fetch' && name === undefined) || (mode === 'version' && name !== undefined && rest.length === 0))) {
    error(USAGE);
    return 2;
  }
  try {
    if (mode === 'version') {
      print(releaseAsset(root, present(name, 'name')).version);
    } else {
      const downloaded = await fetchReleaseAssets({ root, fetch, print: text => print(`[release-assets] ${text}`) });
      print(`[release-assets] ${downloaded.length ? `downloaded ${downloaded.join(', ')}` : 'every archive is in place'}`);
    }
  } catch (failure) {
    if (!(failure instanceof Stop)) throw failure;
    error(`[release-assets] ${mode} failed: ${failure.message}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
