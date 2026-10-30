#!/usr/bin/env node
// Builds the php-ext package PACKAGE at VERSION of the Composer repository PACKAGES (the packages.json of a release) with PIE
// (`make pie-build`, K915). PIE keeps one Composer project per target PHP under PIE_WORKING_DIRECTORY, and repository:add
// is never undone there, so a kept directory serves an earlier repository first and keeps the build of an earlier PHP. Each
// run therefore starts in an empty var/pie/<vendor/name>, adds the one repository and builds. The result is what PIE records
// in vendor/composer/installed.json: the pie-built-binary of the package and its install-path. `pie build` installs nothing
// into the PHP. PIE is the environment's PIE, by default the shim of mise of the http:pie that mise.toml declares.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { run, Stop } from './process.mts';

const USAGE = 'usage: node scripts/kit/pie-build.mts PACKAGES PACKAGE VERSION';
const NAME = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/;

/** The built library of the package and its folder, as PIE records them. */
export type PieBuild = { binary: string; package: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The entries of `name` in the installed.json files under `work` that carry a pie-built-binary, each resolved to absolute paths. */
export function pieBuilds(work: string, name: string): PieBuild[] {
  const builds: PieBuild[] = [];
  for (const target of existsSync(work) ? readdirSync(work) : []) {
    const composer = path.join(work, target, 'vendor', 'composer');
    const file = path.join(composer, 'installed.json');
    if (!existsSync(file)) continue;
    const installed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const packages = isRecord(installed) && Array.isArray(installed.packages) ? installed.packages : [];
    for (const entry of packages) {
      if (!isRecord(entry) || entry.name !== name) continue;
      const binary = isRecord(entry.extra) ? entry.extra['pie-built-binary'] : undefined;
      if (typeof binary !== 'string' || typeof entry['install-path'] !== 'string') continue;
      builds.push({ binary: path.resolve(composer, binary), package: path.resolve(composer, entry['install-path']) });
    }
  }
  return builds;
}

/** Builds PACKAGE:VERSION of the repository `packages` in an empty var/pie/<PACKAGE> of `root`; returns what PIE recorded. */
export function pieBuild(root: string, packages: string, name: string, version: string, env: NodeJS.ProcessEnv, log: (text: string) => void): PieBuild {
  if (!NAME.test(name)) throw new Stop(`PACKAGE ${JSON.stringify(name)} is not a Composer package name vendor/name`);
  const work = path.join(root, 'var', 'pie', name);
  rmSync(work, { recursive: true, force: true });
  const pie = env.PIE ?? path.join(root, 'var', 'tools', 'mise', 'shims', 'pie');
  const pieEnv = { ...env, PIE_WORKING_DIRECTORY: work };
  log(run(pie, ['repository:add', 'composer', packages, '--no-interaction'], { cwd: root, env: pieEnv }));
  log(run(pie, ['build', `${name}:${version}`, '--no-interaction'], { cwd: root, env: pieEnv }));
  const builds = pieBuilds(work, name);
  const [build] = builds;
  if (!build || builds.length !== 1) throw new Stop(`PIE recorded ${builds.length} builds of ${name} in ${work}/*/vendor/composer/installed.json, not one: ${JSON.stringify(builds)}`);
  return build;
}

export function main(args: readonly string[], { root, env = process.env, print = (text: string) => console.log(text), error = (text: string) => console.error(text) }: { root: string; env?: NodeJS.ProcessEnv; print?: (text: string) => void; error?: (text: string) => void }): number {
  const [packages, name, version, ...rest] = args;
  if (!packages || !name || !version || rest.length) {
    error(USAGE);
    return 2;
  }
  try {
    const build = pieBuild(root, packages, name, version, env, text => { if (text.trim()) error(text.trimEnd()); });
    print(`binary ${build.binary}`);
    print(`package ${build.package}`);
    return 0;
  } catch (failure) {
    error(`[pie-build] ${name}:${version} failed: ${failure instanceof Error ? failure.message : String(failure)}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2), { root: repositoryRoot() });
