// Checks that no tracked file names a polyspec package of 0.0.x (K468, docs/operations/local-links.md, Tracked locks). A tracked
// manifest or lock lists no such package, in any section or lock node, so a tracked lock covers the third-party packages only. The
// declarations of the packages that the repository consumes by link live in config/polyspec.json, each with its ecosystem, its
// project folder (named from the repository root) and its name; a declaration whose project lacks the manifest of its ecosystem is
// a finding. The check reads the tracked files only: a link file, such as composer.link.json, is written by link and is not checked.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { git } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { providerKey, providers, repositoryOf, type Provider, workTreeOf } from './link-providers.mts';
import { normalizeName } from './pyproject-dependencies.mts';
import { readConfigFindings } from './schema-validate.mts';
import { isStringArray, isTable, readToml } from './toml.mts';
import { isJsonObject } from './bootstrap/files.mts';

export const CONFIG = 'config/polyspec.json';
const SCHEMA = 'polyspec.schema.json';

export type Ecosystem = 'composer' | 'npm' | 'python';
export type Declaration = { ecosystem: Ecosystem; project: string; name: string };

/** The manifest that a declaration's project folder must hold, per ecosystem. */
const MANIFEST: Record<Ecosystem, string> = { composer: 'composer.json', npm: 'package.json', python: 'pyproject.toml' };

/** Whether a package name of the tracked files is a polyspec package: a Composer name, an npm scope or a Python distribution (PEP 503). */
const isPolyspec = (name: string): boolean => name.startsWith('polyspec/') || name.startsWith('@polyspec/') || /^polyspec[-_.]/i.test(name);

/** The name of a PEP 508 requirement string, without its extras, version or URL. */
const requirementName = (requirement: string): string => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(requirement)?.[1] ?? requirement;

/** The declarations of config/polyspec.json, and the findings of its schema; none when the file is absent. */
export function declarationsOf(root: string): { declarations: Declaration[]; findings: string[] } {
  if (!existsSync(path.join(root, CONFIG))) return { declarations: [], findings: [] };
  const read = readConfigFindings<{ packages: Declaration[] }>(root, CONFIG, SCHEMA);
  if (read.errors) return { declarations: [], findings: read.errors.map(error => `${CONFIG}: ${error}`) };
  return { declarations: read.value.packages, findings: [] };
}

/**
 * The polyspec packages that config/polyspec.json of the repository `top` declares for the project folder `folder` of `ecosystem` (K468).
 * A declaration that the schema refuses fails the call with its errors: a declaration dropped in silence would unlink its package.
 */
export function declaredFor(top: string, ecosystem: Ecosystem, folder: string): string[] {
  const { declarations, findings } = declarationsOf(top);
  if (findings.length > 0) throw new Error(findings.join('\n'));
  return declarations.filter(item => item.ecosystem === ecosystem && path.resolve(top, item.project) === path.resolve(folder)).map(item => item.name);
}

/** The tracked files of the repository `root`, relative to it. */
function trackedFiles(root: string): string[] {
  return git(root, 'ls-files', '-z').split('\0').filter(file => file !== '');
}

