#!/usr/bin/env node
// A temporary directory for tests that require distinct names to remain distinct when their spelling differs by case.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { interruptionStatus, runCommand, withCommandResources, type CleanupCommand } from './run-command.mts';

type CommandResult = { status: number | null; signal?: string | null; error?: Error | undefined; stdout?: string; stderr?: string };
type Command = (file: string, args: string[], runner: CleanupCommand) => CommandResult | Promise<CommandResult>;

function admitWork(): void {
  if (interruptionStatus() !== undefined) throw new Error('case-sensitive directory work stopped because the harness was interrupted');
}

async function run(file: string, args: string[], command: Command, runner: CleanupCommand = runCommand): Promise<string> {
  if (runner === runCommand) admitWork();
  const result = await command(file, args, runner);
  if (result.error || result.status !== 0) {
    const output = [result.stderr, result.stdout].map(text => (text ?? '').trim()).filter(Boolean).join('\n');
    const detail = result.error?.message ?? (result.signal ? `signal ${result.signal}` : String(result.status));
    throw new Error(`${file} ${args.join(' ')} failed (${detail})${output ? `: ${output}` : ''}`);
  }
  return result.stdout ?? '';
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

/** Await `action` with an empty, verified case-sensitive directory, and await resource cleanup before returning. */
export async function withCaseSensitiveDirectory<T>(key: string, action: (directory: string) => T | Promise<T>, options: { platform?: NodeJS.Platform; parent?: string; command?: Command; verify?: (directory: string) => void } = {}): Promise<T> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid environment variable name ${JSON.stringify(key)}`);
  const platform = options.platform ?? process.platform;
  const command: Command = options.command ?? ((file, args, runner) => runner({ command: file, args, stdout: 'pipe', stderr: 'pipe' }));
  let parent: string | undefined;
  let directory: string | undefined;
  let separateMountpoint = false;
  let attachAttempted = false;
  let environmentSet = false;
  let previous: string | undefined;
  return withCommandResources(async () => {
    parent = mkdtempSync(path.join(options.parent ?? tmpdir(), 'kit-case-sensitive-'));
    directory = path.join(parent, 'directory');
    if (platform === 'darwin') {
      // TMPDIR can select image storage on a noowners volume. Only the empty native mountpoint uses owner-aware storage.
      const native = (await run('getconf', ['DARWIN_USER_TEMP_DIR'], command)).trim();
      if (!path.isAbsolute(native)) throw new Error('getconf DARWIN_USER_TEMP_DIR must report a nonempty absolute directory');
      admitWork();
      directory = mkdtempSync(path.join(native, 'kit-case-mount-'));
      separateMountpoint = true;
    } else {
      mkdirSync(directory);
    }
    // Creating a directory on Linux's supported CI filesystems is sufficient; verification catches an unusual case-folding mount.
    if (platform === 'win32') {
      // NTFS stores case sensitivity on a directory. fsutil is the Windows-native interface; unsupported filesystems fail here.
      const fsutil = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'fsutil.exe') : 'fsutil.exe';
      await run(fsutil, ['file', 'setCaseSensitiveInfo', directory, 'enable'], command);
    } else if (platform === 'darwin') {
      const image = path.join(parent, 'case-sensitive.dmg');
      await run('hdiutil', ['create', '-size', '64m', '-fs', 'Case-sensitive APFS', '-volname', 'kit-case', '-ov', image], command);
      // A failed attach may still have mounted the image. Always try to detach after starting it, and retain the
      // mountpoint and image if detachment cannot prove that they are safe to remove.
      admitWork();
      attachAttempted = true;
      await run('hdiutil', ['attach', '-nobrowse', '-mountpoint', directory, image], command);
    } else if (platform !== 'linux') {
      throw new Error(`case-sensitive test directories are not supported on ${platform}`);
    }
    admitWork();
    (options.verify ?? verify)(directory);
    previous = process.env[key];
    process.env[key] = directory;
    environmentSet = true;
    return await action(directory);
  }, async cleanupRunner => {
    if (environmentSet) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    const cleanupFailures: Error[] = [];
    let retainResources = false;
    if (attachAttempted && directory !== undefined) {
      try {
        await run('hdiutil', ['detach', directory], command, cleanupRunner);
      } catch (error) {
        retainResources = true;
        cleanupFailures.push(new Error(
          `could not confirm detachment of ${directory} (${error instanceof Error ? error.message : String(error)}); retained the mountpoint and image: mountpoint ${directory}; image storage ${parent}. Fix: run hdiutil detach ${JSON.stringify(directory)}, then remove ${JSON.stringify(directory)} and ${JSON.stringify(parent)}`,
          { cause: error },
        ));
      }
    }
    if (!retainResources && parent !== undefined) {
      for (const resource of separateMountpoint && directory !== undefined ? [directory, parent] : [parent]) {
        try {
          rmSync(resource, { recursive: true, force: true });
        } catch (error) {
          cleanupFailures.push(new Error(`could not remove temporary test resources at ${resource}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
        }
      }
    }
    if (cleanupFailures.length === 1) throw cleanupFailures[0];
    if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, cleanupFailures.map(error => error.message).join('; '));
  });
}
