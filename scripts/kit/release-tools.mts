#!/usr/bin/env node
// Installs the tools that the release of this repository needs (`make release-tools`), derived from config/release.json: a
// Composer package, a wheel or a Go module needs the tools of mise.lock (the Composer, the Python, the uv and the Go of
// mise.toml), which install-tools installs into var/tools; npm, which an npm package needs, is the npm of the bootstrap, which
// installed the packages that this command runs from. A make entry adds no step (K930): a repository whose make target needs the PHP
// installs it in its release-prepare rule, with make install-tools TOOLS="php", which release.yml runs before this command.
// A per-platform package (wheel-abi3, php-ext, npm-native, go-static) needs install-tools too, which installs the toolchain of
// rust-toolchain.toml with rustup and the tools of mise.lock, such as the Python and uv that run maturin; an npm-native package
// also needs the napi CLI of the repository, a devDependency that install-packages installs, and no tool of kit installs it
// (K1190, K865).
//
// A step that fails stops the command with its output and the fix. Nothing is listed by hand: the configuration of a repository
// decides the tools.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { context, stepFailure } from './release.mts';
import { isNative, napiCommand } from './release-native.mts';
import { Stop } from './process.mts';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';


/** The sections of config/release.json (release.mts loadConfig) that decide the tools of the release. */
export type ToolsConfig = {
  packages: { kind: string; generated?: { kind: string; target: string; outputs: string[] }[] }[];
  goModules: Record<string, string>;
};
/** The output of a step: `print` receives the stdout of the command and `error` its stderr. */
type Output = { print: (text: string) => void; error: (text: string) => void };

/** Whether the configuration needs the tools of install-tools: a Composer package, a wheel, a Go module or a per-platform package. */
export function needsInstallTools(config: ToolsConfig): boolean {
  const kinds = new Set(config.packages.map(({ kind }) => kind));
  return kinds.has('composer') || kinds.has('wheel') || [...kinds].some(isNative) || Object.keys(config.goModules).length > 0;
}

/**
 * The tools that the release of `root` needs and that install-tools does not install, each with its fix: the napi CLI of the
 * repository for an npm-native package (K1190).
 */
export function missingTools(root: string, config: ToolsConfig): string[] {
  if (!config.packages.some(({ kind }) => kind === 'npm-native')) return [];
  const napi = napiCommand(root);
  return existsSync(napi) ? [] : [`${path.relative(root, napi)} is missing; an npm-native package builds with the napi CLI of the repository: declare @napi-rs/cli in devDependencies of package.json and run make install-packages`];
}

/** The tools of the release, in order: install-tools when the configuration needs the tools of mise.lock (K930). */
export function releaseSteps(config: ToolsConfig): string[] {
  return needsInstallTools(config) ? ['install-tools'] : [];
}

/** Runs `command` in `root`, forwards its output on success and failure, and stops with the status and output when it fails. */
function step(command: string, args: string[], { cwd, env, print, error }: { cwd: string; env: NodeJS.ProcessEnv } & Output) {
  const shown = [command, ...args].join(' ');
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw new Stop(`${shown} could not start: ${result.error.message}`);
  if (result.stdout.trim()) print(result.stdout.trimEnd());
  if (result.stderr.trim()) error(result.stderr.trimEnd());
  if (result.status !== 0) throw new Stop(`${shown} ${result.signal ? `ended by signal ${result.signal}` : `exited with ${result.status}`}`);
}

const USAGE = 'usage: node scripts/kit/release-tools.mts';

/** Runs the command line; the exit status. */
export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: { root?: string; env?: NodeJS.ProcessEnv } & Partial<Output> = {}) {
  if (argv.length) {
    error(USAGE);
    return 2;
  }
  try {
    const { config } = context(root, { env });
    const missing = missingTools(root, config);
    if (missing.length) throw new Stop(missing.join('; '));
    const steps = releaseSteps(config);
    for (const name of steps) {
      print(`[release-tools] ${name}`);
      step(process.execPath, [siblingTool(import.meta.url, name)], { cwd: root, env, print, error });
    }
    print(`[release-tools] the tools of the release are ready: ${steps.join(', ') || 'none'}`);
  } catch (failure) {
    error(`[release-tools] failed: ${stepFailure(failure)}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
