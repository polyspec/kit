#!/usr/bin/env node
// Checks the state of the links of a checkout (`make link-state-check`, K305-1, P30). Development consumes the providers only
// through links (docs/operations/local-links.md): the installed folder of a polyspec package is a symbolic link to the folder of
// its provider, never a copy, and the link counts as the installed released version, so no version or requirement is compared.
// While a link exists, in every ecosystem that links:
//   npm       each @polyspec package of node_modules pinned at 0.0.x is a link, and it resolves to a package of that name;
//   Composer  each polyspec package that installed.json of the vendor records at 0.0.x is a link, it resolves to a folder with
//             the composer.json of that name, and the record says it was installed from a path repository (dist type path), so a
//             link over the install of a release archive is a finding (K318);
//   Go        each `use` folder of go.work holds the go.mod of a module.
// A plain copy among links is a finding, and a link that resolves to nothing is one. A checkout without a link passes: CI
// installs the released packages. A finding names the ecosystem and the package. A tracked manifest that names a path outside
// the repository (a Composer path repository, an npm file:/link: dependency, a uv source path) links a sibling by a second way
// besides the folder link, so it is a finding in every checkout (K773).
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isKitHookEntry, kitHookCheckout, kitNodeRunnable, trackedWorkspaceFolders, workspaceHookEntry, workspaceSettings } from './link.mts';
import { providers, siblingCheckouts, type Tool, trackedManifests, workspaceOf } from './link-providers.mts';
import { composerVendorDir, folderFindings, providedFolders } from './link-folders.mts';
import { isTable, readToml } from './toml.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { ignoredPaths, trackedFiles } from './tracked-files.mts';
import { isJsonObject, isStringList, readJsonObject } from './bootstrap/files.mts';

const isLink = (file: string) => lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true;

/**
 * The findings of the go.work files of `root`: each `use` folder holds a go.mod. A go.work that link wrote (untracked and git-ignored)
 * below a tracked go.work uses the modules of that workspace too, as link writes them (K399-2); none is checked above no tracked go.work.
 */
function goFindings(root: string, env: NodeJS.ProcessEnv): string[] {
  const found: string[] = [];
  const tracked = new Set(trackedManifests(root, ['go.work']).map(file => path.join(root, file)));
  const ignored = new Set(ignoredPaths(root).map(file => path.join(root, file)));
  for (const manifest of trackedFiles(root).filter(file => path.posix.basename(file) === 'go.mod')) {
    const directory = path.join(root, path.posix.dirname(manifest));
    const work = path.join(directory, 'go.work');
    if (!existsSync(work)) continue;
    const uses: string[] = [];
    let block = false;
    const check = (use: string) => {
      uses.push(path.resolve(directory, use));
      if (!existsSync(path.join(directory, use, 'go.mod'))) found.push(`go ${use}: the use folder of ${path.relative(root, work)} holds no go.mod`);
    };
    for (const line of readFileSync(work, 'utf8').split('\n')) {
      const text = line.trim();
      if (text === 'use (') { block = true; continue; }
      if (block) {
        if (text === ')') block = false;
        else if (text !== '' && !text.startsWith('//')) check(text);
        continue;
      }
      const single = /^use\s+(\S+)$/.exec(text)?.[1];
      if (single !== undefined) check(single);
    }
    if (tracked.has(work) || !ignored.has(work)) continue;
    const go: Tool = env.GO ? { command: env.GO, env } : { command: toolCommand(root, 'go'), env: toolsEnvironment(root, env) };
    const missing = trackedWorkspaceFolders(go, root, directory, tracked).filter(folder => folder !== directory && !uses.includes(folder));
    if (missing.length) found.push(`go ${path.relative(root, work)}: does not use the modules ${missing.map(folder => path.relative(root, folder)).join(', ')} of the tracked go.work above it; Fix: make link`);
  }
  return found;
}





/**
 * A recipe of the Makefiles of the repository that installs from a lock (composer install, npm ci, uv sync) runs the kit link step
 * after it in the same recipe (K349), so a fresh vendor does not read the tracked locks while polyspec checkouts are present. The rule
 * holds only for an ecosystem in which the repository declares a polyspec dependency, which a link can link, and not for a recipe that
 * make install reaches, through a prerequisite or a $(MAKE) call, since install links last, after every install (K349-2, K360-2). The
 * unlink recipe, which restores the locks by design, and the files that kit copies are left out.
 */

