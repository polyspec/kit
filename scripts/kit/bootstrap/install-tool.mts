// The install step that the tools of var/tools share: build into a temporary directory beside the target and rename it into
// place, so a reader never sees a partly installed tool (replaceInstall). The bootstrap installers of mise and npm, the anchor
// that kit checks before any package manager runs, judge an installation by its digest marker alone: a file of the
// installation that holds the declared digest of the download it was unpacked from (installOnce, K861, K933, S4).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Installs `label` `version` into `prefix` unless the marker `prefix/marker` holds `digest`. `install(next)` builds the tool into
 * the temporary directory `next` from a download whose digest it checks against `digest`, and throws on another; installOnce then
 * writes `digest` into `next/marker` and renames `next` into place. No version is compared: `version` names the tool in the log
 * only. A binary that is swapped while its marker stays passes, since only the marker is read. Returns `{ installed }`.
 */
export function installOnce({ root, label, version, prefix, digest, marker, install, print = () => {} }: {
  root: string;
  label: string;
  version: string;
  prefix: string;
  digest: string;
  marker: string;
  install: (next: string) => void;
  print?: ((text: string) => unknown) | undefined;
}): { installed: boolean } {
  const where = path.relative(root, prefix);
  const found = existsSync(path.join(prefix, marker)) ? readFileSync(path.join(prefix, marker), 'utf8').trim() : undefined;
  if (found === digest) {
    print(`${label}: ${version} with the declared digest is installed in ${where}`);
    return { installed: false };
  }
  print(`${label}: ${found === undefined ? 'no install with a digest marker' : 'the install has another digest'} in ${where}; installing ${version}`);
  replaceInstall(prefix, (next) => {
    install(next);
    mkdirSync(path.dirname(path.join(next, marker)), { recursive: true });
    writeFileSync(path.join(next, marker), `${digest}\n`);
  });
  print(`${label}: installed ${version} in ${where}`);
  return { installed: true };
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
