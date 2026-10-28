// Re-runs the native SDK bootstrap and verifies that its installed tools and wrappers stay byte-for-byte and file-identity stable.
// This runs before npm ci, so it imports only Node.js built-ins and the modules of this directory (K171).
import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileDigest } from './digest.mts';
import { MISE_WRAPPER, miseBinary, miseWhere, nodeBinary, NODE_WRAPPER } from './install-mise.mts';
import { declaredToolchain } from './toolchain-declared.mts';
import { commandPath, toolsPath } from './tool-wrappers.mts';

export type InstalledFile = {
  name: string;
  path: string;
  realPath: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
  mode: number;
};

/** Captures each named installed file's content, timestamp and filesystem identity. */
export function snapshotFiles(files: Readonly<Record<string, string>>): InstalledFile[] {
  return Object.entries(files).sort(([left], [right]) => left.localeCompare(right)).map(([name, file]) => {
    const info = statSync(file);
    if (!info.isFile()) throw new Error(`${file} is not a regular installed file`);
    return {
      name,
      path: path.resolve(file),
      realPath: realpathSync(file),
      sha256: fileDigest(file),
      size: info.size,
      mtimeMs: info.mtimeMs,
      dev: info.dev,
      ino: info.ino,
      mode: info.mode,
    };
  });
}

/** Names installed files whose content, timestamp or identity changed between snapshots. */
export function changedFiles(before: readonly InstalledFile[], after: readonly InstalledFile[]): string[] {
  const oldFiles = new Map(before.map(file => [file.name, file]));
  const newFiles = new Map(after.map(file => [file.name, file]));
  return [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter(name => JSON.stringify(oldFiles.get(name)) !== JSON.stringify(newFiles.get(name))).sort();
}

function installedFiles(root: string): Record<string, string> {
  const nodeDirectory = miseWhere(root, 'node');
  const npm = toolsPath(root, 'npm', 'node_modules', 'npm');
  return {
    'mise binary': miseBinary(toolsPath(root, 'mise-release')),
    'mise wrapper': commandPath(root, MISE_WRAPPER),
    'node binary': nodeBinary(nodeDirectory),
    'node wrapper': commandPath(root, NODE_WRAPPER),
    'npm package metadata': path.join(npm, 'package.json'),
    'npm command': path.join(npm, 'bin', 'npm-cli.js'),
    'npm wrapper': commandPath(root, 'npm'),
    'npx wrapper': commandPath(root, 'npx'),
  };
}

function runBootstrap(root: string): Promise<void> {
  const script = path.join(root, 'scripts/kit/bootstrap/bootstrap.mts');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: root, stdio: 'inherit' });
    child.once('error', error => reject(new Error(`the repeated bootstrap could not start: ${error.message}`, { cause: error })));
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`the repeated bootstrap ended with ${signal === null ? `exit status ${String(code)}` : `signal ${signal}`}`));
    });
  });
}

/** Re-runs bootstrap with its native output visible and refuses any change to the installed SDK files. */
export async function verifyBootstrapIdempotent(root: string, print: (text: string) => void = console.log): Promise<void> {
  const { mise, npm } = declaredToolchain(root);
  if (!mise || !npm) throw new Error('config/toolchain.json and package.json must declare mise and npm before bootstrap idempotence can be checked');
  const before = snapshotFiles(installedFiles(root));
  print('repeat the native mise, Node.js, and npm bootstrap');
  await runBootstrap(root);
  const after = snapshotFiles(installedFiles(root));
  const changed = changedFiles(before, after);
  if (changed.length) throw new Error(`the repeated bootstrap changed installed SDK files: ${changed.join(', ')}`);
  print('the installed mise, Node.js, npm, and wrappers are unchanged');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await verifyBootstrapIdempotent(process.cwd(), text => console.log(`[bootstrap-idempotence] ${text}`));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[bootstrap-idempotence] ${error.message}`);
    process.exitCode = 1;
  }
}
