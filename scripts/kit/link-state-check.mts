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
// installs the released packages. A finding names the ecosystem and the package.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { installedPackages, kitHookCheckout, trackedWorkspaceFolders, withWorkspaceHook, workspaceSettings } from './link.mts';
import { EXCLUDED, type Ecosystem, type Tool, trackedManifests, workspaceOf } from './link-providers.mts';
import { isTable, readToml } from './toml.mts';
import { copiesOf, runningKit, writtenByKit } from './kit-check.mts';
import { makeDatabase } from './owner-check.mts';
import { expandMake } from './recipe-tools.mts';
import { toolCommand, toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { ignoredPaths, trackedFiles } from './tracked-files.mts';
import { isJsonObject, isStringList, readJsonObject } from './bootstrap/files.mts';
import { foreignTrusts } from './bootstrap/install-mise.mts';
import { branchStates } from './worktree-prune.mts';

// Only a package pinned at 0.0.x is linked (docs/operations/local-links.md).
const ZERO = /^v?0\.0\./;
const isLink = (file: string) => lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true;

/** A polyspec package found installed: its ecosystem, name, folder and version. */
type Installed = { ecosystem: 'npm' | 'composer'; name: string; folder: string; version: string | undefined; dist?: string | undefined };

/** The polyspec packages of node_modules below every package.json of `root`. */
function npmInstalled(root: string): Installed[] {
  const found: Installed[] = [];
  for (const manifest of trackedFiles(root).filter(file => path.posix.basename(file) === 'package.json')) {
    const scope = path.join(root, path.posix.dirname(manifest), 'node_modules/@polyspec');
    for (const item of existsSync(scope) ? readdirSync(scope) : []) {
      const folder = path.join(scope, item);
      const version = existsSync(path.join(folder, 'package.json')) ? readJsonObject(path.join(folder, 'package.json')).version : undefined;
      found.push({ ecosystem: 'npm', name: `@polyspec/${item}`, folder, version: typeof version === 'string' ? version : undefined });
    }
  }
  return found;
}

/** The polyspec packages that installed.json of each Composer vendor of `root` records. */
function composerInstalled(root: string, env: NodeJS.ProcessEnv): Installed[] {
  // The Composer projects that kit writes (the copies of kit-sync, config/php-lint, the PHPUnit project) are tools of kit, no
  // consumer project: nothing of them is linked, and they need no Composer here (K320).
  const kitFile = writtenByKit(copiesOf(runningKit()));
  const projects = [...new Set(trackedFiles(root).filter(file => path.posix.basename(file) === 'composer.json' && !kitFile(file) && !file.startsWith('config/php-lint/') && !file.startsWith('config/phpunit/')).map(file => path.join(root, path.posix.dirname(file))))];
  if (projects.length === 0) return [];
  const tool = { command: env.COMPOSER_BIN || composerCommand(root, 'link-state-check'), env: env.COMPOSER_BIN ? env : toolsEnvironment(root, env) };
  const found: Installed[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    const record = path.join(composerVendor(project, tool), 'composer/installed.json');
    if (seen.has(record) || !existsSync(record)) continue;
    seen.add(record);
    for (const entry of installedPackages(record)) {
      if (typeof entry.name !== 'string' || !entry.name.startsWith('polyspec/') || typeof entry['install-path'] !== 'string') continue;
      const dist = isJsonObject(entry.dist) ? entry.dist.type : undefined;
      found.push({ ecosystem: 'composer', name: entry.name, folder: path.resolve(path.dirname(record), entry['install-path']), version: typeof entry.version === 'string' ? entry.version : undefined, dist: typeof dist === 'string' ? dist : 'none' });
    }
  }
  return found;
}

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

/** The PHP that .php-version names, as the id of the platform of K322 (<major>.<minor>.1 as 8<major>0<minor>01), or undefined. */
function expectedPhpId(root: string): number | undefined {
  const file = path.join(root, '.php-version');
  if (!existsSync(file)) return undefined;
  const [major, minor] = readFileSync(file, 'utf8').trim().split('.').map(Number);
  return major === undefined || minor === undefined || Number.isNaN(major) || Number.isNaN(minor) ? undefined : major * 10000 + minor * 100 + 1;
}

/**
 * While a Composer project is linked, its vendor must read the composer.json of the links (K349): the platform check that Composer
 * wrote demands the PHP that .php-version names. A vendor installed from the tracked lock demands the platform of that lock, which a
 * polyspec package of another PHP cannot meet, so a demand above .php-version is the finding (K384). A lower floor is the floor of
 * the packages, which Composer writes as the highest floor they require (">=8.4" is 80400), and it is no finding.
 */
function platformFindings(root: string, installed: readonly Installed[]): string[] {
  const expected = expectedPhpId(root);
  if (expected === undefined) return [];
  const found: string[] = [];
  for (const vendor of new Set(installed.filter(item => item.ecosystem === 'composer' && isLink(item.folder)).map(item => path.dirname(path.dirname(item.folder))))) {
    const file = path.join(vendor, 'composer/platform_check.php');
    if (!existsSync(file)) continue;
    const demanded = /PHP_VERSION_ID >= (\d+)/.exec(readFileSync(file, 'utf8'))?.[1];
    if (demanded !== undefined && Number(demanded) > expected) found.push(`composer ${path.relative(root, file)}: demands PHP id ${demanded} while .php-version names ${expected}; the vendor was installed from the tracked lock, run kit link`);
  }
  return found;
}

// The install from a lock of each ecosystem: the tool named literally, or through its make variable such as $(COMPOSER) install (K349-1).
const INSTALLS: { ecosystem: Ecosystem; pattern: RegExp }[] = [
  { ecosystem: 'composer', pattern: /\bcomposer\s+install\b|\$[({]COMPOSER(?:_BIN)?[)}]\s+install\b/ },
  { ecosystem: 'npm', pattern: /\bnpm\s+ci\b|\$[({]NPM[)}]\s+ci\b/ },
  { ecosystem: 'python', pattern: /\buv\s+sync\b|\$[({]UV[)}]\s+sync\b/ },
];
const LINKS = /\blink\b/;
// composer-install installs through the link where a sibling provides a polyspec package (K432), so its line is an install that links.
// A composer install of a lock, which installs the released polyspec packages of the lock before a link replaces them (K448-1).
const COMPOSER_LOCK = /\bcomposer\s+install\b|\$[({]COMPOSER(?:_BIN)?[)}]\s+install\b/;
const COMPOSER_INSTALL = /(?:\$[({]MAKE[)}]|\bmake)\s+composer-install\b/;
// An install into a tool project of kit, not a project of the repository: no polyspec package is linked there (K320).
const TOOL_PROJECT = /--working-dir[= ]\S*(?:scripts\/kit|config\/php-lint|config\/phpunit|var)\//;
// A make call of a recipe and the targets it names.
const MAKE_CALL = /\$[({]MAKE[)}]((?:\s+[^\s;&|]+)+)/;
// An assignment of a make variable: =, :=, ::=, ?= or +=, after export or override (K403).
const ASSIGNMENT = /^(?:(?:export|override)\s+)*([A-Za-z0-9_.-]+)\s*(::?=|\?=|\+=|=)\s*(.*)$/;
// The head of a rule: its targets, a colon that starts no assignment, and its prerequisites.
const RULE_HEAD = /^([^\s#:=][^#:=]*?)\s*:(?![:=])([^#;]*)/;
// A reference to a make variable by its name, $(NAME) or ${NAME}.
const REFERENCE = /\$[({]([A-Za-z0-9_.-]+)[)}]/g;

/**
 * The ecosystems in which the tracked manifests of `files` declare a polyspec dependency, which a link can link (K349-2); the manifests
 * that provide nothing to a link (tests, examples, fixtures, config, as link-providers.mts leaves them out) declare none.
 */
function polyspecEcosystems(files: readonly string[], read: (file: string) => string | undefined): Set<Ecosystem> {
  const found = new Set<Ecosystem>();
  const names = (value: unknown) => (isJsonObject(value) ? Object.keys(value) : []);
  for (const file of files.filter(name => !EXCLUDED.test(name))) {
    const text = read(file);
    if (text === undefined) continue;
    const base = path.posix.basename(file);
    if (base === 'package.json') {
      const manifest = JSON.parse(text) as unknown;
      if (isJsonObject(manifest) && ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(kind => names(manifest[kind]).some(name => name.startsWith('@polyspec/')))) found.add('npm');
    } else if (base === 'composer.json') {
      const manifest = JSON.parse(text) as unknown;
      if (isJsonObject(manifest) && ['require', 'require-dev'].some(kind => names(manifest[kind]).some(name => name.startsWith('polyspec/')))) found.add('composer');
    } else if (base === 'pyproject.toml') {
      // The requirements of the project, its extras and its dependency groups, read as TOML.
      const toml = readToml(text, file);
      const project = isTable(toml.project) ? toml.project : {};
      const lists = [project.dependencies, ...(isTable(project['optional-dependencies']) ? Object.values(project['optional-dependencies']) : []), ...(isTable(toml['dependency-groups']) ? Object.values(toml['dependency-groups']) : [])];
      if (lists.some(list => Array.isArray(list) && list.some(entry => typeof entry === 'string' && /^polyspec[-_.]/i.test(entry.trim())))) found.add('python');
    }
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
// The targets of `extras` (INSTALL_PACKAGES_EXTRA, K428) need no link step of their own: install-packages runs them and make install links after them.
export function recipeFindings(root: string, files: readonly string[], read: (file: string) => string | undefined, extras: ReadonlySet<string> = new Set()): string[] {
  const ecosystems = polyspecEcosystems(files, read);
  const makefiles = files.filter(name => (name === 'Makefile' || name.endsWith('.mk')) && !name.startsWith('scripts/kit/'));
  // The targets and prerequisites of a rule are read after the expansion of the variables that the Makefiles assign, so a target
  // that install reaches through a variable, as fsm-install: install-kit $(PACKAGE_DEPS), is reached (K403). A variable that no
  // Makefile of the repository assigns, as those of kit.mk, stays as it is written.
  const variables = new Map<string, string>();
  for (const file of makefiles) {
    for (const text of (read(file) ?? '').split('\n')) {
      const assignment = text.startsWith('\t') ? null : ASSIGNMENT.exec(text);
      if (!assignment) continue;
      const [, name = '', operator, value = ''] = assignment;
      if (operator === '+=') variables.set(name, [variables.get(name), value].filter(Boolean).join(' '));
      else if (operator !== '?=' || !variables.has(name)) variables.set(name, value);
    }
  }
  const expand = (text: string, depth = 0): string => (depth > 20 ? text : text.replace(REFERENCE, (reference, name: string) => {
    const value = variables.get(name);
    return value === undefined ? reference : expand(value, depth + 1);
  }));
  const words = (text: string) => expand(text).split(/\s+/).filter(Boolean);
  const rules: { file: string; targets: string[]; prerequisites: string[]; recipe: { line: number; text: string }[] }[] = [];
  for (const file of makefiles) {
    let rule: (typeof rules)[number] | undefined;
    (read(file) ?? '').split('\n').forEach((text, index) => {
      if (text.startsWith('\t')) { rule?.recipe.push({ line: index + 1, text }); return; }
      const head = ASSIGNMENT.test(text) ? null : RULE_HEAD.exec(text);
      rule = head ? { file, targets: words(head[1] ?? ''), prerequisites: words(head[2] ?? ''), recipe: [] } : undefined;
      if (rule) rules.push(rule);
    });
  }
  // The targets that make install reaches: its prerequisites and the targets that their recipes make, transitively.
  const reached = new Set<string>();
  const visit = (target: string) => {
    if (reached.has(target)) return;
    reached.add(target);
    for (const rule of rules.filter(entry => entry.targets.includes(target))) {
      for (const next of rule.prerequisites) visit(next);
      for (const { text } of rule.recipe) for (const word of words(MAKE_CALL.exec(text)?.[1] ?? '')) if (/^[A-Za-z0-9_./-]+$/.test(word)) visit(word);
    }
  };
  visit('install');
  const found: string[] = [];
  // A rule of several targets runs one recipe, so it is reached when one of its targets is.
  for (const { file, targets, recipe } of rules) {
    const target = targets.join(' ');
    if (targets.includes('unlink') || targets.some(name => reached.has(name) || extras.has(name))) continue;
    const index = recipe.findIndex(({ text }) => !TOOL_PROJECT.test(text) && !COMPOSER_INSTALL.test(text) && INSTALLS.some(({ ecosystem, pattern }) => ecosystems.has(ecosystem) && pattern.test(text)));
    // A Composer install of a lock is refused even with the link after it: the release is installed first, which the user rule
    // forbids, so the recipe runs make composer-install, which links from the start (K448-1).
    if (index !== -1 && COMPOSER_LOCK.test(recipe[index]?.text ?? '')) {
      found.push(`${file}:${recipe[index]?.line}: the recipe ${target} installs a lock of Composer that a polyspec package of a sibling checkout provides; run $(MAKE) composer-install DIR=<project> instead, which links from the start (K448-1)`);
    } else if (index !== -1 && !recipe.slice(index + 1).some(({ text }) => LINKS.test(text))) {
      found.push(`${file}:${recipe[index]?.line}: the recipe ${target} installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line`);
    }
  }
  return found;
}

const INSTALL_DIRECTORIES = ['node_modules', 'vendor', '.venv', 'target', 'var'];
const MANIFESTS = new Set(['package.json', 'composer.json', 'pyproject.toml', 'Cargo.toml']);

/** The folders of `root` that hold a manifest of a tracked file, and the root itself, relative to `root`. */
function manifestFolders(root: string): string[] {
  const folders = new Set(['.']);
  for (const file of trackedFiles(root)) if (MANIFESTS.has(path.posix.basename(file))) folders.add(path.posix.dirname(file));
  return [...folders].sort();
}

/** The findings of the install directories of `folders` that are symbolic links. */
function installLinkFindings(root: string, folders: readonly string[]): string[] {
  const found: string[] = [];
  for (const folder of folders) for (const name of INSTALL_DIRECTORIES) {
    const dir = path.join(root, folder, name);
    if (isLink(dir)) found.push(`install directory ${path.relative(root, dir)} is a symbolic link: remove the link and install the worktree from its own sources`);
  }
  return found;
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

/** The findings of the trusted-configs of `root` that trust something other than its own mise.toml (K397). */
function trustFindings(root: string): string[] {
  return foreignTrusts(root).map(({ name, target }) => `mise trusted-configs ${name}: trusts ${target}, not the mise.toml of the checkout; run make install-tools`);
}

/** The findings of the merged branches of `root` that are left, with their worktree: `make worktree-prune` removes them (K381). */
function mergedFindings(root: string): string[] {
  return branchStates(root)
    .filter(state => state.merged)
    .map(state => `branch ${state.branch}${state.folder === undefined ? '' : ` in worktree ${path.relative(root, state.folder) || '.'}`} is merged into main and left. Fix: make worktree-prune`);
}

/** The make targets that INSTALL_PACKAGES_EXTRA of the Makefile of `root` names, read from the make database (K428). */
function extraInstallTargets(root: string): Set<string> {
  const make = makeDatabase(root);
  return new Set(expandMake(make.variables.get('INSTALL_PACKAGES_EXTRA') ?? '', make.variables).split(/\s+/).filter(Boolean));
}

/** K440: the findings of the workspace folder of `root` whose kit checkout has claude-hook but whose .claude/settings.json lacks its hook. */
function workspaceHookFindings(root: string): string[] {
  const workspace = workspaceOf(root);
  const kit = kitHookCheckout(workspace);
  if (kit === undefined) return [];
  const settings = workspaceSettings(workspace);
  if (JSON.stringify(withWorkspaceHook(settings, kit)) === JSON.stringify(settings)) return [];
  return [`${path.join(workspace, '.claude/settings.json')}: no Bash PreToolUse hook runs the claude-hook of the kit checkout (K440); fix: make link`];
}

/** The findings of the links of `root`, sorted; none while nothing is linked. */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const installed = [...npmInstalled(root), ...composerInstalled(root, env)];
  const folders = manifestFolders(root);
  const found = [...workspaceHookFindings(root), ...installLinkFindings(root, folders), ...workspaceLinkFindings(root, folders), ...goFindings(root, env), ...platformFindings(root, installed), ...trustFindings(root), ...mergedFindings(root), ...recipeFindings(root, trackedFiles(root), file => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : undefined), extraInstallTargets(root))];
  const linked = installed.some(item => isLink(item.folder));
  for (const item of installed) {
    const shown = path.relative(root, item.folder);
    if (isLink(item.folder)) {
      const manifest = item.ecosystem === 'npm' ? 'package.json' : 'composer.json';
      if (!existsSync(path.join(item.folder, manifest))) found.push(`${item.ecosystem} ${item.name}: the link ${shown} resolves to no package folder`);
      else if (readJsonObject(path.join(item.folder, manifest)).name !== item.name) found.push(`${item.ecosystem} ${item.name}: the link ${shown} resolves to ${realpathSync(item.folder)}, which names another package`);
      else if (item.ecosystem === 'composer' && item.dist !== 'path') found.push(`composer ${item.name}: ${shown} is a link over an install from ${item.dist}, not Composer's own path install; run kit link`);
    } else if (linked && item.version !== undefined && ZERO.test(item.version)) {
      found.push(`${item.ecosystem} ${item.name}: ${shown} is a copy at ${item.version}, not a link, while other packages are linked`);
    }
  }
  return found.sort();
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const findings = linkFindings(root);
  for (const finding of findings) console.error(`[link-state-check] ${finding}`);
  if (findings.length) {
    console.error(`[link-state-check] ${findings.length} findings. Fix: kit link ${root} <checkout>...`);
    process.exitCode = 1;
  } else console.log('[link-state-check] every installed polyspec package of 0.0.x is a link that resolves, or nothing is linked');
}
