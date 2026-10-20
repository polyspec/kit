#!/usr/bin/env node
// The merge driver kit-twin of a Korean twin (K354). `make hooks` declares it in .git/info/attributes for CHANGELOG.ko.md and the
// Korean checklists, whose English files merge with merge=union, since the lines of a changelog and the rows of a checklist are
// independent. Git runs it for each such twin of a rebase: the text is the union of both sides without their revision markers, and
// the marker is the sha256 of the English file as git merges it (the same union of the same three sides), so every commit that the
// rebase writes holds a current twin, with no conflict, hand edit or script after it.
//
// It is also the driver kit-changelog of CHANGELOG.md (K354-1). A union of a rebase puts the lines of main before those of the commit
// that the rebase applies, so the entry of a branch would land below the newer entries of main; the driver of a changelog, English
// or Korean, then puts the Unreleased entries that only the applied commit adds first, in the style of the list of main (one entry a
// line, or each entry a paragraph of its own). The Unreleased entries are newest first, and no one orders them by hand.
//
// It is also the driver kit-checklist of a checklist (K354-3). A union of a rebase keeps a task row twice when main changes its state
// and the branch appends rows after it, so the rows of a checklist merge by their ID: a row that one side changes takes that side, a
// row that both sides changed differently is a conflict that names its ID, and the other lines merge as the union does. The Korean
// twin of a checklist takes the marker of the merged English, as the twins of the changelogs do.
//
//   node twin-merge.mts <base> <ours> <theirs> <path>    (git passes %O %A %B %P and takes the result from <ours>)
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from './bootstrap/digest.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { loadConfig, readChecklist } from './checklist.mts';
import { stamped } from './documents-stamp.mts';
import { gitResult } from './git.mts';
import { isMain } from './paths.mts';
import { present } from './present.mts';

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

// The Unreleased section of a changelog: its heading, and what follows up to the next heading of a version.
const UNRELEASED = /^## Unreleased\n/m;
const NEXT_SECTION = /^## /m;

/** A part of the Unreleased section: a run of list entries, or other lines such as a sub-heading, kept in their place. */
type Part = { entries: string[] } | { text: string[] };

/** The parts of the body of an Unreleased section and whether its list is loose: most entries after the first follow a blank line. */
function parts(body: string): { parts: Part[]; loose: boolean } {
  const found: Part[] = [];
  let blank = false;
  let gaps = 0;
  let joins = 0;
  for (const line of body.split('\n')) {
    const last = found.at(-1);
    if (line.trim() === '') { blank = true; continue; }
    if (line.startsWith('- ')) {
      if (last !== undefined && 'entries' in last) {
        joins += 1;
        if (blank) gaps += 1;
        last.entries.push(line);
      } else found.push({ entries: [line] });
    } else if (/^\s/.test(line) && last !== undefined && 'entries' in last && !blank) {
      // A continuation line of the last entry.
      last.entries[last.entries.length - 1] += `\n${line}`;
    } else if (last !== undefined && 'text' in last && !blank) last.text.push(line);
    else found.push({ text: [line] });
    blank = false;
  }
  return { parts: found, loose: joins > 0 && gaps * 2 > joins };
}

/** The Unreleased section of `text`: where its body starts and ends, or undefined without one. */
function section(text: string): { start: number; end: number } | undefined {
  const heading = UNRELEASED.exec(text);
  if (heading === null) return undefined;
  const start = heading.index + heading[0].length;
  const next = NEXT_SECTION.exec(text.slice(start));
  return { start, end: next === null ? text.length : start + next.index };
}

/** The entries of the Unreleased section of `text`. */
function entriesOf(text: string): Set<string> {
  const range = section(text);
  if (range === undefined) return new Set();
  return new Set(parts(text.slice(range.start, range.end)).parts.flatMap(part => ('entries' in part ? part.entries : [])));
}

