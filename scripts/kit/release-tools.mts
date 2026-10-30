#!/usr/bin/env node
// Installs the tools that the release of this repository needs (`make release-tools`), derived from config/release.json: a
// Composer package, a wheel or a Go module needs the tools of mise.lock (the Composer, the Python, the uv and the Go of
// mise.toml), which install-tools installs into var/tools; npm, which an npm package needs, is the npm of the bootstrap, which
// installed the packages that this command runs from. A make entry of a package (K930) runs the target of the repository, which
// reads the PHP of mise.lock, so install-tools installs it for the pack.
//
// A step that fails stops the command with its output and the fix. Nothing is listed by hand: the configuration of a repository
// decides the tools.
import { spawnSync } from 'node:child_process';
import { context, stepFailure } from './release.mts';
import { Stop } from './process.mts';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';


/** The sections of config/release.json (release.mts loadConfig) that decide the tools of the release. */
export type ToolsConfig = {
  packages: { kind: string; generated?: { kind: string; target: string; outputs: string[] }[] }[];
  goModules: Record<string, string>;
};
/** The output of a step: `print` receives the stdout of the command and `error` its stderr. */
type Output = { print: (text: string) => void; error: (text: string) => void };

/** Whether the configuration needs the tools of install-tools: a Composer package, a wheel, a Go module, or a make entry (K930). */
export function needsInstallTools(config: ToolsConfig): boolean {
  const kinds = new Set(config.packages.map(({ kind }) => kind));
  return kinds.has('composer') || kinds.has('wheel') || Object.keys(config.goModules).length > 0 || config.packages.some(({ generated }) => (generated?.length ?? 0) > 0);
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
  if (result.status !== 0) throw new Stop(`${shown} exited with ${result.status}`);
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
