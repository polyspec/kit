#!/usr/bin/env node
// A temporary directory for tests that require distinct names to remain distinct when their spelling differs by case.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type Command = (file: string, args: string[]) => { status: number | null; error?: Error; stdout?: string; stderr?: string };

function run(file: string, args: string[], command: Command): void {
  const result = command(file, args);
  if (result.error || result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ` (${result.status}): ${(result.stderr ?? result.stdout ?? '').trim()}`}`);
  }
}

function verify(directory: string): void {
  const upper = path.join(directory, 'KitCaseProbe');
  const lower = path.join(directory, 'kitcaseprobe');
  writeFileSync(upper, 'upper');
  try {
    if (existsSync(lower)) throw new Error(`${directory} folds case`);
    writeFileSync(lower, 'lower');
    if (existsSync(upper) !== true || existsSync(lower) !== true) throw new Error(`${directory} does not retain both case-distinct files`);
  } finally {
    rmSync(upper, { force: true });
    rmSync(lower, { force: true });
  }
}

/** Run `action` with an empty, verified case-sensitive directory under the caller-selected environment key. */
export function withCaseSensitiveDirectory<T>(key: string, action: (directory: string) => T, options: { platform?: NodeJS.Platform; parent?: string; command?: Command; verify?: (directory: string) => void } = {}): T {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid environment variable name ${JSON.stringify(key)}`);
  const platform = options.platform ?? process.platform;
  const command = options.command ?? ((file, args) => spawnSync(file, args, { encoding: 'utf8' }));
  const parent = mkdtempSync(path.join(options.parent ?? tmpdir(), 'kit-case-sensitive-'));
  const directory = path.join(parent, 'directory');
  mkdirSync(directory);
  let attachAttempted = false;
  let outcome: { kind: 'value'; value: T } | { kind: 'error'; error: unknown };
  try {
    // Creating a directory on Linux's supported CI filesystems is sufficient; verification catches an unusual case-folding mount.
    if (platform === 'win32') {
      // NTFS stores case sensitivity on a directory. fsutil is the Windows-native interface; unsupported filesystems fail here.
      const fsutil = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'fsutil.exe') : 'fsutil.exe';
      run(fsutil, ['file', 'setCaseSensitiveInfo', directory, 'enable'], command);
    } else if (platform === 'darwin') {
      const image = path.join(parent, 'case-sensitive.dmg');
      run('hdiutil', ['create', '-size', '64m', '-fs', 'Case-sensitive APFS', '-volname', 'kit-case', '-ov', image], command);
      // A failed attach may still have mounted the image. Always try to detach after starting it, and retain the
      // mountpoint and image if detachment cannot prove that they are safe to remove.
      attachAttempted = true;
      run('hdiutil', ['attach', '-nobrowse', '-mountpoint', directory, image], command);
    } else if (platform !== 'linux') {
      throw new Error(`case-sensitive test directories are not supported on ${platform}`);
    }
    (options.verify ?? verify)(directory);
    const previous = process.env[key];
    process.env[key] = directory;
    try {
      outcome = { kind: 'value', value: action(directory) };
    } catch (error) {
      outcome = { kind: 'error', error };
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  } catch (error) {
    outcome = { kind: 'error', error };
  }

  let cleanupFailure: Error | undefined;
  let retainResources = false;
  if (attachAttempted) {
    try {
      run('hdiutil', ['detach', directory], command);
    } catch (error) {
      retainResources = true;
      cleanupFailure = new Error(
        `could not confirm detachment of ${directory}; retained the mountpoint and image at ${parent}. Fix: run hdiutil detach ${JSON.stringify(directory)}, then remove ${JSON.stringify(parent)}`,
        { cause: error },
      );
    }
  }
  if (!retainResources) {
    try {
      rmSync(parent, { recursive: true, force: true });
    } catch (error) {
      cleanupFailure = new Error(`could not remove temporary test resources at ${parent}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  if (outcome.kind === 'error' && cleanupFailure) throw new AggregateError([outcome.error, cleanupFailure], `${String(outcome.error)}; cleanup also failed: ${cleanupFailure.message}`);
  if (outcome.kind === 'error') throw outcome.error;
  if (cleanupFailure) throw cleanupFailure;
  return outcome.value;
}