const MANIFESTS = new Set(['package.json', 'composer.json', 'pyproject.toml', 'Cargo.toml']);

/** The folders of `root` that hold a manifest of a tracked file, and the root itself, relative to `root`. */
function manifestFolders(root: string): string[] {
  const folders = new Set(['.']);
  for (const file of trackedFiles(root)) if (MANIFESTS.has(path.posix.basename(file))) folders.add(path.posix.dirname(file));
  return [...folders].sort();
}


/** The workspace packages that "workspaces" of the root declares: each package name, with the folder it is in (relative to `root`). */
function workspacePackages(root: string): Map<string, string> {
  const packages = new Map<string, string>();
  const manifest = path.join(root, 'package.json');
  const patterns = existsSync(manifest) ? readJsonObject(manifest).workspaces : undefined;
  if (!isStringList(patterns)) return packages;
  for (const pattern of patterns) {
    // A pattern `dir/*` names each folder of dir; any other pattern names one folder.
    const folders = pattern.endsWith('/*') ? (existsSync(path.join(root, pattern.slice(0, -2))) ? readdirSync(path.join(root, pattern.slice(0, -2))) : []).map(item => path.join(pattern.slice(0, -2), item)) : [pattern];
    for (const folder of folders) {
      const file = path.join(root, folder, 'package.json');
      const name = existsSync(file) ? readJsonObject(file).name : undefined;
      if (typeof name === 'string') packages.set(name, folder);
    }
  }
  return packages;
}

/** The findings of the workspace packages in node_modules of `folders` that are links resolving outside the checkout. */
function workspaceLinkFindings(root: string, folders: readonly string[]): string[] {
  const checkout = realpathSync(root);
  const names = [...workspacePackages(root).keys()];
  const found: string[] = [];
  for (const folder of folders) for (const name of names) {
    const link = path.join(root, folder, 'node_modules', name);
    if (!isLink(link) || !existsSync(link)) continue;
    const target = realpathSync(link);
    if (target !== checkout && !target.startsWith(`${checkout}${path.sep}`)) found.push(`npm ${name}: the link ${path.relative(root, link)} resolves to ${target}, outside the checkout; remove the link and install the worktree from its own sources`);
  }
  return found;
}

/**
 * K440, K440-2: the findings of the workspace folder of `root` whose kit checkout has claude-hook. Three classes, one message each: the
 * node that runs the hook is missing or not executable (kitNodeRunnable); the settings lack the hook (no PreToolUse entry runs the
 * claude-hook of the checkout); the settings hold a hook of the checkout whose entry differs from the one the writer writes.
 */
function workspaceHookFindings(root: string, env: NodeJS.ProcessEnv): string[] {
  const workspace = workspaceOf(root);
  const kit = kitHookCheckout(workspace, env);
  if (kit === undefined) return [];
  const found: string[] = [];
  if (!kitNodeRunnable(kit)) found.push(`${path.join(kit, 'var/tools/bin/node')}: the node of the kit checkout is missing or not executable, so the Claude Code hook cannot run (K440-2); fix: make -C ${realpathSync(kit)} install-tools`);
  const file = path.join(workspace, '.claude/settings.json');
  const settings = workspaceSettings(workspace);
  const pre: unknown[] = isJsonObject(settings.hooks) && Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  const present = pre.filter(isKitHookEntry);
  if (present.length === 0) found.push(`${file}: no Bash PreToolUse hook runs the claude-hook of the kit checkout (K440); fix: make link`);
  else if (JSON.stringify(present) !== JSON.stringify([workspaceHookEntry(kit)])) found.push(`${file}: the Bash PreToolUse hook of the claude-hook of the kit checkout differs from the entry the link writes (K440-2); fix: make link`);
  return found;
}

/** The findings of the links of `root`, sorted; none while nothing is linked. */
// K507: npm and Cargo locks record release sources; their own repository members may use paths.
// Composer development locks may record native path repositories. folderLinkFindings checks the installed source links.
const LOCK_FILES = ['Cargo.lock', 'package-lock.json', 'composer.lock'];
const CARGO_POLYSPEC = /^polyspec[-_.]/i;

