#!/usr/bin/env node
// Writes mise.lock, the digests of the tools of mise.toml for every platform of LOCK_PLATFORMS (`make toolchain-lock`, ONLINE):
//
//   node scripts/kit/toolchain-lock.mts
//
// `mise lock` pins each archive by its sha256. A pypi: tool is pinned by the uv lock that mise writes under .mise/locks with a
// uv and a Python, which must be the pinned ones, never a uv or a Python of the machine: mise 2026.10.8 resolved with the uv
// that came first on PATH, and that uv with a python3 that it found on PATH (measured). So a mise.toml with a pypi: tool locks
// the uv and the Python of mise.toml alone first, installs them from that lock, and then locks every tool with their
// directories first on PATH and that Python as UV_PYTHON. The lock is then
// checked by miseLockFindings, the check of make toolchain-check, so a lock that misses a digest fails here with the finding.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { isMain, ROOT } from './paths.mts';
import { run as output } from './process.mts';
import { declaredMiseTools, LOCK_PLATFORMS, miseLockFindings, MISE_TOOLS } from './toolchain-mise.mts';

/** Writes mise.lock of `root` with the mise of var/tools/bin; throws with the findings of a lock that misses a digest. */
export function lockTools({ root = ROOT, print = () => {} }: { root?: string; print?: (text: string) => void } = {}): void {
  const mise = toolsPath(root, 'bin', 'mise');
  if (!existsSync(mise)) throw new Error(`${path.relative(root, mise)} is missing; run make install-tools TOOLS=npm, the bootstrap that installs mise`);
  // The environment of mise names the checkout's mise.toml as the global configuration (miseEnvironment), and mise then
  // locks its tools only with --global, which writes mise.lock beside that file.
  const platforms = ['--global', '--platform', LOCK_PLATFORMS.join(',')];
  const declared = declaredMiseTools(root);
  const pypi = Object.entries(MISE_TOOLS).some(([name, { key }]) => key.startsWith('pypi:') && declared[name as keyof typeof MISE_TOOLS]);
  // The wrapper sets the environment of mise itself; UV_PYTHON of toolsEnvironment would name a Python before mise installs it.
  let env: NodeJS.ProcessEnv = process.env;
  if (pypi) {
    if (!declared.uv || !declared.python) throw new Error(`a pypi: tool of mise.toml needs the uv and the Python of mise.toml, which lock it; declare ${MISE_TOOLS.uv.key} and ${MISE_TOOLS.python.key}`);
    const pinned = [MISE_TOOLS.uv.key, MISE_TOOLS.python.key];
    run(mise, ['lock', ...pinned, ...platforms], { cwd: root, env }, print);
    run(mise, ['install', '--locked', ...pinned], { cwd: root, env }, print);
    const which = (command: string) => output(mise, ['which', command], { cwd: root, env }).trim();
    const uv = which(MISE_TOOLS.uv.command);
    const python = which(MISE_TOOLS.python.command);
    env = { ...process.env, PATH: [path.dirname(uv), path.dirname(python), process.env.PATH ?? ''].join(path.delimiter), UV_PYTHON: python };
  }
  run(mise, ['lock', ...platforms], { cwd: root, env }, print);
  const findings = miseLockFindings(root);
  if (findings.length > 0) throw new Error(`mise.lock is incomplete:\n${findings.join('\n')}`);
  print('mise.lock pins every tool of mise.toml');
}

if (isMain(import.meta.url)) {
  try {
    lockTools({ print: text => console.log(`[toolchain-lock] ${text}`) });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[toolchain-lock] ${error.message}`);
    process.exitCode = 1;
  }
}
