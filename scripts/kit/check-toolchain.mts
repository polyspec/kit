#!/usr/bin/env node
// Checks that every tool of the checkout runs at the version that the checkout declares, without a network
// (`make toolchain-check`):
//
//   node scripts/kit/check-toolchain.mts [tool...]      the tools: node npm mise rust php phpunit phpcs phpstan, and the tools of mise.toml: go python uv ruff alint golangciLint deadcode govulncheck cargoAudit cargoNextest cargoDeny composer vulture
//
// Without a tool name it checks every declared tool; naming an undeclared tool fails. A tool of mise.toml runs from its shim in
// var/tools/mise/shims (mise-tools.mts), never from PATH, in the environment of mise of the checkout; var/tools/bin and the
// shims come first on PATH, GOTOOLCHAIN=local keeps go from selecting another toolchain and RUSTUP_AUTO_INSTALL=0 keeps rustup
// from installing one. PHP is declared by minor release, so a patch release of the minor passes and the running patch is the
// evidence of the run; every other tool is compared by its exact release. mise.lock must pin every tool of mise.toml
// (miseLockFindings of toolchain-mise.mts), and each tool that it does not is a finding, as is a uv lock sidecar that mise.lock
// names and Git does not track (miseLockSidecarFindings, K192). Every named tool is checked, also after a mismatch, and each mismatch names the file that
// declares the tool, the expected and the running release, and the fix. A run that checks no tool fails. Whichever tools run,
// every declaration also equals the pin that kit ships (toolchain-pins.mts), and so does every manifest floor
// (toolchain-floors.mts), or the channel of an exception of config/toolchain.json whose scope holds the file
// (toolchain-exceptions.mts). Each other declaration or floor, a malformed exception and a stale one are findings, and so
// is a key of an .npmrc that keeps npm from linking.
import { phpInstall } from './install-php.mts';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { RELEASE_OUTPUT, toolsPath } from './bootstrap/tool-wrappers.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { declaredRust } from './toolchain-files.mts';
import { declaredMiseTools, miseLockFindings, miseLockSidecarFindings, MISE_TOOLS } from './toolchain-mise.mts';
import { declaredLintTools } from './toolchain-lint.mts';
import { PINS } from './toolchain-pins.mts';
import { Pinning, readExceptions } from './toolchain-exceptions.mts';
import { floorFindings, npmrcFindings, pinFindings } from './toolchain-floors.mts';
import { present } from './present.mts';

const INSTALL = 'make install-tools';

/** The outcome of a version command, as `execute` returns it; a command ended by a signal has the status null and the signal. */
export type RunResult = { status: number | null; signal?: NodeJS.Signals | null | undefined; stdout: string; stderr?: string | undefined; error?: Error | undefined };

/** Starts `command` with `args` and returns its outcome. */
export type Run = (command: string, args: string[]) => RunResult;

/** The options of a check: the checkout, the environment of the version commands, and how a command starts. */
export type ToolchainOptions = { root?: string; env?: NodeJS.ProcessEnv; run?: Run | undefined };

// A declared tool as declaredToolchain of toolchain-declared.mts, declaredLintTools of toolchain-lint.mts, declaredMiseTools of
// toolchain-mise.mts or declaredRust of toolchain-files.mts return it: an exact release, or minor releases.
type DeclaredTool = { version?: string; minors?: string[]; source: string };
const declaredTools = (root: string): Record<string, DeclaredTool | undefined> => ({ ...declaredToolchain(root), ...declaredLintTools(root), ...declaredMiseTools(root), rust: declaredRust(root) });

// The command that prints the release of a tool and its arguments. deadcode prints no release, so go version -m reads the
// release of golang.org/x/tools from its binary, whose path `mise which` prints first (`which`): its shim is mise itself.
// `absent` reads the name of a declared toolchain that is not installed from the error output of the command (rustup's proxy).
type Probe = { command: (root: string) => string; args: string[]; which?: string; pattern: RegExp; absent?: RegExp; fix: (version: string | undefined) => string };