/** The release tarball of an npm package, as a release publishes it: polyspec-<name>-npm-<version>.tgz. */
const RELEASE_TARBALL = /^file:(?:.*\/)?polyspec-[\w.-]+-npm-[^/]+\.tgz$/;

/** The findings of one tracked lock `file` with its text; `members` names the packages of the repository itself, which are never findings. */
export function lockSourceFindings(file: string, text: string, members: ReadonlySet<string> = new Set()): string[] {
  const base = path.posix.basename(file);
  if (base === 'Cargo.lock') {
    const packages = readToml(text, file).package;
    return (Array.isArray(packages) ? packages : []).flatMap((item: unknown) => {
      if (!isTable(item) || typeof item.name !== 'string' || typeof item.version !== 'string' || !CARGO_POLYSPEC.test(item.name) || members.has(item.name) || typeof item.source === 'string') return [];
      const short = item.name.replace(CARGO_POLYSPEC, '');
      return [`${file}: ${item.name} ${item.version} records no source, which is a path package; the tracked lock names its release source, git+https://github.com/polyspec/${short}?tag=v${item.version}#<commit> (the local link resolves the sibling at fetch time)`];
    });
  }
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) return [];
  if (base === 'package-lock.json') {
    const packages = isJsonObject(parsed.packages) ? parsed.packages : {};
    return Object.entries(packages).flatMap(([key, entry]) => {
      const name = key.replace(/^.*node_modules\//, '');
      if (key === '' || !isJsonObject(entry) || !name.startsWith('@polyspec/') || members.has(name)) return [];
      const resolved = typeof entry.resolved === 'string' ? entry.resolved : undefined;
      if (entry.link !== true && resolved !== undefined && (!resolved.startsWith('file:') || RELEASE_TARBALL.test(resolved))) return [];
      const short = name.replace('@polyspec/', '');
      return [`${file}: ${name} ${String(entry.version)} is a link or a path, not its release; the tracked lock names its release tarball, https://github.com/polyspec/${short}/releases/download/v${String(entry.version)}/<tarball>`];
    });
  }
  return [];
}

/** The names of the packages that the repository of `root` provides itself: each tracked package.json, composer.json and Cargo.toml. */
function ownNames(root: string): Set<string> {
  return new Set(trackedManifests(root, ['package.json', 'composer.json', 'Cargo.toml']).flatMap((item) => {
    const text = readFileSync(path.join(root, item), 'utf8');
    if (item.endsWith('Cargo.toml')) {
      const pkg = readToml(text, item).package;
      return isTable(pkg) && typeof pkg.name === 'string' ? [pkg.name] : [];
    }
    const manifest: unknown = JSON.parse(text);
    return isJsonObject(manifest) && typeof manifest.name === 'string' ? [manifest.name] : [];
  }));
}

