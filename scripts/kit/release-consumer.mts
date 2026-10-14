#!/usr/bin/env node
// The consumer install of the release archives: all archives of a tag are installed together in clean npm and Composer
// projects in a temporary directory outside the repository, from committed manifests and locks, and a smoke command checks
// each installed package.
//
//   node scripts/kit/release-consumer.mts install TAG   install the archives of TAG from var/release/assets and run the smoke commands
//   node scripts/kit/release-consumer.mts lock TAG      write the manifests and locks of the consumer projects from those archives
//
// The consumers are data in config/release.json (`consumers`, schema scripts/kit/schema/release.schema.json): the directory
// of the committed manifest and lock of each kind and, for each installed package, its smoke command. The npm project names
// each installed package by `file:<archive>` and the Composer project requires it at the version of the tag from an
// `artifacts` repository of the zips with Packagist disabled, so a package of this repository comes only from its archive.
// A package that a lock pins from a registry is downloaded as the lock pins it: that is installation, not a registry query,
// so `install` removes the offline settings of npm and Composer (npm_config_offline, COMPOSER_DISABLE_NETWORK) from the
// environment of the project. The caches and COMPOSER_HOME are empty directories of the run; a scope of this repository
// points at an unreachable registry. The archives are built in the run that uses them, so a lock records an archive of this
// repository by name and version only: no `integrity` for an npm entry and an empty `shasum` for a Composer entry. A lock
// changes only with a version or a dependency, and `lock` runs on the release commit before the tag is pushed.
// `lock` resolves version ranges, so it is the one step that reads a registry; no check runs it.
// A `wheel` package is installed into a clean virtual environment of the python3 of mise.toml: its dependencies from the lock of
// consumers.wheel.lock (`pip install --require-hashes --no-deps --only-binary :all:`, the online step of the proof), then the wheels
// of all wheel packages in one command from their files (`pip install --no-index --require-hashes --no-deps`, each named with the
// sha256 of its file), then `pip check`, which fails on a lock that lacks a dependency. The command names every wheel of the release,
// so a sibling (a wheel of the same release) is installed from its file: with --no-deps pip never reads a sibling's URL.
// The Composer project also holds, in its artifact repository, the release zip of each polyspec dependency that
// consumers.composer.polyspec names by its entry of config/release-assets.json (make release-assets-fetch downloads it), so a
// dependency of the release is installed from its released archive, as a consumer installs it, the counterpart of the
// polyspec archives of a wheel lock (consumers.wheel.polyspec).
// A Go module tag releases no archive and has nothing to install. Each failure names the expected and the actual value.
//   TAG is `latest` for the newest root release tag reachable from HEAD.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { ASSETS, archiveName, assetNames, context, latestTag, parseTag, stepFailure, type CommandOptions } from './release.mts';
import type { ConsumerProject, Context, ReleaseConfig, WheelConsumer } from './release.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { wheelName } from './release-wheel.mts';
import { lockRequirements, wheelLocks } from './wheel-dependencies.mts';
import { toolCommand } from './mise-tools.mts';
import { makeVenv } from './python-venv.mts';
import { readJson, writeAtomic } from './bootstrap/files.mts';
import { run, Stop } from './process.mts';
import { CONSUMER_KINDS, WHEEL_KIND } from './release-consumer-config.mts';
import { fetchedAsset } from './release-assets.mts';

// A registry address that refuses every connection: port 9 of the loopback address.
export const UNREACHABLE = 'http://127.0.0.1:9/';
// The directory of the zips in a Composer project; its `artifact` repository names it.
export const ARTIFACTS = 'artifacts';
const FILES = { npm: { manifest: 'package.json', lock: 'package-lock.json', extension: 'tgz', indent: 2 }, composer: { manifest: 'composer.json', lock: 'composer.lock', extension: 'zip', indent: 4 } };
// The settings of the caller that a consumer install must not inherit: the offline settings of the build recipes and the
// paths that redirect Composer away from the project.
const INHERITED = ['npm_config_offline', 'COMPOSER_DISABLE_NETWORK', 'COMPOSER', 'COMPOSER_VENDOR_DIR'];

