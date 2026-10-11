// Installs the Python release that config/toolchain.json pythonBuild declares into the install prefix that the caller names, with
// the wrapper file that the caller names; kit's own install-tools passes var/tools/python-build and var/tools/bin/python3
// (checkoutPython of tool-wrappers.mjs). The archive is the install_only build of python-build-standalone for this platform, downloaded
// from the release of the declaration; the download is refused unless its SHA-256 is the digest that the declaration gives
// for the platform. The archive's symbolic links are replaced by regular copies of their targets (materializeLinks), so the
// installed tree holds no link. An installed release is kept, and the Python of the machine is never changed.
import { copyFileSync, cpSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './digest.mjs';
import { installOnce } from './install-tool.mjs';
import { bootstrapEnvironment, printedRelease, quote, requireAbsolute, run, wrapperText, writeWrapperFile } from './tool-wrappers.mjs';

// The target triple of each platform key (process.platform-process.arch) that the declaration may name.
export const PYTHON_TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

/** The file name of the archive of `declared` ({ version, release }) for the target `triple`. */
export const pythonArchiveName = (declared, triple) => `cpython-${declared.version}+${declared.release}-${triple}-install_only.tar.gz`;

// The symbolic links under `directory`, found without following a link.
function linksUnder(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) found.push(file);
    else if (entry.isDirectory()) linksUnder(file, found);
  }
  return found;
}

/**
 * Replaces every symbolic link under `top` by a regular copy of its target: a file link by the file, a directory link by a
 * copy of the directory (its links copied as their targets too). Every link is resolved before any is replaced: a link whose
 * target is missing or cannot be resolved, or lies outside `top`, fails with the link and its target and changes nothing.
 * `label` names `top` in the messages (the archive directory, such as python).
 */
export function materializeLinks(top, label) {
  const base = realpathSync(top);
  const inside = file => file === base || file.startsWith(base + path.sep);
  const links = linksUnder(top).map((link) => {
    const name = `${label}/${path.relative(top, link)}`;
    const written = readlinkSync(link);
    let target;
    try {
      target = realpathSync(link);
    } catch {
      throw new Error(`${name} links to ${written}, which is missing or cannot be resolved; the archive holds no link to a missing file`);
    }
    if (!inside(target)) throw new Error(`${name} links to ${written}, which lies outside the archive ${label}; the archive holds no link to its outside`);
    return { link, target };
  });
  for (const { link, target } of links) {
    unlinkSync(link);
    if (statSync(target).isDirectory()) cpSync(target, link, { recursive: true, dereference: true });
    else copyFileSync(target, link);
  }
  const left = linksUnder(top);
  if (left.length > 0) throw new Error(`${label} still holds ${left.length} links after the copies: ${left.map(link => path.relative(top, link)).join(', ')}`);
}

/**
 * Installs the declared Python `{ version, release, sha256 }` (sha256 by platform key) into `prefix` and writes the wrapper file
 * `wrapper`, which runs `<prefix>/python/bin/python<minor>`. Both are absolute paths.
 */
export function installPython({ root, declared, prefix, wrapper, platform = `${process.platform}-${process.arch}`, print = () => {} }) {
  requireAbsolute('the install prefix', prefix);
  requireAbsolute('the wrapper', wrapper);
  const triple = PYTHON_TRIPLES[platform];
  if (!triple) throw new Error(`no Python build is verified for ${platform}; the verified platforms are ${Object.keys(PYTHON_TRIPLES).join(', ')}`);
  const sha256 = declared.sha256[platform];
  if (!sha256) throw new Error(`config/toolchain.json pythonBuild declares no sha256 for ${platform}; declare the digest of ${pythonArchiveName(declared, triple)} from the SHA256SUMS of the release ${declared.release}`);
  const file = pythonArchiveName(declared, triple);
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${declared.release}/${file}`;
  const minor = declared.version.split('.').slice(0, 2).join('.');
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
      materializeLinks(path.join(next, 'python'), 'python');
    },
  });
  writeWrapperFile(root, wrapper, wrapperText(`Python ${declared.version} of this checkout`, `exec ${quote(path.join(prefix, 'python', 'bin', `python${minor}`))} "$@"`), print);
  return result;
}
