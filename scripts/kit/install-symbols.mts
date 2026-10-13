// Installs the symbol extractors of the language-parity check (parity-symbols.mts) that config/toolchain.json
// symbolExtractors declares, into var/tools/symbols-<extractor>:
//   go   the Go program of scripts/kit/symbols/go, which reads the types of a module with golang.org/x/tools/go/packages at
//        the release that its go.mod and go.sum pin, built with `go build` into bin/kit-symbols-go
// The release of an extractor is the sha256 of its source files, written to RELEASE beside the build, so a kit release that
// changes an extractor rebuilds it and a second run installs nothing. Each build goes into a temporary directory beside the
// target and is renamed into place (install-tool.mts); nothing is installed into the machine.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './bootstrap/digest.mts';
import { installOnce } from './bootstrap/install-tool.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import type { InstalledExtractor } from './bootstrap/toolchain-declared.mts';

// The extractor programs that kit ships beside its tools (the build copies scripts/kit/symbols into dist/symbols).
export const SYMBOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'symbols');

/** The installation directory of the extractor `extractor` under `root`. */
export const symbolsPrefix = (root: string, extractor: InstalledExtractor): string => toolsPath(root, `symbols-${extractor}`);

/** The release of the extractor `extractor`: the sha256 of the names and contents of its source files. */
export function extractorRelease(extractor: InstalledExtractor): string {
  const directory = path.join(SYMBOLS, extractor);
  return sha256(readdirSync(directory).sort().map(file => `${file}\0${sha256(readFileSync(path.join(directory, file)))}\n`).join(''));
}

/** The release that an installation in `directory` records, or undefined when it records none. */
function installedRelease(directory: string): string | undefined {
  try {
    return readFileSync(path.join(directory, 'RELEASE'), 'utf8');
  } catch {
    return undefined;
  }
}

// How each extractor is built into the temporary directory `next`.
const BUILDS: Record<InstalledExtractor, (next: string, print: (text: string) => void) => void> = {
  go: (next, print) => run('go', ['build', '-trimpath', '-o', path.join(next, 'bin', 'kit-symbols-go'), '.'], { cwd: path.join(SYMBOLS, 'go'), env: { ...process.env, GOFLAGS: '-modcacherw' } }, print),
};

/** Installs the extractor `extractor` into var/tools of `root` unless its release is installed there. */
export function installExtractor({ root, extractor, print = () => {} }: { root: string; extractor: InstalledExtractor; print?: (text: string) => void }) {
  const release = extractorRelease(extractor);
  return installOnce({
    root, label: `the ${extractor} symbol extractor`, prefix: symbolsPrefix(root, extractor), recorded: release, installedRelease, print,
    install: (next: string) => {
      BUILDS[extractor](next, print);
      writeFileSync(path.join(next, 'RELEASE'), release);
    },
  });
}
