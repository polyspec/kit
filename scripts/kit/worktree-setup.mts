#!/usr/bin/env node
// The worktree of a row (K348, docs/operations/local-links.md, Worktrees): `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]`
// creates the worktree `../<repository>-<name>-<id>` of the main checkout on the branch `<type>/<name>-<id>` from main, installs its
// dependencies through native offline package managers and shares its installed tools (K519), and restores Python environments with native uv
// installation from the shared offline cache (K657-4). It rebuilds its own packages and checks it with `make link-state-check`. A second run on an existing worktree of that branch
// links and checks it again, so a run leaves the same state.
//
//   node scripts/kit/worktree-setup.mts <name> <id> [<type>]
import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { usedFolders, worktreeGoFolders, writeGoWorkspace } from './link.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { toolsPath, run as install } from './bootstrap/tool-wrappers.mts';
import { run } from './process.mts';
import { COMMIT_RULES } from './check-commits.mts';
import { git, gitResult } from './git.mts';
import { kitPackageRoot } from './kit-files.mts';
import { isMain, repositoryRoot, siblingTool } from './paths.mts';
import { checkoutProviders } from './link-folders.mts';
import { siblingCheckouts } from './link-providers.mts';
import { npmLink, npmSourceFolders } from './npm-install.mts';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { uvInstallCommand } from './uv-install.mts';

// A name of a worktree: a slug of lower case letters, digits and hyphens; an id: the letters, digits, dots and hyphens of a row.
const NAME = /^[a-z][a-z0-9-]*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** The worktree of a row: its folder beside the main checkout and its branch. */
export function worktreeOf(main: string, { name, id, type }: { name: string; id: string; type: string }): { folder: string; branch: string } {
  if (!NAME.test(name)) throw new Error(`the name ${JSON.stringify(name)} is no slug of lower case letters, digits and hyphens`);
  if (!ID.test(id)) throw new Error(`the id ${JSON.stringify(id)} is no id of a row`);
  if (!COMMIT_RULES.types.includes(type)) throw new Error(`the type ${JSON.stringify(type)} is none of ${COMMIT_RULES.types.join(', ')}`);
  return { folder: path.join(path.dirname(main), `${path.basename(main)}-${name}-${id}`), branch: `${type}/${name}-${id}` };
}

/** The native npm installation directory of each worktree project (K690). */
const NODE_MODULES = 'node_modules';

/** Native npm owns the worktree dependency tree; the configured cache of the main project is reused offline. */
export function prepareWorktreeNpm({ main, folder, project = '.', npm = toolCommand(main, 'npm'), env = toolsEnvironment(main), print }: {
  main: string; folder: string; project?: string; npm?: string; env?: NodeJS.ProcessEnv; print: (text: string) => void;
}): void {
  const source = path.join(main, project);
  const target = path.join(folder, project);
  const cache = run(npm, ['config', 'get', 'cache'], { cwd: source, env }).trim();
  if (!cache) throw new Error(`npm config get cache returned no cache for ${source}`);
  // Remove the local generated root without following legacy package links into the main installation.
  rmSync(path.join(target, NODE_MODULES), { recursive: true, force: true });
  const environment = { ...env, npm_config_offline: 'true', npm_config_cache: cache, npm_config_allow_remote: 'root' };
  install(npm, ['ci', '--offline', '--cache', cache, '--prefix', target, '--no-audit', '--no-fund'], { cwd: target, env: environment }, print);
  const checkouts = siblingCheckouts(folder).checkouts.filter(checkout => realpathSync(checkout) !== realpathSync(main));
  npmLink(target, npmSourceFolders(target, checkoutProviders(checkouts, 'npm')), npm, environment, print);
}

/**
 * The native npm install directories of tracked lock projects already prepared in main (K533, K690), relative to
 * the worktree: the root's, which the tools of kit run from and which the main checkout must hold, and those of the other lock projects,
 * such as a tools project with its own package-lock.json; a project that the main checkout did not install is named and skipped.
 */
function npmProjects(main: string, folder: string, print: (text: string) => void): string[] {
  if (!existsSync(path.join(main, NODE_MODULES))) throw new Error(`${path.join(main, NODE_MODULES)} is missing; run make install in the main checkout, whose dependency cache a worktree reuses`);
  const nested = git(folder, 'ls-files', '-z', '--', '*/package-lock.json').split('\0').filter(Boolean).flatMap((lock) => {
    const modules = path.join(path.dirname(lock), NODE_MODULES);
    if (existsSync(path.join(main, modules))) return [modules];
    print(`[worktree-setup] ${modules} is not installed in the main checkout; the worktree gets none`);
    return [];
  });
  return [NODE_MODULES, ...nested];
}

