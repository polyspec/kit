#!/usr/bin/env node
// Fetches the build backend of the wheel packages into var/tools/wheels (`make release-backend`):
//
//   node scripts/kit/release-backend.mjs     the wheel of buildBackend.requirement in config/release.json
//
// The download is `pip download --no-deps --only-binary :all: --require-hashes` by var/tools/bin/python3, from a requirement
// file that names the requirement with the sha256 that config/release.json declares, so pip refuses a file of another digest.
// The file's sha256 is checked again after the download, and a file that differs is removed. This is the one step of a wheel
// package that reads the network, and it runs before a release; release-assets reads only var/tools/wheels.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileDigest } from './digest.mjs';
import { context } from './release.mjs';
import { backendName, BACKEND_DIRECTORY } from './release-wheel.mjs';
import { run, Stop } from './process.mjs';
import { toolsPath } from './tool-wrappers.mjs';
import { isMain, ROOT } from './paths.mjs';

/** Downloads the build backend that `ctx.config.buildBackend` declares and returns the file; a digest that differs fails. */
export function fetchBackend(ctx, print = () => {}) {
  const { root, config, env } = ctx;
  if (!config.buildBackend) throw new Stop('config/release.json declares no buildBackend; no wheel package needs a build backend');
  const { requirement, sha256 } = config.buildBackend;
  const python = toolsPath(root, 'bin', 'python3');
  if (!existsSync(python)) throw new Stop(`${path.relative(root, python)} is missing; make install-tools TOOLS=python installs the Python of pythonBuild`);
  const directory = toolsPath(root, BACKEND_DIRECTORY);
  const file = path.join(directory, backendName(requirement));
  const shown = path.relative(root, file);
  mkdirSync(directory, { recursive: true });
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-backend-'));
  try {
    const requirements = path.join(folder, 'requirements.txt');
    writeFileSync(requirements, `${requirement} --hash=sha256:${sha256}\n`);
    print(`[release-backend] downloading ${requirement} into ${path.relative(root, directory)}`);
    run(python, ['-m', 'pip', 'download', '--no-deps', '--no-input', '--disable-pip-version-check', '--only-binary', ':all:', '--require-hashes', '-r', requirements, '-d', directory], { cwd: root, env });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  const actual = fileDigest(file);
  if (actual !== sha256) {
    rmSync(file, { force: true });
    throw new Stop(`${shown} has the sha256 ${actual}, config/release.json buildBackend declares ${sha256}; the file is removed`);
  }
  print(`[release-backend] ${shown} has the declared sha256`);
  return file;
}

if (isMain(import.meta.url)) {
  try {
    fetchBackend(context(ROOT, { env: process.env, log: text => console.log(text) }), text => console.log(text));
  } catch (failure) {
    if (!(failure instanceof Stop)) throw failure;
    console.error(`[release-backend] failed: ${failure.message}`);
    process.exitCode = 1;
  }
}
