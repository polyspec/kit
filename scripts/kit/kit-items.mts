#!/usr/bin/env node
// The item IDs of kit that the repositories which install the kit package check their rows against (K957). A repository has no
// kit checkout beside it in CI, so kit-build writes the IDs into dist/kit-items.json, which the package ships:
//
//   node scripts/kit/kit-items.mts <file>   writes the item IDs of the checklists of this checkout to <file>, as a JSON array
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, readChecklist, trackersOf, workingPlanFiles } from './checklist.mts';
import { isMain, repositoryRoot } from './paths.mts';

/** The file of the installed kit package that holds its item IDs, relative to the package root (K957). */
export const KIT_ITEMS = 'dist/kit-items.json';

/** The item IDs of the checklists of the kit checkout `kit`, sorted: every task of every plan folder. Throws when one cannot be read. */
export function kitItemIds(kit: string): string[] {
  const ids = new Set<string>();
  for (const tracker of trackersOf(loadConfig(kit), workingPlanFiles(kit))) {
    for (const item of readChecklist(readFileSync(path.join(kit, tracker.path), 'utf8'), tracker).items) ids.add(item.id);
  }
  return [...ids].sort();
}

if (isMain(import.meta.url)) {
  const [target] = process.argv.slice(2);
  if (!target) throw new Error('kit-items needs the file to write, such as dist/kit-items.json');
  const ids = kitItemIds(repositoryRoot());
  writeFileSync(path.resolve(target), `${JSON.stringify(ids, null, 2)}\n`);
  console.log(`[kit-items] wrote ${ids.length} item IDs to ${target}`);
}
