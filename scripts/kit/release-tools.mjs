#!/usr/bin/env node
// Installs the tools that the release of this repository needs (`make release-tools`), derived from config/release.json:
//
//   npm       a package of kind npm, or the npm consumer project
//   composer  a package of kind composer, or the Composer consumer project
//   python    a wheel package, or the wheel consumer; pythonBackend installs the build backend of its wheels with it
//   go        a Go module
//   cargo     a git-tag manifest of the proof: install-tools does not install cargo, so it must be on PATH and is checked
//
// The tools in `install` are installed by install-tools (var/tools); a missing `system` tool fails with its fix. Nothing is
// listed by hand: the configuration of a repository decides the tools, so the proof does not fail on a tool it did not install.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from './release.mjs';
import { Stop } from './process.mjs';

const INSTALL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'install-tools.mjs');

/** The install-tools names and the system tools that the configuration needs, the names in the order of install-tools. */
export function toolsFor(config) {
  const kinds = new Set(config.packages.map(({ kind }) => kind));
  const needed = new Set();
  if (kinds.has('npm') || config.consumers?.npm) needed.add('npm');
  if (kinds.has('composer') || config.consumers?.composer) needed.add('composer');
  if (kinds.has('wheel') || config.consumers?.wheel) {
    needed.add('python');
    needed.add('pythonBackend');
  }
  if (Object.keys(config.goModules ?? {}).length) needed.add('go');
  const order = ['npm', 'composer', 'python', 'pythonBackend', 'go'];
  const system = Object.keys(config.proof?.gitTag ?? {}).length ? ['cargo'] : [];
  return { install: order.filter(name => needed.has(name)), system };
}

/** The version line of a system tool; a tool that does not run stops with its fix. */
function requireSystem(name, env) {
  const result = spawnSync(name, ['--version'], { encoding: 'utf8', env });
  if (result.error || result.status !== 0) throw new Stop(`${name} is needed by the git-tag proof and does not run; install ${name} on the runner before make release-tools`);
  return result.stdout.trim();
}

const USAGE = 'usage: node scripts/kit/release-tools.mjs';

/** Runs the command line; the exit status. */
export function main(argv, { root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), env = process.env, print = console.log, error = console.error } = {}) {
  if (argv.length) {
    error(USAGE);
    return 2;
  }
  try {
    const { config } = context(root, { env });
    const { install, system } = toolsFor(config);
    for (const name of system) print(`[release-tools] ${name}: ${requireSystem(name, env)}`);
    if (install.length) {
      print(`[release-tools] install-tools ${install.join(' ')}`);
      const result = spawnSync(process.execPath, [INSTALL, ...install], { cwd: root, env, stdio: 'inherit' });
      if (result.status !== 0) throw new Stop(`install-tools ${install.join(' ')} exited with ${result.status}`);
    }
    print(`[release-tools] the tools of the release are ready: ${[...install, ...system].join(' ') || 'none'}`);
  } catch (failure) {
    if (!(failure instanceof Stop) && !(failure instanceof SyntaxError) && failure?.code !== 'ENOENT') throw failure;
    error(`[release-tools] failed: ${failure.message}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
