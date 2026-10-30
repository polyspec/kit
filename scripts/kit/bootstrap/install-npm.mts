// Installs the npm that `packageManager` of package.json declares into var/tools/npm, with the wrappers npm and npx in
// var/tools/bin. packageManager declares `npm@<version>+sha512.<digest>`: the registry tarball is downloaded, refused unless its
// SHA-512 is the digest or when it holds a link, and unpacked; a declaration without the digest is refused before anything is
// downloaded. An installation whose marker holds the digest is kept (K933). The npm of the machine is never used or changed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installOnce } from './install-tool.mts';
import { archiveTar, bootstrapEnvironment, run, toolsPath, writeNativeWrapper } from './tool-wrappers.mts';
import { fileDigest } from './digest.mts';

/** The digest marker of the installed npm, relative to var/tools/npm. */
const MARKER = 'node_modules/npm/.sha512';

// Downloads the tarball, checks its digest and that it holds only files and directories, and unpacks it without its top directory.
function unpackVerified({ root, next, version, sha512, print }: { root: string; next: string; version: string; sha512: string; print: (text: string) => void }): void {
  const scratch = path.join(next, '.download');
  mkdirSync(scratch);
  const tarball = path.join(scratch, 'npm.tgz');
  const url = `https://registry.npmjs.org/npm/-/npm-${version}.tgz`;
  run('curl', ['--fail', '--silent', '--show-error', '--location', '--output', tarball, url], { cwd: root, env: bootstrapEnvironment(root) }, print);
  const actual = fileDigest(tarball, 'sha512');
  if (actual !== sha512) throw new Error(`npm ${version} tarball ${url} has the sha512 ${actual}; packageManager of package.json declares ${sha512}`);
  const listing = spawnSync(archiveTar(), ['-tvf', tarball], { encoding: 'utf8' });
  if (listing.status !== 0) throw new Error(`tar -tvf ${tarball} ended with exit status ${listing.status}: ${listing.stderr.trim()}`);
  // tar -tv starts the line of a file with - and the one of a directory with d.
  const links = listing.stdout.split('\n').filter(line => line && !/^[-d]/.test(line));
  if (links.length > 0) throw new Error(`the npm ${version} tarball holds a link or a special file; expected files and directories only: ${links[0]}`);
  const directory = path.join(next, 'node_modules/npm');
  mkdirSync(directory, { recursive: true });
  run(archiveTar(), ['-x', '-f', tarball, '-C', directory, '--strip-components', '1'], { cwd: root }, print);
  rmSync(scratch, { recursive: true, force: true });
}

/** The wrappers of var/tools/bin that run the installed npm, each with its script of npm/bin. */
export const NPM_WRAPPERS = { npm: 'npm-cli.js', npx: 'npx-cli.js' };

/**
 * Installs the declared npm `{ version, sha512 }` into var/tools/npm of `root` and writes the wrappers, which run it with
 * `node`, the node of the checkout by its absolute path; returns `{ installed }`. A declaration without its sha512 is refused first, naming how to get it.
 */
export function installNpm({ root, declared, node, print = () => {} }: { root: string; declared: { version: string; sha512: string | undefined }; node: string; print?: (text: string) => void }) {
  const { version, sha512 } = declared;
  if (sha512 === undefined) throw new Error(`packageManager of package.json declares npm@${version} without a sha512 digest; add it: run \`npm pack npm@${version}\` and \`shasum -a 512 npm-${version}.tgz\`, then write npm@${version}+sha512.<hex> in packageManager`);
  const prefix = toolsPath(root, 'npm');
  const result = installOnce({
    root, label: 'npm', version, prefix, digest: sha512, marker: MARKER, print,
    install: (next: string) => {
      writeFileSync(path.join(next, 'package.json'), '{ "private": true }\n');
      unpackVerified({ root, next, version, sha512, print });
    },
  });
  for (const [name, cli] of Object.entries(NPM_WRAPPERS)) {
    writeNativeWrapper(root, name, {
      comment: `${name} ${declared.version} of this checkout`,
      executable: node,
      args: [path.join(prefix, 'node_modules/npm/bin', cli)],
    }, print);
  }
  return result;
}
