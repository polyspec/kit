#!/usr/bin/env node
// Installs the tools of the checkout into var/tools (`make install-tools`, ONLINE), after the bootstrap installed npm and mise:
//
//   node scripts/kit/install-tools.mts
//
// mise installs every tool of mise.toml at the release and digest of mise.lock (`mise install --locked`, by the wrapper
// var/tools/bin/mise, which keeps mise and the builds of its tools under var/tools/mise); a tool that mise.lock does not pin
// fails the install. Then kit installs what mise does not: the build backend of the Python wheels (config/toolchain.json
// pythonBackend, by the sha256 of its wheel), the Composer projects of config/phpunit (phpunit) and config/php-lint, the Rust
// channels of config/toolchain.json exceptions (install-rust.mts, with rustup, which stays the toolchain manager of Rust) and the
// symbol extractors of symbolExtractors, which build with the Go and the Composer of mise. Each is installed only when it is
// declared, and an install of the release that is present changes nothing, so a second run installs nothing. The tools of
// the machine are never changed. Node.js, Rust and PHP are verified by check-toolchain.mts, not installed. The command takes
// no tool names: mise.lock is one set of tools. It prints a line for each step and has no time limit.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { installPhpLint } from './install-php-lint.mts';
import { installPhpunit } from './install-phpunit.mts';
import { installRustChannels } from './install-rust.mts';
import { installExtractor } from './install-symbols.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { isMain, ROOT } from './paths.mts';
import { installBackend } from './release-backend.mts';
import { readExceptions } from './toolchain-exceptions.mts';
import { declaredLintTools } from './toolchain-lint.mts';

/** Installs the tools of mise.lock and the declared tools that mise does not install into var/tools of `root`. */
export function installTools({ root = ROOT, print = () => {} }: { root?: string; print?: (text: string) => void } = {}): void {
  const mise = toolsPath(root, 'bin', 'mise');
  if (!existsSync(mise)) throw new Error(`${path.relative(root, mise)} is missing; run make install-tools TOOLS=npm, the bootstrap that installs mise`);
  // The Rust channels that the exceptions declare; a malformed exception fails here, as toolchain-check reports it.
  const exceptions = readExceptions(root);
  if (exceptions.findings.length > 0) throw new Error(exceptions.findings.join('\n'));
  const rustChannels = [...new Set(exceptions.exceptions.filter(exception => exception.tool === 'rust').map(exception => exception.channel))];
  // The wrapper sets the environment of mise itself; the installs of kit that follow run the tools of mise.
  run(mise, ['install', '--locked'], { cwd: root, env: process.env }, print);
  const env = toolsEnvironment(root);
  const { pythonBackend, phpunit, symbolExtractors } = declaredToolchain(root);
  const { phpLint } = declaredLintTools(root);
  if (pythonBackend) installBackend({ root, env, requirement: pythonBackend.requirement, digests: [pythonBackend.sha256], source: pythonBackend.source, print });
  if (phpunit) installPhpunit({ root, declared: phpunit, print });
  if (phpLint) installPhpLint({ root, declared: phpLint, print });
  if (rustChannels.length > 0) installRustChannels({ root, channels: rustChannels, print });
  for (const extractor of symbolExtractors?.extractors ?? []) installExtractor({ root, extractor, print });
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
