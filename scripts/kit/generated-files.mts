#!/usr/bin/env node
// The generated-file check of AGENTS.md "Generated files": a staged path with a generated segment (node_modules, vendor, .venv,
// venv, __pycache__, target, dist or *.egg-info) is refused, naming the path, unless config/generated.json declares it an
// exception. The pre-commit hook that `git-hooks install` writes runs `staged` through `make staged-generated-hook`.
//
//   node scripts/kit/generated-files.mts staged   fail while a staged path is generated and no exception of the config allows it,
//                                                 or a staged Korean twin holds a stale source-sha256 (K382)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gitResult } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { matchesAny } from './glob.mts';
import { readConfigFindings } from './schema-validate.mts';
import { stagedTwinFindings } from './check-documents.mts';

export const CONFIG = 'config/generated.json';
export const GENERATED_SEGMENTS = ['node_modules', 'vendor', '.venv', 'venv', '__pycache__', 'target', 'dist'];

/** config/generated.json as generated.schema.json describes it. */
export interface GeneratedConfig {
  schema: 1;
  paths: string[];
  exceptions: string[];
}

const isGeneratedSegment = (segment: string) => GENERATED_SEGMENTS.includes(segment) || segment.endsWith('.egg-info');

/** The paths that are generated (a segment of GENERATED_SEGMENTS, or a glob of `config.paths`) and that no glob of `config.exceptions` allows, in the order given. */
export function generatedOffenders(paths: string[], config: Pick<GeneratedConfig, 'paths' | 'exceptions'>) {
  return paths.filter(file => (file.split('/').some(isGeneratedSegment) || matchesAny(config.paths, file)) && !matchesAny(config.exceptions, file));
}

/** The configuration of the checkout `root`; throws with every finding when it breaks the schema, and when it is missing. */
export function loadGeneratedConfig(root: string): GeneratedConfig {
  if (!existsSync(path.join(root, CONFIG))) throw new Error(`${CONFIG} does not exist in ${root}; the repository declares its generated-file exceptions there`);
  const { value, errors } = readConfigFindings<GeneratedConfig>(root, CONFIG, 'generated.schema.json');
  if (errors) throw new Error(errors.join('\n'));
  return value;
}

/** The staged paths of the checkout `root` that are added, copied, modified or renamed. */
export function stagedPaths(root: string) {
  const run = gitResult(root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z');
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`git diff --cached failed in ${root}: ${run.stderr.trim()}`);
  return run.stdout.split('\0').filter(Boolean);
}

if (isMain(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== 'staged' || rest.length > 0) {
    console.error('Usage: node scripts/kit/generated-files.mts staged');
    process.exitCode = 2;
  } else {
    const root = repositoryRoot();
    const offenders = generatedOffenders(stagedPaths(root), loadGeneratedConfig(root));
    const twins = stagedTwinFindings(root);
    for (const file of offenders) console.error(`[generated-files] ${file} is a generated file (AGENTS.md "Generated files"); unstage it, or declare it in ${CONFIG}`);
    for (const line of twins) console.error(`[generated-files] ${line}`);
    if (offenders.length > 0 || twins.length > 0) process.exitCode = 1;
    else console.log('[generated-files] no generated file is staged');
  }
}