/**
 * The changelog `merged`, the union of `ours` and `theirs`, with the Unreleased entries that only `theirs` adds before the others of
 * their part, in the style of the list of `ours` (K354-1); a changelog without a new entry of `theirs` is returned as it is.
 */
export function orderUnreleased(merged: string, ours: string, theirs: string): string {
  const range = section(merged);
  if (range === undefined) return merged;
  const known = entriesOf(ours);
  const added = new Set([...entriesOf(theirs)].filter(entry => !known.has(entry)));
  if (added.size === 0) return merged;
  const ourRange = section(ours);
  const loose = ourRange === undefined ? false : parts(ours.slice(ourRange.start, ourRange.end)).loose;
  const body = parts(merged.slice(range.start, range.end)).parts.map((part) => {
    if ('text' in part) return part.text.join('\n');
    const ordered = [...part.entries.filter(entry => added.has(entry)), ...part.entries.filter(entry => !added.has(entry))];
    return ordered.join(loose ? '\n\n' : '\n');
  }).join('\n\n');
  const tail = range.end === merged.length ? '\n' : '\n\n';
  return `${merged.slice(0, range.start)}\n${body}${tail}${merged.slice(range.end)}`;
}

/** Whether `file` is a changelog, whose Unreleased entries the drivers order (K354-1). */
const isChangelog = (file: string) => /^CHANGELOG(\.ko)?\.md$/.test(path.basename(file));

/** Whether `file` is a checklist of a plan folder, whose task rows the driver merges by ID (K354-3). */
const isChecklist = (file: string) => /^docs\/plans\/[^/]+\/checklist(\.ko)?\.md$/.test(file);

/** The merge attribute that git gives `file` in the work tree `root` (git check-attr), such as union or kit-changelog. */
function mergeAttribute(root: string, file: string): string {
  const read = gitResult(root, 'check-attr', 'merge', '--', file);
  if (read.error || read.status !== 0) throw new Error(`git check-attr merge -- ${file} failed: ${read.error?.message ?? read.stderr.trim()}`);
  return /: merge: (.*)$/m.exec(read.stdout)?.[1]?.trim() ?? 'unspecified';
}

/** The merged changelog `file` of the work tree `root` from its three sides: the union, with the Unreleased entries ordered. */
export function mergeChangelog(root: string, texts: { base: string; ours: string; theirs: string }): string {
  return orderUnreleased(union(root, texts.base, texts.ours, texts.theirs), texts.ours, texts.theirs);
}

// The placeholder that stands for a task row in the text which the union merges, followed by the key of the row (K354-3): the ID of
// the row and its occurrence among the rows of its checklist, so a placeholder is the same line on every side that keeps the row.
const PLACEHOLDER = '\u0001kit-row:';

/** `text` with each task row replaced by its placeholder, and the rows by their keys; the rows are those of the checklist reading. */
function placeholders(text: string, idPattern: string): { text: string; rows: Map<string, string> } {
  const lines = text.split('\n');
  const rows = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const item of readChecklist(text, { path: '', translation: '', idPattern }).items) {
    const occurrence = seen.get(item.id) ?? 0;
    seen.set(item.id, occurrence + 1);
    const key = `${item.id}#${occurrence}`;
    rows.set(key, present(lines[item.line - 1], `line ${item.line} of the checklist`));
    lines[item.line - 1] = `${PLACEHOLDER}${key}`;
  }
  return { text: lines.join('\n'), rows };
}

/** The row of `key` in the merged checklist from its row on each side (undefined where a side has none), or a conflict. */
function resolveRow(key: string, base: string | undefined, ours: string | undefined, theirs: string | undefined): string | undefined {
  if (ours === theirs || theirs === base) return ours;
  if (ours === base) return theirs;
  throw new Error(`the task ${key.replace(/#\d+$/, '')} changed differently on both sides; resolve its row by hand`);
}

/**
 * The checklist merged from its three sides (K354-3): the lines that are not task rows merge as the union does, and each task row
 * merges by its ID. A row that both sides changed alike is kept once; a row that one side changes, adds or deletes takes that
 * side; a row that both sides changed differently throws, naming its ID.
 */
