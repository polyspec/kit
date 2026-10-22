// The stubs of the tools that kit starts from the checkout (K393-1): each name is a wrapper in var/tools/bin of the checkout
// that runs the stub of the same name in the stubs directory, where the test writes it. The tests keep PATH as they set it;
// only the place where the helper finds the stub changes.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Writes var/tools/bin/<name> under `root` for each of `names`, each running `stubsDir`/<name> with its arguments. */
export function checkoutStubs(root: string, stubsDir: string, names: readonly string[]): void {
  const bin = path.join(root, 'var/tools/bin');
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    const wrapper = path.join(bin, name);
    writeFileSync(wrapper, `#!/bin/sh\nexec '${path.join(stubsDir, name)}' "$@"\n`);
    chmodSync(wrapper, 0o755);
  }
}

/**
 * Writes var/tools/bin/<name> under `root` for each of `names`, each running the tool of that name that PATH finds, for a test that
 * reads with the real tool and not a stub (K393-1). The test's purpose is the reading, not where the tool comes from.
 */
export function checkoutTools(root: string, names: readonly string[]): void {
  const bin = path.join(root, 'var/tools/bin');
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    // K491: the tool is the one that PATH finds outside the checkout's var/tools, whose shims would recurse into mise.
    const outside = (process.env.PATH ?? '').split(path.delimiter).filter(entry => !entry.includes(`${path.sep}var${path.sep}tools`)).join(path.delimiter);
    const real = execFileSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: { ...process.env, PATH: outside } }).trim();
    const wrapper = path.join(bin, name);
    writeFileSync(wrapper, `#!/bin/sh\nexec '${real}' "$@"\n`);
    chmodSync(wrapper, 0o755);
  }
}
