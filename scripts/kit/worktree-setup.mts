#!/usr/bin/env node
// The worktree of a row (K348, docs/operations/local-links.md, Worktrees): `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]`
// creates the worktree `../<repository>-<name>-<id>` of the main checkout on the branch `<type>/<name>-<id>` from main, links its
// node_modules to the main checkout's and installs nothing (K519: the tools of var/tools are the main checkout's through kit.mk and
// toolsPath), rebuilds its own packages and checks it with `make link-state-check`. It refuses while the free disk is under
// WORKTREE_DISK_FLOOR, and a second run on an existing worktree of that branch links and checks it again, so a run leaves the same state.
//
//   node scripts/kit/worktree-setup.mts <name> <id> [<type>]
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statfsSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { COMMIT_RULES } from './check-commits.mts';
import { git, gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { shimsPath, toolsEnvironment } from './mise-tools.mts';
import { composerCommand } from './install-composer-project.mts';

/** The free disk under which no worktree is made, in bytes: 30 GB, the floor of the owner's guidelines for a new worktree. */
export const WORKTREE_DISK_FLOOR = 30 * 1024 ** 3;

// A name of a worktree: a slug of lower case letters, digits and hyphens; an id: the letters, digits, dots and hyphens of a row.
const NAME = /^[a-z][a-z0-9-]*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** The Go build cache of the tools of the repository of `root` (K538), as go env GOCACHE names it; none when the tools hold no go. */
function goBuildCache(root: string): string | undefined {
  const go = shimsPath(root, 'go');
  if (!existsSync(go)) return undefined;
  const result = spawnSync(go, ['env', 'GOCACHE'], { cwd: root, encoding: 'utf8', env: toolsEnvironment(root) });
  if (result.error) throw new Error(`go env GOCACHE could not start in ${root}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`go env GOCACHE ended with exit status ${result.status} in ${root}: ${result.stderr.trim()}`);
  const cache = result.stdout.trim();
  return cache === '' || cache === 'off' ? undefined : cache;
}

// The age after which an entry of the Go build cache counts as unused (K538): Go refreshes the time of an entry it uses about hourly.
const GO_CACHE_UNUSED_MS = 2 * 3600 * 1000;

/** Removes each file of the Go build cache `cache` unused for GO_CACHE_UNUSED_MS, and returns their count and bytes (K538). */
function trimGoCache(cache: string): { entries: number; bytes: number } {
  const oldest = Date.now() - GO_CACHE_UNUSED_MS;
  let entries = 0;
  let bytes = 0;
  const visit = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      if (!entry.isFile() || folder === cache) continue;
      const stat = statSync(file);
      if (stat.mtimeMs >= oldest) continue;
      unlinkSync(file);
      entries += 1;
      bytes += stat.size;
    }
  };
  if (existsSync(cache)) visit(cache);
  return { entries, bytes };
}

/** The free bytes of the file system of `directory` for an unprivileged user. */
export const freeBytes = (directory: string): number => {
  const stats = statfsSync(directory);
  return stats.bavail * stats.bsize;
};

/** The worktree of a row: its folder beside the main checkout and its branch. */
export function worktreeOf(main: string, { name, id, type }: { name: string; id: string; type: string }): { folder: string; branch: string } {
  if (!NAME.test(name)) throw new Error(`the name ${JSON.stringify(name)} is no slug of lower case letters, digits and hyphens`);
  if (!ID.test(id)) throw new Error(`the id ${JSON.stringify(id)} is no id of a row`);
  if (!COMMIT_RULES.types.includes(type)) throw new Error(`the type ${JSON.stringify(type)} is none of ${COMMIT_RULES.types.join(', ')}`);
  return { folder: path.join(path.dirname(main), `${path.basename(main)}-${name}-${id}`), branch: `${type}/${name}-${id}` };
}

/** The folders of the main checkout that a worktree links instead of installing them (K519). */
// The folder of the npm packages that a worktree links entry by entry to the main checkout's (K519, K530).
const NODE_MODULES = 'node_modules';

/**
 * The node_modules of the worktree `folder` (K530): a real folder whose entries link to those of the main checkout `main` (linkEntry),
 * each scope folder and .bin entry by entry, so a package of the repository's own workspace, which the main checkout links to its own
 * packages, links into the worktree, and the worktree resolves its own code. A link of the whole folder, which K519 made, is replaced;
 * the repository ignores the real folder as it ignores the main checkout's. Nothing is installed.
 */
function linkNodeModules(main: string, folder: string, modules: string, print: (text: string) => void): void {
  const source = path.join(main, modules);
  const target = path.join(folder, modules);
  const entry = lstatSync(target, { throwIfNoEntry: false });
  if (entry?.isSymbolicLink()) {
    if (path.resolve(folder, readlinkSync(target)) !== source) throw new Error(`${target} is a link to ${readlinkSync(target)}, not to ${source}; remove it, since a worktree installs nothing (K519)`);
    unlinkSync(target);
    print(`[worktree-setup] replaced the link of ${target} to the main checkout's folder (K519) with a folder of links (K530)`);
  } else if (entry !== undefined && !entry.isDirectory()) {
    throw new Error(`${target} exists and is no folder; remove it, since a worktree installs nothing (K519)`);
  }
  mkdirSync(target, { recursive: true });
  // An entry that the main checkout's folder lacks was installed in the worktree, which installs nothing.
  for (const name of readdirSync(target)) {
    const nested = name.startsWith('@') || name === '.bin' ? readdirSync(path.join(target, name)).map(inner => path.join(name, inner)) : [];
    for (const relative of [name, ...nested]) {
      if (lstatSync(path.join(source, relative), { throwIfNoEntry: false }) === undefined) {
        throw new Error(`${path.join(target, relative)} is no entry of ${source}; remove it, since a worktree installs nothing (K519)`);
      }
    }
  }
  for (const item of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    if (!item.isDirectory() || !(item.name.startsWith('@') || item.name === '.bin')) {
      linkEntry(main, folder, modules, from, path.join(target, item.name));
      continue;
    }
    mkdirSync(path.join(target, item.name), { recursive: true });
    for (const name of readdirSync(from)) linkEntry(main, folder, modules, path.join(from, name), path.join(target, item.name, name));
  }
  print(`[worktree-setup] linked the packages of ${modules} to ${source}, the repository's own into the worktree`);
}

/**
 * The node_modules of each tracked npm lock project of the worktree `folder` that the main checkout `main` installed (K533), relative to
 * the worktree: the root's, which the tools of kit run from and which the main checkout must hold, and those of the other lock projects,
 * such as a tools project with its own package-lock.json; a project that the main checkout did not install is named and skipped.
 */
function npmProjects(main: string, folder: string, print: (text: string) => void): string[] {
  if (!existsSync(path.join(main, NODE_MODULES))) throw new Error(`${path.join(main, NODE_MODULES)} is missing; run make install in the main checkout, whose ${NODE_MODULES} a worktree links`);
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

/**
 * Places the file `source` of an environment of the main checkout `main` at `target` of the worktree `folder` (K533): a file that the
 * installer wrote with a path of the main checkout, a script, an activate script or an editable .pth, is written with that path of the
 * worktree and its mode, since the environment of the worktree runs its own sources; any other file links (linkEntry, `venv` the
 * environment). A target that is no file of the worktree throws.
 */
function placeFile(main: string, folder: string, venv: string, source: string, target: string): void {
  const root = realpathSync(main);
  const text = readFileSync(source, 'utf8');
  const named = new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'g');
  if (!named.test(text)) {
    linkEntry(main, folder, venv, source, target);
    return;
  }
  const entry = lstatSync(target, { throwIfNoEntry: false });
  if (entry !== undefined && !entry.isFile()) throw new Error(`${target} exists and is no file that worktree-setup writes; remove it, since a worktree installs nothing (K519)`);
  writeFileSync(target, text.replace(named, folder), { mode: statSync(source).mode & 0o777 });
}

/**
 * The Python environment `venv` of the worktree `folder` (K533): a real folder whose entries link to those of the main checkout `main`,
 * bin and each site-packages entry by entry; an interpreter link of bin keeps its target, and a file that names a path of the main
 * checkout is written with the worktree's (placeFile), so the worktree imports and runs its own sources. Nothing is installed.
 */
function linkVenv(main: string, folder: string, venv: string, print: (text: string) => void): void {
  const source = path.join(main, venv);
  const target = path.join(folder, venv);
  if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${target} is a link to a whole environment, which runs the sources of another checkout; remove it and run worktree-setup again (K533)`);
  mkdirSync(target, { recursive: true });
  for (const item of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(target, item.name);
    if (item.name === 'bin' && item.isDirectory()) {
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from, { withFileTypes: true })) {
        if (name.isSymbolicLink()) keepLink(path.join(from, name.name), path.join(to, name.name));
        else if (name.isFile()) placeFile(main, folder, venv, path.join(from, name.name), path.join(to, name.name));
        else linkEntry(main, folder, venv, path.join(from, name.name), path.join(to, name.name));
      }
    } else if (item.name === 'lib' && item.isDirectory()) {
      for (const python of readdirSync(from)) {
        const sites = path.join(from, python, 'site-packages');
        mkdirSync(path.join(to, python, 'site-packages'), { recursive: true });
        for (const name of readdirSync(path.join(from, python))) {
          if (name !== 'site-packages') linkEntry(main, folder, venv, path.join(from, python, name), path.join(to, python, name));
        }
        for (const name of readdirSync(sites, { withFileTypes: true })) {
          const place = name.isFile() && name.name.endsWith('.pth') ? placeFile : linkEntry;
          place(main, folder, venv, path.join(sites, name.name), path.join(to, python, 'site-packages', name.name));
        }
      }
    } else {
      linkEntry(main, folder, venv, from, to);
    }
  }
  print(`[worktree-setup] linked the environment ${venv} to ${source}, its own sources from the worktree`);
}

/** Makes `target` a link with the same target as the link `source`, such as an interpreter of an environment; an other entry throws. */
function keepLink(source: string, target: string): void {
  const link = readlinkSync(source);
  const entry = lstatSync(target, { throwIfNoEntry: false });
  if (entry === undefined) {
    symlinkSync(link, target);
    return;
  }
  if (!entry.isSymbolicLink() || readlinkSync(target) !== link) throw new Error(`${target} exists and is not the link to ${link}; remove it, since a worktree installs nothing (K519)`);
}

/** A Composer project of the worktree: its folder relative to the worktree and its vendor folder, from config.vendor-dir. */
type ComposerProject = { project: string; vendor: string };

/** The tracked Composer projects of the worktree `folder` whose vendor folder the main checkout `main` holds (K521). */
function composerProjects(main: string, folder: string): ComposerProject[] {
  return git(folder, 'ls-files', '-z', '--', 'composer.json', '*/composer.json').split('\0').filter(Boolean).flatMap((file) => {
    const manifest: unknown = JSON.parse(readFileSync(path.join(folder, file), 'utf8'));
    const config = typeof manifest === 'object' && manifest !== null && 'config' in manifest ? manifest.config : undefined;
    const vendorDir = typeof config === 'object' && config !== null && 'vendor-dir' in config && typeof config['vendor-dir'] === 'string' ? config['vendor-dir'] : 'vendor';
    const project = path.dirname(file);
    return existsSync(path.join(main, project, vendorDir)) ? [{ project, vendor: path.join(project, vendorDir) }] : [];
  });
}

/**
 * Links `target` to `source`: a source that resolves inside the main checkout `main` but outside its vendor folder `vendor`, as a
 * path repository does, links to the same path of the worktree `folder`; any other links to the source. An existing link to the same place is kept; anything else throws.
 */
function linkEntry(main: string, folder: string, vendor: string, source: string, target: string): void {
  const resolved = realpathSync(source);
  const within = (root: string) => resolved.startsWith(`${realpathSync(root)}${path.sep}`);
  const inside = within(main) && !within(path.join(main, vendor));
  const destination = inside ? path.join(folder, path.relative(realpathSync(main), resolved)) : source;
  const link = path.relative(path.dirname(target), destination);
  if (existsSync(target) || lstatSync(path.dirname(target)).isDirectory() && readdirSync(path.dirname(target)).includes(path.basename(target))) {
    const entry = lstatSync(target);
    if (entry.isSymbolicLink() && path.resolve(path.dirname(target), readlinkSync(target)) === path.resolve(path.dirname(target), link)) return;
    throw new Error(`${target} exists and is not the link to ${destination}; remove it, since a worktree installs nothing (K521)`);
  }
  symlinkSync(link, target);
}

/**
 * The bin folder `target` of a vendor of the worktree `folder`, from that of the main checkout `source` (K550): a Composer proxy
 * computes the autoload from its own folder, which PHP resolves through links, so each proxy, a PHP file that Composer generated,
 * is written into the worktree with its mode, and each link keeps its relative target, which resolves into the packages of the
 * worktree's vendor; any other entry links (linkEntry). An entry of another kind than the main checkout's throws.
 */
function vendorBin(main: string, folder: string, vendor: string, source: string, target: string): void {
  if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(target);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) {
      keepLink(from, to);
    } else if (entry.isFile() && readFileSync(from, 'utf8').includes('generated by Composer')) {
      const existing = lstatSync(to, { throwIfNoEntry: false });
      if (existing !== undefined && !existing.isFile()) throw new Error(`${to} exists and is no proxy file that worktree-setup writes; remove it, since a worktree installs nothing (K519)`);
      writeFileSync(to, readFileSync(from), { mode: statSync(from).mode & 0o777 });
    } else {
      linkEntry(main, folder, vendor, from, to);
    }
  }
}

/**
 * The vendor folder of the Composer project `project` in the worktree `folder` (K521): a real folder whose packages and bin link to the
 * main checkout's (linkEntry), whose composer/installed.json and installed.php link to the main checkout's, and whose autoload is the
 * worktree's own, written by `composer dump-autoload` offline in the project, so the repository's own classes load from the worktree.
 * The autoload files of the main checkout, which name its sources, are not linked. Nothing is installed.
 */
function linkVendor(main: string, folder: string, { project, vendor }: ComposerProject, composer: string, print: (text: string) => void): void {
  const source = path.join(main, vendor);
  const target = path.join(folder, vendor);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error(`${target} is a link to a whole vendor folder, whose autoload names the sources of another checkout; remove it and run worktree-setup again (K521)`);
  mkdirSync(path.join(target, 'composer'), { recursive: true });
  for (const name of ['installed.json', 'installed.php']) {
    if (!existsSync(path.join(source, 'composer', name))) throw new Error(`${path.join(source, 'composer', name)} is missing; run make install in the main checkout, whose vendor a worktree links`);
    linkEntry(main, folder, vendor, path.join(source, 'composer', name), path.join(target, 'composer', name));
  }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    if (entry.name === 'composer' || entry.name === 'autoload.php') continue;
    if (entry.isSymbolicLink() && realpathSync(from) === realpathSync(source)) {
      print(`[worktree-setup] ${vendor}/${entry.name} of the main checkout links to its own vendor folder; it is not linked`);
      continue;
    }
    if (entry.name === 'bin' && entry.isDirectory()) {
      vendorBin(main, folder, vendor, from, path.join(target, entry.name));
      continue;
    }
    if (!lstatSync(from).isDirectory() || entry.isSymbolicLink()) {
      linkEntry(main, folder, vendor, from, path.join(target, entry.name));
      continue;
    }
    mkdirSync(path.join(target, entry.name), { recursive: true });
    for (const name of readdirSync(from)) linkEntry(main, folder, vendor, path.join(from, name), path.join(target, entry.name, name));
  }
  print(`[worktree-setup] linked the packages of ${vendor}; composer dump-autoload in ${path.join(folder, project)}`);
  const result = spawnSync(composer, ['dump-autoload', '--no-interaction'], { cwd: path.join(folder, project), env: { ...process.env, COMPOSER_DISABLE_NETWORK: '1' }, encoding: 'utf8' });
  if (result.error) throw new Error(`composer dump-autoload could not start in ${path.join(folder, project)}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`composer dump-autoload ended with exit status ${result.status} in ${path.join(folder, project)}: ${`${result.stdout}${result.stderr}`.trim()}`);
}

