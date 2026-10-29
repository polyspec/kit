#!/usr/bin/env node
// Installs the tools that the release of this repository needs (`make release-tools`), derived from config/release.json:
//
//   install-tools  a Composer package or consumer, a wheel or a Go module: install-tools installs the tools of mise.lock (the
//                  Composer, the Python, the uv and the Go of mise.toml) into var/tools; npm, which
//                  an npm package needs, is the npm of the bootstrap, which installed the packages that this command runs from
//   rust           a git-tag manifest of the proof: the channel of rust-toolchain.toml is installed with rustup, as make
//                  install does, and check-toolchain checks rustc against it
//   assets         a polyspec dependency of the Composer consumer (consumers.composer.polyspec): release-assets.mts fetch
//                  downloads the release zips of config/release-assets.json, which the consumer install reads
//
// A step that fails stops the command with its output and the fix. Nothing is listed by hand: the configuration of a repository
// decides the tools, so the proof does not fail on a tool it did not install.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { context, stepFailure } from './release.mts';
import { Stop } from './process.mts';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';


/** The sections of config/release.json (release.mts loadConfig) that decide the tools of the release. */
export type ToolsConfig = {
  packages: { kind: string }[];
  consumers?: { npm?: unknown; composer?: { directory: string; polyspec?: unknown[] }; wheel?: unknown };
  goModules: Record<string, string>;
  proof?: { gitTag?: Record<string, unknown> };
};
/** The output of a step: `print` receives the stdout of the command and `error` its stderr. */
type Output = { print: (text: string) => void; error: (text: string) => void };

/**
 * Whether the configuration needs the tools of install-tools (a Composer package or consumer, a wheel, a Go module), Rust,
 * and the release archives of config/release-assets.json (a polyspec dependency of the Composer consumer).
 */
export function toolsFor(config: ToolsConfig) {
  const kinds = new Set(config.packages.map(({ kind }) => kind));
  const install = kinds.has('composer') || kinds.has('wheel') || Boolean(config.consumers?.composer) || Boolean(config.consumers?.wheel) || Object.keys(config.goModules).length > 0;
  return { install, rust: Object.keys(config.proof?.gitTag ?? {}).length > 0, assets: (config.consumers?.composer?.polyspec?.length ?? 0) > 0 };
}

/** Runs `command` in `root`, forwards its output on success and failure, and stops with the status and output when it fails. */
function step(command: string, args: string[], { cwd, env, print, error }: { cwd: string; env: NodeJS.ProcessEnv } & Output) {
  const shown = [command, ...args].join(' ');
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw new Stop(`${shown} could not start: ${result.error.message}`);
  if (result.stdout.trim()) print(result.stdout.trimEnd());
  if (result.stderr.trim()) error(result.stderr.trimEnd());
  if (result.status !== 0) throw new Stop(`${shown} exited with ${result.status}`);
}

/**
 * Installs the Rust channel that rust-toolchain.toml of `root` declares and checks rustc against it. The channel is read by
 * rustup from the file in the checkout, and check-toolchain of the checkout's own scripts/kit reads the same declaration.
 */
export function prepareRust(root: string, { env = process.env, print = console.log, error = console.error }: { env?: NodeJS.ProcessEnv } & Partial<Output> = {}) {
  const file = path.join(root, 'rust-toolchain.toml');
  if (!existsSync(file)) throw new Stop('rust-toolchain.toml is missing; the git-tag proof needs the Rust channel that it declares. Fix: write channel in rust-toolchain.toml');
  step('rustup', ['toolchain', 'install', '--no-self-update'], { cwd: root, env, print, error });
  step(process.execPath, [siblingTool(import.meta.url, 'check-toolchain'), 'rust'], { cwd: root, env, print, error });
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
    const { install, rust, assets } = toolsFor(config);
    if (install) {
      print('[release-tools] install-tools');
      step(process.execPath, [siblingTool(import.meta.url, 'install-tools')], { cwd: root, env, print, error });
    }
    if (rust) {
      print('[release-tools] rust: rustup installs the channel of rust-toolchain.toml');
      prepareRust(root, { env, print, error });
    }
    if (assets) {
      print('[release-tools] release-assets: the release zips of the polyspec dependencies of the Composer consumer');
      step(process.execPath, [siblingTool(import.meta.url, 'release-assets'), 'fetch'], { cwd: root, env, print, error });
    }
    print(`[release-tools] the tools of the release are ready: ${[...(install ? ['install-tools'] : []), ...(rust ? ['rust'] : []), ...(assets ? ['release-assets'] : [])].join(' ') || 'none'}`);
  } catch (failure) {
    error(`[release-tools] failed: ${stepFailure(failure)}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
