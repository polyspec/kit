// The native compiler's exec adapter retains the executable and its invocation without running a test.
// The parity run owns the parent directory and removes it after all bindings finish.
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './paths.mts';
import { parseJson } from './schema-validate.mts';
import { runCommand, type RunCommandResult } from './run-command.mts';

/** The invocation supplied by the native tool, with a binary private to this parity run. */
export interface CapturedExecutable {
  executable: 'test-binary';
  source?: string;
  cwd: string;
  args: string[];
  env: Record<string, string>;
}

export interface NativeExecutionResult extends RunCommandResult {
  execution: { command: string; args: string[]; cwd: string };
}

/** Preserve the actual executable command with every success or failure of its process. */
async function executeNative(execution: NativeExecutionResult['execution'], env: NodeJS.ProcessEnv,
  silenceMs: number, say: (line: string) => void): Promise<NativeExecutionResult> {
  const result = await runCommand({ ...execution, env, stdout: 'pipe', stderr: 'pipe', silenceMs,
    maxOutputBytes: 256 * 1024 * 1024, onLine: (_stream, line) => say(line) });
  return { ...result, execution };
}

/** Execute a Rust artifact with the environment retained from Cargo's native invocation. */
export async function runCargoExecutable(executable: string, invocation: CapturedExecutable,
  selection: readonly string[], silenceMs: number, say: (line: string) => void,
  runner: readonly string[] = []): Promise<NativeExecutionResult> {
  const execution = { command: runner[0] ?? executable,
    args: [...runner.slice(1), ...(runner.length ? [executable] : []), ...invocation.args, ...selection], cwd: invocation.cwd };
  return executeNative(execution, invocation.env, silenceMs, say);
}

/** Execute a copied Go test through its native JSON reporter without invoking the compiler. */
export async function runGoExecutable(go: string, executable: string, invocation: CapturedExecutable,
  selection: readonly string[], silenceMs: number, say: (line: string) => void): Promise<NativeExecutionResult> {
  const execution = { command: go, args: ['tool', 'test2json', '-t', executable, ...selectedGoArguments(invocation, selection)],
    cwd: invocation.cwd };
  return executeNative(execution, invocation.env, silenceMs, say);
}

/** Apply binding selection to Go's translated invocation while retaining its other native flags. */
export function selectedGoArguments(invocation: CapturedExecutable, selection: readonly string[]): string[] {
  const replacements = new Map<string, string>();
  for (let index = 0; index < selection.length; index++) {
    const word = selection[index] ?? '';
    const match = /^-(count|run)(?:=(.*))?$/.exec(word);
    if (!match) throw new Error(`unsupported Go binding selection ${word}; declare only count and run selection flags`);
    const value = match[2] ?? selection[++index];
    if (value === undefined) throw new Error(`Go binding selection ${word} has no value; provide its native filter`);
    replacements.set(`-test.${match[1]}`, value);
  }
  const args: string[] = [];
  for (let index = 0; index < invocation.args.length; index++) {
    const word = invocation.args[index] ?? '';
    const name = word.split('=')[0] ?? '';
    if (replacements.has(name)) {
      if (!word.includes('=')) index++;
    } else args.push(word);
  }
  return [...args, ...[...replacements].map(([name, value]) => `${name}=${value}`)];
}

/** Retain one executable before the native compiler removes its temporary build directory. */
export function captureExecutable(directory: string, executable: string, args: readonly string[],
  { cwd = process.cwd(), env = process.env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const own = mkdtempSync(path.join(directory, 'binary-'));
  try {
    copyFileSync(executable, path.join(own, 'test-binary'));
    const record: CapturedExecutable = { executable: 'test-binary', source: path.resolve(executable), cwd, args: [...args],
      env: Object.fromEntries(Object.entries(env).flatMap(([name, value]) => value === undefined ? [] : [[name, value]])) };
    // Native environments may contain credentials. They stay in this private run directory, never in compiler output.
    writeFileSync(path.join(own, 'invocation.json'), JSON.stringify(record), { mode: 0o600 });
    return path.basename(own);
  } catch (error) {
    rmSync(own, { recursive: true, force: true });
    throw error;
  }
}

/** Read only an invocation inside the current run, never a path supplied by a compiler output line. */
export function readExecutable(directory: string, id: string): CapturedExecutable {
  if (!/^binary-[A-Za-z0-9]+$/.test(id)) throw new Error('invalid parity executable id; run make parity-check to collect fresh compiler output');
  return parseJson<CapturedExecutable>(readFileSync(path.join(directory, id, 'invocation.json'), 'utf8'),
    'parity-executable.schema.json', 'native test invocation');
}

/** Match the native compiler's executable identity to exactly one retained invocation. */
export function capturedExecutableFor(directory: string, source: string): { executable: string; invocation: CapturedExecutable } {
  const matches = readdirSync(directory).filter(id => id !== 'kit-parity-capture' && id !== 'kit-parity-capture.cmd').map(id => ({ id, invocation: readExecutable(directory, id) }))
    .filter(entry => entry.invocation.source === path.resolve(source));
  const match = matches[0];
  if (matches.length !== 1 || !match)
    throw new Error(`native compiler executable ${source} has ${matches.length} captured invocations; inspect the compiler report of this parity run`);
  return { executable: path.join(directory, match.id, match.invocation.executable), invocation: match.invocation };
}

if (isMain(import.meta.url)) {
  const [directory, executable, ...args] = process.argv.slice(2);
  if (!directory || !executable) {
    console.error('usage: parity-executable.mts <owned run directory> <test executable> [native arguments]; run make parity-check');
    process.exitCode = 2;
  } else {
    const id = captureExecutable(directory, executable, args);
    console.log(`KIT_PARITY_EXECUTABLE ${id}`);
  }
}
