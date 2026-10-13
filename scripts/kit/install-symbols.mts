// Installs the symbol extractors of the language-parity check (parity-symbols.mts) that config/toolchain.json
// symbolExtractors declares, into var/tools/symbols-<extractor>:
//   go   the Go program of scripts/kit/symbols/go, which reads the types of a module with golang.org/x/tools/go/packages at
//        the release that its go.mod and go.sum pin, built with `go build` of the Go of mise.toml into bin/kit-symbols-go
//   php  the Composer project of scripts/kit/symbols/php, whose composer.lock pins nikic/php-parser, installed into vendor
//        with the Composer of mise.toml as install-phpunit.mts installs PHPUnit
// The release of an extractor is the sha256 of its source files, written to RELEASE beside the build, so a kit release that
// changes an extractor rebuilds it and a second run installs nothing. Each build goes into a temporary directory beside the
// target and is renamed into place (install-tool.mts); nothing is installed into the machine.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './bootstrap/digest.mts';
import { installOnce } from './bootstrap/install-tool.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
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

/** The release that an installation in `directory` records, or undefined when it has no RELEASE; another read error throws. */
function installedRelease(directory: string): string | undefined {
  const file = path.join(directory, 'RELEASE');
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    // Only a missing file means that nothing is installed; any other error is a broken installation.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`${file} cannot be read: ${(error as Error).message}`);
  }
}

// How each extractor is built into the temporary directory `next` for the checkout `root`.
const BUILDS: Record<InstalledExtractor, (root: string, next: string, print: (text: string) => void) => void> = {
  php: (root, next, print) => {
    const composer = composerCommand(root, 'the php symbol extractor');
    for (const file of ['composer.json', 'composer.lock']) copyFileSync(path.join(SYMBOLS, 'php', file), path.join(next, file));
    run(composer, ['install', '--no-interaction', '--no-progress', '--no-scripts', '--no-plugins', '--prefer-dist'], { cwd: next, env: composerEnvironment(root) }, print);
  },
  // The Go of mise.toml, through its shim, never a go of the machine.
  go: (root, next, print) => {
    const go = toolCommand(root, 'go');
    if (!existsSync(go)) throw new Error(`the go symbol extractor needs ${path.relative(root, go)}, the Go of mise.toml; declare go in mise.toml and run make install-tools`);
    run(go, ['build', '-trimpath', '-o', path.join(next, 'bin', 'kit-symbols-go'), '.'], { cwd: path.join(SYMBOLS, 'go'), env: { ...toolsEnvironment(root), GOFLAGS: '-modcacherw' } }, print);
  },
};

/** Installs the extractor `extractor` into var/tools of `root` unless its release is installed there. */
export function installExtractor({ root, extractor, print = () => {} }: { root: string; extractor: InstalledExtractor; print?: (text: string) => void }) {
  const release = extractorRelease(extractor);
  return installOnce({
    root, label: `the ${extractor} symbol extractor`, prefix: symbolsPrefix(root, extractor), recorded: release, installedRelease, print,
    install: (next: string) => {
      BUILDS[extractor](root, next, print);
      writeFileSync(path.join(next, 'RELEASE'), release);
    },
  });
}