/** A package kind with a committed consumer project: the keys of CONSUMER_KINDS (release-consumer-config.mts). */
export type ConsumerKind = keyof typeof FILES;
/** The consumer project of an archive kind (config/release.json consumers.npm or consumers.composer). */
export type Consumer = ConsumerProject;
export type { ReleaseConfig, WheelConsumer };
/** The release context of release.mts context(), in the fields that the release consumer and the release proof read. */
export type ReleaseContext = Pick<Context, 'root' | 'config' | 'env'>;
/** An installed package of a consumer project and the name of its archive. */
type ArchivePackage = { name: string; file: string };
/** An entry of composer.lock packages or of vendor/composer/installed.json. */
type ComposerEntry = { name: string; version?: string; dist?: { url?: string; shasum?: string } };
/** package-lock.json of an npm consumer project: packages maps paths to entries. */
type NpmLock = { packages?: Record<string, { version?: string; resolved?: string; integrity?: string }> };
/** composer.lock of a Composer consumer project: packages lists entries. */
type ComposerLock = { packages?: ComposerEntry[]; 'packages-dev'?: ComposerEntry[] };
/** The fields of the manifest of a consumer project that the release reads: package.json for npm, composer.json for Composer. */
type ConsumerManifest = { dependencies?: Record<string, string>; require?: Record<string, string>; repositories?: { type?: string; url?: string }[] };

/**
 * The smoke command of the package `name`, its program first; release-consumer-config.mts requires a non-empty command for
 * each installed package.
 */
function smokeOf(smoke: Record<string, string[]>, name: string, where: string): [string, ...string[]] {
  const command = smoke[name];
  if (command === undefined) throw new Error(`config/release.json: ${where}.smoke.${name} is missing`);
  const [program, ...args] = command;
  if (program === undefined) throw new Error(`config/release.json: ${where}.smoke.${name} is an empty command`);
  return [program, ...args];
}

const json = (value: unknown, indent: number) => `${JSON.stringify(value, null, indent)}\n`;
/** The package kinds with a committed consumer project, each with its packages: [[kind, consumer, [{ name, file }]]]. */
function plan(config: ReleaseConfig, version: string): [ConsumerKind, Consumer, ArchivePackage[]][] {
  const { consumers } = config;
  if (!consumers) throw new Stop('config/release.json has no consumers section; it declares the consumer projects that install the archives');
  return CONSUMER_KINDS.flatMap((kind) => {
    const consumer = consumers[kind];
    return consumer ? [[kind, consumer, Object.keys(consumer.smoke).map(name => ({ name, file: archiveName(kind, name, version) }))]] : [];
  });
}

/** Requires `directory` to hold exactly the archives of `version`; the names of the archives. */
export function requireArchives(config: ReleaseConfig, version: string, directory: string, where: string) {
  const expected = [...assetNames(config, version)].sort();
  if (!existsSync(directory)) throw new Stop(`${where} does not exist; it holds the archives of ${version}: [${expected.join(', ')}]`);
  const actual = readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Stop(`${where} holds [${actual.join(', ')}], the archives of ${version} are [${expected.join(', ')}]`);
  }
  return expected;
}

/** The environment of a project command: no offline setting, and caches and homes that are empty directories of the run. */
function environment(env: NodeJS.ProcessEnv, folder: string) {
  const clean = Object.fromEntries(Object.entries(env).filter(([name]) => !INHERITED.includes(name)));
  return { ...clean, npm_config_cache: path.join(folder, 'npm-cache'), COMPOSER_HOME: path.join(folder, 'composer-home'), COMPOSER_CACHE_DIR: path.join(folder, 'composer-cache'), PIP_CACHE_DIR: path.join(folder, 'pip-cache') };
}

/** The scopes of the npm packages of this repository, each pointed at the unreachable registry. */
const registryArguments = (config: ReleaseConfig) => [...new Set(config.packages.filter(item => item.kind === 'npm' && item.name.startsWith('@')).map(({ name }) => name.slice(0, name.indexOf('/'))))].sort().map(scope => `--${scope}:registry=${UNREACHABLE}`);