/**
 * Creates or reuses the worktree of the row in the repository of `root`, links its folders (linkFolders), rebuilds its packages and runs
 * `make link-state-check` in it; returns its folder. Throws, creating nothing, while `free` is under WORKTREE_DISK_FLOOR, and when the
 * folder exists as anything but the worktree of the branch.
 */
/**
 * The link tool that rebuilds the packages of a worktree (K482). A consumer runs the link of its installed kit, and kit itself runs its
 * own scripts/kit/link.mts, which the worktree has as a source; the tool is chosen by which of the two the worktree holds.
 */
function linkTool(folder: string): string {
  const own = path.join(folder, 'scripts/kit/link.mts');
  return existsSync(own) ? own : path.join(folder, 'node_modules/@polyspec/kit/dist/link.mjs');
}

export function setupWorktree(root: string, row: { name: string; id: string; type: string }, { free = freeBytes, print = (text: string) => console.log(text), composer, goCache = goBuildCache }: { free?: (directory: string) => number; print?: (text: string) => void; composer?: string; goCache?: (root: string) => string | undefined } = {}): string {
  const main = path.dirname(path.resolve(root, git(root, 'rev-parse', '--git-common-dir').trim()));
  const { folder, branch } = worktreeOf(main, row);
  const listed = git(main, 'worktree', 'list', '--porcelain').split('\n\n').map(entry => ({ folder: /^worktree (.*)$/m.exec(entry)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(entry)?.[1] }));
  const existing = listed.find(entry => entry.folder === folder);
  if (existing && existing.branch !== branch) throw new Error(`${folder} is the worktree of ${existing.branch ?? 'a detached HEAD'}, not of ${branch}`);
  if (!existing) {
    if (existsSync(folder)) throw new Error(`${folder} exists and is no worktree of ${branch}; remove it or choose another name`);
    let available = free(path.dirname(main));
    // K538: under the floor the Go build cache, which Go rebuilds on demand, is trimmed by age first; nothing else is removed.
    const cache = available < WORKTREE_DISK_FLOOR ? goCache(main) : undefined;
    let trimmed = '';
    if (cache !== undefined) {
      const { entries, bytes } = trimGoCache(cache);
      print(`[worktree-setup] trimmed ${entries} entries of the Go build cache ${cache}, unused for 2 hours: ${bytes} bytes freed`);
      trimmed = `after the trim of the Go build cache freed ${bytes} bytes, `;
      available = free(path.dirname(main));
    }
    if (available < WORKTREE_DISK_FLOOR) throw new Error(`${trimmed}the free disk is ${(available / 1024 ** 3).toFixed(1)} GB, under the floor of ${WORKTREE_DISK_FLOOR / 1024 ** 3} GB for a new worktree; free disk first`);
    const known = gitResult(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
    git(main, 'worktree', 'add', '--quiet', folder, ...(known ? [branch] : ['-b', branch, 'main']));
    print(`[worktree-setup] created ${folder} on ${branch}`);
  } else {
    print(`[worktree-setup] ${folder} is the worktree of ${branch}; linking and checking it again`);
  }
  for (const modules of npmProjects(main, folder, print)) linkNodeModules(main, folder, modules, print);
  for (const venv of pythonEnvironments(main)) linkVenv(main, folder, venv, print);
  for (const project of composerProjects(main, folder)) linkVendor(main, folder, project, composer ?? composerCommand(folder, 'make worktree-setup'), print);
  for (const target of ['rebuild', 'link-state-check']) {
    // The rebuild (K482) builds the packages of the worktree's own repository before the check reads their builds: a new worktree has none yet.
    const [command, args] = target === 'rebuild'
      ? [process.execPath, [linkTool(folder), 'rebuild', '.']]
      : ['make', ['--no-print-directory', target]];
    print(`[worktree-setup] ${target === 'rebuild' ? 'link rebuild' : `make ${target}`} in ${folder}`);
    const result = spawnSync(command, args, { cwd: folder, stdio: 'inherit' });
    if (result.error) throw new Error(`${target} could not start in ${folder}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${target} ended with ${result.status === null ? `the signal ${result.signal}` : `exit status ${result.status}`} in ${folder}`);
  }
  return folder;
}

if (isMain(import.meta.url)) {
  const [name = '', id = '', type = 'fix'] = process.argv.slice(2);
  try {
    console.log(`[worktree-setup] ready: ${setupWorktree(repositoryRoot(), { name, id, type })}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[worktree-setup] ${error.message}`);
    process.exit(1);
  }
}
