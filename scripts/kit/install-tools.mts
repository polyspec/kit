#!/usr/bin/env node
// Installs the toolchains that the checkout declares into var/tools (`make install-tools`), which the Makefile puts first
// on PATH through the wrappers of var/tools/bin:
//
//   node scripts/kit/install-tools.mts [tool...]      the tools: uv python pythonBackend npm go ruff composer phpunit cargoAudit govulncheck
//
// Without arguments every declared tool is installed; with arguments only the named tools, each of which must be declared
// (uv installs the Python, so a python that is named without uv needs uv installed first; ruff runs with that Python).
// Python (pythonBuild), npm, Go, ruff, uv, Composer (with a sha256), PHPUnit (the Composer project of config/phpunit), cargo-audit and govulncheck are installed by their own modules; the
// declarations are read by toolchain-declared.mts. Each tool is installed only when it is declared, and an install is skipped when the exact
// release is present, so a second run changes nothing. The tools of the machine are never changed. Node.js, Rust and PHP
// are verified by check-toolchain.mts, not installed. The command prints a line for each step and has no time limit.
import { installCargoAudit } from './install-cargo-audit.mts';
import { installComposer } from './install-composer.mts';
import { installPhpunit } from './install-phpunit.mts';
import { installGo } from './install-go.mts';
import { installGovulncheck } from './install-govulncheck.mts';
import { installNpm } from './install-npm.mts';
import { installPython } from './install-python.mts';
import { installBackend } from './release-backend.mts';
import { installRuff } from './install-ruff.mts';
import { installUv } from './install-uv.mts';
import { declaredToolchain } from './toolchain-declared.mts';
import { isMain, ROOT } from './paths.mts';

/** The declarations of declaredToolchain (toolchain-declared.mts) that install-tools reads. */
interface Declared {
  pythonBuild?: unknown;
  pythonBackend?: { requirement: string; sha256: string; source: string };
  npm?: unknown;
  go?: unknown;
  ruff?: unknown;
  uv?: unknown;
  composer?: { sha256?: string };
  phpunit?: unknown;
  cargoAudit?: { version: string };
  govulncheck?: { version: string };
}

const TOOLS = ['python', 'pythonBackend', 'npm', 'go', 'ruff', 'uv', 'composer', 'phpunit', 'cargoAudit', 'govulncheck'];

/**
 * Installs the declared tools into var/tools of `root`, or only `tools` (names of TOOLS, each declared); returns the names of
 * the tools it installed.
 */
export function installTools({ root = ROOT, tools = null, print = () => {} }: { root?: string; tools?: string[] | null; print?: (text: string) => void } = {}): string[] {
  const declared: Declared = declaredToolchain(root);
  const present: Record<string, unknown> = {
    python: declared.pythonBuild, pythonBackend: declared.pythonBackend, npm: declared.npm, go: declared.go, ruff: declared.ruff, uv: declared.uv, composer: declared.composer?.sha256, phpunit: declared.phpunit, cargoAudit: declared.cargoAudit, govulncheck: declared.govulncheck,
  };
  for (const name of tools ?? []) {
    if (!TOOLS.includes(name)) throw new Error(`unknown tool ${name}; the tools are ${TOOLS.join(', ')}`);
    if (!present[name]) throw new Error(`${name} is not declared; declare it in config/toolchain.json or in its file, or leave it out of the tools to install`);
  }
  const wanted = (name: string) => present[name] && (tools === null || tools.length === 0 || tools.includes(name));
  const installed: string[] = [];
  const step = (name: string, tool: () => { installed: unknown }) => { if (tool().installed) installed.push(name); };
  if (wanted('npm')) step('npm', () => installNpm({ root, declared: declared.npm, print }));
  if (wanted('go')) step('go', () => installGo({ root, declared: declared.go, print }));
  if (wanted('uv')) step('uv', () => installUv({ root, declared: declared.uv, print }));
  if (wanted('python')) step('python', () => installPython({ root, declared: declared.pythonBuild, print }));
  // wanted holds only a declared tool.
  if (wanted('pythonBackend')) step('pythonBackend', () => { const { installed } = installBackend({ root, env: process.env, requirement: declared.pythonBackend!.requirement, digests: [declared.pythonBackend!.sha256], source: declared.pythonBackend!.source, print }); return { installed }; });
  if (wanted('ruff')) step('ruff', () => installRuff({ root, declared: declared.ruff, print }));
  if (wanted('composer')) step('composer', () => installComposer({ root, declared: declared.composer, print }));
  if (wanted('phpunit')) step('phpunit', () => installPhpunit({ root, declared: declared.phpunit, print }));
  // wanted holds only a declared tool.
  if (wanted('cargoAudit')) step('cargo-audit', () => installCargoAudit({ root, recorded: declared.cargoAudit!.version, print }));
  // wanted holds only a declared tool.
  if (wanted('govulncheck')) step('govulncheck', () => installGovulncheck({ root, recorded: declared.govulncheck!.version, print }));
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
