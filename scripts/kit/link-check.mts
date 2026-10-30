#!/usr/bin/env node
// Compares the links of a checkout with its link declaration (`make link-check`, K869, P30): LINKS_FILE at the root of the main
// checkout names the provider checkouts, and make link applies it. The comparison:
//   - each installed npm, Composer and Python folder of a package that a declared checkout provides is a link to its provider, never
//     a copy (link's check, folderFindings), and a polyspec package that a linked npm provider loads is a link in it too (K761);
//   - no install folder holds a link out of the checkout that the declaration does not name; with no file, none holds one;
//   - the go.work that link writes at each Go module uses exactly the module, its tracked workspace and the declared providers that it
//     requires; with none, link wrote no go.work;
//   - a polyspec package that a tracked project declares and a declared checkout provides has an installed folder (K888);
//   - no tracked manifest names a path out of the repository, whatever the package, which a clean clone cannot reproduce (K773, K902);
//   - with a declaration, the workspace folder holds the Claude Code hook of the kit checkout (K440), and with --project the consumer
//     holds the hook of the kit that links it (K498), unless that kit is an installed package (K916).
// Nothing about a version is judged. A finding names the ecosystem and the package or the file.
//
//   node link-check.mts [--project <dir>]
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { declaredUnlinked, isKitHookEntry, kitHookCheckout, kitNodeRunnable, link, projectHookFindings, workspaceHookEntry, workspaceSettings } from './link.mts';
import { declaredCheckouts, isIgnored, LINKS_FILE, mainCheckout, providers, trackedManifests, workspaceOf, workTreeOf } from './link-providers.mts';
import { isTable, readToml } from './toml.mts';
import { isMain } from './paths.mts';
import { isJsonObject } from './bootstrap/files.mts';

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

/**
 * K773, K902: the findings of one tracked manifest `file` with its text: each folder outside the repository of `root` that it links by a
 * path, a Composer path repository, an npm file:/link: dependency or a uv source path, whatever the package name, since a clean clone and
 * CI cannot reproduce it. A sibling is linked only by the folder link of make link (docs/operations/local-links.md); a path inside the
 * repository, an own member, and a release archive pass.
 */
function manifestPathFindings(file: string, text: string, root: string): string[] {
  const finding = (name: string, target: string) => `${file}: ${name} is linked by the path ${target} outside the repository, which a clean clone cannot reproduce; fix: require a release, and link a polyspec checkout with .links and make link (docs/operations/local-links.md)`;
  const linked = (target: string) => !ARCHIVE.test(target) && outside(file, target, root);
  if (path.posix.basename(file) === 'pyproject.toml') {
    const tool = readToml(text, file).tool;
    const uv = isTable(tool) ? tool.uv : undefined;
    const sources = isTable(uv) ? uv.sources : undefined;
    if (!isTable(sources)) return [];
    return Object.entries(sources).flatMap(([name, value]) => (Array.isArray(value) ? value : [value])
      .flatMap((item: unknown) => isTable(item) && typeof item.path === 'string' && linked(item.path) ? [finding(name, item.path)] : []));
  }
  const manifest: unknown = JSON.parse(text);
  if (!isJsonObject(manifest)) return [];
  if (path.posix.basename(file) === 'composer.json') {
    const repositories: unknown[] = Array.isArray(manifest.repositories) ? manifest.repositories : isJsonObject(manifest.repositories) ? Object.values(manifest.repositories) : [];
    return repositories.flatMap(item => isJsonObject(item) && item.type === 'path' && typeof item.url === 'string' && linked(item.url) ? [finding('a path repository', item.url)] : []);
  }
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = manifest[field];
    return isJsonObject(dependencies) ? Object.entries(dependencies).flatMap(([name, spec]) => typeof spec === 'string' && NPM_PATH.test(spec) && linked(spec.replace(NPM_PATH, '')) ? [finding(name, spec)] : []) : [];
  });
}

/** The findings of every tracked composer.json, package.json and pyproject.toml (K773). */
function trackedManifestPathFindings(root: string): string[] {
  return trackedManifests(root, ['composer.json', 'package.json', 'pyproject.toml']).flatMap(file => manifestPathFindings(file, readFileSync(path.join(root, file), 'utf8'), root));
}

/**
 * The findings of `root` beside link's check, sorted: K773's paths of the tracked manifests, the declared packages with no installed
 * folder (K888) and, with a declaration, the hook of the workspace folder (K440).
 */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const checkouts = declaredCheckouts(root);
  const provided = providers(checkouts ?? [], undefined, root, root);
  // The declaration is a setting of the checkout, which Git ignores (K869).
  const file = path.join(mainCheckout(root), LINKS_FILE);
  const ignored = checkouts === undefined || isIgnored(file) ? [] : [`${file}: Git does not ignore the link declaration; fix: add the line /${LINKS_FILE} to the .gitignore of the repository`];
  return [...ignored, ...trackedManifestPathFindings(root), ...declaredUnlinked(root, provided, env), ...(checkouts === undefined ? [] : workspaceHookFindings(root, env))].sort();
}

/** The link check of the checkout of `directory`, or with `project` of the consumer `directory`: link's check, then linkFindings. */
export function linkCheck(directory: string, project: boolean, print: (text: string) => void, env: NodeJS.ProcessEnv = process.env): boolean {
  const checkouts = declaredCheckouts(directory) ?? [];
  let ok = link({ checkouts, directories: [directory], check: true, print, env, project });
  const root = workTreeOf(directory);
  for (const finding of [...linkFindings(root, env), ...(project ? projectHookFindings(directory) : [])]) {
    print(`[link-check] ${finding}`);
    ok = false;
  }
  return ok;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const project = args[0] === '--project' ? args[1] : undefined;
  if (args.length !== (project === undefined ? 0 : 2)) {
    console.error('Usage: node link-check.mts [--project <dir>]');
    process.exitCode = 2;
  } else if (!linkCheck(project ?? '.', project !== undefined, text => console.log(text))) {
    console.error(`[link-check] the links differ from the link declaration (${LINKS_FILE}). Fix: make link`);
    process.exitCode = 1;
  } else console.log(`[link-check] the links are the link declaration (${LINKS_FILE})`);
}
