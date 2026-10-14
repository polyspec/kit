#!/usr/bin/env node
// Checks the classes of the tools of a checkout (`make rebuild-check`), as config/rebuild.json declares them. S1 forbids a
// rebuild of what an ecosystem tool does, unless a rebuild record (docs/rebuild/<tool>.md) weighs the tools and says why none
// fits. Every tracked file that `paths` selects has one class:
//   ecosystem   it runs or uses an ecosystem tool, named in `tool`
//   replaced    an ecosystem library replaces it in a registered item, with the `reason`
//   record      kit keeps its own implementation; `record` is the rebuild record, which names the tool it covers
//   policy      a rule of polyspec with no ecosystem equivalent, with the `reason` (S8)
// Whether a tool parses an outside format is a judgement; the check makes it explicit for every tool, so a new tool fails
// until it is classified.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfigFindings } from './schema-validate.mts';
import { trackedFiles } from './tracked-files.mts';

export const DECLARATION = 'config/rebuild.json';

/** The class of a tool. */
export type RebuildClass = { kind: 'ecosystem' | 'replaced' | 'record' | 'policy'; tool?: string; reason?: string; record?: string };

/** The declaration of config/rebuild.json (scripts/kit/schema/rebuild.schema.json). */
export type RebuildDeclaration = { schema: 1; comment?: string; paths: string[]; tools: Record<string, RebuildClass> };

// The field that each class needs, with the words of its finding.
const NEEDS = { ecosystem: ['tool', 'the tool it uses'], replaced: ['reason', 'its reason'], record: ['record', 'its record'], policy: ['reason', 'its reason'] } as const;

/** The findings of `declaration` against the tracked files of `root`, sorted. */
export function rebuildFindings(root: string, declaration: RebuildDeclaration, tracked: string[]): string[] {
  const findings: string[] = [];
  const files = new Set(tracked);
  for (const file of tracked.filter(item => matchesAny(declaration.paths, item))) {
    if (!Object.hasOwn(declaration.tools, file)) findings.push(`${file}: the tool has no class in ${DECLARATION}; declare it ecosystem, replaced, record or policy`);
  }
  for (const [file, entry] of Object.entries(declaration.tools)) {
    if (!files.has(file)) {
      findings.push(`${DECLARATION}: ${file} is not a tracked file`);
      continue;
    }
    if (!Object.hasOwn(NEEDS, entry.kind)) {
      findings.push(`${DECLARATION}: ${file} has the class ${JSON.stringify(entry.kind)}; the classes are ecosystem, replaced, record and policy`);
      continue;
    }
    const [field, words] = NEEDS[entry.kind];
    const value = entry[field];
    if (!value?.trim()) {
      findings.push(`${DECLARATION}: ${file} is ${entry.kind} and needs ${words}`);
      continue;
    }
    if (entry.kind !== 'record') continue;
    if (!existsSync(path.join(root, value))) findings.push(`${DECLARATION}: the record ${value} of ${file} does not exist`);
    else if (!readFileSync(path.join(root, value), 'utf8').includes(file)) findings.push(`${value}: the record does not name ${file}, which ${DECLARATION} says it covers`);
  }
  return findings.sort();
}

if (isMain(import.meta.url)) {
  if (!existsSync(path.join(repositoryRoot(), DECLARATION))) {
    console.error(`[rebuild-check] ${DECLARATION} does not exist; declare the class of each tool there (scripts/kit/schema/rebuild.schema.json)`);
    process.exit(1);
  }
  const { value, errors } = readConfigFindings<RebuildDeclaration>(repositoryRoot(), DECLARATION, 'rebuild.schema.json');
  const findings = errors ?? rebuildFindings(repositoryRoot(), value, trackedFiles(repositoryRoot()));
  for (const finding of findings) console.error(`[rebuild-check] ${finding}`);
  if (findings.length) process.exitCode = 1;
  else console.log(`[rebuild-check] every tool that ${DECLARATION} selects has its class`);
}
