// The install step that the tools of var/tools share: build into a temporary directory beside the target and rename it into
// place, so a reader never sees a partly installed tool (replaceInstall). The bootstrap installers of mise and npm, which have no
// tool beneath them to judge an installed release, also skip a recorded release (installOnce, K861).
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Installs `label` at `recorded` into `prefix` unless `installedRelease(prefix)` already prints it. `install(next)` builds
 * the tool into the temporary directory `next`. Returns `{ installed, release }`; throws with the expected and the actual
 * release when the build does not print `recorded`.
 */
export function installOnce({ root, label, prefix, recorded, installedRelease, install, print = () => {} }: {
  root: string;
  label: string;
  prefix: string;
  recorded: string;
  installedRelease: (directory: string) => string | undefined;
  install: (next: string) => void;
  print?: ((text: string) => unknown) | undefined;
}): { installed: boolean; release: string } {
  const found = installedRelease(prefix);
  const where = path.relative(root, prefix);
  if (found === recorded) {
    print(`${label}: ${recorded} is installed in ${where}`);
    return { installed: false, release: recorded };
  }
  print(`${label}: ${found ? `${found} is installed` : 'none is installed'} in ${where}; installing ${recorded}`);
  replaceInstall(prefix, (next) => {
    install(next);
    const release = installedRelease(next);
    if (release !== recorded) throw new Error(`the installation of ${label} ${recorded} into ${next} prints ${release}; expected ${recorded}`);
  });
  print(`${label}: installed ${recorded} in ${where}`);
  return { installed: true, release: recorded };
}

/**
 * Builds a tool with `install(next)` into a temporary directory beside `prefix` and renames it into place, so a reader never sees
 * a partly installed tool; the old installation moves aside with one rename and the new one takes its place with another.
 */
export function replaceInstall(prefix: string, install: (next: string) => void): void {
  mkdirSync(path.dirname(prefix), { recursive: true });
  const next = mkdtempSync(`${prefix}.next-`);
  try {
    install(next);
    const old = `${prefix}.old-${process.pid}`;
    if (existsSync(prefix)) renameSync(prefix, old);
    renameSync(next, prefix);
    rmSync(old, { recursive: true, force: true });
  } finally {
    rmSync(next, { recursive: true, force: true });
  }
}