/** A new temporary directory outside the repository. */
function outside(ctx: ReleaseContext) {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-release-consumer-')));
  if (!path.relative(realpathSync(ctx.root), folder).startsWith('..')) {
    rmSync(folder, { recursive: true, force: true });
    throw new Stop(`${folder} is inside the repository ${ctx.root}; the consumer projects are outside it`);
  }
  return folder;
}

/** The manifest of a consumer project with each installed package set to its archive (npm) or to the version (Composer). */
function manifestFor(ctx: ReleaseContext, kind: ConsumerKind, consumer: Consumer, packages: ArchivePackage[], version: string) {
  const file = path.join(ctx.root, consumer.directory, FILES[kind].manifest);
  if (!existsSync(file)) throw new Stop(`${consumer.directory}/${FILES[kind].manifest} is missing; commit the manifest of the ${kind} consumer project, with its name and ${kind === 'npm' ? '"private": true' : '"type": "project" and the artifact repository'}`);
  const manifest = readJson(file) as ConsumerManifest;
  const field = kind === 'npm' ? 'dependencies' : 'require';
  const set: Record<string, string> = { ...manifest[field] };
  for (const { name, file: archive } of packages) set[name] = kind === 'npm' ? `file:${archive}` : version;
  return { ...manifest, [field]: set };
}

/** The consumer manifest and lock must name the archives of the tag; each difference names the expected and the actual value. */
function staleProblems(ctx: ReleaseContext, kind: ConsumerKind, consumer: Consumer, packages: ArchivePackage[], version: string) {
  const directory = consumer.directory;
  const problems: string[] = [];
  const manifestFile = `${directory}/${FILES[kind].manifest}`;
  const lockFile = `${directory}/${FILES[kind].lock}`;
  for (const file of [manifestFile, lockFile]) if (!existsSync(path.join(ctx.root, file))) problems.push(`${file} is missing`);
  if (problems.length) return problems;
  const manifest = readJson(path.join(ctx.root, manifestFile)) as ConsumerManifest;
  // The lock is package-lock.json or composer.lock as `kind` says; each branch reads the shape of its kind.
  const lock = readJson(path.join(ctx.root, lockFile));
  for (const { name, file } of packages) {
    if (kind === 'npm') {
      const spec = manifest.dependencies?.[name];
      if (spec !== `file:${file}`) problems.push(`${manifestFile}: dependencies.${name} is ${JSON.stringify(spec ?? null)}, expected "file:${file}"`);
      const entry = (lock as NpmLock).packages?.[`node_modules/${name}`];
      if (entry?.resolved !== `file:${file}` || entry?.version !== version) problems.push(`${lockFile}: node_modules/${name} is ${entry ? `${entry.version} resolved ${entry.resolved}` : 'missing'}, expected ${version} resolved file:${file}`);
    } else {
      const spec = manifest.require?.[name];
      if (spec !== version) problems.push(`${manifestFile}: require.${name} is ${JSON.stringify(spec ?? null)}, expected "${version}"`);
      const { packages: entries = [], 'packages-dev': devEntries = [] } = lock as ComposerLock;
      const entry = [...entries, ...devEntries].find(item => item.name === name);
      if (entry?.version !== version || entry?.dist?.url !== `${ARTIFACTS}/${file}`) problems.push(`${lockFile}: ${name} is ${entry ? `${entry.version} from ${entry.dist?.url}` : 'missing'}, expected ${version} from ${ARTIFACTS}/${file}`);
    }
  }
  if (kind === 'composer' && !(manifest.repositories ?? []).some(item => item.type === 'artifact' && item.url === ARTIFACTS)) problems.push(`${manifestFile}: repositories lacks { "type": "artifact", "url": "${ARTIFACTS}" }`);
  return problems;
}

/**
 * The release zips of the polyspec dependencies of the Composer consumer: each entry of config/release-assets.json that
 * consumers.composer.polyspec names, which must hold its sha256 and be a zip.
 */
