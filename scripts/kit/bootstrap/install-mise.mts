// Installs the mise release that config/toolchain.json mise declares into var/tools/mise-release, with the wrapper mise in
// var/tools/bin; the data, cache, state and config of mise, its installs and its shims, are var/tools/mise.
// mise installs every other tool of the checkout from mise.toml and mise.lock, so it is installed first by the bootstrap, which
// then installs the node and the npm of mise.toml with it (installNode), before any package (K171, K938). The archive is mise-v<version>-<os>-<arch>.tar.gz of the GitHub release of mise for
// this platform (`.tar.gz` on POSIX and `.zip` on Windows); the download is refused unless its sha256 is the digest that the declaration gives for the platform. The
// wrapper keeps every directory that mise reads or writes under var/tools and records the trust of the config of the checkout
// (trustConfig); the settings of mise, such as locked, are the repository's own in its mise.toml (K1048). The environment of the
// wrapper is the one the caller passes, by default the directories of mise of the checkout (miseEnvironment); install-mise writes
// nothing else into var/tools and leaves the trusts of other checkouts to mise (K1092).
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './digest.mts';
import { installOnce } from './install-tool.mts';
import { archiveTar, bootstrapEnvironment, commandPath, run, toolsPath, writeNativeWrapper } from './tool-wrappers.mts';

// The asset of the mise archive of each platform key (process.platform-process.arch) that the declaration may name.
export const MISE_ASSETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'macos-arm64',
  'darwin-x64': 'macos-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'windows-x64': 'windows-x64',
  'windows-arm64': 'windows-arm64',
};

/** The platform key shared by config/toolchain.json and mise.lock. */
export const misePlatform = (platform = process.platform, arch = process.arch): string => `${platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform}-${arch}`;

/**
 * Records the trust of the mise.toml of the checkout `root` with `mise trust` in the state dir of the checkout (MISE_STATE_DIR),
 * run by the mise `binary` with the `environment` of mise that the caller passes, by default that of the checkout (K1092). Each shim of the checkout reads that config only once it
 * is trusted there, so a new worktree is trusted by its own install of mise and no environment variable trusts a path (K208).
 * The other entries of its trusted-configs are mise's own; none is removed (K1092).
 */
export function trustConfig({ root, binary, environment = miseEnvironment(root), print = () => {} }: { root: string; binary: string; environment?: Readonly<Record<string, string>>; print?: (text: string) => void }): void {
  const env: NodeJS.ProcessEnv = { ...process.env, ...environment };
  // With MISE_GLOBAL_CONFIG_FILE set, `mise trust` trusts the global configuration instead of the file it names, so it is unset here (K208).
  delete env.MISE_GLOBAL_CONFIG_FILE;
  run(binary, ['trust', path.join(root, 'mise.toml')], { cwd: root, env }, print);
}

/** The download URL of the mise archive of `version` for the asset `asset`. */
export const miseArchiveUrl = (version: string, asset: string, extension = 'tar.gz'): string => `https://github.com/jdx/mise/releases/download/v${version}/mise-v${version}-${asset}.${extension}`;

/**
 * The environment in which the tools of mise run from its shims, var/tools/mise/shims, for the checkout `root`: the directories
 * of mise under var/tools/mise, mise.toml of the checkout as the global configuration, so a shim runs the tool of the
 * checkout from any directory instead of the next command of its name on PATH, and the trusted config of the checkout. The
 * settings of mise and uv (locked, auto_install, python-downloads, the uv cache) are the repository's own, in the [settings] and
 * [env] of its mise.toml or its uv configuration; kit sets none (K1048). A tool that mise runs from uv gets the Python of mise from mise. var/tools is the checkout's own, a linked worktree's too (toolsPath, K858).
 */
export function miseEnvironment(root: string): Record<string, string> {
  return {
    MISE_DATA_DIR: toolsPath(root, 'mise'),
    MISE_CACHE_DIR: toolsPath(root, 'mise', 'cache'),
    MISE_STATE_DIR: toolsPath(root, 'mise', 'state'),
    MISE_CONFIG_DIR: toolsPath(root, 'mise', 'config'),
    MISE_GLOBAL_CONFIG_FILE: path.join(root, 'mise.toml'),
    // mise install records the trust of the root of the global config, the home directory unless this names the checkout (K397-1).
    MISE_GLOBAL_CONFIG_ROOT: root,
  };
}

// The text of the wrapper mise: the environment of mise for the checkout, then the binary. mise links each shim to the mise
// that PATH names, so the directory of the binary comes first on PATH: a shim that linked this wrapper would run mise itself,
// since the wrapper drops the name of the shim.
/**
 * Installs the declared mise `{ version, sha256 }` (sha256 by platform key) into var/tools/mise-release of `root`, writes the
 * wrapper with the `environment` of the caller (by default miseEnvironment of the checkout), and records the trust of mise.toml.
 */
/** The wrapper of var/tools/bin that runs the installed mise. */
export const MISE_WRAPPER = 'mise';
export const miseBinary = (directory: string, platform = process.platform): string => (platform === 'win32' ? path.win32 : path).join(directory, 'mise', 'bin', `mise${platform === 'win32' ? '.exe' : ''}`);

