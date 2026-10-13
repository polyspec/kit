// Installs the symbol extractors of the language-parity check (parity-symbols.mts) that config/toolchain.json
// symbolExtractors declares, into var/tools/symbols-<extractor>:
//   go   the Go program of scripts/kit/symbols/go, which reads the types of a module with golang.org/x/tools/go/packages at
//        the release that its go.mod and go.sum pin, built with `go build` of var/tools/bin/go, the Go of the kit pin, into bin/kit-symbols-go
//   php  the Composer project of scripts/kit/symbols/php, whose composer.lock pins nikic/php-parser, installed into vendor
//        with the composer.phar of var/tools/composer (the declared composer) as install-phpunit.mts installs PHPUnit
// The release of an extractor is the sha256 of its source files, written to RELEASE beside the build, so a kit release that
// changes an extractor rebuilds it and a second run installs nothing. Each build goes into a temporary directory beside the
// target and is renamed into place (install-tool.mts); nothing is installed into the machine.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './bootstrap/digest.mts';
import { installOnce } from './bootstrap/install-tool.mts';
import { bootstrapEnvironment, run, toolsPath } from './bootstrap/tool-wrappers.mts';
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
    const composer = toolsPath(root, 'composer', 'composer.phar');
    if (!existsSync(composer)) throw new Error(`the php symbol extractor needs ${path.relative(root, composer)}, the Composer that config/toolchain.json composer declares; declare composer and run make install-tools`);
    for (const file of ['composer.json', 'composer.lock']) copyFileSync(path.join(SYMBOLS, 'php', file), path.join(next, file));
    const environment = bootstrapEnvironment(root, { COMPOSER_HOME: toolsPath(root, 'composer', 'home'), COMPOSER_CACHE_DIR: toolsPath(root, 'composer', 'cache') });
    run('php', [composer, 'install', '--no-interaction', '--no-progress', '--no-scripts', '--no-plugins', '--prefer-dist'], { cwd: next, env: environment }, print);
  },
  // The Go of the kit pin that install-tools installs into var/tools, never a go of the machine.
  go: (root, next, print) => {
    const go = toolsPath(root, 'bin', 'go');
    if (!existsSync(go)) throw new Error(`the go symbol extractor needs ${path.relative(root, go)}, the Go of the kit pin; run make install-tools`);
    run(go, ['build', '-trimpath', '-o', path.join(next, 'bin', 'kit-symbols-go'), '.'], { cwd: path.join(SYMBOLS, 'go'), env: bootstrapEnvironment(root, { GOFLAGS: '-modcacherw' }) }, print);
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
