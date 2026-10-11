#!/usr/bin/env node
// Fetches the build backend of the Python wheels into var/tools/wheels. Two declarations name it: buildBackend of
// config/release.json, which a repository that releases wheels declares (`make release-backend`), and pythonBackend of
// config/toolchain.json, which the kit declares for its own wheel tests (`make install-tools`). Both call installBackend:
//
//   node scripts/kit/release-backend.mjs     the buildBackend of config/release.json
//
// The download is `pip download --no-deps --only-binary :all: --require-hashes` by var/tools/bin/python3, from a requirement
// file that names the requirement with the declared sha256, so pip refuses a file of another digest. The file's sha256 is
// checked again after the download, and a file that differs is removed. A file that already has the declared digest is kept,
// so a second run changes nothing. This is the one network step of the Python wheels; release-assets reads only var/tools/wheels.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileDigest } from './digest.mjs';
import { context } from './release.mjs';
import { backendName, BACKEND_DIRECTORY } from './release-wheel.mjs';
import { run, Stop } from './process.mjs';
import { toolsPath } from './tool-wrappers.mjs';
import { isMain, ROOT } from './paths.mjs';

/** Makes the build backend wheel of `requirement` with the digest `sha256` exist in var/tools/wheels; `source` names the declaration. Returns { installed, file }. */
export function installBackend({ root, env, requirement, sha256, source, print = () => {} }) {
  const python = toolsPath(root, 'bin', 'python3');
  if (!existsSync(python)) throw new Stop(`${path.relative(root, python)} is missing; make install-tools TOOLS=python installs the Python of pythonBuild`);
  const directory = toolsPath(root, BACKEND_DIRECTORY);
  const file = path.join(directory, backendName(requirement));
  const shown = path.relative(root, file);
  if (existsSync(file) && fileDigest(file) === sha256) {
    print(`[backend] ${shown} has the declared sha256; kept`);
    return { installed: false, file };
  }
  mkdirSync(directory, { recursive: true });
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-backend-'));
  try {
    const requirements = path.join(folder, 'requirements.txt');
    writeFileSync(requirements, `${requirement} --hash=sha256:${sha256}\n`);
    print(`[backend] downloading ${requirement} into ${path.relative(root, directory)}`);
    run(python, ['-m', 'pip', 'download', '--no-deps', '--no-input', '--disable-pip-version-check', '--only-binary', ':all:', '--require-hashes', '-r', requirements, '-d', directory], { cwd: root, env });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  const actual = existsSync(file) ? fileDigest(file) : 'none';
  if (actual !== sha256) {
    rmSync(file, { force: true });
    throw new Stop(`${shown} has the sha256 ${actual}, ${source} declares ${sha256}; the file is removed`);
  }
  print(`[backend] ${shown} has the declared sha256`);
  return { installed: true, file };
}

/** Downloads the buildBackend of `ctx.config` (config/release.json) and returns the file; a digest that differs fails. */
export function fetchBackend(ctx, print = () => {}) {
  if (!ctx.config.buildBackend) throw new Stop('config/release.json declares no buildBackend; no wheel package needs a build backend');
  const { requirement, sha256 } = ctx.config.buildBackend;
  return installBackend({ root: ctx.root, env: ctx.env, requirement, sha256, source: 'config/release.json buildBackend', print }).file;
}

if (isMain(import.meta.url)) {
  try {
    fetchBackend(context(ROOT, { env: process.env }), text => console.log(`[release-backend] ${text}`));
  } catch (failure) {
    if (!(failure instanceof Stop)) throw failure;
    console.error(`[release-backend] failed: ${failure.message}`);
    process.exitCode = 1;
  }
}