// The probe of the tool `tool` of mise.toml, run from its shim.
const shim = (tool: keyof typeof MISE_TOOLS, output: { args: string[]; pattern: RegExp }): Probe => ({ command: root => toolCommand(root, MISE_TOOLS[tool].command), ...output, fix: () => INSTALL });

// The command that prints the release of a tool, the pattern that reads it, and the fix of a mismatch.
const probes: Record<string, Probe> = {
  // The node of mise.toml runs from its wrapper var/tools/bin/node, which the bootstrap writes, first on PATH (K171).
  node: { command: root => toolsPath(root, 'bin', 'node'), args: ['--version'], pattern: /^v(\d+\.\d+\.\d+)$/m, fix: () => 'make install-tools TOOLS=npm' },
  npm: { command: () => 'npm', args: ['--version'], pattern: /^(\d+\.\d+\.\d+)$/m, fix: () => 'make install-tools TOOLS=npm' },
  mise: { command: root => toolsPath(root, 'bin', 'mise'), ...RELEASE_OUTPUT.mise, fix: () => 'make install-tools TOOLS=npm' },
  // rustup installs the toolchain of rust-toolchain.toml through make install-tools (install-rust.mts); its proxy names a missing one.
  rust: { command: () => 'rustc', args: ['--version'], pattern: /^rustc (\d+\.\d+\.\d+) /m, absent: /toolchain '([^']+)' is not installed/, fix: () => INSTALL },
  php: { command: () => 'php', args: ['-n', '-r', 'echo PHP_VERSION, "\\n";'], pattern: /^(\d+\.\d+\.\d+)/m, fix: v => `make install-tools finds the PHP of .php-version; install it first with ${present(v, 'the declared PHP minors').split(' or ').map(phpInstall).join(' or ')}` },
  phpunit: { command: () => 'phpunit', ...RELEASE_OUTPUT.phpunit, fix: () => INSTALL },
  phpcs: { command: () => 'phpcs', ...RELEASE_OUTPUT.phpcs, fix: () => INSTALL },
  phpstan: { command: () => 'phpstan', ...RELEASE_OUTPUT.phpstan, fix: () => INSTALL },
  go: shim('go', { args: ['env', 'GOVERSION'], pattern: /^go(\d+\.\d+\.\d+)$/m }),
  python: shim('python', { args: ['--version'], pattern: /^Python (\d+\.\d+\.\d+)/m }),
  uv: shim('uv', RELEASE_OUTPUT.uv),
  ruff: shim('ruff', RELEASE_OUTPUT.ruff),
  alint: shim('alint', RELEASE_OUTPUT.alint),
  golangciLint: shim('golangciLint', RELEASE_OUTPUT['golangci-lint']),
  deadcode: { ...shim('go', { args: ['version', '-m'], pattern: /^\s*mod\s+golang\.org\/x\/tools\s+v(\d+\.\d+\.\d+)\s/m }), which: MISE_TOOLS.deadcode.command },
  govulncheck: shim('govulncheck', RELEASE_OUTPUT.govulncheck),
  cargoAudit: shim('cargoAudit', RELEASE_OUTPUT.cargoAudit),
  // cargo-nextest prints `cargo-nextest 0.9.146 (8af696ddc 2026-09-21)` and its build lines; cargo-deny `cargo-deny 0.20.2`.
  cargoNextest: shim('cargoNextest', { args: ['--version'], pattern: /^cargo-nextest (\d+\.\d+\.\d+) /m }),
  cargoDeny: shim('cargoDeny', { args: ['--version'], pattern: /^cargo-deny (\d+\.\d+\.\d+)$/m }),
  composer: shim('composer', { args: ['--version', '--no-ansi'], pattern: /^Composer version (\d+\.\d+\.\d+) /m }),
  vulture: shim('vulture', RELEASE_OUTPUT.vulture),
};
export const TOOLS = Object.keys(probes);