/** The findings of every tracked lock of LOCK_FILES (K507). */
function trackedLockFindings(root: string): string[] {
  const members = ownNames(root);
  return trackedManifests(root, LOCK_FILES).flatMap(file => lockSourceFindings(file, readFileSync(path.join(root, file), 'utf8'), members));
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const NPM_PATH = /^(?:file|link):/;
/** A release archive installs a release, not the folder of a checkout. */
const ARCHIVE = /\.(?:tgz|tar\.gz|zip|whl)$/;

/** The path `target` of the tracked manifest `file` in `root`, when it exists. */
function located(file: string, target: string, root: string): string | undefined {
  const full = path.resolve(root, path.dirname(file), target);
  return existsSync(full) ? full : undefined;
}

/**
 * Whether the path `target` of the tracked manifest `file` leaves the repository of `root`. A target that exists is judged by its
 * real path, so an in-repo path through a link out of the repository leaves it too; the text judges the rest.
 */
function outside(file: string, target: string, root: string): boolean {
  const full = located(file, target, root);
  if (full !== undefined) {
    const relative = path.relative(realpathSync(root), realpathSync(full));
    return relative.startsWith('..') || path.isAbsolute(relative);
  }
  return path.posix.isAbsolute(target) || path.posix.normalize(path.posix.join(path.posix.dirname(file), target)).startsWith('../');
}

/** Whether the Composer path repository `target` of `file` is a polyspec package by the name of its composer.json; a missing one may be. */
function polyspecRepository(file: string, target: string, root: string): boolean {
  const full = located(file, target, root);
  if (full === undefined) return true;
  const manifest = path.join(full, 'composer.json');
  const parsed: unknown = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : undefined;
  return isJsonObject(parsed) && typeof parsed.name === 'string' && parsed.name.startsWith('polyspec/');
}

/**
 * K773: the findings of one tracked manifest `file` with its text: each polyspec package folder outside the repository of `root` that it
 * links by a path, a Composer path repository, an npm file:/link: dependency or a uv source path. A sibling is linked only by the folder
 * link of make link (docs/operations/local-links.md); a path inside the repository, an own member, and a release archive pass.
 */
function manifestPathFindings(file: string, text: string, root: string): string[] {
  const finding = (name: string, target: string) => `${file}: ${name} is linked by the path ${target} outside the repository; a sibling is linked only by the folder link of make link (docs/operations/local-links.md)`;
  const linked = (target: string) => !ARCHIVE.test(target) && outside(file, target, root);
  if (path.posix.basename(file) === 'pyproject.toml') {
    const tool = readToml(text, file).tool;
    const uv = isTable(tool) ? tool.uv : undefined;
    const sources = isTable(uv) ? uv.sources : undefined;
    if (!isTable(sources)) return [];
    return Object.entries(sources).flatMap(([name, value]) => CARGO_POLYSPEC.test(name) ? (Array.isArray(value) ? value : [value])
      .flatMap((item: unknown) => isTable(item) && typeof item.path === 'string' && linked(item.path) ? [finding(name, item.path)] : []) : []);
  }
  const manifest: unknown = JSON.parse(text);
  if (!isJsonObject(manifest)) return [];
  if (path.posix.basename(file) === 'composer.json') {
    const repositories: unknown[] = Array.isArray(manifest.repositories) ? manifest.repositories : isJsonObject(manifest.repositories) ? Object.values(manifest.repositories) : [];
    return repositories.flatMap(item => isJsonObject(item) && item.type === 'path' && typeof item.url === 'string' && linked(item.url) && polyspecRepository(file, item.url, root) ? [finding('a path repository', item.url)] : []);
  }
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = manifest[field];
    return isJsonObject(dependencies) ? Object.entries(dependencies).flatMap(([name, spec]) => name.startsWith('@polyspec/') && typeof spec === 'string' && NPM_PATH.test(spec) && linked(spec.replace(NPM_PATH, '')) ? [finding(name, spec)] : []) : [];
  });
}

/** The findings of every tracked composer.json, package.json and pyproject.toml (K773). */
function trackedManifestPathFindings(root: string): string[] {
  return trackedManifests(root, ['composer.json', 'package.json', 'pyproject.toml']).flatMap(file => manifestPathFindings(file, readFileSync(path.join(root, file), 'utf8'), root));
}

/**
 * K448: the findings of the installed package folders of `root` that a sibling checkout provides: a folder that is a copy, or that
 * links elsewhere than to its provider. Nothing about a version is judged.
 */
function folderLinkFindings(root: string, folders: readonly string[]): string[] {
  const provided = [...providers(siblingCheckouts(root).checkouts, undefined, root, root).values()];
  return folders.flatMap((folder) => {
    const project = path.join(root, folder);
    return folderFindings(root, providedFolders(project, provided, { vendorDir: composerVendorDir(project, process.env) }));
  });
}

/**
 * The findings of the links of `root`, sorted: K507's release record of the tracked locks, K773's paths of the tracked manifests, the folder of each provided package (a link to
 * its provider, never a copy), the workspace links, go.work and the hook of the checkout.
 */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const folders = manifestFolders(root);
  return [...trackedLockFindings(root), ...trackedManifestPathFindings(root), ...folderLinkFindings(root, folders), ...workspaceHookFindings(root, env), ...workspaceLinkFindings(root, folders), ...goFindings(root, env)].sort();
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const findings = linkFindings(root);
  for (const finding of findings) console.error(`[link-state-check] ${finding}`);
  if (findings.length) {
    console.error(`[link-state-check] ${findings.length} findings. Fix: kit link ${root} <checkout>...`);
    process.exitCode = 1;
  } else console.log('[link-state-check] every installed package that a sibling checkout provides is a link to it');
}