export function mergeChecklist(root: string, texts: { base: string; ours: string; theirs: string }, idPattern: string): string {
  const base = placeholders(texts.base, idPattern);
  const ours = placeholders(texts.ours, idPattern);
  const theirs = placeholders(texts.theirs, idPattern);
  const skeleton = union(root, base.text, ours.text, theirs.text);
  const placed = new Set<string>();
  return skeleton.split('\n').flatMap((line) => {
    if (!line.startsWith(PLACEHOLDER)) return [line];
    const key = line.slice(PLACEHOLDER.length);
    // A union writes the lines of both sides of a hunk that they changed, so a row that both sides changed alike appears twice.
    if (placed.has(key)) return [];
    placed.add(key);
    const row = resolveRow(key, base.rows.get(key), ours.rows.get(key), theirs.rows.get(key));
    return row === undefined ? [] : [row];
  }).join('\n');
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

/**
 * The merge of the three sides of `file` that git runs with the merge attribute `attribute` of the file: the driver of a changelog
 * (K354-1) or of a checklist (K354-3) by its attribute, and the union otherwise.
 */
function mergerOf(root: string, file: string, attribute: string): (sides: { base: string; ours: string; theirs: string }) => string {
  if (isChangelog(file) && attribute === 'kit-changelog') return sides => mergeChangelog(root, sides);
  if (isChecklist(file) && attribute === 'kit-checklist') {
    const { idPattern } = loadConfig(root);
    return sides => mergeChecklist(root, sides, idPattern);
  }
  return sides => union(root, sides.base, sides.ours, sides.theirs);
}

/** The merged twin of `twin` (a path of the work tree `root`) from its three sides: the union, with the marker of the merged English. */
export function mergeTwin(root: string, twin: string, texts: { base: string; ours: string; theirs: string }): string {
  const plain = { base: texts.base.replace(MARKER, ''), ours: texts.ours.replace(MARKER, ''), theirs: texts.theirs.replace(MARKER, '') };
  const english = twin.replace(/\.ko\.md$/, '.md');
  // The twin merges as git merges its English file, by the attribute of that file: a checkout whose hooks predate K354-1 merges
  // CHANGELOG.md with merge=union, and its marker is the sha256 of that union (K354-2). A checklist merges by its rows (K354-3).
  const merge = mergerOf(root, twin, mergeAttribute(root, english));
  const body = merge(plain);
  const { base, theirs } = sides(root);
  // The English file merges as its own driver merges it, so the marker is the sha256 of the English file that the rebase writes.
  const merged = merge({ base: textAt(root, base, english), ours: textAt(root, 'HEAD', english), theirs: textAt(root, theirs, english) });
  const result = stamped(body, sha256(merged));
  if (result === null) throw new Error(`${twin} has no doc-id line, so it holds no revision marker`);
  return result;
}

if (isMain(import.meta.url)) {
  const [base, ours, theirs, twin] = process.argv.slice(2);
  try {
    if (!base || !ours || !theirs || !twin) throw new Error('Usage: node twin-merge.mts <base> <ours> <theirs> <path>');
    const read = (file: string) => readFileSync(file, 'utf8');
    const texts = { base: read(base), ours: read(ours), theirs: read(theirs) };
    // A Korean twin takes the marker of its merged English file; the English changelog is the union with its entries ordered, and
    // the English checklist is the merge of its rows by ID.
    if (twin.endsWith('.ko.md')) writeAtomic(ours, mergeTwin(process.cwd(), twin, texts));
    else if (isChecklist(twin)) writeAtomic(ours, mergeChecklist(process.cwd(), texts, loadConfig(process.cwd()).idPattern));
    else writeAtomic(ours, mergeChangelog(process.cwd(), texts));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[twin-merge] ${error.message}`);
    process.exit(1);
  }
}
