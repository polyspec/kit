// Installs the Go release of the kit pin (scripts/kit/toolchain-pins.json go) into var/tools/go, with the wrappers go and
// gofmt in var/tools/bin. The archive is go<version>.<os>-<arch>.tar.gz of the Go downloads for this platform; the download
// is refused unless its sha256 is the digest that toolchain-pins.json goArchives gives for the platform, and it is unpacked
// as it is (install-archive.mts). No Go of the machine takes part, so a checkout without Go installs one. The wrappers set
// GOTOOLCHAIN=local, so the installed Go runs no other toolchain. An installed release is kept.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { quote, wrapperText } from './bootstrap/tool-wrappers.mts';
import { installArchive } from './install-archive.mts';

// The target of the Go archive of each platform key (process.platform-process.arch) that toolchain-pins.json may name.
export const GO_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-amd64',
  'linux-x64': 'linux-amd64',
  'linux-arm64': 'linux-arm64',
};

/** The download URL of the Go archive of `version` for the target `target`. */
export const goArchiveUrl = (version: string, target: string): string => `https://dl.google.com/go/go${version}.${target}.tar.gz`;

/** Installs Go `version` with the digests `sha256` (by platform key) into var/tools/go of `root` and writes the wrappers. */
export function installGo({ root, version, sha256, platform = `${process.platform}-${process.arch}`, print = () => {} }: { root: string; version: string; sha256: Readonly<Record<string, unknown>>; platform?: string; print?: (text: string) => void }) {
  return installArchive({
    tool: 'go', source: 'scripts/kit/toolchain-pins.json goArchives', root, declared: { version, sha256 }, platform, targets: GO_TARGETS, print,
    archive: target => `go${version}.${target}`,
    url: target => goArchiveUrl(version, target),
    // The archive unpacks to go/, whose VERSION starts with go<version>; split gives at least one line.
    release: (directory) => {
      const file = path.join(directory, 'go', 'VERSION');
      return existsSync(file) ? readFileSync(file, 'utf8').split('\n')[0]!.replace(/^go/, '') : undefined;
    },
    wrappers: directory => Object.fromEntries(['go', 'gofmt'].map(name => [name, wrapperText(`${name} of Go ${version} of this checkout`, `GOTOOLCHAIN=local exec ${quote(path.join(directory, 'go', 'bin', name))} "$@"`)])),
  });
}
