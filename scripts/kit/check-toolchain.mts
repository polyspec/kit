#!/usr/bin/env node
// Checks that every declared tool of the checkout runs from the tools of the checkout, without a network (`make toolchain-check`):
//
//   node scripts/kit/check-toolchain.mts [tool...]      the tools: node npm mise rust php phpunit phpcs phpstan, and the tools of mise.toml: go python uv ruff alint golangciLint deadcode govulncheck 
//
// Without a tool name it checks every declared tool; naming an undeclared tool fails. A tool of mise.toml runs from its shim in
// var/tools/mise/shims (mise-tools.mts), never from PATH, in the environment of mise of the checkout; var/tools/bin and the
// shims come first on PATH, GOTOOLCHAIN=local keeps go from selecting another toolchain and RUSTUP_AUTO_INSTALL=0 keeps rustup
// from installing one. A tool that is missing or fails to start is a finding that names its fix; the release that runs is shown and
// never compared, since kit enforces no version (S4, K448): the checkout's mise.toml and its lock decide it. A key of an .npmrc
// that keeps npm from linking is a finding too.
import { phpInstall } from './install-php.mts';
import { installedGenStub } from './install-php-arginfo.mts';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { declaredToolchain } from './bootstrap/toolchain-declared.mts';
import { commandPath, RELEASE_OUTPUT } from './bootstrap/tool-wrappers.mts';
import { MISE_WRAPPER, NODE_WRAPPER } from './bootstrap/install-mise.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { execute } from './process.mts';
import { declaredRust } from './toolchain-files.mts';
import { declaredMiseTools, MISE_TOOLS } from './toolchain-mise.mts';
import { declaredLintTools } from './toolchain-lint.mts';
import { npmrcFindings } from './toolchain-floors.mts';
import { present } from './present.mts';
import { commandWords } from './recipe-tools.mts';
import { trackedFiles } from './tracked-files.mts';

const INSTALL = 'make install-tools';

/** The outcome of a version command, as `execute` returns it; a command ended by a signal has the status null and the signal. */
export type RunResult = { status: number | null; signal?: NodeJS.Signals | null | undefined; stdout: string; stderr?: string | undefined; error?: Error | undefined };

/** Starts `command` with `args` and returns its outcome. */
export type Run = (command: string, args: string[]) => RunResult;

/** The options of a check: the checkout, the environment of the version commands, and how a command starts. */
export type ToolchainOptions = { root?: string; env?: NodeJS.ProcessEnv; run?: Run | undefined };