export function installMise({ root, declared, platform = misePlatform(), environment = miseEnvironment(root), print = () => {} }: { root: string; declared: { version: string; sha256: Readonly<Record<string, string>> }; platform?: string; environment?: Readonly<Record<string, string>>; print?: (text: string) => void }) {
  const asset = MISE_ASSETS[platform];
  if (!asset) throw new Error(`no mise archive is verified for ${platform}; the verified platforms are ${Object.keys(MISE_ASSETS).join(', ')}`);
  const sha256 = declared.sha256[platform];
  const extension = platform.startsWith('windows-') ? 'zip' : 'tar.gz';
  if (!sha256) throw new Error(`config/toolchain.json mise declares no sha256 for ${platform}; declare the digest of mise-v${declared.version}-${asset}.${extension}`);
  const url = miseArchiveUrl(declared.version, asset, extension);
  const prefix = toolsPath(root, 'mise-release');
  const binary = (directory: string) => miseBinary(directory);
  // The marker .sha256 of var/tools/mise-release holds the digest of the archive it was unpacked from (K933).
  const result = installOnce({
    root, label: 'mise', version: declared.version, prefix, digest: sha256, marker: '.sha256', print,
    install: (next: string) => {
      const archive = path.join(next, `mise-${asset}.${extension}`);
      const environment = bootstrapEnvironment(root);
      run('curl', ['--fail', '--silent', '--show-error', '--location', '--output', archive, url], { cwd: root, env: environment }, print);
      const actual = fileDigest(archive);
      if (actual !== sha256) {
        rmSync(archive, { force: true });
        throw new Error(`${url} has the sha256 ${actual}; config/toolchain.json mise declares ${sha256} for ${platform}`);
      }
      run(archiveTar(), [extension === 'zip' ? '-xf' : '-xzf', archive, '-C', next], { cwd: root, env: environment }, print);
      rmSync(archive, { force: true });
    },
  });
  trustConfig({ root, binary: binary(prefix), environment, print });
  writeNativeWrapper(root, MISE_WRAPPER, { comment: `mise ${declared.version} of this checkout`, executable: binary(prefix), environment, pathPrefix: [path.dirname(binary(prefix))] }, print);
  return result;
}

/**
 * The directory of the install of the tool `key` of mise.toml of the checkout `root`, which `mise where` prints when the mise of
 * the checkout runs in `root`: mise reads the mise.toml of the checkout, whichever mise.toml governs the directory where the tool
 * later runs, so a tool started by a path under it runs outside the shims (K199). mise runs with the `environment` of mise of the
 * caller, by default that of the checkout.
 */
export function miseWhere(root: string, key: string, environment: Readonly<Record<string, string>> = miseEnvironment(root)): string {
  const command = process.platform === 'win32' ? miseBinary(toolsPath(root, 'mise-release')) : commandPath(root, MISE_WRAPPER);
  return execFileSync(command, ['where', key], { cwd: root, env: { ...bootstrapEnvironment(root), ...environment }, encoding: 'utf8' }).trim();
}

/** The wrapper of var/tools/bin that runs the Node.js of mise.toml, which mise installs into var/tools/mise. */
export const NODE_WRAPPER = 'node';
/** The wrappers of var/tools/bin that run the npm of mise.toml with the node of the checkout, each with its script of npm/bin. */
export const NPM_WRAPPERS = { npm: 'npm-cli.js', npx: 'npx-cli.js' };
export const nodeBinary = (directory: string, platform = process.platform): string => (platform === 'win32' ? path.win32 : path).join(directory, platform === 'win32' ? 'node.exe' : 'bin/node');

/**
 * Installs the Node.js and the npm of mise.toml with the mise of the checkout (`mise install node npm:npm`; whether mise.lock
 * must pin them is the locked setting of the repository's mise.toml, K1092) and writes the wrappers node, npm and npx of var/tools/bin. node starts that node by the absolute path that
 * `mise where node` prints; npm and npx run the npm of `mise where npm:npm` with that node. The wrappers run node itself, not the
 * shim of mise: a shim puts the bin directory of the install, with the npm that Node.js bundles, first on the PATH of node.
 * mise runs with the `environment` of mise of the caller, by default that of the checkout, as installMise gives its wrapper (K1092).
 * A mise.toml that declares no node or npm fails the install of mise. Returns the path of the node wrapper.
 */
export function installNode({ root, environment = miseEnvironment(root), print = () => {} }: { root: string; environment?: Readonly<Record<string, string>>; print?: (text: string) => void }): string {
  const mise = process.platform === 'win32' ? miseBinary(toolsPath(root, 'mise-release')) : commandPath(root, MISE_WRAPPER);
  try {
    run(mise, ['install', 'node', 'npm:npm'], { cwd: root, env: { ...bootstrapEnvironment(root), ...environment } }, print);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`${error.message}; mise.toml must declare node and npm:npm, the Node.js and npm releases of the checkout`, { cause: error });
  }
  const executable = nodeBinary(miseWhere(root, 'node', environment));
  writeNativeWrapper(root, NODE_WRAPPER, { comment: 'the Node.js of mise.toml of this checkout', executable }, print);
  const npmCli = path.join(miseWhere(root, 'npm:npm', environment), 'node_modules/npm/bin');
  for (const [name, cli] of Object.entries(NPM_WRAPPERS)) {
    writeNativeWrapper(root, name, { comment: `${name} of mise.toml of this checkout, run with its node`, executable, args: [path.join(npmCli, cli)] }, print);
  }
  // npm's Windows wrapper starts node.exe directly, avoiding a nested .cmd launch and its second command-line expansion.
  return process.platform === 'win32' ? executable : commandPath(root, NODE_WRAPPER);
}
