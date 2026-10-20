#!/usr/bin/env node
// Checks the classes of the tools of a checkout (`make rebuild-check`), as config/rebuild.json declares them. S1 forbids a
// rebuild of what an ecosystem tool does, unless a rebuild record (docs/rebuild/<tool>.md) weighs the tools and says why none
// fits. kit finds the tool sources by the layout of the repository (TOOL_SOURCES); a repository cannot narrow them, it only
// classifies them (K286). Every tool source has one class:
//   ecosystem   it runs or uses an ecosystem tool, named in `tool`
//   replaced    an ecosystem library replaces it in a registered item, with the `reason`
//   record      kit keeps its own implementation; `record` is the rebuild record, which names the tool it covers
//   policy      a rule of polyspec with no ecosystem equivalent, with the `reason` (S8)
// Whether a tool parses an outside format is a judgement; the check makes it explicit for every tool, so a new tool fails
// until it is classified.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from './glob.mts';
import { isTestFile } from './check-commits.mts';
import { installedKit, isSource } from './kit-check.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfigFindings } from './schema-validate.mts';
import { trackedFiles } from './tracked-files.mts';

export const DECLARATION = 'config/rebuild.json';

/** The class of a tool: its kind, which rebuildFindings holds to ecosystem, replaced, record or policy, and the field that the kind needs. */
export type RebuildClass = { kind: string; tool?: string; reason?: string; record?: string };

/** The declaration of config/rebuild.json (scripts/kit/schema/rebuild.schema.json). */
export type RebuildDeclaration = { schema: 1; comment?: string; tools: Record<string, RebuildClass> };

// The field that each class needs, with the words of its finding.
const NEEDS = { ecosystem: ['tool', 'the tool it uses'], replaced: ['reason', 'its reason'], record: ['record', 'its record'], policy: ['reason', 'its reason'] } as const;
const isKind = (kind: string): kind is keyof typeof NEEDS => Object.hasOwn(NEEDS, kind);

// The places where the tool sources of a repository lie, whatever it declares (K286): its scripts, the scripts, tools and bin of
// its packages (and of their components), its generators, its benchmarks, its examples and the generators of its fixtures.
const EXTENSIONS = '{mts,mjs,cjs,js,ts,py,php,sh,mk}';
const SOURCE = `*.${EXTENSIONS}`;
const TOOL_SOURCES = [
  `scripts/**/${SOURCE}`, `packages/*/{scripts,tools,bin}/**/${SOURCE}`, `packages/*/*/{scripts,tools,bin}/**/${SOURCE}`,
  '**/*_generate.go', `**/*.generate.${EXTENSIONS}`, `benchmarks/**/${SOURCE}`, `examples/**/${SOURCE}`, 'tests/fixtures/*/generate.*',
];
// A test is no tool, and a fixture generator is the one test-side tool.
const isToolSource = (file: string) => matchesAny(TOOL_SOURCES, file) && !file.endsWith('.d.ts') && (!isTestFile(file) || matchesAny(['tests/fixtures/*/generate.*'], file));

/**
 * The tracked tool sources of `root`: the files of the layout, except the copies of the installed kit in a repository other than
 * kit (kit-check reports a repository whose kit is not installed).
 */
export function toolSources(root: string, tracked: readonly string[]): string[] {
  const kit = isSource(root) ? undefined : installedKit(root);
  const copies = new Set(kit === undefined || 'finding' in kit ? [] : kit.copies.map(({ file }) => file));
  return tracked.filter(file => isToolSource(file) && !copies.has(file));
}

/** The findings of `declaration` against the tracked files of `root`, sorted. */
export function rebuildFindings(root: string, declaration: RebuildDeclaration, tracked: string[]): string[] {
  const findings: string[] = [];
  const files = new Set(tracked);
  for (const file of toolSources(root, tracked)) {
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
  const findings = errors ?? rebuildFindings(repositoryRoot(), value, trackedFiles(repositoryRoot()));
  for (const finding of findings) console.error(`[rebuild-check] ${finding}`);
  if (findings.length) process.exitCode = 1;
  else console.log(`[rebuild-check] every tool that ${DECLARATION} selects has its class`);
}