function dependencyZips(ctx: ReleaseContext, kind: ConsumerKind, consumer: Consumer): string[] {
  if (kind !== 'composer') return [];
  return (consumer.polyspec ?? []).map((name) => {
    const file = fetchedAsset(ctx.root, name);
    if (!file.endsWith('.zip')) throw new Stop(`consumers.composer.polyspec names ${name}, whose archive ${path.basename(file)} is no zip; a Composer artifact repository reads zips`);
    return file;
  });
}

/** A project of `kind` in `folder`: the archives of its kind, the manifest and, unless `lock`, the committed lock. */
function stage(ctx: ReleaseContext, kind: ConsumerKind, consumer: Consumer, folder: string, assets: string, manifest: unknown, committed: Consumer | null) {
  const project = path.join(folder, kind);
  const archives = path.join(project, kind === 'npm' ? '' : ARTIFACTS);
  mkdirSync(archives, { recursive: true });
  for (const name of readdirSync(assets).filter(item => item.endsWith(`.${FILES[kind].extension}`))) copyFileSync(path.join(assets, name), path.join(archives, name));
  for (const file of dependencyZips(ctx, kind, consumer)) copyFileSync(file, path.join(archives, path.basename(file)));
  writeFileSync(path.join(project, FILES[kind].manifest), json(manifest, FILES[kind].indent));
  if (committed) copyFileSync(path.join(ctx.root, committed.directory, FILES[kind].lock), path.join(project, FILES[kind].lock));
  return project;
}

/** The installed version of a package in a project of `kind`, or null. */
function installedVersion(kind: ConsumerKind, project: string, name: string) {
  if (kind === 'npm') {
    const file = path.join(project, 'node_modules', name, 'package.json');
    return existsSync(file) ? (readJson(file) as { version?: string }).version ?? null : null;
  }
  // Composer 2 writes vendor/composer/installed.json as { packages: [...] } on every install.
  const file = path.join(project, 'vendor/composer/installed.json');
  if (!existsSync(file)) throw new Stop(`composer install wrote no vendor/composer/installed.json in ${project}`);
  const installed = readJson(file) as { packages: ComposerEntry[] };
  return installed.packages.find(item => item.name === name)?.version ?? null;
}

/**
 * Installs the archives of `directory`, which hold exactly the archives of `version`, in clean projects of each kind of
 * `ctx.config.consumers` with the committed locks and runs the smoke command of each installed package in its project.
 * `step(text)` reports each completed step. Returns the number of installed packages.
 */
