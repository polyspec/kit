#!/usr/bin/env node
// The check that no tracked test, script or Makefile bypasses a gate (`make bypass-check`, K308): P6 forbids lowering a standard
// to pass, and these three bypass a gate without a trace:
//   1. setting the CI identity (GITHUB_ACTIONS, CI) outside .github/workflows: a local run impersonates CI to pass the guard that
//      keeps a suite out of a local run;
//   2. make -o, --old-file or --assume-old naming a gate of kit-gates: the gate is treated as up to date and never runs;
//   3. --no-verify: a Git hook is skipped.
// The tools and tests of kit itself (scripts/kit, tests/kit, tests/source) are left out, since they test the guards that these
// rules protect. Each finding names the file, the line and the bypass.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';

// The files that are read: tests, scripts, Makefiles and Git hooks; the workflows are the one place that CI is named.
const READ = /^(?:tests\/|scripts\/|\.githooks\/|Makefile$|.*\.mk$|.*\/Makefile$)/;
const KIT_OWN = /^(?:scripts\/kit\/|tests\/kit\/|tests\/source\/)/;

// A CI identity variable set to a value: a shell assignment, an object property, or an assignment to process.env or env.
const CI_IDENTITY = /\b(?:GITHUB_ACTIONS|CI)\b(?:['"]?\s*[:=]\s*['"]?(?:true|1|yes)\b|\s*\]?\s*=\s*['"]?(?:true|1|yes)\b)/;
const BYPASS_FLAGS = /\s(?:-o|--old-file|--assume-old)(?:=|\s+)([A-Za-z0-9_.-]+)/g;

/** The gates of kit-gates among the prerequisites of `text`, the content of scripts/kit/kit.mk. */
export function gatesOf(text: string): string[] {
  return /^kit-gates:\s*([^#\n]*)/m.exec(text)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
}

/** The findings of the file `file` with the text `text`; `gates` are the gates of kit-gates. */
export function bypassFindings(file: string, text: string, gates: readonly string[]): string[] {
  if (!READ.test(file) || KIT_OWN.test(file)) return [];
  return text.split('\n').flatMap((line, index) => {
    const found: string[] = [];
    const code = line.replace(/^\s*(?:\/\/|#).*$/, '');
    const where = `${file}:${index + 1}`;
    if (CI_IDENTITY.test(code)) found.push(`${where}: sets the CI identity outside a workflow; a local run never impersonates CI`);
    if (/\bmake\b/.test(code)) {
      for (const match of code.matchAll(BYPASS_FLAGS)) {
        if (gates.includes(match[1] ?? '')) found.push(`${where}: make ${(match[0] ?? '').trim()} treats the gate ${match[1]} as up to date and never runs it`);
      }
    }
    if (/--no-verify\b/.test(code)) found.push(`${where}: --no-verify skips a Git hook`);
    return found;
  });
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const kit = path.join(root, 'scripts/kit/kit.mk');
  const gates = existsSync(kit) ? gatesOf(readFileSync(kit, 'utf8')) : [];
  const found = trackedFiles(root).flatMap(file => bypassFindings(file, readFileSync(path.join(root, file), 'utf8'), gates));
  for (const line of found) console.error(`[bypass-check] ${line}`);
  if (found.length) {
    console.error(`[bypass-check] ${found.length} bypasses of a gate; a gate runs, and its finding is fixed`);
    process.exit(1);
  }
  console.log('[bypass-check] no test, script or Makefile impersonates CI, assumes a gate up to date or skips a hook');
}
