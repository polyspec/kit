// Installs the symbol extractors of the language-parity check (parity-symbols.mts) that config/toolchain.json
// symbolExtractors declares, into var/tools/symbols-<extractor>:
//   go   the Go program of scripts/kit/symbols/go, which reads the types of a module with golang.org/x/tools/go/packages at
//        the release that its go.mod and go.sum pin, built with `go build` of the Go of mise.toml into bin/kit-symbols-go (the
//        go of the install that `mise where go` prints in the checkout, not the shim, which would read the mise.toml of a
//        linked kit checkout, K199), in the Go environment of mise (miseInstallEnvironment: -mod=readonly, GOPATH and GOCACHE
//        under var/tools) and with
//        GOWORK=off: the extractor is a module of its own, which lies under node_modules of the consumer, so a go.work of the
//        consumer does not list it (`go help environment`)
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
import { miseInstallEnvironment, miseWhere } from './bootstrap/install-mise.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { declaredToolchain, type InstalledExtractor } from './bootstrap/toolchain-declared.mts';
import { declaredMiseTools, MISE_TOOLS } from './toolchain-mise.mts';
import { isMain, repositoryRoot } from './paths.mts';

// The extractor programs that kit ships beside its tools (the build copies scripts/kit/symbols into dist/symbols).
export const SYMBOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'symbols');

/** The installation directory of the extractor `extractor` under `root`. */
export const symbolsPrefix = (root: string, extractor: InstalledExtractor): string => toolsPath(root, `symbols-${extractor}`);

/**
 * The release of the extractor `extractor`: the sha256 of the names and contents of its source files, the files of its folder.
 * The folder holds no other folder but vendor/, the packages that kit's Makefile installs there for its own PHP lint
 * (kit-install-symbols-php, K248-4), which are no source; another folder throws.
 */
export function extractorRelease(extractor: InstalledExtractor, symbols = SYMBOLS): string {
  const directory = path.join(symbols, extractor);
  const entries = readdirSync(directory, { withFileTypes: true }).filter(entry => !(entry.isDirectory() && entry.name === 'vendor'));
  const folders = entries.filter(entry => !entry.isFile()).map(entry => entry.name);
  if (folders.length) throw new Error(`${directory} holds ${folders.join(', ')}, which is no source file; an extractor is the files of its folder`);
  return sha256(entries.map(entry => entry.name).sort().map(file => `${file}\0${sha256(readFileSync(path.join(directory, file)))}\n`).join(''));
}

/** The release that an installation in `directory` records, or undefined when it has no RELEASE; another read error throws. */
function installedRelease(directory: string): string | undefined {
  const file = path.join(directory, 'RELEASE');
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // Only a missing file means that nothing is installed; any other error is a broken installation.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`${file} cannot be read: ${error.message}`, { cause: error });
  }
}

const GO_MISSING = 'the go symbol extractor needs the Go of mise.toml; declare go in mise.toml and run make install-tools';

/** The go of the install of the Go of mise.toml of `root`, which `mise where go` names in `root`. */
function goCommand(root: string): string {
  let directory: string;
  try {
    directory = miseWhere(root, MISE_TOOLS.go.key);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`${GO_MISSING}: ${error.message}`, { cause: error });
  }
  const go = path.join(directory, 'bin', MISE_TOOLS.go.command);
  if (!existsSync(go)) throw new Error(`${GO_MISSING}: ${go} does not exist`);
  return go;
}

// How each extractor is built into the temporary directory `next` for the checkout `root`.
const BUILDS: Record<InstalledExtractor, (root: string, next: string, print: (text: string) => void) => void> = {
  php: (root, next, print) => {
    const composer = composerCommand(root, 'the php symbol extractor');
    for (const file of ['composer.json', 'composer.lock']) copyFileSync(path.join(SYMBOLS, 'php', file), path.join(next, file));
    run(composer, ['install', '--no-interaction', '--no-progress', '--no-scripts', '--no-plugins', '--prefer-dist'], { cwd: next, env: composerEnvironment(root) }, print);
  },
  // The Go of mise.toml of the checkout by its absolute path, never a go of the machine nor the shim: the build runs in the
  // extractor sources, which a linked kit puts in the kit checkout, whose mise.toml the shim would read and the checkout does not
  // trust (K199).
  go: (root, next, print) => {
    const go = goCommand(root);
    run(go, ['build', '-trimpath', '-o', path.join(next, 'bin', 'kit-symbols-go'), '.'], { cwd: path.join(SYMBOLS, 'go'), env: { ...toolsEnvironment(root), ...miseInstallEnvironment(root), GOWORK: 'off' } }, print);
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

/** Installs only the requested, declared extractors; their pinned runtime prerequisites must be declared before any build starts. */
export function installDeclaredExtractors({
  root = repositoryRoot(), extractors, print = () => {}, install = installExtractor,
}: {
  root?: string;
  extractors: readonly string[];
  print?: (text: string) => void;
  install?: typeof installExtractor;
}) {
  if (extractors.length === 0 || extractors.some(name => name.trim() === '')) throw new Error('EXTRACTORS must name one or more declared symbol extractors; run make kit-install-symbols EXTRACTORS="go" or EXTRACTORS="php"');
  if (new Set(extractors).size !== extractors.length) throw new Error(`EXTRACTORS repeats a symbol extractor: ${extractors.join(', ')}`);
  const isExtractor = (name: string): name is InstalledExtractor => name === 'go' || name === 'php';
  const selected = extractors.filter(isExtractor);
  const unknown = extractors.filter(name => !isExtractor(name));
  if (unknown.length) throw new Error(`unknown symbol extractor${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}; choose go, php`);
  const toolchain = declaredToolchain(root);
  const declared = toolchain.symbolExtractors?.extractors;
  if (!declared) throw new Error('config/toolchain.json does not declare symbolExtractors; declare the requested extractor before installing it');
  const undeclared = selected.filter(name => !declared.includes(name));
  if (undeclared.length) throw new Error(`${undeclared.join(', ')} is not declared in config/toolchain.json symbolExtractors; declare it before installing it`);

  const mise = declaredMiseTools(root);
  if (selected.includes('go') && !mise.go) throw new Error('the Go symbol extractor needs go in mise.toml; run make install-tools TOOLS=go');
  if (selected.includes('php')) {
    if (!mise.composer) throw new Error('the PHP symbol extractor needs http:composer in mise.toml; run make install-tools TOOLS=php composer');
    if (!toolchain.php || !existsSync(path.join(root, '.php-version'))) throw new Error('the PHP symbol extractor needs the PHP wrapper of .php-version; run make install-tools TOOLS=php composer');
  }
  return selected.map(extractor => install({ root, extractor, print }));
}

if (isMain(import.meta.url)) {
  try {
    installDeclaredExtractors({ extractors: process.argv.slice(2), print: text => console.log(`[install-symbols] ${text}`) });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[install-symbols] ${error.message}`);
    process.exitCode = 1;
  }
}
