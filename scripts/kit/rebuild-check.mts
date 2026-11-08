#!/usr/bin/env node
// Checks the classes of the tools of a checkout (`make rebuild-check`), as config/rebuild.json declares them. S1 forbids a
// rebuild of what an ecosystem tool does, unless a rebuild record (docs/rebuild/<tool>.md) weighs the tools and says why none
// fits. The caller declares where its tool sources lie with --source <glob> and which of those files are none with
// --exclude <glob>, both repeatable (K1080); every tracked file that a source selects and no exclude drops has one class, and with
// no --source the check reads only the classes that config/rebuild.json declares:
//   ecosystem   it runs or uses an ecosystem tool, named in `tool`
//   replaced    an ecosystem library replaces it in a registered item, with the `reason`
//   record      kit keeps its own implementation; `record` is the rebuild record, which names the tool it covers
//   policy      a rule of polyspec with no ecosystem equivalent, with the `reason` (S8)
// Whether a tool parses an outside format is a judgement; the check makes it explicit for every selected tool, so a new tool fails
// until it is classified.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { matchesAny } from './glob.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfigFindings } from './schema-validate.mts';
import { trackedFiles } from './tracked-files.mts';

export const DECLARATION = 'config/rebuild.json';

/** The class of a tool: its kind, which rebuildFindings holds to ecosystem, replaced, record or policy, and the field that the kind needs. */
export type RebuildClass = { kind: string; tool?: string; reason?: string; record?: string };

/** The declaration of config/rebuild.json (scripts/kit/schema/rebuild.schema.json). */
export type RebuildDeclaration = { comment?: string; tools: Record<string, RebuildClass> };

// The field that each class needs, with the words of its finding.
const NEEDS = { ecosystem: ['tool', 'the tool it uses'], replaced: ['reason', 'its reason'], record: ['record', 'its record'], policy: ['reason', 'its reason'] } as const;
const isKind = (kind: string): kind is keyof typeof NEEDS => Object.hasOwn(NEEDS, kind);

/**
 * The findings of `declaration` against the tracked files of `root`, sorted; `sources` are the globs of the tool sources that the
 * caller declares and `excludes` the globs of the files among them that are no tool source, such as tests (K1080).
 */
export function rebuildFindings(root: string, declaration: RebuildDeclaration, tracked: string[], sources: readonly string[] = [], excludes: readonly string[] = []): string[] {
  const findings: string[] = [];
  const files = new Set(tracked);
  for (const file of sources.length ? tracked.filter(file => matchesAny(sources, file) && !matchesAny(excludes, file)) : []) {
    if (!Object.hasOwn(declaration.tools, file)) findings.push(`${file}: the tool has no class in ${DECLARATION}; declare it ecosystem, replaced, record or policy`);
  }
  for (const [file, entry] of Object.entries(declaration.tools)) {
    if (!files.has(file)) {
      findings.push(`${DECLARATION}: ${file} is not a tracked file`);
      continue;
    }
    if (!isKind(entry.kind)) {
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
  const { values } = parseArgs({ options: { source: { type: 'string', multiple: true }, exclude: { type: 'string', multiple: true } } });
  const findings = errors ?? rebuildFindings(repositoryRoot(), value, trackedFiles(repositoryRoot()), values.source ?? [], values.exclude ?? []);
  for (const finding of findings) console.error(`[rebuild-check] ${finding}`);
  if (findings.length) process.exitCode = 1;
  else console.log(`[rebuild-check] every tool that ${DECLARATION} selects has its class`);
}
