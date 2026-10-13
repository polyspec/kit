#!/usr/bin/env node
// Writes mise.lock, the digests of the tools of mise.toml for every platform of LOCK_PLATFORMS (`make toolchain-lock`, ONLINE):
//
//   node scripts/kit/toolchain-lock.mts
//
// `mise lock` pins each archive by its sha256. A pypi: tool is pinned by the uv lock that mise writes under .mise/locks, which
// mise writes only with a uv at hand: when the first `mise lock` leaves such a tool without it, the uv and the Python of
// mise.toml are installed from the lock just written and `mise lock` runs again. The lock is then checked by
// miseLockFindings, the check of make toolchain-check, so a lock that misses a digest fails here with the finding.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { isMain, ROOT } from './paths.mts';
import { declaredMiseTools, LOCK_PLATFORMS, miseLockFindings, MISE_TOOLS } from './toolchain-mise.mts';

/** Writes mise.lock of `root` with the mise of var/tools/bin; throws with the findings of a lock that misses a digest. */
export function lockTools({ root = ROOT, print = () => {} }: { root?: string; print?: (text: string) => void } = {}): void {
  const mise = toolsPath(root, 'bin', 'mise');
  if (!existsSync(mise)) throw new Error(`${path.relative(root, mise)} is missing; run make install-tools TOOLS=npm, the bootstrap that installs mise`);
  // The wrapper sets the environment of mise itself; UV_PYTHON of toolsEnvironment would name a Python before mise installs it.
  const env = process.env;
  const lock = () => run(mise, ['lock', '--platform', LOCK_PLATFORMS.join(',')], { cwd: root, env }, print);
  lock();
  if (miseLockFindings(root).some(line => line.includes('without the digest of its uv lock'))) {
    const declared = declaredMiseTools(root);
    if (!declared.uv || !declared.python) throw new Error(`a pypi: tool of mise.toml needs the uv and the Python of mise.toml, which lock it; declare ${MISE_TOOLS.uv.key} and ${MISE_TOOLS.python.key}`);
    run(mise, ['install', '--locked', MISE_TOOLS.uv.key, MISE_TOOLS.python.key], { cwd: root, env }, print);
    lock();
  }
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
