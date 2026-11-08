// The readers of the manifests whose format an ecosystem tool reads, so that kit parses none of them itself (S1):
//   TOML    smol-toml through readToml of toml.mts, the one TOML reader of kit (pyproject.toml, rust-toolchain.toml)
//   go.mod  go mod edit -json of the Go of the checkout (K393-1)
//   Cargo   cargo metadata --no-deps of the cargo on PATH, offline
//   .npmrc  npm config get of the npm of the checkout, in the directory of the file
// A reader that cannot run or read its file throws an Error that names the file and the cause. The Rust declaration of a
// checkout is read here, not in bootstrap/toolchain-declared.mts, because only the npm and Node.js pins are read before the
// tools are installed; the Go release is a tool of mise.toml (toolchain-mise.mts).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Declared } from './bootstrap/toolchain-declared.mts';
import { execute } from './process.mts';
import { toolCommand } from './mise-tools.mts';
import { readToml } from './toml.mts';
import type { TomlTable } from './toml.mts';
import { parseJson } from './schema-validate.mts';

// The output of `command` with `args` that reads `file`; an Error names the file, the reader `shown` and the cause.
function output(file: string, shown: string, command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): string {
  const result = execute(command, args, { env, cwd });
  if (result.error) throw new Error(`${file}: ${shown} cannot start: ${result.error.message}`);
  if (result.status !== 0) {
    const ended = result.signal ? `ended by signal ${result.signal}` : `exit status ${result.status}`;
    throw new Error(`${file}: ${shown} cannot read it (${ended}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** The table of the TOML file `file` of `root`; a file that is no TOML throws with the file and the place of the error. */
export const readTomlFile = (root: string, file: string): TomlTable => readToml(readFileSync(path.join(root, file), 'utf8'), file);

/** A module version of `go mod edit -json`; a replacement by a directory has no version. */
type GoModuleVersion = { Path: string; Version?: string };
/** A go.mod as `go mod edit -json` prints it; go-mod.schema.json. */
type GoMod = { Module: { Path: string }; Go?: string; Toolchain?: string; Require?: (GoModuleVersion & { Version: string; Indirect?: boolean })[] | null; Replace?: { Old: GoModuleVersion; New: GoModuleVersion }[] | null };
/** A package of `cargo metadata --no-deps`; cargo-metadata.schema.json. */
type CargoPackage = { manifest_path: string; version: string; rust_version: string | null };

/**
 * The go.mod `file` of `root` as `go mod edit -json` prints it: the module path, the go line and the toolchain line, and the
 * require and replace directives, each when present.
 */
export const readGoMod = (root: string, file: string, env: NodeJS.ProcessEnv): GoMod =>
  parseJson<GoMod>(output(file, '`go mod edit -json`', toolCommand(root, 'go'), ['mod', 'edit', '-json', path.join(root, file)], env), 'go-mod.schema.json', `go mod edit -json ${file}`);

/** The go.work file `file` (absolute) of `root` as `go work edit -json` prints it: the directories of its use directives, when present. */
export const readGoWork = (root: string, file: string, env: NodeJS.ProcessEnv): { Use?: { DiskPath: string }[] } =>
  parseJson<{ Use?: { DiskPath: string }[] }>(output(file, '`go work edit -json`', toolCommand(root, 'go'), ['work', 'edit', '-json', file], env), 'go-work.schema.json', `go work edit -json ${file}`);

/** The go.work file that the go command uses in the directory `directory` of `root` (`go env GOWORK`), or null for none. */
export function goWorkFile(root: string, directory: string, env: NodeJS.ProcessEnv): string | null {
  const file = output(path.posix.join(directory, 'go.mod'), '`go env GOWORK`', toolCommand(root, 'go'), ['env', 'GOWORK'], env, path.join(root, directory)).trim();
  // go env prints nothing without a workspace and off when GOWORK=off turns it off.
  return file === '' || file === 'off' ? null : file;
}

/** The packages of the Cargo workspace of the Cargo.toml `file` of `root`, as `cargo metadata --no-deps` prints them. */
export const readCargoPackages = (root: string, file: string, env: NodeJS.ProcessEnv): CargoPackage[] =>
  parseJson<{ packages: CargoPackage[] }>(output(file, '`cargo metadata`', 'cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline', '--manifest-path', path.join(root, file)], env), 'cargo-metadata.schema.json', `cargo metadata ${file}`).packages;

/** The Rust release that the checkout declares: the channel of rust-toolchain.toml as it declares it, which rustup judges (K840); undefined without the file. */
export function declaredRust(root: string): Declared | undefined {
  if (!existsSync(path.join(root, 'rust-toolchain.toml'))) return undefined;
  const channel = (readTomlFile(root, 'rust-toolchain.toml') as { toolchain?: { channel?: unknown } }).toolchain?.channel;
  return { version: typeof channel === 'string' ? channel : 'as rustup resolves it', source: 'rust-toolchain.toml channel' };
}
