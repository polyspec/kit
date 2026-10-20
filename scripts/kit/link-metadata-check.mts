#!/usr/bin/env node
// Checks that the installed polyspec packages of a checkout are what its links say they are (`make link-metadata-check`, K305, P30).
// Development consumes the providers only through links (docs/operations/local-links.md); a link whose installed metadata was
// recorded for the released package misleads every tool that reads it, such as the platform check that Composer writes from
// installed.json. While a link exists, for every polyspec package that a link replaced:
//   npm       the link resolves to a folder whose package.json names the package;
//   Composer  the record of installed.json (version, require, autoload, replace, provide, conflict) equals the composer.json at
//             its install-path, for a linked package and for a path package of the project;
//   Python    the Version and Requires-Python of the dist-info of an editable install equal the pyproject.toml it was built from;
//   Go        each `use` folder of go.work holds the go.mod of a module.
// A checkout without a link passes: CI installs the released packages. Any difference is a finding that names the package
// and the field.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composerVendor } from './composer-vendor.mts';
import { composerCommand } from './install-composer-project.mts';
import { recordDifferences } from './link.mts';
import { readTomlFile } from './link-providers.mts';
import { toolsEnvironment } from './mise-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';
import { readJsonObject } from './bootstrap/files.mts';

const shown = (value: unknown) => (value === undefined ? 'absent' : JSON.stringify(value));

/** The findings of the npm links of `root`: a polyspec package of node_modules that is a link must resolve to its package. */
function npmFindings(root: string): string[] {
  const found: string[] = [];
  for (const manifest of trackedFiles(root).filter(file => path.posix.basename(file) === 'package.json')) {
    const scope = path.join(root, path.posix.dirname(manifest), 'node_modules/@polyspec');
    for (const item of existsSync(scope) ? readdirSync(scope) : []) {
      const link = path.join(scope, item);
      if (!lstatSync(link).isSymbolicLink()) continue;
      const name = `@polyspec/${item}`;
      const target = existsSync(link) ? path.join(realpathSync(link), 'package.json') : undefined;
      if (target === undefined || !existsSync(target)) { found.push(`npm ${name}: the link ${path.relative(root, link)} resolves to no package folder`); continue; }
      const declared = readJsonObject(target).name;
      if (declared !== name) found.push(`npm ${name}: the linked source ${path.relative(root, target)} names ${shown(declared)}`);
    }
  }
  return found;
}

/** The findings of the Composer records of `root`: the vendor of each Composer project that holds installed.json. */
function composerFindings(root: string, env: NodeJS.ProcessEnv): string[] {
  const found: string[] = [];
  const projects = [...new Set(trackedFiles(root).filter(file => path.posix.basename(file) === 'composer.json').map(file => path.join(root, path.posix.dirname(file))))];
  if (projects.length === 0) return found;
  const command = env.COMPOSER_BIN || composerCommand(root, 'link-metadata-check');
  const tool = { command, env: env.COMPOSER_BIN ? env : toolsEnvironment(root, env) };
  const seen = new Set<string>();
  for (const project of projects) {
    const vendor = composerVendor(project, tool);
    const record = path.join(vendor, 'composer/installed.json');
    if (seen.has(record) || !existsSync(record)) continue;
    seen.add(record);
    for (const { name, field, installed, source } of recordDifferences(record)) {
      found.push(`composer ${name}: ${field} of ${path.relative(root, record)} is ${shown(installed)}, the linked source says ${shown(source)}`);
    }
  }
  return found;
}

/** The value of the header `name` of a dist-info METADATA text. */
const header = (metadata: string, name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(metadata)?.[1]?.trim();

/** The findings of the editable installs of `root`: a dist-info whose direct_url.json names a folder with a pyproject.toml. */
function pythonFindings(root: string): string[] {
  const found: string[] = [];
  for (const manifest of trackedFiles(root).filter(file => path.posix.basename(file) === 'pyproject.toml')) {
    const lib = path.join(root, path.posix.dirname(manifest), '.venv/lib');
    for (const version of existsSync(lib) ? readdirSync(lib) : []) {
      const site = path.join(lib, version, 'site-packages');
      for (const info of existsSync(site) ? readdirSync(site).filter(item => item.endsWith('.dist-info')) : []) {
        const direct = path.join(site, info, 'direct_url.json');
        if (!existsSync(direct)) continue;
        const url = readJsonObject(direct).url;
        if (typeof url !== 'string' || !url.startsWith('file://')) continue;
        const pyproject = path.join(fileURLToPath(url), 'pyproject.toml');
        if (!existsSync(pyproject)) continue;
        const project = readTomlFile(pyproject).project;
        if (typeof project !== 'object' || project === null) continue;
        const source = project as Record<string, unknown>;
        const metadata = readFileSync(path.join(site, info, 'METADATA'), 'utf8');
        const name = String(source.name ?? info);
        for (const [field, installed, declared] of [['Version', header(metadata, 'Version'), source.version], ['Requires-Python', header(metadata, 'Requires-Python'), source['requires-python']]] as const) {
          if (typeof declared === 'string' && installed !== declared) found.push(`python ${name}: ${field} of ${path.relative(root, path.join(site, info))} is ${shown(installed)}, the linked source says ${shown(declared)}`);
        }
      }
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

/** The findings of the links of `root`, sorted. */
export function linkFindings(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  return [...npmFindings(root), ...composerFindings(root, env), ...pythonFindings(root), ...goFindings(root)].sort();
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const findings = linkFindings(root);
  for (const finding of findings) console.error(`[link-metadata-check] ${finding}`);
  if (findings.length) {
    console.error(`[link-metadata-check] ${findings.length} findings: the installed metadata of a linked package differs from its source. Fix: kit link ${root} <checkout>...`);
    process.exitCode = 1;
  } else console.log('[link-metadata-check] every linked package carries the metadata of its source');
}
