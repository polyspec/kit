// The files that the modules of kit read beside their own module, and those that the kit-build recipe of the Makefile of kit ships
// into dist (K421). A consumer holds no scripts/kit: a module that reads a file beside itself reads it from dist, so kit-build ships
// each such file or folder, or every consumer fails as test-markers-check did until K345-1. A module that tsc compiles beside the
// reader is no asset.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// A file or folder that a module reads beside itself: a relative URL of import.meta.url, or a path joined to the folder of the module.
const BESIDE = [/new URL\('\.\/([^'/]+)/g, /path\.join\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\),\s*'([^'/]+)/g];
// A source file that tsc compiles into dist, which kit-build ships by its build of the tools.
const COMPILED = /\.(?:mts|ts)$/;

/** The first segments of the files and folders that the module text `text` reads beside itself, sorted. */
export function assetsOf(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of BESIDE) for (const match of text.matchAll(pattern)) if (match[1] !== undefined && !COMPILED.test(match[1])) found.add(match[1]);
  return [...found].sort();
}

/** The first segments of the files and folders of scripts/kit that the kit-build recipe of `makefile` copies into dist. */
export function shippedAssets(makefile: string): Set<string> {
  const recipe: string[] = [];
  let inBuild = false;
  for (const line of makefile.split('\n')) {
    if (line.startsWith('kit-build:')) { inBuild = true; continue; }
    if (inBuild && !line.startsWith('\t')) break;
    if (inBuild) recipe.push(line);
  }
  const shipped = new Set<string>();
  for (const line of recipe) {
    for (const match of line.matchAll(/\bcp(?:\s+-R)?\s+scripts\/kit\/([^\s/]+)/g)) if (match[1] !== undefined) shipped.add(match[1]);
    // tar -C scripts/kit ... -cf - <folder> | tar -C dist.next -xf -
    const tar = /\btar -C scripts\/kit\b[^|]*-cf -\s+([^\s|]+)/.exec(line);
    if (tar?.[1] !== undefined) shipped.add(tar[1]);
  }
  return shipped;
}

/** The lines `<module>: <asset>` of each file or folder that a module of `modules` (file to text) reads beside itself and `makefile` does not ship. */
export function unshippedAssets(modules: ReadonlyMap<string, string>, makefile: string): string[] {
  const shipped = shippedAssets(makefile);
  return [...modules].flatMap(([file, text]) => assetsOf(text).filter(asset => !shipped.has(asset)).map(asset => `${file}: ${asset}`)).sort();
}

/** The modules of `root`/scripts/kit at its top level, by their path relative to `root`. */
export function kitModules(root: string, files: readonly string[]): Map<string, string> {
  return new Map(files.filter(file => /^scripts\/kit\/[^/]+\.mts$/.test(file)).map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
}
