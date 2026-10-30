#!/usr/bin/env node
// Installs the tools of the checkout into var/tools (`make install-tools`, ONLINE), after the bootstrap installed npm and mise:
//
//   node scripts/kit/install-tools.mts
//
// mise installs every tool of mise.toml at the release and digest of mise.lock (`mise install --locked`, by the wrapper
// var/tools/bin/mise, which keeps mise and the builds of its tools under var/tools/mise); a tool that mise.lock does not pin
// fails the install. Then kit installs what mise does not: the Composer projects of config/phpunit (phpunit) and config/php-lint, the Rust
// toolchain of rust-toolchain.toml with its components and the Rust channels of config/toolchain.json exceptions (install-rust.mts,
// with rustup, which stays the toolchain manager of Rust), PHP's pinned arginfo parser when packages/php-ext is declared, and the symbol
// extractors of symbolExtractors, which build with the Go and the Composer of mise. Each is installed only when it is declared, and an install of the release that is present changes
// nothing, so a second run installs nothing. The tools of the machine are never changed. Node.js is a tool of mise.toml, which
// the bootstrap installs first (K171); PHP is provided by the machine: install-php.mts finds the release of .php-version there and wraps it (K283). With no selectors the command installs all tools. A selector list of the tool names of toolchain-mise.mts installs only those pinned tools and their prerequisites, for example `make install-tools TOOLS="go python"`. Unknown, empty and undeclared selectors fail before the checkout is changed. `TOOLS=npm` remains the bootstrap. It prints a line for each
// step and has no time limit.
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MISE_WRAPPER, NODE_WRAPPER, miseBinary, miseInstallEnvironment, removeForeignTrusts } from './bootstrap/install-mise.mts';
import { NPM_WRAPPERS } from './bootstrap/install-npm.mts';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { installPhp, PHP_WRAPPERS } from './install-php.mts';
import { installPhpArginfo } from './install-php-arginfo.mts';
import { installPhpLint, PHP_LINT_WRAPPERS } from './install-php-lint.mts';
import { installPhpunit, PHPUNIT_WRAPPERS } from './install-phpunit.mts';
import { installRustChannels, installRustToolchain } from './install-rust.mts';
import { installExtractor } from './install-symbols.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readExceptions } from './toolchain-exceptions.mts';
import { declaredLintTools } from './toolchain-lint.mts';
import { declaredMiseTools, MISE_TOOLS, TOOLS as TOOLCHAIN_TOOLS } from './toolchain-mise.mts';
import { declaredRust } from './toolchain-files.mts';

type InstallSelector = Exclude<(typeof TOOLCHAIN_TOOLS)[number], 'npm' | 'mise'>;

const SELECTORS = TOOLCHAIN_TOOLS.filter((tool): tool is InstallSelector => tool !== 'npm' && tool !== 'mise');
const isInstallSelector = (tool: string): tool is InstallSelector => SELECTORS.some(selector => selector === tool);
const isMiseSelector = (tool: InstallSelector): tool is keyof typeof MISE_TOOLS => Object.hasOwn(MISE_TOOLS, tool);

