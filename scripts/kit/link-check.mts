#!/usr/bin/env node
// Compares the links of a checkout with its link declaration (`make link-check`, K869, P30): LINKS_FILE at the root of the main
// checkout names the provider checkouts, and make link applies it. The comparison:
//   - each installed npm, Composer and Python folder of a package that a declared checkout provides is a link to its provider, never
//     a copy (link's check, folderFindings), and a polyspec package that a linked npm provider loads is a link in it too (K761);
//   - no install folder holds a link out of the checkout that the declaration does not name; with no file, none holds one;
//   - the go.work that link writes at each Go module uses exactly the module, its tracked workspace and the declared providers that it
//     requires; with none, link wrote no go.work;
//   - a polyspec package that a tracked project declares and a declared checkout provides has an installed folder (K888);
//   - no tracked manifest names a path out of the repository by its text, whatever the package, which a clean clone cannot reproduce
//     (K773, K902); a path inside it is the repository's own folder, however the repository fills it (K976); every manifest that a
//     package manager reads is judged: a Composer manifest of any name, a Cargo.toml, a go.mod and a tracked go.work (K997, P30);
// Nothing about a version is judged. A finding names the ecosystem and the package or the file.
//
//   node link-check.mts [--project <dir>]
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { consumerManifests, declaredUnlinked, link } from './link.mts';
import { declaredCheckouts, isIgnored, linkGit, LINKS_FILE, mainCheckout, providers, workTreeOf } from './link-providers.mts';
import { isTable, readToml } from './toml.mts';
import { isMain } from './paths.mts';
import { isJsonObject } from './bootstrap/files.mts';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
/** A Composer manifest of any name: composer.json, composer.local.json and the like (K997). */
const COMPOSER = /^composer(?:\.[^/]+)?\.json$/;
/** The tables of a Cargo.toml whose entries name a dependency, each also under target.<cfg> (K997). */
const CARGO_TABLES = ['dependencies', 'dev-dependencies', 'build-dependencies'];
/** The manifests that link does not list as a project, which a package manager reads too (K997). */
const OTHER_MANIFESTS = ['composer.*.json', 'Cargo.toml', 'go.mod', 'go.work'];
const NPM_PATH = /^(?:file|link):/;
/** A release archive installs a release, not the folder of a checkout. */
const ARCHIVE = /\.(?:tgz|tar\.gz|zip|whl)$/;

/**
 * Whether the path `target` of the manifest `file` leaves the repository, judged by its text (K976): an absolute path, or one that
 * leaves the folder of the repository after normalizing. A path inside the repository is the repository's own folder, however the
 * repository fills it (a link to a sibling checkout in development, a copy in CI), so where it resolves is not judged.
 */
function outside(file: string, target: string): boolean {
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
  return path.posix.isAbsolute(target) || normalized === '..' || normalized.startsWith('../');
}

/**
 * K773, K902: the findings of one manifest `file` with its text: each path out of the repository by its text (K976) that it links by a
 * path, a Composer path repository, an npm file:/link: dependency or a uv source path, whatever the package name, since a clean clone and
 * CI cannot reproduce it. A sibling is linked only by the folder link of make link (docs/operations/local-links.md); a path inside the
 * repository, however it resolves (K976), an own member, and a release archive pass.
 */
function manifestPathFindings(file: string, text: string): string[] {
  const finding = (name: string, target: string) => `${file}: ${name} is linked by the path ${target} outside the repository, which a clean clone cannot reproduce; fix: require a release, and link a polyspec checkout with .links and make link (docs/operations/local-links.md)`;
  const linked = (target: string) => !ARCHIVE.test(target) && outside(file, target);
  const base = path.posix.basename(file);
  if (base === 'Cargo.toml') return cargoPaths(readToml(text, file)).flatMap(([name, target]) => linked(target) ? [finding(name, target)] : []);
  if (base === 'go.mod' || base === 'go.work') return goPaths(text).flatMap(([name, target]) => linked(target) ? [finding(name, target)] : []);
  if (base === 'pyproject.toml') {
    const tool = readToml(text, file).tool;
    const uv = isTable(tool) ? tool.uv : undefined;
    const sources = isTable(uv) ? uv.sources : undefined;
    if (!isTable(sources)) return [];
    return Object.entries(sources).flatMap(([name, value]) => (Array.isArray(value) ? value : [value])
      .flatMap((item: unknown) => isTable(item) && typeof item.path === 'string' && linked(item.path) ? [finding(name, item.path)] : []));
  }
  const manifest: unknown = JSON.parse(text);
  if (!isJsonObject(manifest)) return [];
  if (COMPOSER.test(base)) {
    const repositories: unknown[] = Array.isArray(manifest.repositories) ? manifest.repositories : isJsonObject(manifest.repositories) ? Object.values(manifest.repositories) : [];
    return repositories.flatMap(item => isJsonObject(item) && item.type === 'path' && typeof item.url === 'string' && linked(item.url) ? [finding('a path repository', item.url)] : []);
  }
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = manifest[field];
    return isJsonObject(dependencies) ? Object.entries(dependencies).flatMap(([name, spec]) => typeof spec === 'string' && NPM_PATH.test(spec) && linked(spec.replace(NPM_PATH, '')) ? [finding(name, spec)] : []) : [];
  });
}