/** The polyspec names of a tracked manifest or lock, by the section that names them. */
function namesIn(file: string, text: string): string[] {
  const base = path.posix.basename(file);
  const names: string[] = [];
  if (base === 'composer.json') {
    const manifest = JSON.parse(text) as unknown;
    if (isJsonObject(manifest)) for (const section of ['require', 'require-dev']) names.push(...Object.keys(isJsonObject(manifest[section]) ? manifest[section] : {}));
  } else if (base === 'composer.lock') {
    const lock = JSON.parse(text) as unknown;
    if (isJsonObject(lock)) for (const section of ['packages', 'packages-dev']) for (const item of Array.isArray(lock[section]) ? lock[section] : []) if (isJsonObject(item) && typeof item.name === 'string') names.push(item.name);
  } else if (base === 'package.json') {
    const manifest = JSON.parse(text) as unknown;
    if (isJsonObject(manifest)) for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) names.push(...Object.keys(isJsonObject(manifest[section]) ? manifest[section] : {}));
  } else if (base === 'package-lock.json') {
    const lock = JSON.parse(text) as unknown;
    if (isJsonObject(lock) && isJsonObject(lock.packages)) {
      for (const [key, node] of Object.entries(lock.packages)) {
        const at = key.lastIndexOf('node_modules/');
        if (at !== -1) names.push(key.slice(at + 'node_modules/'.length));
        if (key === '' && isJsonObject(node)) for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) names.push(...Object.keys(isJsonObject(node[section]) ? node[section] : {}));
      }
    }
  } else if (base === 'pyproject.toml') {
    const project = readToml(text, file);
    const table = isTable(project.project) ? project.project : {};
    const required = [...(isStringArray(table.dependencies) ? table.dependencies : [])];
    if (isTable(table['optional-dependencies'])) for (const list of Object.values(table['optional-dependencies'])) if (isStringArray(list)) required.push(...list);
    if (isTable(project['dependency-groups'])) for (const list of Object.values(project['dependency-groups'])) if (isStringArray(list)) required.push(...list);
    names.push(...required.map(requirementName));
  } else if (base === 'pylock.toml') {
    const lock = readToml(text, file);
    for (const item of Array.isArray(lock.packages) ? lock.packages : []) if (isTable(item) && typeof item.name === 'string') names.push(item.name);
  }
  return names;
}

const MANIFEST_FILES = new Set(['composer.json', 'composer.lock', 'package.json', 'package-lock.json', 'pyproject.toml', 'pylock.toml']);

/** The ecosystem of a tracked manifest or lock; every caller has already limited `file` to MANIFEST_FILES. */
function ecosystemOf(file: string): Ecosystem {
  const base = path.posix.basename(file);
  if (base.startsWith('composer')) return 'composer';
  if (base.startsWith('package')) return 'npm';
  return 'python';
}

/** Whether `file` resolves inside `root`; a tracked manifest symlink to another checkout is not owned here. */
function insideCheckout(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** The link-discovered providers whose manifests physically resolve inside this repository. */
function ownedWorkspacePackages(root: string): Map<string, Provider> {
  const repository = repositoryOf(root);
  const checkout = realpathSync(workTreeOf(root));
  const found = providers([], undefined, root, root);
  return new Map([...found].filter(([, provider]) => {
    if (provider.ecosystem === 'go' || provider.repository !== repository) return false;
    const manifest = path.join(provider.folder, MANIFEST[provider.ecosystem]);
    return insideCheckout(checkout, realpathSync(manifest));
  }));
}

/** Whether this package name belongs to a source-backed provider in the repository's own workspace. */
function ownedByWorkspace(owned: ReadonlyMap<string, Provider>, file: string, name: string): boolean {
  const ecosystem = ecosystemOf(file);
  const providerName = ecosystem === 'python' ? normalizeName(name) : name;
  return owned.has(providerKey(ecosystem, providerName));
}

/** The findings of the tracked files and of the declarations of `root`, one line each; none when the repository is clean. */
export function polyspecLockFindings(root: string): string[] {
  const findings: string[] = [];
  const tracked = trackedFiles(root);
  const owned = ownedWorkspacePackages(root);
  for (const file of tracked.filter(item => MANIFEST_FILES.has(path.posix.basename(item)))) {
    const names = [...new Set(namesIn(file, readFileSync(path.join(root, file), 'utf8')).filter(isPolyspec).filter(name => !ownedByWorkspace(owned, file, name)))].sort();
    if (names.length > 0) findings.push(`${file}: names ${names.join(', ')}; a tracked file names no polyspec package of 0.0.x, its declaration is in ${CONFIG} (K468)`);
  }
  const declared = declarationsOf(root);
  findings.push(...declared.findings);
  for (const { ecosystem, project } of declared.declarations) {
    const manifest = path.posix.join(project, MANIFEST[ecosystem]);
    if (!tracked.includes(manifest)) findings.push(`${CONFIG}: the ${ecosystem} declaration of ${project} has no ${manifest} tracked in the repository (K468)`);
  }
  return findings;
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const findings = polyspecLockFindings(root);
  for (const finding of findings) process.stdout.write(`${finding}\n`);
  if (findings.length > 0) {
    process.stderr.write(`[polyspec-lock-check] ${findings.length} finding${findings.length === 1 ? '' : 's'}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('[polyspec-lock-check] no tracked file names a polyspec package of 0.0.x\n');
  }
}