// A declared tool as declaredToolchain of toolchain-declared.mts, declaredLintTools of toolchain-lint.mts, declaredMiseTools of
// toolchain-mise.mts or declaredRust of toolchain-files.mts return it: the release as declared, or minor releases.
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
  node: { command: root => commandPath(root, NODE_WRAPPER), args: ['--version'], pattern: /^v(\d+\.\d+\.\d+)$/m, fix: () => 'make install-tools TOOLS=npm' },
  // npm and php are the tools of the checkout, its wrappers in var/tools/bin, never the ones on PATH (K393-1).
  npm: { command: root => toolCommand(root, 'npm'), args: ['--version'], pattern: /^(\d+\.\d+\.\d+)$/m, fix: () => 'make install-tools TOOLS=npm' },
  mise: { command: root => toolCommand(root, MISE_WRAPPER), ...RELEASE_OUTPUT.mise, fix: () => 'make install-tools TOOLS=npm' },
  // rustup installs the toolchain of rust-toolchain.toml through make install-tools (install-rust.mts); its proxy names a missing one.
  rust: { command: () => 'rustc', args: ['--version'], pattern: /^rustc (\d+\.\d+\.\d+) /m, absent: /toolchain '([^']+)' is not installed/, fix: () => INSTALL },
  php: { command: root => toolCommand(root, 'php'), args: ['-n', '-r', 'echo PHP_VERSION, "\\n";'], pattern: /^(\d+\.\d+\.\d+)/m, fix: v => `make install-tools finds the PHP of .php-version; install it first with ${present(v, 'the declared PHP minors').split(' or ').map(phpInstall).join(' or ')}` },
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
type ToolName = keyof typeof probes;
const isToolName = (name: string): name is ToolName => Object.hasOwn(probes, name);
export const TOOLS = Object.keys(probes).filter(isToolName);

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
  // A tool of the checkout that is missing is a finding of its own probe, which names the fix, and not an error of the check.
  let program: string;
  try {
    program = command(root);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const failure = (shown: string, result: RunResult) => {
    const detail = String(result.stderr ?? '').trim();
    const ended = result.signal ? `ended by signal ${result.signal}` : `exit status ${result.status}`;
    return { error: `\`${shown}\` failed (${result.error?.message ?? ended})${detail ? `: ${detail}` : ''}`, absent: entry.absent?.exec(detail)?.[1] };
  };
  const args = [...entry.args];
  if (entry.which) {
    const mise = toolCommand(root, MISE_WRAPPER);
    const found = run(mise, ['which', entry.which]);
    if (found.error || found.status !== 0) return failure(`${shownPath(root, mise)} which ${entry.which}`, found);
    args.push(found.stdout.trim());
  }
  const result = run(program, args);
  const shown = `${shownPath(root, program)} ${args.join(' ')}`;
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

/**
 * One line for each of `tools` that does not run from the tools of the checkout (K448, S4): a tool that is missing or fails to start is
 * the finding; its release is shown, never compared, since the checkout's mise.toml and its lock decide it. `run` starts a command and
 * returns `{ status, stdout, stderr, error }`.
 */
export function toolchainMismatches(tools: string[], { root = repositoryRoot(), env = toolchainEnvironment(root), run = defaultRun(root, env) }: ToolchainOptions = {}) {
  const declared = declaredTools(root);
  const mismatches: string[] = [];
  for (const tool of tools) {
    if (!probes[tool]) throw new Error(`unknown tool ${tool}; the tools are ${TOOLS.join(', ')}`);
    if (!declared[tool]) throw new Error(`${tool} is not declared; declare it in config/toolchain.json or in its file, or leave it out of the tools to check`);
    const found = probe(root, tool, run);
    const { source } = declared[tool];
    // The declaration is named for the fix, never compared with the running release.
    const declares = (declared[tool].minors ?? [declared[tool].version]).join(' or ');
    if (found.absent) mismatches.push(`${tool}: the toolchain ${found.absent} is not installed; ${source} declares ${declares}; fix: ${probes[tool].fix(declared[tool].version)}`);
    else if (found.error) mismatches.push(`${tool}: ${found.error}; ${source} declares ${declares}; fix: ${probes[tool].fix(declared[tool].minors ? declared[tool].minors.join(' or ') : declared[tool].version)}`);
  }
  return mismatches;
}

/** The findings of the installed, pinned offline generator and parser of PHP extension arginfo. */
export function arginfoToolFindings(root: string): string[] {
  if (!existsSync(path.join(root, 'packages/php-ext'))) return [];
  try {
    installedGenStub(root);
    return [];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return [`PHP extension arginfo tools are missing or incomplete: ${error.message}`];
  }
}

// The PHP commands that a recipe or a script must not start by their bare names: the PATH of the machine finds another PHP's
// (K341), so install-tools wraps php-fpm of the PHP of .php-version as var/tools/bin/php-fpm.
const PHP_FPM_COMMANDS: ReadonlySet<string> = new Set(['php-fpm', 'php-cgi']);

/**
 * One finding for each line of a tracked Makefile or *.mk file that starts a recipe with php-fpm or php-cgi by its bare name, and of
 * each line of a tracked *.sh script that starts one, read as the shell reads it (commandWords, K341). A make variable that names the
 * file, or var/tools/bin/php-fpm, is no bare name.
 */
export function bareFpmFindings(root: string): string[] {
  const findings: string[] = [];
  for (const file of trackedFiles(root)) {
    const makefile = path.posix.basename(file) === 'Makefile' || file.endsWith('.mk');
    if (!makefile && !file.endsWith('.sh')) continue;
    readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      // A recipe line starts with a tab, and a script's comment is no command.
      const text = makefile ? (line.startsWith('\t') ? line.slice(1) : undefined) : (line.trimStart().startsWith('#') ? undefined : line);
      if (text === undefined) return;
      for (const word of commandWords(text).filter(word => PHP_FPM_COMMANDS.has(word))) {
        findings.push(`${file}:${index + 1} starts ${word} by its bare name: \`${line.trim()}\`; the PATH of the machine finds the ${word} of another PHP than .php-version. Fix: start var/tools/bin/${word}, which install-tools writes for the PHP of .php-version, or a make variable that names it`);
      }
    });
  }
  return findings;
}

if (isMain(import.meta.url)) {
  try {
    const requested = process.argv.slice(2);
    const checkAllDeclared = requested.length === 0;
    const env = toolchainEnvironment(repositoryRoot());
    const declared = declaredTools(repositoryRoot());
    const tools = requested.length > 0 ? requested : TOOLS.filter(tool => declared[tool]);
    if (tools.length === 0) throw new Error('no toolchain is declared, so nothing is checked; declare a tool in mise.toml, config/toolchain.json, .php-version, rust-toolchain.toml or packageManager of package.json');
    const mismatches = toolchainMismatches(tools);
    // No declaration is compared with a pin and no floor with a declaration (K448, S4): the checkout's own files decide its versions.
    const links = npmrcFindings(repositoryRoot(), env);
    const system = [...(checkAllDeclared ? arginfoToolFindings(repositoryRoot()) : []), ...bareFpmFindings(repositoryRoot())];
    console.log(`[check-toolchain] ${Object.entries(toolchainVersions(tools)).map(([tool, release]) => `${tool} ${release}`).join(', ')}`);
    for (const line of [...mismatches, ...links, ...system]) console.error(`[check-toolchain] ${line}`);
    if (mismatches.length > 0) console.error(`[check-toolchain] ${mismatches.length} of ${tools.length} tools do not run from the tools of the checkout`);
    if (links.length > 0) console.error(`[check-toolchain] ${links.length} keys of .npmrc keep npm from linking`);
    if (mismatches.length > 0 || links.length > 0 || system.length > 0) process.exitCode = 1;
    else console.log(`[check-toolchain] ${tools.length} tools run from the tools of the checkout`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // The declarations and the check fail with an Error.
    console.error(`[check-toolchain] ${error.message}`);
    process.exitCode = 1;
  }
}
