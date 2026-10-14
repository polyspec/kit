// The VS Code of an extension's integration test, installed into a tools directory of the checkout:
//
//   node scripts/kit/install-vscode.mts <extension package directory> <tools directory>
//
// The build is the minimum version of engines.vscode (^X.Y.Z) in the package.json of the extension, for the platform of the
// machine, in <tools>/vscode-<platform>-<version>, the layout of @vscode/test-electron (an optional peer dependency of kit:
// a repository that installs VS Code declares it). The repository's install target runs this with the network; its
// integration run reads the copy with installedExecutable and never downloads. An install of a complete copy does nothing.
// @vscode/test-electron downloads into the copy's own directory, so a new copy is downloaded into <tools>/.next-<pid> and
// renamed into place: a reader finds no copy or a complete one, and two installs at once keep the copy of the first.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import util from '@vscode/test-electron/out/util.js';
import { readNpmManifestFile } from './manifests.mts';
import { isMain } from './paths.mts';
import { present } from './present.mts';

// The file that @vscode/test-electron writes into a copy after its last file.
const COMPLETE = 'is-complete';
const RANGE = /^\^(\d+\.\d+\.\d+)$/;

/** downloadAndUnzipVSCode of @vscode/test-electron, with the options that the install passes; it returns the executable. */
export type Download = (options: { version: string; platform: string; cachePath: string }) => Promise<string>;

/** The version, the platform and the directory of the VS Code copy of the extension `extension` in the tools directory `base`. */
export function vscodeCopy(extension: string, base: string, platform: string = util.systemDefaultPlatform): { version: string; platform: string; directory: string } {
  const manifest = path.join(extension, 'package.json');
  const range = readNpmManifestFile(manifest).engines?.vscode;
  const match = typeof range === 'string' ? RANGE.exec(range) : null;
  if (!match) throw new Error(`${manifest}: engines.vscode is ${JSON.stringify(range)}; the install reads the minimum of a range ^X.Y.Z`);
  // RANGE has one group, which matched.
  const version = present(match[1], 'match[1]');
  return { version, platform, directory: path.join(path.resolve(base), `vscode-${platform}-${version}`) };
}

const complete = (directory: string): boolean => existsSync(path.join(directory, COMPLETE));

/** The executable of the installed copy; fails with the fix when the copy is missing or incomplete. Reads no network. */
export function installedExecutable(extension: string, base: string): string {
  const { version, platform, directory } = vscodeCopy(extension, base);
  if (!complete(directory)) throw new Error(`VS Code ${version} is not installed in ${directory}; run make install-vscode`);
  return util.downloadDirToExecutablePath(directory, platform);
}

/** Installs the copy into `base` unless it is complete there, with `download`, and returns its directory. */
export async function installVSCode(extension: string, base: string, download: Download): Promise<string> {
  const { version, platform, directory } = vscodeCopy(extension, base);
  if (complete(directory)) {
    console.log(`[install-vscode] VS Code ${version} is installed in ${directory}`);
    return directory;
  }
  const next = path.join(path.resolve(base), `.next-${process.pid}`);
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  try {
    console.log(`[install-vscode] downloading VS Code ${version} for ${platform} into ${next}`);
    await download({ version, platform, cachePath: next });
    const downloaded = path.join(next, path.basename(directory));
    if (!complete(downloaded)) throw new Error(`the download of VS Code ${version} left no complete copy in ${downloaded}`);
    // A copy without its last file is the remainder of an interrupted install; no reader uses it.
    if (!complete(directory)) rmSync(directory, { recursive: true, force: true });
    try {
      renameSync(downloaded, directory);
    } catch (error) {
      // A concurrent install published its complete copy first; that copy stays.
      if (!complete(directory)) throw error;
    }
    console.log(`[install-vscode] installed VS Code ${version} in ${directory}`);
    return directory;
  } finally {
    rmSync(next, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const [extension, base, ...rest] = process.argv.slice(2);
  if (extension === undefined || base === undefined || rest.length > 0) {
    console.error('usage: node scripts/kit/install-vscode.mts <extension package directory> <tools directory>');
    process.exit(2);
  }
  const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
  await installVSCode(extension, base, downloadAndUnzipVSCode);
}