/** The package and path of each dependency of a Cargo.toml that names a path: its dependency tables, those of each target, and patch (K997). */
function cargoPaths(manifest: Record<string, unknown>): [string, string][] {
  const target = isTable(manifest.target) ? Object.values(manifest.target).filter(isTable) : [];
  const patch = isTable(manifest.patch) ? Object.values(manifest.patch).filter(isTable) : [];
  const workspace = isTable(manifest.workspace) ? [manifest.workspace] : [];
  const tables = [...[manifest, ...target, ...workspace].flatMap(owner => CARGO_TABLES.map(name => owner[name])), ...patch].filter(isTable);
  return tables.flatMap(table => Object.entries(table).flatMap(([name, value]) => isTable(value) && typeof value.path === 'string' ? [[name, value.path] as [string, string]] : []));
}

/**
 * The module and path of each replace of a go.mod or go.work whose target is a folder, and each use of a go.work, which names a
 * folder (K997). A replace target that is a module path with a version names no folder; a folder starts with ./, ../ or /.
 */
function goPaths(text: string): [string, string][] {
  const found: [string, string][] = [];
  let block = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (block && line === ')') { block = ''; continue; }
    const opened = /^(replace|use)\s*\($/.exec(line);
    if (opened) { block = opened[1] ?? ''; continue; }
    const directive = /^(replace|use)\s+(.+)$/.exec(line);
    const [verb, rest] = directive ? [directive[1], directive[2] ?? ''] : [block, line];
    if (!rest) continue;
    // A path of go.mod and go.work may be quoted.
    const unquoted = (word: string) => word.replace(/^(["`])(.*)\1$/, '$2');
    if (verb === 'use') found.push(['a used module', unquoted(rest)]);
    else if (verb === 'replace') {
      const [left = '', right = ''] = rest.split('=>').map(part => part.trim());
      const target = unquoted(right.split(/\s+/)[0] ?? '');
      if (/^(?:\.{1,2}\/|\/)/.test(target) || target === '.' || target === '..') found.push([left.split(/\s+/)[0] ?? '', target]);
    }
  }
  return found;
}

/** The tracked files of `top` that are manifests of OTHER_MANIFESTS other than composer.json, relative to `top` (K997). */
function otherManifests(top: string): string[] {
  const outcome = linkGit(top, 'ls-files', '-z', '--', ...OTHER_MANIFESTS.flatMap(name => [name, `*/${name}`]));
  if (outcome.error || outcome.status !== 0) throw new Error(`git ls-files failed in ${top}: ${outcome.error?.message ?? outcome.stderr.trim()}`);
  return outcome.stdout.split('\0').filter(file => file && path.posix.basename(file) !== 'composer.json');
}

/**
 * The findings of each composer.json, package.json and pyproject.toml that link judges in `directory`, with `project` its own (K773,
 * K975), and of each other manifest of a package manager there: with `project`, those of its own folder (K997).
 */
function manifestsPathFindings(root: string, directory: string, project: boolean): string[] {
  const top = realpathSync(root);
  const scope = path.relative(top, realpathSync(directory));
  const others = otherManifests(top).filter(file => project ? path.posix.dirname(file) === (scope || '.') : scope === '' || file.startsWith(`${scope}/`)).map(file => path.join(top, file));
  return [...consumerManifests(directory, project, ['composer', 'npm', 'python']), ...others].flatMap(file => manifestPathFindings(path.relative(top, file), readFileSync(file, 'utf8')));
}

/**
 * The findings of `root` beside link's check, sorted: K773's paths of the tracked manifests, the declared packages with no installed
 * folder (K888), of the manifests that link judges in `directory`, with `project` those of that project (K975). link writes no Claude
 * Code settings, so the check judges none (K960).
 */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env, directory = root, project = false): string[] {
  const checkouts = declaredCheckouts(root);
  const provided = providers(checkouts ?? [], undefined, root, root);
  // The declaration is a setting of the checkout, which Git ignores (K869).
  const file = path.join(mainCheckout(root), LINKS_FILE);
  const ignored = checkouts === undefined || isIgnored(file) ? [] : [`${file}: Git does not ignore the link declaration; fix: add the line /${LINKS_FILE} to the .gitignore of the repository`];
  return [...ignored, ...manifestsPathFindings(root, directory, project), ...declaredUnlinked(directory, provided, env, project)].sort();
}

/**
 * The link check of the checkout of `directory`, or with `project` of the consumer `directory`: link's check, then linkFindings, of the
 * whole checkout, or with `project` of that project alone (K975).
 */
export function linkCheck(directory: string, project: boolean, print: (text: string) => void, env: NodeJS.ProcessEnv = process.env): boolean {
  // With no declaration, make link links nothing and leaves the release state (K869), which the check compares: no own link (K935).
  const checkouts = declaredCheckouts(directory);
  let ok = link({ checkouts: checkouts ?? [], directories: [directory], check: true, print, env, project, own: checkouts !== undefined });
  const root = workTreeOf(directory);
  for (const finding of linkFindings(root, env, project ? directory : root, project)) {
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
