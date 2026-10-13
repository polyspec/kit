// Installs the uv release that config/toolchain.json uv declares into var/tools/uv, with the wrapper uv in var/tools/bin. The
// archive is uv-<target>.tar.gz of the GitHub release of uv for this platform; the download is refused unless its sha256 is
// the digest that the declaration gives for the platform, and it is unpacked as it is. The wrapper sets every directory that
// uv writes to under var/tools (the cache and the Python installs), reads no uv.toml of the home (UV_NO_CONFIG) and lets uv
// download a Python only by `uv python install` (UV_PYTHON_DOWNLOADS=manual). An installed release is kept. The uv of the
// machine is never used.
import path from 'node:path';
import { printedRelease, quote, toolsPath, wrapperText } from './bootstrap/tool-wrappers.mts';
import { installArchive } from './install-archive.mts';

// The target of the uv archive of each platform key (process.platform-process.arch) that the declaration may name.
export const UV_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

/** The download URL of the uv archive of `version` for the target `target`. */
export const uvArchiveUrl = (version: string, target: string): string => `https://github.com/astral-sh/uv/releases/download/${version}/uv-${target}.tar.gz`;

// The text of the wrapper uv: the state of uv under var/tools, then the installed binary.
function uvWrapper(root: string, binary: string, version: string) {
  const lines = [
    `UV_CACHE_DIR=${quote(toolsPath(root, 'uv-cache'))}`,
    `UV_PYTHON_INSTALL_DIR=${quote(toolsPath(root, 'uv-python'))}`,
    'UV_NO_CONFIG=1',
    'UV_PYTHON_DOWNLOADS=manual',
    'export UV_CACHE_DIR UV_PYTHON_INSTALL_DIR UV_NO_CONFIG UV_PYTHON_DOWNLOADS',
    `exec ${quote(binary)} "$@"`,
  ];
  return wrapperText(`uv ${version} of this checkout`, lines.join('\n'));
}

/** Installs the declared uv `{ version, sha256 }` (sha256 by platform key) into var/tools/uv of `root` and writes the wrapper. */
export function installUv({ root, declared, platform = `${process.platform}-${process.arch}`, print = () => {} }: { root: string; declared: { version: string; sha256: Readonly<Record<string, unknown>> }; platform?: string; print?: (text: string) => void }) {
  const binary = (directory: string, target: string) => path.join(directory, `uv-${target}`, 'uv');
  return installArchive({
    tool: 'uv', source: 'config/toolchain.json uv', root, declared, platform, targets: UV_TARGETS, print,
    archive: target => `uv-${target}`,
    url: target => uvArchiveUrl(declared.version, target),
    release: (directory, target) => printedRelease(binary(directory, target), 'uv'),
    wrappers: (directory, target) => ({ uv: uvWrapper(root, binary(directory, target), declared.version) }),
  });
}