// The ignored folders that hold no environment of the repository: the npm packages and the tools of the main checkout (K555).
const NO_ENVIRONMENT = /^(?:.*\/)?node_modules$|^var\/tools$/;
// How deep below an ignored folder an environment is looked for, as var/python or packages/python/.venv (K555).
const ENVIRONMENT_DEPTH = 3;

/**
 * The Python environments of the main checkout `main`, relative (K533, K555): each folder with a pyvenv.cfg among its ignored folders,
 * wherever the repository makes it, as the .venv of a project or the UV_PROJECT_ENVIRONMENT var/python of crudui, at most
 * ENVIRONMENT_DEPTH below an ignored folder; node_modules, the tools and the inside of an environment are not entered.
 */
function pythonEnvironments(main: string): string[] {
  const found: string[] = [];
  const visit = (relative: string, depth: number) => {
    if (NO_ENVIRONMENT.test(relative)) return;
    if (existsSync(path.join(main, relative, 'pyvenv.cfg'))) {
      found.push(relative);
      return;
    }
    if (depth === 0) return;
    for (const entry of readdirSync(path.join(main, relative), { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(relative, entry.name), depth - 1);
    }
  };
  const ignored = git(main, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory').split('\0').filter(name => name.endsWith('/'));
  for (const name of ignored) visit(name.slice(0, -1), ENVIRONMENT_DEPTH);
  return found.sort();
}

/** The nearest tracked uv project that owns an environment's workspace. */
function pythonProject(main: string, venv: string): string {
  for (let directory = path.dirname(path.resolve(main, venv)); ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, 'pyproject.toml'))) return directory;
    if (directory === main) break;
  }
  throw new Error(`no pyproject.toml owns Python environment ${venv} in ${main}; add the environment to a tracked uv project`);
}

/** Restores a Python worktree environment with the tracked lock and native editable source installation. */
export function prepareWorktreePython({ main, folder, venv, uv, env = process.env, print }: {
  main: string; folder: string; venv: string; uv: string; env?: NodeJS.ProcessEnv; print: (text: string) => void;
}): void {
  const source = path.join(main, venv);
  const target = path.join(folder, venv);
  const project = pythonProject(main, venv);
  const worktreeProject = path.join(folder, path.relative(main, project));
  const marker = path.join(folder, 'var/worktree-python', venv, 'native-uv');
  const entry = lstatSync(target, { throwIfNoEntry: false });
  if (entry !== undefined && (!entry.isDirectory() || !existsSync(marker) || lstatSync(path.join(target, 'pyvenv.cfg'), { throwIfNoEntry: false })?.isSymbolicLink())) {
    throw new Error(`${target} is not an environment created by native worktree setup; retain it and create a fresh worktree environment instead of rewriting Python installed metadata`);
  }
  const environment = {
    ...env,
    UV: uv,
    UV_SYNC: '--no-install-project --all-groups',
    UV_PROJECT_ENVIRONMENT: path.relative(worktreeProject, target),
    UV_OFFLINE: '1',
    UV_PYTHON_DOWNLOADS: 'never',
    UV_CACHE_DIR: env.UV_CACHE_DIR || toolsPath(main, 'mise', 'cache', 'uv'),
  };
  if (entry === undefined) {
    print(`[worktree-setup] uv venv: ${target}`);
    run(uv, ['venv', '--python', path.join(source, 'bin/python'), target], { cwd: main, env: environment });
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, 'native uv worktree environment\n');
  }
  print(`[worktree-setup] native uv locked source install: ${target}`);
  const checkouts = siblingCheckouts(folder).checkouts;
  let output = '';
  const status = uvInstallCommand([worktreeProject, ...checkouts], environment, text => { output += text; print(text.trimEnd()); });
  if (status !== 0) throw new Error(`native worktree Python installation failed without network access; inspect uv's error and prepare the required inputs in the main checkout before retrying: ${output.trim()}`);
  print(`[worktree-setup] native Python environment ready: ${target}`);
}

/** Makes `target` a link with the same target as the link `source`, such as an interpreter of an environment; an other entry throws. */
/** The locked Composer projects prepared in main; path members without their own lock remain owned by their parent. */
function composerProjects(main: string, folder: string, composer: string, env: NodeJS.ProcessEnv): string[] {
  return [...new Set(git(folder, 'ls-files', '-z', '--', 'composer.json', '*/composer.json').split('\0').filter(Boolean).map(file => path.dirname(file)))].filter(project => {
    const manifest = path.resolve(folder, project, env.COMPOSER || 'composer.json');
    if (!existsSync(manifest.replace(/\.json$/, '') + '.lock')) return false;
    return existsSync(composerVendor(path.join(main, project), { command: composer, env }));
  });
}

