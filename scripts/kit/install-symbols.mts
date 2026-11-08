// Installs the PHP programs of kit (scripts/kit/symbols/php) that lint-php and php-extension run, when the EXTRACTORS argument
// names php, or with --declared when config/toolchain.json symbolExtractors names it, into var/tools/symbols-php (K1071): the
// Composer project of scripts/kit/symbols/php, whose composer.lock pins nikic/php-parser, installed into vendor with the
// Composer of mise.toml, with the environment of the caller and no flag of kit (K1095).
// Each install builds the extractor again, and Composer keeps its own cache (K861); the build goes into a temporary
// directory beside the target and is renamed into place (install-tool.mts); nothing is installed into the machine.
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceInstall } from './bootstrap/install-tool.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { toolCommand } from './mise-tools.mts';
import { declaredToolchain, type InstalledExtractor } from './bootstrap/toolchain-declared.mts';
import { declaredMiseTools } from './toolchain-mise.mts';
import { isMain, repositoryRoot } from './paths.mts';

// The extractor programs that kit ships beside its tools (the build copies scripts/kit/symbols into dist/symbols).
export const SYMBOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'symbols');

/** The installation directory of the extractor `extractor` under `root`. */
export const symbolsPrefix = (root: string, extractor: InstalledExtractor): string => toolsPath(root, `symbols-${extractor}`);

// How each extractor is built into the temporary directory `next` for the checkout `root`.
const BUILDS: Record<InstalledExtractor, (root: string, next: string, print: (text: string) => void) => void> = {
  php: (root, next, print) => {
    const composer = toolCommand(root, 'composer');
    for (const file of ['composer.json', 'composer.lock']) copyFileSync(path.join(SYMBOLS, 'php', file), path.join(next, file));
    run(composer, ['install'], { cwd: next, env: process.env }, print);
  },
};

/** Installs the extractor `extractor` into var/tools of `root`, built again on each install (K861). */
export function installExtractor({ root, extractor, print = () => {} }: { root: string; extractor: InstalledExtractor; print?: (text: string) => void }): void {
  const prefix = symbolsPrefix(root, extractor);
  replaceInstall(prefix, next => BUILDS[extractor](root, next, print));
  print(`the ${extractor} symbol extractor: installed in ${path.relative(root, prefix)}`);
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
  if (extractors.length === 0 || extractors.some(name => name.trim() === '')) throw new Error('EXTRACTORS must name one or more symbol extractors; run make kit-install-symbols EXTRACTORS="php"');
  if (new Set(extractors).size !== extractors.length) throw new Error(`EXTRACTORS repeats a symbol extractor: ${extractors.join(', ')}`);
  const isExtractor = (name: string): name is InstalledExtractor => name === 'php';
  const selected = extractors.filter(isExtractor);
  const unknown = extractors.filter(name => !isExtractor(name));
  if (unknown.length) throw new Error(`unknown symbol extractor${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}; choose php`);
  // The EXTRACTORS argument names what to install; config/toolchain.json need not repeat it (K1071).
  const toolchain = declaredToolchain(root);

  const mise = declaredMiseTools(root);
  if (selected.includes('php')) {
    if (!mise.composer) throw new Error('the PHP symbol extractor needs http:composer in mise.toml; run make install-tools TOOLS=php composer');
    if (!toolchain.php) throw new Error('the PHP symbol extractor needs PHP declared by .php-version or config/toolchain.json php; run make install-tools TOOLS=php composer');
  }
  for (const extractor of selected) install({ root, extractor, print });
}

/**
 * Installs every extractor that config/toolchain.json symbolExtractors declares, and nothing without one (`--declared`, for make
 * kit-install-declared, K861); returns the declared extractors.
 */
export function installDeclared({ root = repositoryRoot(), print = () => {}, install = installExtractor }: { root?: string; print?: (text: string) => void; install?: typeof installExtractor } = {}): readonly string[] {
  const extractors = declaredToolchain(root).symbolExtractors?.extractors ?? [];
  if (extractors.length) installDeclaredExtractors({ root, extractors, print, install });
  return extractors;
}

if (isMain(import.meta.url)) {
  try {
    const print = (text: string) => console.log(`[install-symbols] ${text}`);
    if (process.argv[2] === '--declared') installDeclared({ print });
    else installDeclaredExtractors({ extractors: process.argv.slice(2), print });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[install-symbols] ${error.message}`);
    process.exitCode = 1;
  }
}
