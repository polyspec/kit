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
// The command runs the download in a process of its own (K173), whose process group it kills once the download settles.
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import util from '@vscode/test-electron/out/util.js';
import { readNpmManifestFile } from './manifests.mts';
import { isMain } from './paths.mts';
import { present } from './present.mts';

// The file that @vscode/test-electron writes into a copy after its last file.
const COMPLETE = 'is-complete';
const RANGE = /^\^(\d+\.\d+\.\d+)$/;
// The argument by which the command runs one downloadAndUnzipVSCode in its own process: --download <version> <platform> <cachePath>.
const DOWNLOAD = '--download';

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

/** The result that the download process sends to the install: the executable, or the message of the failure. */
type Settled = { executable: string } | { error: string };

const isSettled = (message: unknown): message is Settled =>
  typeof message === 'object' && message !== null && (typeof (message as { executable?: unknown }).executable === 'string' || typeof (message as { error?: unknown }).error === 'string');

/**
 * downloadAndUnzipVSCode in a process of its own. @vscode/test-electron 3.1.0 pipes a .tar.gz download into a
 * `tar -xzf -` child and neither ends nor kills that child when the response fails ("aborted"): the child waits on its
 * input and keeps the event loop alive after a retry succeeds, so the install never exited (K173). The download process
 * leads its own process group, which is killed once the download has settled, so a tar that it left ends with it; it
 * ends itself when the install goes away first. A failed download fails with its error.
 */
export const downloadInOwnProcess: Download = (options) =>
  new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [DOWNLOAD, options.version, options.platform, options.cachePath], { detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let settled: Settled | undefined;
    child.on('message', (message: unknown) => {
      if (!isSettled(message)) return;
      settled = message;
      // The group is the download process and every child that it started; a negative pid names the group.
      process.kill(-present(child.pid, 'child.pid'), 'SIGKILL');
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (settled === undefined) reject(new Error(`the download process of VS Code ${options.version} ended with ${code ?? signal} before its result`));
      else if ('executable' in settled) resolve(settled.executable);
      else reject(new Error(settled.error));
    });
  });

/** The download process: runs downloadAndUnzipVSCode with `options` and sends its result to the install. */
async function downloadProcess(options: Parameters<Download>[0]): Promise<void> {
  // The install went away (an interrupt reaches the group of the install, not this one): the download ends too.
  process.on('disconnect', () => process.exit(1));
  const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
  let settled: Settled;
  try {
    settled = { executable: await downloadAndUnzipVSCode(options) };
  } catch (error) {
    settled = { error: error instanceof Error ? error.message : String(error) };
  }
  // fork gave this process its channel to the install.
  if (process.send === undefined) throw new Error(`${DOWNLOAD} runs in a process that the install forked`);
  process.send(settled);
}

if (isMain(import.meta.url)) {
  const [first, ...rest] = process.argv.slice(2);
  const [version, platform, cachePath, ...extra] = rest;
  if (first === DOWNLOAD && version !== undefined && platform !== undefined && cachePath !== undefined && extra.length === 0) {
    await downloadProcess({ version, platform, cachePath });
  } else if (first === undefined || first === DOWNLOAD || rest.length !== 1) {
    console.error('usage: node scripts/kit/install-vscode.mts <extension package directory> <tools directory>');
    process.exit(2);
  } else {
    await installVSCode(first, present(rest[0], 'rest[0]'), downloadInOwnProcess);
  }
}