/** Whether a native output stays in this checkout, never the main checkout or another external directory. */
function ownOutput(folder: string, output: string): boolean {
  const relative = path.relative(folder, output);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Native Composer writes its own vendor, autoload, binaries and records using the main checkout's Composer cache. */
export function prepareWorktreeComposer({ main, folder, project = '.', composer = composerCommand(main, 'worktree dependencies'), env = composerEnvironment(main), print }: {
  main: string; folder: string; project?: string; composer?: string; env?: NodeJS.ProcessEnv; print: (text: string) => void;
}): void {
  const target = path.join(folder, project);
  const environment: NodeJS.ProcessEnv = { ...env, COMPOSER_DISABLE_NETWORK: '1' };
  const manifest = path.resolve(target, environment.COMPOSER || 'composer.json');
  if (!ownOutput(folder, manifest)) throw new Error(`Composer manifest ${manifest} is outside the worktree; declare a worktree-owned manifest before installation`);
  const vendor = composerVendor(target, { command: composer, env: environment });
  if (!ownOutput(folder, vendor)) throw new Error(`Composer vendor ${vendor} is outside the worktree; declare a worktree-owned vendor directory before installation`);
  const mainVendor = composerVendor(path.join(main, project), { command: composer, env: environment });
  const sourceVendor = existsSync(mainVendor) ? realpathSync(mainVendor) : mainVendor;
  const projected = (directory: string, depth: number): boolean => {
    const entry = lstatSync(directory, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) {
      const resolved = realpathSync(directory);
      return resolved === sourceVendor || resolved.startsWith(`${sourceVendor}${path.sep}`);
    }
    return entry?.isDirectory() === true && depth > 0 && readdirSync(directory).some(name => projected(path.join(directory, name), depth - 1));
  };
  // A legacy projection is not a native installation even when its copied records happen to match the lock.
  if (projected(vendor, 2)) rmSync(vendor, { recursive: true, force: true });
  install(composer, ['install', '--no-interaction', '--no-progress', '--prefer-dist'], { cwd: target, env: environment }, print);
}

// Immutable archive inputs are copied with native filesystem cloning when supported; installed package records are never copied.
const COMPOSER_ARTIFACTS = 'var/composer-artifacts';
function prepareArtifacts(main: string, folder: string): void {
  const source = path.join(main, COMPOSER_ARTIFACTS);
  if (!existsSync(source)) return;
  const target = path.join(folder, COMPOSER_ARTIFACTS);
  if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(target);
  cpSync(source, target, { recursive: true, mode: constants.COPYFILE_FICLONE });
}

/**
 * Creates or reuses the worktree of the row, prepares native offline dependencies and runs `make link-state-check`
 * in it. Unless `linkStateOnly` is true, it rebuilds its packages before the check; returns its folder. Throws, creating nothing, when
 * the folder exists as anything but the worktree of the branch.
 */
/**
 * The link tool that rebuilds the packages of a worktree (K482). A consumer runs the link source of its linked kit (K613), and kit
 * itself runs its own scripts/kit/link.mts, which the worktree has as a source; the tool is chosen by which of the two the worktree holds.
 */
export function worktreeLinkTool(folder: string): string {
  const own = path.join(folder, path.relative(kitPackageRoot(), siblingTool(import.meta.url, 'link')));
  return existsSync(own) ? own : createRequire(path.join(folder, 'package.json')).resolve('@polyspec/kit/link');
}


/**
 * The go.work and go.work.sum files that link wrote in the main checkout `main` beside a go.mod of the worktree `folder` (K615),
 * relative to both: only git-ignored workspace state is eligible for initial copying. Native Go remaps its main-checkout
 * uses to the worktree's own source paths. A tracked go.work is the worktree's own and is not among these local files.
 */
function goWorkFiles(main: string, folder: string): string[] {
  const modules = git(folder, 'ls-files', '--', 'go.mod', '*/go.mod').split('\n').filter(Boolean);
  const candidates = modules.flatMap(module => ['go.work', 'go.work.sum'].map(name => path.join(path.dirname(module), name)))
    .filter(file => existsSync(path.join(main, file)));
  if (!candidates.length) return [];
  // check-ignore exits 1 when it ignores none of them.
  return gitResult(main, 'check-ignore', '--no-index', ...candidates).stdout.split('\n').filter(Boolean).filter(file => gitResult(main, 'ls-files', '--error-unmatch', '--', file).status !== 0);
}

/** Copies initial local Go workspace state, then maps main-checkout modules to this worktree through native Go commands. */
export function prepareWorktreeGo({ main, folder, go, env, print }: {
  main: string; folder: string; go?: string; env?: NodeJS.ProcessEnv; print: (text: string) => void;
}): void {
  const files = goWorkFiles(main, folder);
  for (const file of files) {
    if (!existsSync(path.join(folder, file))) copyFileSync(path.join(main, file), path.join(folder, file));
  }
  for (const file of files.filter(file => file.endsWith('.work'))) {
    const target = path.join(folder, file);
    const tool = { command: go ?? toolCommand(folder, 'go'), env: env ?? toolsEnvironment(folder) };
    const folders = worktreeGoFolders(folder, usedFolders(tool, target));
    writeGoWorkspace(tool, target, folders);
    print(`[worktree-setup] prepared ${file} for the worktree's own sources`);
  }
}

export function setupWorktree(root: string, row: { name: string; id: string; type: string }, { print = (text: string) => console.log(text), composer, npm, uv, go, linkStateOnly = false }: { print?: (text: string) => void; composer?: string; npm?: string; uv?: string; go?: string; linkStateOnly?: boolean } = {}): string {
  const main = path.dirname(path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim()));
  const { folder, branch } = worktreeOf(main, row);
  const listed = git(main, 'worktree', 'list', '--porcelain').split('\n\n').map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }));
  const existing = listed.find(entry => entry.folder === folder);
  if (existing && existing.branch !== branch) throw new Error(`${folder} is the worktree of ${existing.branch ?? 'a detached HEAD'}, not of ${branch}`);
  if (!existing) {
    if (existsSync(folder)) throw new Error(`${folder} exists and is no worktree of ${branch}; remove it or choose another name`);
    const known = gitResult(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
    git(main, 'worktree', 'add', '--quiet', folder, ...(known ? [branch] : ['-b', branch, 'main']));
    print(`[worktree-setup] created ${folder} on ${branch}`);
  } else {
    print(`[worktree-setup] ${folder} is the worktree of ${branch}; linking and checking it again`);
  }
  for (const modules of npmProjects(main, folder, print)) prepareWorktreeNpm({ main, folder, project: path.dirname(modules), ...(npm === undefined ? {} : { npm }), print });
  for (const venv of pythonEnvironments(main)) prepareWorktreePython({ main, folder, venv, uv: uv ?? toolCommand(main, 'uv'), env: uv === undefined ? toolsEnvironment(main) : process.env, print });
  prepareArtifacts(main, folder);
  const composerProjectsPresent = git(folder, 'ls-files', '--', 'composer.json', '*/composer.json').trim() !== '';
  if (composerProjectsPresent) {
    const command = composer ?? composerCommand(main, 'worktree dependencies');
    const environment = { ...composerEnvironment(main), COMPOSER_DISABLE_NETWORK: '1' };
    for (const project of composerProjects(main, folder, command, environment)) prepareWorktreeComposer({ main, folder, project, composer: command, env: environment, print });
  }
  prepareWorktreeGo({ main, folder, ...(go === undefined ? {} : { go }), print });
  for (const target of linkStateOnly ? ['link-state-check'] : ['rebuild', 'link-state-check']) {
    // The rebuild (K482) builds the packages of the worktree's own repository before the check reads their builds: a new worktree has none yet.
    const [command, args] = target === 'rebuild'
      ? [process.execPath, [worktreeLinkTool(folder), 'rebuild', '.']]
      : ['make', ['--no-print-directory', target]];
    print(`[worktree-setup] ${target === 'rebuild' ? 'link rebuild' : `make ${target}`} in ${folder}`);
    const result = spawnSync(command, args, { cwd: folder, stdio: 'inherit' });
    if (result.error) throw new Error(`${target} could not start in ${folder}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${target} ended with ${result.status === null ? `the signal ${result.signal}` : `exit status ${result.status}`} in ${folder}`);
  }
  return folder;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const linkStateOnly = args.includes('--link-state-only');
  const positional = args.filter(argument => argument !== '--link-state-only');
  const [name = '', id = '', type = 'fix', ...extra] = positional;
  try {
    if (extra.length > 0) throw new Error(`unexpected argument ${JSON.stringify(extra[0])}`);
    console.log(`[worktree-setup] ready: ${setupWorktree(repositoryRoot(), { name, id, type }, { linkStateOnly })}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-setup] ${error.message}`);
    process.exit(1);
  }
}
