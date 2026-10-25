#!/usr/bin/env node
// Writes the packed form of the files that name the sources of kit, the prepack step of npm pack after make kit-build (K613):
//
//   node scripts/kit/pack-manifest.mts
//
// A repository runs the sources of the kit checkout beside it through its link, but an installed package lies under node_modules,
// where node strips no types, so the package that npm packs runs dist: each export of package.json names its dist module and
// declarations, the kit-bootstrap.mk sets KIT to the dist beside its scripts/kit and KIT_EXT to mjs, and the Claude hook runs
// dist/claude-hook.mjs. postpack restores the three files from Git.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { kitPackageRoot } from './kit-files.mts';
import { isMain } from './paths.mts';

// An export of a source of scripts/kit, as package.json names it in the checkout.
const SOURCE_EXPORT = /"\.\/([a-z-]+)": "\.\/scripts\/kit\/\1\.mts"/g;

/** The packed text of each file of `root` that names the sources: package.json, scripts/kit/kit-bootstrap.mk and claude/settings.json. */
export function packedFiles(root: string): Record<string, string> {
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  const swap = (file: string, text: string, from: RegExp, to: string) => {
    const result = text.replace(from, to);
    if (result === text) throw new Error(`pack-manifest: ${file} names no source to pack (${String(from)})`);
    return result;
  };
  const manifest = swap('package.json', read('package.json'), SOURCE_EXPORT, '"./$1": { "types": "./dist/$1.d.mts", "default": "./dist/$1.mjs" }');
  const kitLine = swap('scripts/kit/kit-bootstrap.mk', read('scripts/kit/kit-bootstrap.mk'), /^KIT := \$\(KIT_BOOTSTRAP\)$/m, 'KIT := $(KIT_BOOTSTRAP:%/scripts/kit=%/dist)');
  const bootstrap = swap('scripts/kit/kit-bootstrap.mk', kitLine, /^KIT_EXT := mts$/m, 'KIT_EXT := mjs');
  const settings = swap('claude/settings.json', read('claude/settings.json'), /scripts\/kit\/claude-hook\.mts/g, 'dist/claude-hook.mjs');
  return { 'package.json': manifest, 'scripts/kit/kit-bootstrap.mk': bootstrap, 'claude/settings.json': settings };
}

if (isMain(import.meta.url)) {
  const root = kitPackageRoot();
  for (const [file, text] of Object.entries(packedFiles(root))) writeFileSync(path.join(root, file), text);
}
