#!/usr/bin/env node
// Installs the toolchains that the checkout declares into var/tools (`make install-tools`), which the Makefile puts first
// on PATH through the wrappers of var/tools/bin:
//
//   node scripts/kit/install-tools.mts [tool...]      the tools: uv python pythonBackend npm go ruff composer phpunit cargoAudit govulncheck alint phpLint vulture golangciLint deadcode symbolExtractors
//
// Without arguments every declared tool is installed; with arguments only the named tools, each of which must be declared
// (uv installs the Python, so a python that is named without uv needs uv installed first; ruff runs with that Python).
// Python (pythonBuild), npm, Go, ruff, uv, Composer (with a sha256), PHPUnit (the Composer project of config/phpunit), cargo-audit, govulncheck, alint, the PHP lint (the Composer project of config/php-lint), vulture, golangci-lint, deadcode and the symbol extractors of parity (install-symbols.mts) are installed by their own modules; the
// declarations are read by toolchain-declared.mts and the lint tools by toolchain-lint.mts; Go, wanted by a checkout that tracks a go.mod, is the release of the kit pin
// from its archive (toolchain-pins.json goArchives). Each tool is installed only when it is declared, and an install is skipped when the exact
// release is present, so a second run changes nothing. The tools of the machine are never changed. Node.js, Rust and PHP
// are verified by check-toolchain.mts, not installed. The command prints a line for each step and has no time limit.
import path from 'node:path';
import { installAlint } from './install-alint.mts';
import { installCargoAudit } from './install-cargo-audit.mts';
import { installDeadcode } from './install-deadcode.mts';
import { installGolangciLint } from './install-golangci-lint.mts';
import { installComposer } from './install-composer.mts';
import { installPhpLint } from './install-php-lint.mts';
import { installPhpunit } from './install-phpunit.mts';
import { installGo } from './install-go.mts';
import { installGovulncheck } from './install-govulncheck.mts';
import { installNpm } from './bootstrap/install-npm.mts';
import { installPython } from './install-python.mts';
import { installBackend } from './release-backend.mts';
import { installRuff } from './install-ruff.mts';
import { installExtractor } from './install-symbols.mts';
import { installUv } from './install-uv.mts';
import { installVulture } from './install-vulture.mts';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { GO_ARCHIVES, PINS } from './toolchain-pins.mts';
import { checkedFiles } from './tracked-files.mts';
import { declaredLintTools } from './toolchain-lint.mts';
import type { DeclaredToolchain } from './bootstrap/toolchain-declared.mts';
import { isMain, ROOT } from './paths.mts';

const TOOLS = ['python', 'pythonBackend', 'npm', 'go', 'ruff', 'uv', 'composer', 'phpunit', 'cargoAudit', 'govulncheck', 'alint', 'phpLint', 'vulture', 'golangciLint', 'deadcode', 'symbolExtractors'];

/**
 * Installs the declared tools into var/tools of `root`, or only `tools` (names of TOOLS, each declared); returns the names of
 * the tools it installed.
 */
export function installTools({ root = ROOT, tools = null, print = () => {} }: { root?: string; tools?: string[] | null; print?: (text: string) => void } = {}): string[] {
  const declared: DeclaredToolchain = declaredToolchain(root);
  const lint = declaredLintTools(root);
  const present: Record<string, unknown> = {
    python: declared.pythonBuild, pythonBackend: declared.pythonBackend, npm: declared.npm, go: checkedFiles(root).some(file => path.posix.basename(file) === 'go.mod'), ruff: lint.ruff, uv: declared.uv, composer: declared.composer?.sha256, phpunit: declared.phpunit, cargoAudit: declared.cargoAudit, govulncheck: declared.govulncheck, alint: declared.alint, phpLint: lint.phpLint, vulture: lint.vulture, golangciLint: lint.golangciLint, deadcode: lint.deadcode, symbolExtractors: declared.symbolExtractors,
  };
  for (const name of tools ?? []) {
    if (!TOOLS.includes(name)) throw new Error(`unknown tool ${name}; the tools are ${TOOLS.join(', ')}`);
    if (!present[name]) throw new Error(`${name} is not declared; declare it in config/toolchain.json or in its file, or leave it out of the tools to install`);
  }
  const wanted = (name: string) => present[name] && (tools === null || tools.length === 0 || tools.includes(name));
  const installed: string[] = [];
  const step = (name: string, tool: () => { installed: unknown }) => { if (tool().installed) installed.push(name); };
  // wanted is true only for a declared tool, so each test of a declaration below passes whenever wanted does.
  const { npm, uv, pythonBuild, pythonBackend, composer, phpunit, cargoAudit, govulncheck, alint, symbolExtractors } = declared;
  const { ruff, vulture, golangciLint, deadcode, phpLint } = lint;
  if (npm && wanted('npm')) step('npm', () => installNpm({ root, declared: npm, print }));
  if (wanted('go')) {
    // A checkout that holds a go.mod needs Go: the release of the kit pin, which toolchain-check compares with the go.mod.
    step('go', () => installGo({ root, version: PINS.go, sha256: GO_ARCHIVES, print }));
  }
  if (uv && wanted('uv')) step('uv', () => installUv({ root, declared: uv, print }));
  if (pythonBuild && wanted('python')) step('python', () => installPython({ root, declared: pythonBuild, print }));
  if (pythonBackend && wanted('pythonBackend')) step('pythonBackend', () => { const { installed } = installBackend({ root, env: process.env, requirement: pythonBackend.requirement, digests: [pythonBackend.sha256], source: pythonBackend.source, print }); return { installed }; });
  if (ruff && wanted('ruff')) step('ruff', () => installRuff({ root, declared: ruff, print }));
  if (composer && wanted('composer')) {
    const { sha256 } = composer;
    // wanted holds a declared sha256; one that is no text is refused here by name.
    if (typeof sha256 !== 'string') throw new Error(`config/toolchain.json composer.sha256 is ${JSON.stringify(sha256)}, not the text of a sha256`);
    step('composer', () => installComposer({ root, declared: { ...composer, sha256 }, print }));
  }
  if (phpunit && wanted('phpunit')) step('phpunit', () => installPhpunit({ root, declared: phpunit, print }));
  if (cargoAudit && wanted('cargoAudit')) step('cargo-audit', () => installCargoAudit({ root, recorded: cargoAudit.version, print }));
  if (govulncheck && wanted('govulncheck')) step('govulncheck', () => installGovulncheck({ root, recorded: govulncheck.version, print }));
  if (alint && wanted('alint')) step('alint', () => installAlint({ root, declared: alint, print }));
  if (phpLint && wanted('phpLint')) step('phpLint', () => installPhpLint({ root, declared: phpLint, print }));
  if (vulture && wanted('vulture')) step('vulture', () => installVulture({ root, declared: vulture, print }));
  if (golangciLint && wanted('golangciLint')) step('golangciLint', () => installGolangciLint({ root, declared: golangciLint, print }));
  if (deadcode && wanted('deadcode')) step('deadcode', () => installDeadcode({ root, recorded: deadcode.version, print }));
  // The extractors build with the Go and the Composer installed above.
  for (const extractor of symbolExtractors && wanted('symbolExtractors') ? symbolExtractors.extractors : []) step(`symbols-${extractor}`, () => installExtractor({ root, extractor, print }));
  return installed;
}

if (isMain(import.meta.url)) {
  try {
    installTools({ tools: process.argv.slice(2), print: text => console.log(`[install-tools] ${text}`) });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[install-tools] ${error.message}`);
    process.exitCode = 1;
  }
}
