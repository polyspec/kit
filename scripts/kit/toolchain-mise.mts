// The tools that mise installs into var/tools/mise (K127): their releases in [tools] of mise.toml, and the digests in mise.lock,
// which `make toolchain-lock` writes with `mise lock` and `make install-tools` installs with `mise install --locked`. Each tool
// of kit is the key of mise.toml that names its backend; its value is the release, or a table with the release as version:
//   node          node (the archive of nodejs.org; the bootstrap installs it first, and var/tools/bin/node runs it, K171)
//   go            go                                     python  python (the python-build-standalone build of mise.lock)
//   uv            uv                                     ruff    ruff
//   alint         github:asamarts/alint                  golangciLint  golangci-lint
//   deadcode      go:golang.org/x/tools/cmd/deadcode     govulncheck   go:golang.org/x/vuln/cmd/govulncheck
//   cargoAudit    github:rustsec/rustsec, with version_prefix = "cargo-audit/v", the native binary of each platform
//   cargoNextest  github:nextest-rs/nextest, with version_prefix = "cargo-nextest-", the native binary of each platform
//   cargoDeny     cargo-deny (aqua:EmbarkStudios/cargo-deny of the registry of mise), the native binary of each platform
//   composer      http:composer, with the url of composer.phar and its checksum from getcomposer.org
//   vulture       pypi:vulture, whose wheel and dependencies mise.lock pins with uv (.mise/locks)
// A release is taken as mise.toml declares it. A key of another tool, a repository's own http: tool among them, passes
// through to mise, which judges its configuration; kit checks the tools above only (K839). The TOML is read by readTomlFile
// (smol-toml). mise.lock is mise's record: `mise install --locked` checks it, and kit does not judge it (K835).
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Declared } from './bootstrap/toolchain-declared.mts';
import { isTable } from './toml.mts';
import { readTomlFile } from './toolchain-files.mts';

/** The key of mise.toml of each tool of kit, and the command of the tool among the shims of mise. */
export const MISE_TOOLS = {
  node: { key: 'node', command: 'node' },
  go: { key: 'go', command: 'go' },
  python: { key: 'python', command: 'python3' },
  uv: { key: 'uv', command: 'uv' },
  ruff: { key: 'ruff', command: 'ruff' },
  alint: { key: 'github:asamarts/alint', command: 'alint' },
  golangciLint: { key: 'golangci-lint', command: 'golangci-lint' },
  deadcode: { key: 'go:golang.org/x/tools/cmd/deadcode', command: 'deadcode' },
  govulncheck: { key: 'go:golang.org/x/vuln/cmd/govulncheck', command: 'govulncheck' },
  cargoAudit: { key: 'github:rustsec/rustsec', command: 'cargo-audit' },
  cargoNextest: { key: 'github:nextest-rs/nextest', command: 'cargo-nextest' },
  cargoDeny: { key: 'cargo-deny', command: 'cargo-deny' },
  composer: { key: 'http:composer', command: 'composer' },
  vulture: { key: 'pypi:vulture', command: 'vulture' },
} as const;

/** A tool of kit that mise installs. */
export type MiseTool = keyof typeof MISE_TOOLS;

/** Whether `name` is a tool of MISE_TOOLS. */
const isMiseTool = (name: string): name is MiseTool => Object.hasOwn(MISE_TOOLS, name);

/** The tools of MISE_TOOLS. */
export const MISE_TOOL_NAMES: MiseTool[] = Object.keys(MISE_TOOLS).filter(isMiseTool);

/**
 * The platforms on which every mise tool must have an archive pin: Linux x64/ARM64 and macOS x64/ARM64. Windows bootstrap
 * Node and the selected Go tool have their own explicit lock pins below; this does not claim the rest of kit's tools on Windows.
 */
export const LOCK_PLATFORMS = ['linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64'];

/** Additional Windows archives pinned for the bootstrap and the explicitly supported Go smoke install. */
export const WINDOWS_LOCKED_TOOLS = ['node', 'go'] as const;
export const WINDOWS_LOCK_PLATFORMS = ['windows-x64', 'windows-arm64'] as const;

// The [tools] table of mise.toml of `root`, or undefined without the file.
function toolsTable(root: string): Record<string, unknown> | undefined {
  if (!existsSync(path.join(root, 'mise.toml'))) return undefined;
  const tools = readTomlFile(root, 'mise.toml').tools ?? {};
  if (!isTable(tools)) throw new Error(`mise.toml tools must be a table of the tools; it is ${JSON.stringify(tools)}`);
  return tools;
}

/** The tools of mise.toml of `root`, each with its release and `mise.toml tools.<key>`; an absent mise.toml declares none. */
export function declaredMiseTools(root: string): Partial<Record<MiseTool, Declared>> {
  const tools = toolsTable(root) ?? {};
  const names = Object.fromEntries(MISE_TOOL_NAMES.map(name => [MISE_TOOLS[name].key, name]));
  const declared: Partial<Record<MiseTool, Declared>> = {};
  for (const [key, value] of Object.entries(tools)) {
    const name = names[key];
    // Another key, a repository's own http: tool among them (K327), is a tool of mise that kit does not run (K839).
    if (!name) continue;
    // The key declares the tool; its release is shown as declared: a string, the first of a list, or as mise resolves it.
    const release = isTable(value) ? value.version : value;
    const first: unknown = Array.isArray(release) ? release[0] : release;
    declared[name] = { version: typeof first === 'string' ? first : 'as mise resolves it', source: `mise.toml tools.${key}` };
  }
  return declared;
}