function installSelection(root: string, selected: readonly string[] | undefined) {
  if (selected === undefined) return { all: true, mise: [] as string[], php: true, phpunit: true, phpLint: true, rust: true, arginfo: true, symbols: true };
  if (selected.length === 0 || selected.some(tool => tool.trim() === '')) throw new Error(`TOOLS must name one or more declared tool selectors; choose ${SELECTORS.join(', ')}`);
  const selectors = selected.filter(isInstallSelector);
  const unknown = selected.filter(tool => !isInstallSelector(tool));
  if (unknown.length) throw new Error(`unknown TOOLS selector${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}; choose ${SELECTORS.join(', ')}`);

  const declaredMise = declaredMiseTools(root);
  const declared = declaredToolchain(root);
  const declaredPhpLint = declaredLintTools(root);
  const rust = declaredRust(root);
  for (const tool of selectors) {
    const available = isMiseSelector(tool) ? declaredMise[tool]
      : tool === 'php' ? declared.php
        : tool === 'rust' ? rust
          : tool === 'phpunit' ? declared.phpunit
            : tool === 'phpcs' ? declaredPhpLint.phpcs
              : tool === 'phpstan' ? declaredPhpLint.phpstan
                : undefined;
    if (!available) throw new Error(`${tool} is not declared by this checkout; declare it in its toolchain file or omit it from TOOLS`);
  }
  const needsPhp = selected.some(tool => ['php', 'phpunit', 'phpcs', 'phpstan', 'composer'].includes(tool));
  if (needsPhp && !declared.php) throw new Error(`the selected PHP tools need PHP, but .php-version or config/toolchain.json does not declare it`);
  if (needsPhp && !existsSync(path.join(root, '.php-version'))) throw new Error(`the selected PHP tools need the PHP wrapper, but .php-version is missing; add the declared PHP minor before installing tools`);
  if (selected.some(tool => ['phpunit', 'phpcs', 'phpstan'].includes(tool)) && !declaredMise.composer) throw new Error(`the selected PHP tools need Composer, but mise.toml does not declare it`);

  const mise = new Set<string>();
  let php = selected.includes('php') || selected.includes('composer');
  let phpunit = selected.includes('phpunit');
  let phpLint = selected.includes('phpcs') || selected.includes('phpstan');
  const rustSelected = selected.includes('rust');
  for (const tool of selectors) {
    if (isMiseSelector(tool)) mise.add(MISE_TOOLS[tool].key);
    if (tool === 'deadcode' || tool === 'govulncheck' || tool === 'golangciLint') mise.add(MISE_TOOLS.go.key);
    if (tool === 'vulture') {
      mise.add(MISE_TOOLS.python.key);
      mise.add(MISE_TOOLS.uv.key);
    }
    if (tool === 'phpunit' || tool === 'phpcs' || tool === 'phpstan') {
      php = true;
      mise.add(MISE_TOOLS.composer.key);
    }
  }
  for (const name of Object.keys(MISE_TOOLS).filter((name): name is keyof typeof MISE_TOOLS => Object.hasOwn(MISE_TOOLS, name))) {
    const tool = MISE_TOOLS[name];
    if (mise.has(tool.key) && !declaredMise[name]) throw new Error(`${name} is needed by the selected TOOLS, but mise.toml does not declare ${tool.key}`);
  }
  return { all: false, mise: [...mise], php, phpunit, phpLint, rust: rustSelected, arginfo: false, symbols: false };
}

