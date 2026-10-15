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
// Every release is exact: <major>.<minor>.<patch>, and vulture the PyPI release, which may have two parts. A key of another
// tool is refused, so mise installs nothing that kit does not check. The TOML is read by readTomlFile (smol-toml).
//
// mise.lock must pin each archive by its sha256 for every platform of LOCK_PLATFORMS, and a pypi: tool by the digest of its
// uv lock. The one exception is a tool that the go: backend builds (deadcode, govulncheck): mise.lock records its release
// only, and its integrity is that of Go, which checks every module against the checksum database (GOSUMDB) while it builds
// it, with GOFLAGS=-mod=readonly (miseInstallEnvironment of bootstrap/install-mise.mts).
//
// The uv lock of a pypi: tool is a sidecar folder that mise.lock names by its path, `.mise/locks/<tool>/<version>`: lock data,
// which mise's documentation says to commit with mise.lock, and which `mise install --locked` of a fresh checkout replays. Each
// sidecar that mise.lock names is a tracked folder of the checkout, its tracked files present (miseLockSidecarFindings, K192).
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Declared } from './bootstrap/toolchain-declared.mts';
import { isTable } from './toml.mts';
import { readTomlFile } from './toolchain-files.mts';
import { git } from './git.mts';

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
 * The platforms of mise whose archives mise.lock pins: every platform on which the bootstrap installs mise, the archives of
 * config/toolchain.json mise, so that make install-tools runs on an x64 or an ARM Linux runner and on either Mac (K134).
 */
export const LOCK_PLATFORMS = ['linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64'];

const RELEASE: Record<string, RegExp> = { vulture: /^\d+\.\d+(\.\d+)?$/ };
const EXACT = /^\d+\.\d+\.\d+$/;

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
    if (!name) throw new Error(`mise.toml tools declares ${key}, which kit does not check; the tools are ${Object.values(MISE_TOOLS).map(tool => tool.key).join(', ')}`);
    const version = isTable(value) ? value.version : value;
    const source = `mise.toml tools.${key}`;
    if (typeof version !== 'string' || !(RELEASE[name] ?? EXACT).test(version)) throw new Error(`${source} must declare an exact release${name === 'vulture' ? ' as PyPI names it' : ', <major>.<minor>.<patch>'}; it declares ${JSON.stringify(version)}`);
    declared[name] = { version, source };
  }
  return declared;
}

/**
 * One line for each tool of mise.toml of `root` that mise.lock does not pin as the header describes: a tool or a release that
 * the lock lacks, an archive of a platform of LOCK_PLATFORMS without its sha256, a pypi: tool without the digest of its uv lock.
 */
export function miseLockFindings(root: string): string[] {
  const tools = toolsTable(root);
  if (!tools || Object.keys(tools).length === 0) return [];
  if (!existsSync(path.join(root, 'mise.lock'))) return ['mise.lock is missing; run make toolchain-lock'];
  const locked = readTomlFile(root, 'mise.lock').tools ?? {};
  const findings: string[] = [];
  for (const [key, value] of Object.entries(tools)) {
    const version = isTable(value) ? value.version : value;
    const listed = isTable(locked) ? locked[key] : undefined;
    // A tool that mise.lock does not list has no entry.
    const entries = Array.isArray(listed) ? listed.filter(isTable) : [];
    const entry = entries.find(item => item.version === version);
    if (!entry) {
      findings.push(`mise.lock does not pin ${key} ${String(version)}; run make toolchain-lock`);
      continue;
    }
    // The go: backend builds the tool from its module, which Go checks against GOSUMDB; mise.lock records the release only.
    if (key.startsWith('go:')) continue;
    if (key.startsWith('pypi:')) {
      const graph = entry.uv;
      if (!isTable(graph) || typeof graph.digest !== 'string' || !graph.digest.startsWith('sha256:')) findings.push(`mise.lock pins ${key} ${String(version)} without the digest of its uv lock; install uv with mise and run make toolchain-lock`);
      continue;
    }
    for (const platform of LOCK_PLATFORMS) {
      const archive = entry[`platforms.${platform}`];
      if (!isTable(archive) || typeof archive.checksum !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(archive.checksum)) findings.push(`mise.lock pins ${key} ${String(version)} for ${platform} without the sha256 of its archive; run make toolchain-lock${key.startsWith('http:') ? `, after declaring the checksum of ${key} in mise.toml` : ''}`);
    }
  }
  return findings;
}

/**
 * One line for each uv lock sidecar that mise.lock of `root` names (`uv = { path }` of a pypi: tool) and the Git index of `root`
 * does not track: a folder without tracked files, or a tracked file that is missing from the working tree. A fresh checkout runs
 * `mise install --locked` from what is tracked, so an untracked or deleted sidecar fails there (K192).
 */
export function miseLockSidecarFindings(root: string): string[] {
  if (!existsSync(path.join(root, 'mise.lock'))) return [];
  const locked = readTomlFile(root, 'mise.lock').tools ?? {};
  const sidecars = Object.entries(isTable(locked) ? locked : {}).flatMap(([key, listed]) => (Array.isArray(listed) ? listed : [])
    .filter(isTable)
    .flatMap(entry => (isTable(entry.uv) && typeof entry.uv.path === 'string' ? [{ key, version: typeof entry.version === 'string' ? entry.version : JSON.stringify(entry.version), folder: entry.uv.path }] : [])));
  return sidecars.flatMap(({ key, version, folder }) => {
    const tracked = git(root, 'ls-files', '-z', '--cached', '--', folder).split('\0').filter(Boolean);
    if (tracked.length === 0) return [`mise.lock pins ${key} ${version} by the uv lock in ${folder}, which Git does not track; mise install --locked of a checkout needs it, so commit ${folder} with mise.lock (make toolchain-lock writes it)`];
    return tracked.filter(file => !existsSync(path.join(root, file))).map(file => `mise.lock pins ${key} ${version} by the uv lock in ${folder}, whose tracked file ${file} is missing; restore it with git checkout -- ${folder}, or run make toolchain-lock`);
  });
}
