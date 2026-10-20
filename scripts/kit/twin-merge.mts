#!/usr/bin/env node
// The merge driver kit-twin of a Korean twin (K354). `make hooks` declares it in .git/info/attributes for CHANGELOG.ko.md and the
// Korean checklists, whose English files merge with merge=union, since the lines of a changelog and the rows of a checklist are
// independent. Git runs it for each such twin of a rebase: the text is the union of both sides without their revision markers, and
// the marker is the sha256 of the English file as git merges it (the same union of the same three sides), so every commit that the
// rebase writes holds a current twin, with no conflict, hand edit or script after it.
//
//   node twin-merge.mts <base> <ours> <theirs> <path>    (git passes %O %A %B %P and takes the result from <ours>)
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from './bootstrap/digest.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { stamped } from './documents-stamp.mts';
import { gitResult } from './git.mts';
import { isMain } from './paths.mts';

const MARKER = /^<!-- source-sha256: [^>]*? -->\n/m;

/** The union of `ours` and `theirs` over `base`, as `git merge-file --union` writes it in the work tree `root`. */
export function union(root: string, base: string, ours: string, theirs: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-twin-merge-'));
  try {
    const files = (['ours', 'base', 'theirs'] as const).map((name, index) => {
      const file = path.join(folder, name);
      writeFileSync(file, [ours, base, theirs][index] ?? '');
      return file;
    });
    const result = gitResult(root, 'merge-file', '-p', '--union', ...files);
    // git merge-file exits with the number of conflicts, which a union never leaves, and with a negative status on an error.
    if (result.error || result.status !== 0) throw new Error(`git merge-file --union failed: ${result.error?.message ?? result.stderr.trim()}`);
    return result.stdout;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** The text of `file` at the revision `rev`, empty when the revision holds no such file. */
function textAt(root: string, rev: string, file: string): string {
  if (gitResult(root, 'cat-file', '-e', `${rev}:${file}`).status !== 0) return '';
  const shown = gitResult(root, 'show', `${rev}:${file}`);
  if (shown.error || shown.status !== 0) throw new Error(`git show ${rev}:${file} failed: ${shown.error?.message ?? shown.stderr.trim()}`);
  return shown.stdout;
}

/**
 * The base and theirs of the rebase that runs in `root`: the commit that it applies over HEAD, the last of rebase-merge/done, and its
 * parent. Git names no such commit to a driver of a merge or a cherry-pick, so the English side is unknown there and the driver
 * fails, naming the rebase that lands a branch.
 */
function sides(root: string): { base: string; theirs: string } {
  const done = path.resolve(root, gitResult(root, 'rev-parse', '--git-path', 'rebase-merge/done').stdout.trim());
  const commit = existsSync(done) ? readFileSync(done, 'utf8').trim().split('\n').at(-1)?.split(/\s+/)[1] : undefined;
  if (commit === undefined || gitResult(root, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`).status !== 0) {
    throw new Error('the driver kit-twin merges a Korean twin in a rebase, where it knows the commit that the rebase applies; rebase the branch onto main instead of merging it');
  }
  return { base: `${commit}^`, theirs: commit };
}

/** The merged twin of `twin` (a path of the work tree `root`) from its three sides: the union, with the marker of the merged English. */
export function mergeTwin(root: string, twin: string, texts: { base: string; ours: string; theirs: string }): string {
  const body = union(root, texts.base.replace(MARKER, ''), texts.ours.replace(MARKER, ''), texts.theirs.replace(MARKER, ''));
  const english = twin.replace(/\.ko\.md$/, '.md');
  const { base, theirs } = sides(root);
  const merged = union(root, textAt(root, base, english), textAt(root, 'HEAD', english), textAt(root, theirs, english));
  const result = stamped(body, sha256(merged));
  if (result === null) throw new Error(`${twin} has no doc-id line, so it holds no revision marker`);
  return result;
}

if (isMain(import.meta.url)) {
  const [base, ours, theirs, twin] = process.argv.slice(2);
  try {
    if (!base || !ours || !theirs || !twin) throw new Error('Usage: node twin-merge.mts <base> <ours> <theirs> <path>');
    const read = (file: string) => readFileSync(file, 'utf8');
    writeAtomic(ours, mergeTwin(process.cwd(), twin, { base: read(base), ours: read(ours), theirs: read(theirs) }));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[twin-merge] ${error.message}`);
    process.exit(1);
  }
}
