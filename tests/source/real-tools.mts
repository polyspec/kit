// The tools of mise.toml that this checkout installed (make install-tools), for the source tests that run them in a repository
// of their own. A shim of mise resolves its tool from mise.toml above its working directory, so a sandbox outside the checkout
// gets a script for each tool, as its own shim, that runs the binary that mise installed for this checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The binary that mise installed for this checkout for the command `name`, which `mise which` names. */
export function installedBinary(name: string): string {
  const found = spawnSync(path.join(ROOT, 'var/tools/bin/mise'), ['which', name], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(found.status, 0, `mise which ${name} failed; make install-tools installs the tools of mise.toml: ${found.stderr}`);
  return found.stdout.trim();
}

/** Writes var/tools/mise/shims/<name> of the sandbox `root` for each of `names`: a script that runs the binary of this checkout. */
export function sandboxShims(root: string, names: readonly string[]): void {
  const shims = path.join(root, 'var/tools/mise/shims');
  mkdirSync(shims, { recursive: true });
  for (const name of names) writeFileSync(path.join(shims, name), `#!/bin/sh\nexec '${installedBinary(name)}' "$@"\n`, { mode: 0o755 });
}
