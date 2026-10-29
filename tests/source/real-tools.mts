// The tools of mise.toml that this checkout installed (make install-tools), for the source tests that run them in a repository
// of their own. A shim of mise resolves its tool from mise.toml above its working directory, so a sandbox outside the checkout
// gets a script for each tool, as its own shim, that runs the binary that mise installed for this checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The installed wrapper of `name`, or its native binary that `mise which` resolves for this checkout. */
export function installedBinary(name: string): string {
  const wrapper = toolsPath(ROOT, 'bin', name);
  if (existsSync(wrapper)) return wrapper;
  const found = spawnSync(toolCommand(ROOT, 'mise'), ['which', name], { cwd: ROOT, encoding: 'utf8', env: toolsEnvironment(ROOT) });
  assert.equal(found.status, 0, `mise which ${name} failed; make install-tools installs the tools of mise.toml: ${found.stderr}`);
  return found.stdout.trim();
}

/** Writes var/tools/mise/shims/<name> of the sandbox `root` for each of `names`: a script that runs the binary of this checkout. */
export function sandboxShims(root: string, names: readonly string[]): void {
  const shims = path.join(root, 'var/tools/mise/shims');
  mkdirSync(shims, { recursive: true });
  for (const name of names) writeFileSync(path.join(shims, name), `#!/bin/sh\nexec '${installedBinary(name)}' "$@"\n`, { mode: 0o755 });
}

/**
 * Writes var/tools/bin/mise of the sandbox `root`: a script that runs the mise of this checkout in this checkout, so that
 * `mise where <tool>`, which a tool asks the wrapper of its root (K199), names the install of this checkout that the shims run.
 */
export function sandboxMise(root: string): void {
  const bin = path.join(root, 'var/tools/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'mise'), `#!/bin/sh\ncd '${ROOT}' && exec '${toolCommand(ROOT, 'mise')}' "$@"\n`, { mode: 0o755 });
}

/**
 * Installs the uv project `project` as its repository's own install does, with the uv and the python3 of this checkout:
 * uv lock, then uv sync --frozen, non-editable unless `editable`. The parity reader of a Python distribution reads
 * that environment and installs nothing.
 */
export function installProject(project: string, { editable = false } = {}): void {
  const uv = toolCommand(ROOT, 'uv');
  for (const args of [['lock'], ['sync', '--frozen', '--python', toolCommand(ROOT, 'python3'), ...(editable ? [] : ['--no-editable'])]]) {
    const done = spawnSync(uv, [...args, '--project', project], { cwd: project, encoding: 'utf8', env: toolsEnvironment(ROOT) });
    assert.equal(done.status, 0, `uv ${args[0]} of ${project} failed: ${done.stderr}`);
  }
}
