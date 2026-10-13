// Installs the alint release that config/toolchain.json alint declares into var/tools/alint, with the wrapper alint in
// var/tools/bin. alint checks the folder layout of a repository (S5) against config/layout.yml (`make layout-check`). The
// archive is alint-v<version>-<target>.tar.gz of the GitHub release of alint for this platform; the download is refused
// unless its sha256 is the digest that the declaration gives for the platform, and it is unpacked as it is. An installed
// release is kept. The alint of the machine is never used.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import { installOnce } from './bootstrap/install-tool.mts';
import { bootstrapEnvironment, printedRelease, quote, run, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';

// The target of the alint archive of each platform key (process.platform-process.arch) that the declaration may name. The
// Linux archives are the static musl builds, the only Linux builds of a release.
export const ALINT_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
};

/** The name of the alint archive of `version` for the target `target`, without .tar.gz: also the folder it unpacks to. */
export const alintArchive = (version: string, target: string): string => `alint-v${version}-${target}`;

/** The download URL of the alint archive of `version` for the target `target`. */
export const alintArchiveUrl = (version: string, target: string): string => `https://github.com/asamarts/alint/releases/download/v${version}/${alintArchive(version, target)}.tar.gz`;

/** Installs the declared alint `{ version, sha256 }` (sha256 by platform key) into var/tools/alint of `root` and writes the wrapper. */
export function installAlint({ root, declared, platform = `${process.platform}-${process.arch}`, print = () => {} }: { root: string; declared: { version: string; sha256: Readonly<Record<string, unknown>> }; platform?: string; print?: (text: string) => void }) {
  const target = ALINT_TARGETS[platform];
  if (!target) throw new Error(`no alint archive is verified for ${platform}; the verified platforms are ${Object.keys(ALINT_TARGETS).join(', ')}`);
  const sha256 = declared.sha256[platform];
  if (!sha256) throw new Error(`config/toolchain.json alint declares no sha256 for ${platform}; declare the digest of ${alintArchive(declared.version, target)}.tar.gz of the alint release ${declared.version}`);
  const url = alintArchiveUrl(declared.version, target);
  const prefix = toolsPath(root, 'alint');
  const binary = (directory: string) => path.join(directory, alintArchive(declared.version, target), 'alint');
  const result = installOnce({
    root, label: 'alint', prefix, recorded: declared.version, installedRelease: (directory: string) => printedRelease(binary(directory), 'alint'), print,
    install: (next: string) => {
      const archive = path.join(next, `${alintArchive(declared.version, target)}.tar.gz`);
      const environment = bootstrapEnvironment(root);
      run('curl', ['--fail', '--silent', '--show-error', '--location', '--output', archive, url], { cwd: root, env: environment }, print);
      const actual = fileDigest(archive);
      if (actual !== sha256) {
        rmSync(archive, { force: true });
        throw new Error(`${url} has the sha256 ${actual}; config/toolchain.json alint declares ${sha256} for ${platform}`);
      }
      run('tar', ['-xzf', archive, '-C', next], { cwd: root, env: environment }, print);
      rmSync(archive, { force: true });
    },
  });
  writeWrapper(root, 'alint', wrapperText(`alint ${declared.version} of this checkout`, `exec ${quote(binary(prefix))} "$@"`), print);
  return result;
}