/** The environment of the version commands: the tools of var/tools first on PATH (toolsEnvironment) and no toolchain selection or download. */
export const toolchainEnvironment = (root: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({ ...toolsEnvironment(root, base), GOTOOLCHAIN: 'local', RUSTUP_AUTO_INSTALL: '0' });

const defaultRun = (root: string, env: NodeJS.ProcessEnv): Run => (command, args) => execute(command, args, { cwd: root, env });

// A command as a message shows it: relative to the checkout when it lies in it.
const shownPath = (root: string, command: string): string => (path.relative(root, command).startsWith('..') ? command : path.relative(root, command));

// The release that `tool` runs at, or the reason that it cannot be read.
function probe(root: string, tool: string, run: Run): { release: string; error?: undefined; absent?: undefined } | { release?: undefined; error: string; absent?: string | undefined } {
  const entry = probes[tool];
  // Destructuring the probe of an unknown tool failed here before.
  if (!entry) throw new Error(`unknown tool ${tool}; the tools are ${TOOLS.join(', ')}`);
  const { command, pattern } = entry;
  const failure = (shown: string, result: RunResult) => {
    const detail = String(result.stderr ?? '').trim();
    const ended = result.signal ? `ended by signal ${result.signal}` : `exit status ${result.status}`;
    return { error: `\`${shown}\` failed (${result.error?.message ?? ended})${detail ? `: ${detail}` : ''}`, absent: entry.absent?.exec(detail)?.[1] };
  };
  const args = [...entry.args];
  if (entry.which) {
    const mise = toolsPath(root, 'bin', 'mise');
    const found = run(mise, ['which', entry.which]);
    if (found.error || found.status !== 0) return failure(`${shownPath(root, mise)} which ${entry.which}`, found);
    args.push(found.stdout.trim());
  }
  const result = run(command(root), args);
  const shown = `${shownPath(root, command(root))} ${args.join(' ')}`;
  if (result.error || result.status !== 0) return failure(shown, result);
  const release = pattern.exec(result.stdout)?.[1];
  return release ? { release } : { error: `no release in the output of \`${shown}\`: ${JSON.stringify(result.stdout.trim())}` };
}

/** The release of each of `tools` that runs at `root`, as `{ tool: release }`, or `unavailable: <reason>`. */
export function toolchainVersions(tools: string[] = TOOLS, { root = repositoryRoot(), env = toolchainEnvironment(root), run = defaultRun(root, env) }: ToolchainOptions = {}) {
  return Object.fromEntries(tools.map((tool) => {
    const found = probe(root, tool, run);
    return [tool, found.release ?? `unavailable: ${found.error}`];
  }));
}

/** One line for each of `tools` that does not run at its declared version; `run` starts a command and returns `{ status, stdout, stderr, error }`. */
export function toolchainMismatches(tools: string[], { root = repositoryRoot(), env = toolchainEnvironment(root), run = defaultRun(root, env) }: ToolchainOptions = {}) {
  const declared = declaredTools(root);
  const mismatches: string[] = [];
  for (const tool of tools) {
    if (!probes[tool]) throw new Error(`unknown tool ${tool}; the tools are ${TOOLS.join(', ')}`);
    if (!declared[tool]) throw new Error(`${tool} is not declared; declare it in config/toolchain.json or in its file, or leave it out of the tools to check`);
    const found = probe(root, tool, run);
    const { source } = declared[tool];
    // PHP is declared by minor release; the patch of the run is evidence, not a requirement.
    const minors = declared[tool].minors;
    if (found.absent) {
      mismatches.push(`${tool}: the toolchain ${found.absent} is not installed; ${source} declares ${expectation(declared[tool])}; fix: ${probes[tool].fix(declared[tool].version)}`);
      continue;
    }
    if (found.error) {
      mismatches.push(`${tool}: ${found.error}; ${source} declares ${expectation(declared[tool])}; fix: ${probes[tool].fix(minors ? minors.join(' or ') : declared[tool].version)}`);
      continue;
    }
    // probe returns a release whenever it returns no error.
    const minor = present(found.release, 'found.release').split('.').slice(0, 2).join('.');
    const accepted = minors ? minors.includes(minor) : found.release === declared[tool].version;
    if (!accepted) {
      const fix = probes[tool].fix(minors ? minors.join(' or ') : declared[tool].version);
      mismatches.push(`${tool}: ${found.release} runs here and ${source} declares ${expectation(declared[tool])}; fix: ${fix}`);
    }
  }
  return mismatches;
}

/**
 * The findings of the system commands that `make php-ext-arginfo` needs in a repository with packages/php-ext (K303): the
 * gen_stub.php of the PHP downloads its PHP-Parser with wget, else curl, and unpacks it with tar (build/gen_stub.php of PHP
 * 8.5.10, installPhpParser). They are no tool of mise, so the machine and the CI image provide them.
 */
export function arginfoToolFindings(root: string, run: Run = defaultRun(root, toolchainEnvironment(root))): string[] {
  if (!existsSync(path.join(root, 'packages/php-ext'))) return [];
  const has = (command: string) => { const result = run(command, ['--version']); return !result.error && result.status === 0; };
  const found: string[] = [];
  if (!has('wget') && !has('curl')) found.push('make php-ext-arginfo: gen_stub.php of the PHP downloads its PHP-Parser with wget, else curl, and neither is installed; fix: install curl or wget');
  if (!has('tar')) found.push('make php-ext-arginfo: gen_stub.php of the PHP unpacks its PHP-Parser with tar, which is not installed; fix: install tar');
  return found;
}

const expectation = (entry: DeclaredTool) => (entry.minors ?? [entry.version]).join(' or ');

if (isMain(import.meta.url)) {
  try {
    const requested = process.argv.slice(2);
    const env = toolchainEnvironment(repositoryRoot());
    const declared = declaredTools(repositoryRoot());
    const tools = requested.length > 0 ? requested : TOOLS.filter(tool => declared[tool]);
    if (tools.length === 0) throw new Error('no toolchain is declared, so nothing is checked; declare a tool in mise.toml, config/toolchain.json, .php-version, rust-toolchain.toml or packageManager of package.json');
    const mismatches = toolchainMismatches(tools);
    // Every declaration and every floor equals the pin of kit, or the channel of a declared exception, whichever tools run.
    const { exceptions, findings: malformed } = readExceptions(repositoryRoot());
    const pinning = new Pinning(PINS, exceptions);
    const pins = pinFindings(declared, pinning);
    const floors = floorFindings(repositoryRoot(), pinning, env);
    const excepted = [...malformed, ...pinning.stale()];
    const links = npmrcFindings(repositoryRoot(), env);
    const locked = [...miseLockFindings(repositoryRoot()), ...miseLockSidecarFindings(repositoryRoot())];
    const system = arginfoToolFindings(repositoryRoot());
    console.log(`[check-toolchain] ${Object.entries(toolchainVersions(tools)).map(([tool, release]) => `${tool} ${release}`).join(', ')}`);
    for (const line of [...mismatches, ...pins, ...floors, ...excepted, ...links, ...locked, ...system]) console.error(`[check-toolchain] ${line}`);
    if (mismatches.length > 0) console.error(`[check-toolchain] ${mismatches.length} of ${tools.length} tools differ from the declared versions`);
    if (pins.length > 0) console.error(`[check-toolchain] ${pins.length} declarations differ from the pins of kit`);
    if (floors.length > 0) console.error(`[check-toolchain] ${floors.length} manifest floors differ from the pins of kit`);
    if (excepted.length > 0) console.error(`[check-toolchain] ${excepted.length} findings of the exceptions of config/toolchain.json`);
    if (links.length > 0) console.error(`[check-toolchain] ${links.length} keys of .npmrc keep npm from linking`);
    if (locked.length > 0) console.error(`[check-toolchain] ${locked.length} findings of the pins of mise.lock`);
    if (mismatches.length > 0 || pins.length > 0 || floors.length > 0 || excepted.length > 0 || links.length > 0 || locked.length > 0 || system.length > 0) process.exitCode = 1;
    else console.log(`[check-toolchain] ${tools.length} tools run at the declared versions`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // The declarations and the check fail with an Error.
    console.error(`[check-toolchain] ${error.message}`);
    process.exitCode = 1;
  }
}