/** Installs the tools of mise.lock and the declared tools that mise does not install into var/tools of `root`. */
export function installTools({ root = repositoryRoot(), tools, print = () => {} }: { root?: string; tools?: readonly string[]; print?: (text: string) => void } = {}): void {
  const selection = installSelection(root, tools);
  // A var that is a symbolic link belongs to another checkout: each checkout keeps its own var/tools and its own mise state (K469-1).
  const variables = path.join(root, 'var');
  if (existsSync(variables) && lstatSync(variables).isSymbolicLink()) throw new Error(`${variables} is a symbolic link; each checkout keeps its own var, so make install-tools refuses to write the var of another checkout (K469-1)`);
  const mise = process.platform === 'win32' ? miseBinary(toolsPath(root, 'mise-release')) : toolsPath(root, 'bin', 'mise');
  if (!existsSync(mise)) throw new Error(`${path.relative(root, mise)} is missing; run make install-tools TOOLS=npm, the bootstrap that installs mise`);
  // The trusted-configs of mise keep the trust of this checkout only: the entries of the home directory, of other checkouts and of removed worktrees go (K397).
  removeForeignTrusts(root);
  // The Rust channels that the exceptions declare; a malformed exception fails here.
  const exceptions = readExceptions(root);
  if (exceptions.findings.length > 0) throw new Error(exceptions.findings.join('\n'));
  const rustChannels = selection.rust ? [...new Set(exceptions.exceptions.filter(exception => exception.tool === 'rust').map(exception => exception.channel))] : [];
  const { phpunit, php, symbolExtractors } = declaredToolchain(root);
  const { phpLint } = declaredLintTools(root);
  // var/tools/bin comes first on PATH, so a wrapper that kit no longer writes would shadow the shims of mise in this run too.
  if (selection.all) removeStaleWrappers(root, [MISE_WRAPPER, NODE_WRAPPER, ...Object.keys(NPM_WRAPPERS), ...(php ? PHP_WRAPPERS : []), ...(phpunit ? Object.keys(PHPUNIT_WRAPPERS) : []), ...(phpLint ? Object.keys(PHP_LINT_WRAPPERS) : [])], print);
  else removeStaleWrappers(root, [], print, selectedStaleWrappers(selection.mise));
  // The wrapper sets the environment of mise itself; the installs of kit that follow run the tools of mise.
  if (selection.all || selection.mise.length > 0) run(mise, ['install', '--locked', ...(selection.all ? [] : selection.mise)], { cwd: root, env: process.platform === 'win32' ? miseInstallEnvironment(root) : process.env }, print);
  // The wrappers of php come before the installs that run Composer, so that Composer runs on the pinned PHP.
  if (selection.php && php) installPhp({ root, print });
  if (selection.arginfo && php && existsSync(path.join(root, 'packages/php-ext'))) installPhpArginfo({ root, print });
  if (selection.phpunit && phpunit) installPhpunit({ root, declared: phpunit, print });
  if (selection.phpLint && phpLint) installPhpLint({ root, declared: phpLint, print });
  if (selection.rust && existsSync(path.join(root, 'rust-toolchain.toml'))) installRustToolchain({ root, print });
  if (rustChannels.length > 0) installRustChannels({ root, channels: rustChannels, print });
  if (selection.symbols) for (const extractor of symbolExtractors?.extractors ?? []) installExtractor({ root, extractor, print });
}

/**
 * Removes each file of var/tools/bin of `root` that is not one of `written`, the wrappers that the bootstrap and install-tools
 * write for the declarations of the checkout: a wrapper of an older kit, such as the go, gofmt, python3 and alint of kit 0.0.38,
 * which now come from mise, would shadow the shims of mise on PATH (K149).
 */
function removeStaleWrappers(root: string, written: readonly string[], print: (text: string) => void, selected?: readonly string[]): void {
  const retained = new Set(written.map(name => `${name}${process.platform === 'win32' ? '.cmd' : ''}`));
  const selectedNames = selected?.map(name => `${name}${process.platform === 'win32' ? '.cmd' : ''}`);
  for (const name of readdirSync(toolsPath(root, 'bin')).filter(name => {
    return !retained.has(name) && (!selectedNames || selectedNames.includes(name));
  }).sort()) {
    rmSync(toolsPath(root, 'bin', name), { recursive: true });
    print(`removed ${path.relative(root, toolsPath(root, 'bin', name))}`);
  }
}

/** Legacy mise aliases that can shadow a selected shim. */
function selectedStaleWrappers(mise: readonly string[]): string[] {
  const names = new Set<string>();
  if (mise.includes(MISE_TOOLS.go.key) || mise.includes(MISE_TOOLS.deadcode.key) || mise.includes(MISE_TOOLS.govulncheck.key)) names.add('go').add('gofmt');
  if (mise.includes(MISE_TOOLS.python.key) || mise.includes(MISE_TOOLS.vulture.key)) names.add('python3');
  if (mise.includes(MISE_TOOLS.alint.key)) names.add('alint');
  return [...names];
}

if (isMain(import.meta.url)) {
  try {
    const tools = process.argv.length > 2 ? process.argv.slice(2) : undefined;
    installTools({ ...(tools === undefined ? {} : { tools }), print: text => console.log(`[install-tools] ${text}`) });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[install-tools] ${error.message}`);
    process.exitCode = 1;
  }
}
