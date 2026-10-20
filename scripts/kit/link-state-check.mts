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
import { installedPackages } from './link.mts';
import { copiesOf, runningKit, writtenByKit } from './kit-check.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';
import { isJsonObject, readJsonObject } from './bootstrap/files.mts';

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

/** The findings of the go.work files of `root`: each `use` folder holds a go.mod. */
function goFindings(root: string): string[] {
  const found: string[] = [];
  for (const manifest of trackedFiles(root).filter(file => path.posix.basename(file) === 'go.mod')) {
    const directory = path.join(root, path.posix.dirname(manifest));
    const work = path.join(directory, 'go.work');
    if (!existsSync(work)) continue;
    let block = false;
    const check = (use: string) => { if (!existsSync(path.join(directory, use, 'go.mod'))) found.push(`go ${use}: the use folder of ${path.relative(root, work)} holds no go.mod`); };
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
 * polyspec package of another PHP cannot meet.
 */
function platformFindings(root: string, installed: readonly Installed[]): string[] {
  const expected = expectedPhpId(root);
  if (expected === undefined) return [];
  const found: string[] = [];
  for (const vendor of new Set(installed.filter(item => item.ecosystem === 'composer' && isLink(item.folder)).map(item => path.dirname(path.dirname(item.folder))))) {
    const file = path.join(vendor, 'composer/platform_check.php');
    if (!existsSync(file)) continue;
    const demanded = /PHP_VERSION_ID >= (\d+)/.exec(readFileSync(file, 'utf8'))?.[1];
    if (demanded !== undefined && Number(demanded) !== expected) found.push(`composer ${path.relative(root, file)}: demands PHP id ${demanded} while .php-version names ${expected}; the vendor was installed from the tracked lock, run kit link`);
  }
  return found;
}

const INSTALL = /\b(?:composer\s+install|npm\s+ci|uv\s+sync)\b/;
const LINKS = /\blink\b/;
// An install into a tool project of kit, not a project of the repository: no polyspec package is linked there (K320).
const TOOL_PROJECT = /--working-dir[= ]\S*(?:scripts\/kit|config\/php-lint|config\/phpunit|var)\//;

/**
 * A recipe of the Makefiles of the repository that installs from a lock (composer install, npm ci, uv sync) runs the kit link step
 * after it in the same recipe (K349), so a fresh vendor does not read the tracked locks while polyspec checkouts are present. The
 * unlink recipe, which restores the locks by design, and the files that kit copies are left out.
 */
export function recipeFindings(root: string, files: readonly string[], read: (file: string) => string | undefined): string[] {
  const found: string[] = [];
  for (const file of files.filter(name => (name === 'Makefile' || name.endsWith('.mk')) && !name.startsWith('scripts/kit/'))) {
    const lines = (read(file) ?? '').split('\n');
    let target = '';
    let recipe: { line: number; text: string }[] = [];
    const flush = () => {
      const index = recipe.findIndex(({ text }) => INSTALL.test(text) && !TOOL_PROJECT.test(text));
      if (target !== '' && target !== 'unlink' && index !== -1 && !recipe.slice(index + 1).some(({ text }) => LINKS.test(text))) {
        found.push(`${file}:${recipe[index]?.line}: the recipe ${target} installs from a lock without the kit link step after it; add $(MAKE) link (or kit link --siblings) as the next line`);
      }
      recipe = [];
    };
    lines.forEach((text, index) => {
      if (text.startsWith('\t')) { recipe.push({ line: index + 1, text }); return; }
      flush();
      target = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(text)?.[1] ?? '';
    });
    flush();
  }
  return found;
}

/** The findings of the links of `root`, sorted; none while nothing is linked. */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const installed = [...npmInstalled(root), ...composerInstalled(root, env)];
  const found = [...goFindings(root), ...platformFindings(root, installed), ...recipeFindings(root, trackedFiles(root), file => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : undefined))];
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