export function installConsumers(ctx: ReleaseContext, version: string, directory: string, step: (text: string) => void = () => {}) {
  const { config } = ctx;
  const relative = path.relative(ctx.root, directory);
  requireArchives(config, version, directory, relative.startsWith('..') ? directory : relative);
  const projects = plan(config, version);
  const problems = projects.flatMap(([kind, consumer, packages]) => staleProblems(ctx, kind, consumer, packages, version));
  if (problems.length) throw new Stop(`the consumer projects do not name the archives of ${version}: ${problems.join('; ')}. Fix: make release-consumer-lock TAG=v${version} writes them`);
  const folder = outside(ctx);
  try {
    const env = environment(ctx.env, folder);
    let installed = 0;
    for (const [kind, consumer, packages] of projects) {
      const project = stage(ctx, kind, consumer, folder, directory, manifestFor(ctx, kind, consumer, packages, version), consumer);
      if (kind === 'npm') run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0', ...registryArguments(config)], { cwd: project, env });
      else run('composer', ['install', '--no-interaction', '--no-progress', '--no-plugins', '--no-scripts'], { cwd: project, env });
      step(`${kind} ${kind === 'npm' ? 'ci' : 'install'} of ${packages.length} packages from ${consumer.directory}`);
      for (const { name } of packages) {
        const actual = installedVersion(kind, project, name);
        if (actual !== version) throw new Stop(`${kind} installed ${name} ${actual ?? 'none'}, expected ${version}`);
        run(smokeOf(consumer.smoke, name, `consumers.${kind}`)[0], smokeOf(consumer.smoke, name, `consumers.${kind}`).slice(1), { cwd: project, env });
        step(`${kind} ${name} ${version}: ${smokeOf(consumer.smoke, name, `consumers.${kind}`).join(' ')}`);
        installed += 1;
      }
    }
    installed += installWheels(ctx, version, directory, folder, env, step);
    return installed;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Installs the wheels of `names` at `version` from `directory` into a clean virtual environment of `folder` made by the Python
 * of `root`. `requirements` is the requirement file of the dependencies (lockRequirements), installed first with hashes, no
 * dependency of their own and only binary files. Then the wheels: `pip install --no-index --require-hashes --no-deps`, each file
 * named with the sha256 of its file. Each package must show `version`, its smoke command runs in the environment, and `pip check` must
 * pass in it. Returns the number of packages.
 */
export function installWheelFiles({ root, env, folder, version, directory, names, smoke, requirements = '', step = () => {} }: {
  root: string; env: NodeJS.ProcessEnv; folder: string; version: string; directory: string; names: string[]; smoke: Record<string, string[]>;
  requirements?: string; step?: (text: string) => void;
}) {
  if (names.length === 0) return 0;
  const project = path.join(folder, WHEEL_KIND);
  const venv = path.join(project, 'venv');
  mkdirSync(project, { recursive: true });
  // uv venv makes the venv from the checkout Python with no pip (python-venv.mts); pip of the checkout installs into it.
  try {
    makeVenv({ root, directory: venv, env });
  } catch (error) {
    throw new Stop((error as Error).message);
  }
  const bin = path.join(venv, 'bin');
  const python = path.join(bin, 'python');
  const checkoutPython = toolCommand(root, 'python3');
  const venvEnv = { ...env, PATH: `${bin}${path.delimiter}${env.PATH}`, VIRTUAL_ENV: venv };
  if (requirements !== '') {
    const dependencies = path.join(project, 'dependencies.txt');
    writeFileSync(dependencies, requirements);
    run(checkoutPython, ['-m', 'pip', '--python', python, 'install', '--no-input', '--disable-pip-version-check', '--require-hashes', '--no-deps', '--only-binary', ':all:', '-r', dependencies], { cwd: project, env });
    step(`wheel dependencies pip install of ${requirements.split('\n').filter(Boolean).length} requirements`);
  }
  const requirementsFile = path.join(project, 'requirements.txt');
  writeFileSync(requirementsFile, names.map((name) => {
    const file = path.join(directory, wheelName(name, version));
    return `${file} --hash=sha256:${fileDigest(file)}\n`;
  }).join(''));
  run(checkoutPython, ['-m', 'pip', '--python', python, 'install', '--no-input', '--disable-pip-version-check', '--no-index', '--require-hashes', '--no-deps', '-r', requirementsFile], { cwd: project, env });
  step(`wheel pip install of ${names.length} packages`);
  run(checkoutPython, ['-m', 'pip', '--python', python, 'check'], { cwd: project, env });
  step('wheel pip check passed');
  for (const name of names) {
    const shown = run(checkoutPython, ['-m', 'pip', '--python', python, 'show', name], { cwd: project, env });
    const actual = /^Version: (.*)$/m.exec(shown)?.[1]?.trim() ?? null;
    if (actual !== version) throw new Stop(`wheel installed ${name} ${actual ?? 'none'}, expected ${version}`);
    run(smokeOf(smoke, name, 'consumers.wheel')[0], smokeOf(smoke, name, 'consumers.wheel').slice(1), { cwd: project, env: venvEnv });
    step(`wheel ${name} ${version}: ${smokeOf(smoke, name, 'consumers.wheel').join(' ')}`);
  }
  return names.length;
}

/** The wheel packages of the configuration, installed by installWheelFiles with the locks of their dependencies. */
function installWheels(ctx: ReleaseContext, version: string, directory: string, folder: string, env: NodeJS.ProcessEnv, step: (text: string) => void) {
  const names = ctx.config.packages.filter(item => item.kind === WHEEL_KIND).map(({ name }) => name);
  if (names.length === 0) return 0;
  const requirements = wheelLocks(ctx.root, ctx.config).map(({ file, text }: { file: string; text: string }) => lockRequirements(text, file)).join('');
  const wheel = ctx.config.consumers?.[WHEEL_KIND];
  if (wheel === undefined) throw new Error(`config/release.json: consumers.${WHEEL_KIND} is missing; the packages [${names.join(', ')}] are of kind ${WHEEL_KIND}`);
  return installWheelFiles({ root: ctx.root, env, folder, version, directory, names, smoke: wheel.smoke, requirements, step });
}

/** The lock without the hashes of the archives of this repository, which each run builds again. */
// The lock is package-lock.json (NpmLock) or composer.lock (ComposerLock) as `kind` says; each branch reads the shape of its kind.
function withoutArchiveHashes(kind: ConsumerKind, lock: unknown, packages: ArchivePackage[]) {
  const files = new Set(packages.map(({ file }) => file));
  if (kind === 'npm') {
    for (const entry of Object.values((lock as NpmLock).packages ?? {})) if (files.has(String(entry.resolved).replace(/^file:/, ''))) delete entry.integrity;
  } else {
    const { packages: entries = [], 'packages-dev': devEntries = [] } = lock as ComposerLock;
    for (const { dist } of [...entries, ...devEntries]) if (dist && files.has(String(dist.url).replace(`${ARTIFACTS}/`, ''))) dist.shasum = '';
  }
  return lock;
}

/**
 * Writes the manifest and the lock of each consumer project from the committed manifest and the archives of the tag in
 * var/release/assets: `npm install --package-lock-only` and `composer update --no-install`. Returns the written files.
 */
export function lockConsumers(ctx: ReleaseContext, tag: string, step: (text: string) => void = () => {}) {
  const [directory, version] = parseTag(ctx.config, tag);
  if (directory !== null) throw new Stop(`${tag} is a Go module tag; it has no archive and no consumer project`);
  const assets = path.join(ctx.root, ASSETS);
  requireArchives(ctx.config, version, assets, ASSETS);
  const folder = outside(ctx);
  const written: string[] = [];
  try {
    const env = environment(ctx.env, folder);
    for (const [kind, consumer, packages] of plan(ctx.config, version)) {
      const manifest = manifestFor(ctx, kind, consumer, packages, version);
      const project = stage(ctx, kind, consumer, folder, assets, manifest, null);
      if (kind === 'npm') run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0', ...registryArguments(ctx.config)], { cwd: project, env });
      else run('composer', ['update', '--no-install', '--no-interaction', '--no-progress', '--no-plugins', '--no-scripts'], { cwd: project, env });
      const lock = withoutArchiveHashes(kind, readJson(path.join(project, FILES[kind].lock)), packages);
      for (const [file, value] of [[FILES[kind].manifest, manifest], [FILES[kind].lock, lock]] as const) {
        writeAtomic(path.join(ctx.root, consumer.directory, file), json(value, FILES[kind].indent));
        written.push(`${consumer.directory}/${file}`);
      }
      step(`wrote ${consumer.directory}/${FILES[kind].manifest} and ${FILES[kind].lock} for ${tag}`);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return written;
}

const USAGE = 'usage: node scripts/kit/release-consumer.mts install|lock TAG';

/** Runs a step of the command line; the exit status. */
export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}) {
  const [mode, latest, ...rest] = argv;
  let tag = latest;
  if (mode === undefined || !['install', 'lock'].includes(mode) || !tag || rest.length) {
    error(USAGE);
    return 2;
  }
  try {
    const ctx = context(root, { env, log: print });
    if (tag === 'latest') tag = latestTag(ctx);
    const [directory, version] = parseTag(ctx.config, tag);
    const step = (text: string) => print(`[release-consumer] ${tag}: ${text}`);
    if (mode === 'lock') {
      lockConsumers(ctx, tag, step);
    } else if (directory !== null) {
      step('a Go module tag releases no archive; nothing to install');
    } else {
      const count = installConsumers(ctx, version, path.join(root, ASSETS), step);
      step(`installed and checked ${count} packages from ${ASSETS}`);
    }
  } catch (failure) {
    error(`[release-consumer] ${mode} ${tag} failed: ${stepFailure(failure)}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
