// Installs the Python release that config/toolchain.json pythonBuild declares into var/tools/python-build, with the wrapper
// python3 in var/tools/bin. The archive is the install_only build of python-build-standalone for this platform, downloaded
// from the release of the declaration; the download is refused unless its SHA-256 is the digest that the declaration gives
// for the platform. The archive is unpacked as it is, its own symbolic links included. An installed release is kept, and
// the Python of the machine is never changed.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './digest.mjs';
import { installOnce } from './install-tool.mjs';
import { bootstrapEnvironment, printedRelease, quote, run, toolsPath, wrapperText, writeWrapper } from './tool-wrappers.mjs';

// The target triple of each platform key (process.platform-process.arch) that the declaration may name.
export const PYTHON_TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

/** The file name of the archive of `declared` ({ version, release }) for the target `triple`. */
export const pythonArchiveName = (declared, triple) => `cpython-${declared.version}+${declared.release}-${triple}-install_only.tar.gz`;

/** Installs the declared Python `{ version, release, sha256 }` (sha256 by platform key) into var/tools and writes the wrapper. */
export function installPython({ root, declared, platform = `${process.platform}-${process.arch}`, print = () => {} }) {
  const triple = PYTHON_TRIPLES[platform];
  if (!triple) throw new Error(`no Python build is verified for ${platform}; the verified platforms are ${Object.keys(PYTHON_TRIPLES).join(', ')}`);
  const sha256 = declared.sha256[platform];
  if (!sha256) throw new Error(`config/toolchain.json pythonBuild declares no sha256 for ${platform}; declare the digest of ${pythonArchiveName(declared, triple)} from the SHA256SUMS of the release ${declared.release}`);
  const file = pythonArchiveName(declared, triple);
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${declared.release}/${file}`;
  const minor = declared.version.split('.').slice(0, 2).join('.');
  const prefix = toolsPath(root, 'python-build');
  const result = installOnce({
    root, label: 'Python', prefix, recorded: declared.version, print,
    installedRelease: directory => printedRelease(path.join(directory, 'python', 'bin', `python${minor}`), 'python'),
    install: (next) => {
      const archive = path.join(next, file);
      const environment = bootstrapEnvironment(root);
      run('curl', ['--fail', '--silent', '--show-error', '--location', '--output', archive, url], { cwd: root, env: environment }, print);
      const actual = fileDigest(archive);
      if (actual !== sha256) {
        rmSync(archive, { force: true });
        throw new Error(`${url} has the sha256 ${actual}; config/toolchain.json pythonBuild declares ${sha256} for ${platform}`);
      }
      run('tar', ['-xzf', archive, '-C', next], { cwd: root, env: environment }, print);
      rmSync(archive, { force: true });
    },
  });
  writeWrapper(root, 'python3', wrapperText(`Python ${declared.version} of this checkout`, `exec ${quote(path.join(prefix, 'python', 'bin', `python${minor}`))} "$@"`), print);
  return result;
}
