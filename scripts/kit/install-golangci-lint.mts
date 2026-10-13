// Installs the golangci-lint release that config/toolchain.json golangciLint declares into var/tools/golangci-lint, with the
// wrapper golangci-lint in var/tools/bin, by install-archive.mts. golangci-lint runs the Go linters of .golangci.yml in each Go
// module (`make lint-go`). The archive is golangci-lint-<version>-<os>-<arch>.tar.gz of the GitHub release for this platform,
// whose digests the release lists in golangci-lint-<version>-checksums.txt.
import path from 'node:path';
import { printedRelease, quote, wrapperText } from './bootstrap/tool-wrappers.mts';
import { installArchive } from './install-archive.mts';

// The target of the golangci-lint archive of each platform key (process.platform-process.arch) that the declaration may name.
export const GOLANGCI_LINT_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-amd64',
  'linux-x64': 'linux-amd64',
  'linux-arm64': 'linux-arm64',
};

/** The name of the golangci-lint archive of `version` for the target `target`, without .tar.gz: also the folder it unpacks to. */
export const golangciLintArchive = (version: string, target: string): string => `golangci-lint-${version}-${target}`;

/** The download URL of the golangci-lint archive of `version` for the target `target`. */
export const golangciLintArchiveUrl = (version: string, target: string): string => `https://github.com/golangci/golangci-lint/releases/download/v${version}/${golangciLintArchive(version, target)}.tar.gz`;

/** Installs the declared golangci-lint `{ version, sha256 }` (sha256 by platform key) into var/tools/golangci-lint of `root` and writes the wrapper. */
export function installGolangciLint({ root, declared, platform = `${process.platform}-${process.arch}`, print = () => {} }: { root: string; declared: { version: string; sha256: Readonly<Record<string, unknown>> }; platform?: string; print?: (text: string) => void }) {
  const binary = (directory: string, target: string) => path.join(directory, golangciLintArchive(declared.version, target), 'golangci-lint');
  return installArchive({
    tool: 'golangci-lint', source: 'config/toolchain.json golangciLint', root, declared, platform, targets: GOLANGCI_LINT_TARGETS, print,
    archive: target => golangciLintArchive(declared.version, target),
    url: target => golangciLintArchiveUrl(declared.version, target),
    release: (directory, target) => printedRelease(binary(directory, target), 'golangci-lint'),
    wrappers: (directory, target) => ({ 'golangci-lint': wrapperText(`golangci-lint ${declared.version} of this checkout`, `exec ${quote(binary(directory, target))} "$@"`) }),
  });
}
