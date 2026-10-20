#!/usr/bin/env node
// Checks the state of the links of a checkout (`make link-state-check`, K305-1, P30). Development consumes the providers only
// through links (docs/operations/local-links.md): the installed folder of a polyspec package is a symbolic link to the folder of
// its provider, never a copy, and the link counts as the installed released version, so no version or requirement is compared.
// While a link exists, in every ecosystem that links:
//   npm       each @polyspec package of node_modules pinned at 0.0.x is a link, and it resolves to a package of that name;
//   Composer  each polyspec package that installed.json of the vendor records at 0.0.x is a link, and it resolves to a folder
//             with the composer.json of that name;
//   Go        each `use` folder of go.work holds the go.mod of a module.
// A plain copy among links is a finding, and a link that resolves to nothing is one. A checkout without a link passes: CI
// installs the released packages. A finding names the ecosystem and the package.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { installedPackages } from './link.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';
import { readJsonObject } from './bootstrap/files.mts';

// Only a package pinned at 0.0.x is linked (docs/operations/local-links.md).
const ZERO = /^v?0\.0\./;
const isLink = (file: string) => lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true;

/** A polyspec package found installed: its ecosystem, name, folder and version. */
type Installed = { ecosystem: 'npm' | 'composer'; name: string; folder: string; version: string | undefined };

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
  const projects = [...new Set(trackedFiles(root).filter(file => path.posix.basename(file) === 'composer.json').map(file => path.join(root, path.posix.dirname(file))))];
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
      found.push({ ecosystem: 'composer', name: entry.name, folder: path.resolve(path.dirname(record), entry['install-path']), version: typeof entry.version === 'string' ? entry.version : undefined });
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

/** The findings of the links of `root`, sorted; none while nothing is linked. */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const installed = [...npmInstalled(root), ...composerInstalled(root, env)];
  const found = goFindings(root);
  const linked = installed.some(item => isLink(item.folder));
  for (const item of installed) {
    const shown = path.relative(root, item.folder);
    if (isLink(item.folder)) {
      const manifest = item.ecosystem === 'npm' ? 'package.json' : 'composer.json';
      if (!existsSync(path.join(item.folder, manifest))) found.push(`${item.ecosystem} ${item.name}: the link ${shown} resolves to no package folder`);
      else if (readJsonObject(path.join(item.folder, manifest)).name !== item.name) found.push(`${item.ecosystem} ${item.name}: the link ${shown} resolves to ${realpathSync(item.folder)}, which names another package`);
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
