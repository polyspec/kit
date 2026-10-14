#!/usr/bin/env node
// Fetches the wheels that the checkout declares into var/tools/wheels. pythonBackend of config/toolchain.json, the one
// declaration of the build backend of the Python wheels (K166), names a wheel: install-tools installs it (`make
// install-tools`), and so does this command for a release (`make release-backend`). Both call installBackend:
//
//   node scripts/kit/release-backend.mts     the pythonBackend of config/toolchain.json
//
// The download is `pip download --no-deps --only-binary :all: --require-hashes` by the python3 of mise.toml, from a requirement
// file that names the requirement with each declared sha256, so pip refuses a file of another digest. The file's sha256 is
// checked again after the download, and a file that differs is removed. A file that already has a declared digest is kept,
// so a second run changes nothing. This is the one network step of the Python wheels; release-assets reads only var/tools/wheels.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import { BACKEND_DIRECTORY, BACKEND_SOURCE, buildBackend } from './release-wheel.mts';
import { run, Stop } from './process.mts';
import { toolsPath } from './bootstrap/tool-wrappers.mts';
import { toolCommand } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { present } from './present.mts';

const REQUIREMENT = /^([A-Za-z0-9._-]+)==(\d+(?:\.\d+)*)$/;

/** What fetchBackend reads: the checkout, whose config/toolchain.json declares pythonBackend, and the environment of pip. */
type BackendContext = { root: string; env: NodeJS.ProcessEnv };

// The wheels of `name==version` in `directory`: every file of that distribution and release whose name ends in .whl.
const wheelsOf = (directory: string, name: string, version: string) => (existsSync(directory) ? readdirSync(directory) : [])
  .filter(file => file.startsWith(`${name}-${version}-`) && file.endsWith('.whl'))
  .map(file => path.join(directory, file));

/**
 * Makes a wheel of the exact `requirement` name==version exist in var/tools/wheels, with a digest that `digests` (the sha256
 * of each accepted wheel) lists; `source` names the declaration. The download is `pip download` by the python3 of mise.toml with
 * every listed digest as a hash of the requirement, so pip picks the wheel of this platform and refuses one whose digest is not
 * listed. The digest of the file is checked again after the download, and a file that differs is removed. A wheel that already
 * has a listed digest is kept, so a second run changes nothing. Returns { installed, file }.
 */
export function installBackend({ root, env, requirement, digests, source, print = () => {} }: { root: string; env: NodeJS.ProcessEnv; requirement: string; digests: string[]; source: string; print?: (text: string) => void }) {
  const python = toolCommand(root, 'python3');
  if (!existsSync(python)) throw new Stop(`${path.relative(root, python)} is missing; declare python in mise.toml and run make install-tools`);
  const found = REQUIREMENT.exec(requirement);
  if (!found) throw new Stop(`${source} must record requirement as name==version; it records ${JSON.stringify(requirement)}`);
  // Both groups of REQUIREMENT are required, so a match holds them.
  const name = present(found[1], `the name of ${requirement}`);
  const version = present(found[2], `the version of ${requirement}`);
  const directory = toolsPath(root, BACKEND_DIRECTORY);
  const kept = wheelsOf(directory, name, version).find(file => digests.includes(fileDigest(file)));
  if (kept) {
    print(`[backend] ${path.relative(root, kept)} has a declared sha256; kept`);
    return { installed: false, file: kept };
  }
  mkdirSync(directory, { recursive: true });
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-backend-'));
  try {
    const requirements = path.join(folder, 'requirements.txt');
    writeFileSync(requirements, `${requirement} ${digests.map(digest => `--hash=sha256:${digest}`).join(' ')}\n`);
    print(`[backend] downloading ${requirement} into ${path.relative(root, directory)}`);
    run(python, ['-m', 'pip', 'download', '--no-deps', '--no-input', '--disable-pip-version-check', '--only-binary', ':all:', '--require-hashes', '-r', requirements, '-d', directory], { cwd: root, env });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  const files = wheelsOf(directory, name, version);
  const shown = path.relative(root, path.join(directory, `${name}-${version}-*.whl`));
  const wrong = files.find(item => !digests.includes(fileDigest(item)));
  if (wrong) {
    const actual = fileDigest(wrong);
    rmSync(wrong, { force: true });
    throw new Stop(`${path.relative(root, wrong)} has the sha256 ${actual}, ${source} declares ${digests.join(' or ')}; the file is removed`);
  }
  const file = files.find(item => digests.includes(fileDigest(item)));
  if (!file) throw new Stop(`${shown} was not downloaded; pip downloaded no wheel of ${requirement}`);
  print(`[backend] ${path.relative(root, file)} has a declared sha256`);
  return { installed: true, file };
}

/** Downloads the pythonBackend of config/toolchain.json of `ctx.root` and returns the file; a digest that differs fails. */
export function fetchBackend(ctx: BackendContext, print: (text: string) => void = () => {}) {
  const { requirement, sha256 } = buildBackend(ctx.root);
  return installBackend({ root: ctx.root, env: ctx.env, requirement, digests: [sha256], source: BACKEND_SOURCE, print }).file;
}

if (isMain(import.meta.url)) {
  try {
    fetchBackend({ root: repositoryRoot(), env: process.env }, text => console.log(`[release-backend] ${text}`));
  } catch (failure) {
    if (!(failure instanceof Stop)) throw failure;
    console.error(`[release-backend] failed: ${failure.message}`);
    process.exitCode = 1;
  }
}
