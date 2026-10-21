#!/usr/bin/env node
// Installs the tools of the checkout into var/tools (`make install-tools`, ONLINE), after the bootstrap installed npm and mise:
//
//   node scripts/kit/install-tools.mts
//
// mise installs every tool of mise.toml at the release and digest of mise.lock (`mise install --locked`, by the wrapper
// var/tools/bin/mise, which keeps mise and the builds of its tools under var/tools/mise); a tool that mise.lock does not pin
// fails the install. Then kit installs what mise does not: the build backend of the Python wheels (config/toolchain.json
// pythonBackend, by the sha256 of its wheel), the Composer projects of config/phpunit (phpunit) and config/php-lint, the Rust
// toolchain of rust-toolchain.toml with its components and the Rust channels of config/toolchain.json exceptions (install-rust.mts,
// with rustup, which stays the toolchain manager of Rust) and the symbol extractors of symbolExtractors, which build with the Go
// and the Composer of mise. Each is installed only when it is declared, and an install of the release that is present changes
// nothing, so a second run installs nothing. The tools of the machine are never changed. Node.js is a tool of mise.toml, which
// the bootstrap installs first (K171); PHP is provided by the machine: install-php.mts finds the release of .php-version there and wraps it (K283). The command takes no tool names: mise.lock is one set of tools. It prints a line for each
// step and has no time limit.
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MISE_WRAPPER, NODE_WRAPPER, removeForeignTrusts } from './bootstrap/install-mise.mts';
import { NPM_WRAPPERS } from './bootstrap/install-npm.mts';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { installPhp, PHP_WRAPPERS } from './install-php.mts';
import { installPhpLint, PHP_LINT_WRAPPERS } from './install-php-lint.mts';
import { installPhpunit, PHPUNIT_WRAPPERS } from './install-phpunit.mts';
import { installRustChannels, installRustToolchain } from './install-rust.mts';
import { installExtractor } from './install-symbols.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { installBackend } from './release-backend.mts';
import { readExceptions } from './toolchain-exceptions.mts';
import { declaredLintTools } from './toolchain-lint.mts';

/** Installs the tools of mise.lock and the declared tools that mise does not install into var/tools of `root`. */
export function installTools({ root = repositoryRoot(), print = () => {} }: { root?: string; print?: (text: string) => void } = {}): void {
  // A var that is a symbolic link belongs to another checkout: each checkout keeps its own var/tools and its own mise state (K469-1).
  const variables = path.join(root, 'var');
  if (existsSync(variables) && lstatSync(variables).isSymbolicLink()) throw new Error(`${variables} is a symbolic link; each checkout keeps its own var, so make install-tools refuses to write the var of another checkout (K469-1)`);
  const mise = toolsPath(root, 'bin', 'mise');
  if (!existsSync(mise)) throw new Error(`${path.relative(root, mise)} is missing; run make install-tools TOOLS=npm, the bootstrap that installs mise`);
  // The trusted-configs of mise keep the trust of this checkout only: the entries of the home directory, of other checkouts and of removed worktrees go (K397).
  removeForeignTrusts(root);
  // The Rust channels that the exceptions declare; a malformed exception fails here, as toolchain-check reports it.
  const exceptions = readExceptions(root);
  if (exceptions.findings.length > 0) throw new Error(exceptions.findings.join('\n'));
  const rustChannels = [...new Set(exceptions.exceptions.filter(exception => exception.tool === 'rust').map(exception => exception.channel))];
  const { pythonBackend, phpunit, php, symbolExtractors } = declaredToolchain(root);
  const { phpLint } = declaredLintTools(root);
  // var/tools/bin comes first on PATH, so a wrapper that kit no longer writes would shadow the shims of mise in this run too.
  removeStaleWrappers(root, [MISE_WRAPPER, NODE_WRAPPER, ...Object.keys(NPM_WRAPPERS), ...(php ? PHP_WRAPPERS : []), ...(phpunit ? Object.keys(PHPUNIT_WRAPPERS) : []), ...(phpLint ? Object.keys(PHP_LINT_WRAPPERS) : [])], print);
  // The wrapper sets the environment of mise itself; the installs of kit that follow run the tools of mise.
  run(mise, ['install', '--locked'], { cwd: root, env: process.env }, print);
  const env = toolsEnvironment(root);
  // The wrappers of php come before the installs that run Composer, so that Composer runs on the pinned PHP.
  if (php) installPhp({ root, print });
  if (pythonBackend) installBackend({ root, env, requirement: pythonBackend.requirement, digests: [pythonBackend.sha256], source: pythonBackend.source, print });
  if (phpunit) installPhpunit({ root, declared: phpunit, print });
  if (phpLint) installPhpLint({ root, declared: phpLint, print });
  if (existsSync(path.join(root, 'rust-toolchain.toml'))) installRustToolchain({ root, print });
  if (rustChannels.length > 0) installRustChannels({ root, channels: rustChannels, print });
  for (const extractor of symbolExtractors?.extractors ?? []) installExtractor({ root, extractor, print });
}

/**
 * Removes each file of var/tools/bin of `root` that is not one of `written`, the wrappers that the bootstrap and install-tools
 * write for the declarations of the checkout: a wrapper of an older kit, such as the go, gofmt, python3 and alint of kit 0.0.38,
 * which now come from mise, would shadow the shims of mise on PATH (K149).
 */
function removeStaleWrappers(root: string, written: readonly string[], print: (text: string) => void): void {
  for (const name of readdirSync(toolsPath(root, 'bin')).filter(name => !written.includes(name)).sort()) {
    rmSync(toolsPath(root, 'bin', name), { recursive: true });
    print(`removed ${path.relative(root, toolsPath(root, 'bin', name))}`);
  }
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error(`install-tools takes no tool names; it installs every tool of mise.lock and the declared tools that mise does not install, and it was given ${process.argv.slice(2).join(' ')}`);
    installTools({ print: text => console.log(`[install-tools] ${text}`) });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[install-tools] ${error.message}`);
    process.exitCode = 1;
  }
}
