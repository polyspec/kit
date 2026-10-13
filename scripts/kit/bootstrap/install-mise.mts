// Installs the mise release that config/toolchain.json mise declares into var/tools/mise, with the wrapper mise in var/tools/bin.
// mise installs every other tool of the checkout from mise.toml and mise.lock, so it is installed by the bootstrap, after the npm
// of packageManager and before any package. The archive is mise-v<version>-<os>-<arch>.tar.gz of the GitHub release of mise for
// this platform; the download is refused unless its sha256 is the digest that the declaration gives for the platform. The
// wrapper keeps every directory that mise reads or writes under var/tools, trusts the config of the checkout and installs only
// what mise.lock pins (MISE_LOCKED), so nothing of the machine changes and no config of the home is read.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './digest.mts';
import { installOnce } from './install-tool.mts';
import { bootstrapEnvironment, printedRelease, quote, run, toolsPath, wrapperText, writeWrapper } from './tool-wrappers.mts';

// The asset of the mise archive of each platform key (process.platform-process.arch) that the declaration may name.
export const MISE_ASSETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'macos-arm64',
  'darwin-x64': 'macos-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
};

/** The download URL of the mise archive of `version` for the asset `asset`. */
export const miseArchiveUrl = (version: string, asset: string): string => `https://github.com/jdx/mise/releases/download/v${version}/mise-v${version}-${asset}.tar.gz`;

// The text of the wrapper mise: the directories of mise under var/tools, the trusted config of the checkout, then the binary.
function miseWrapper(root: string, binary: string, version: string) {
  const variables = {
    MISE_DATA_DIR: toolsPath(root, 'mise-data'),
    MISE_CACHE_DIR: toolsPath(root, 'mise-cache'),
    MISE_STATE_DIR: toolsPath(root, 'mise-state'),
    MISE_CONFIG_DIR: toolsPath(root, 'mise-config'),
    MISE_TRUSTED_CONFIG_PATHS: root,
  };
  const lines = [
    ...Object.entries(variables).map(([name, value]) => `${name}=${quote(value)}`),
    'MISE_LOCKED=1',
    `export ${[...Object.keys(variables), 'MISE_LOCKED'].join(' ')}`,
    `exec ${quote(binary)} "$@"`,
  ];
  return wrapperText(`mise ${version} of this checkout`, lines.join('\n'));
}

/** Installs the declared mise `{ version, sha256 }` (sha256 by platform key) into var/tools/mise of `root` and writes the wrapper. */
export function installMise({ root, declared, platform = `${process.platform}-${process.arch}`, print = () => {} }: { root: string; declared: { version: string; sha256: Readonly<Record<string, unknown>> }; platform?: string; print?: (text: string) => void }) {
  const asset = MISE_ASSETS[platform];
  if (!asset) throw new Error(`no mise archive is verified for ${platform}; the verified platforms are ${Object.keys(MISE_ASSETS).join(', ')}`);
  const sha256 = declared.sha256[platform];
  if (!sha256) throw new Error(`config/toolchain.json mise declares no sha256 for ${platform}; declare the digest of mise-v${declared.version}-${asset}.tar.gz`);
  const url = miseArchiveUrl(declared.version, asset);
  const prefix = toolsPath(root, 'mise');
  const binary = (directory: string) => path.join(directory, 'mise', 'bin', 'mise');
  const result = installOnce({
    root, label: 'mise', prefix, recorded: declared.version, installedRelease: (directory: string) => printedRelease(binary(directory), 'mise'), print,
    install: (next: string) => {
      const archive = path.join(next, `mise-${asset}.tar.gz`);
      const environment = bootstrapEnvironment(root);
      run('curl', ['--fail', '--silent', '--show-error', '--location', '--output', archive, url], { cwd: root, env: environment }, print);
      const actual = fileDigest(archive);
      if (actual !== sha256) {
        rmSync(archive, { force: true });
        throw new Error(`${url} has the sha256 ${actual}; config/toolchain.json mise declares ${sha256} for ${platform}`);
      }
      run('tar', ['-xzf', archive, '-C', next], { cwd: root, env: environment }, print);
      rmSync(archive, { force: true });
    },
  });
  writeWrapper(root, 'mise', miseWrapper(root, binary(prefix), declared.version), print);
  return result;
}
