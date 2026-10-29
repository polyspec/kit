#!/usr/bin/env node
// Writes the revision marker of the Korean documents (`make documents-stamp`): in every pair that config/documents.json
// selects, the Korean file gets `<!-- source-sha256: <sha256 of the English file> -->`, on the line after its `<!-- doc-id: ... -->`
// line, replacing the marker there. Run it after the Korean text matches the English text; the checker
// (`make docs-check`) compares the marker, so a stamp on an unreviewed translation hides a missing translation.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, documentsOf } from './check-documents.mts';
import { sha256 } from './bootstrap/digest.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { proseLines } from './markdown.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';

const MARKER_LINE = /^<!-- source-sha256: [^>]*? -->$/;
const DOC_ID = /<!-- doc-id: [^>]*? -->/;

/** The fields of config/documents.json that select the pairs. */
export interface DocumentsConfig {
  include: string[];
  exclude?: string[];
}

/** A line of the prose of a document (markdown.mts proseLines): its number and its text. */
interface ProseLine {
  line: number;
  text: string;
}

/** The text of a Korean document whose line after the doc-id line is the marker `<!-- source-sha256: ${sha} -->`, or null
 * when it has no doc-id line; no other line changes, so a marker shown as an example in the body stays. */
export function stamped(text: string, sha: string): string | null {
  const id = proseLines(text).find((entry: ProseLine) => DOC_ID.test(entry.text));
  if (!id) return null;
  const lines = text.split('\n');
  // id.line is the 1-based number of the doc-id line, so lines[id.line] is the line after it.
  lines.splice(id.line, MARKER_LINE.test(lines[id.line] ?? '') ? 1 : 0, `<!-- source-sha256: ${sha} -->`);
  return lines.join('\n');
}

/** Stamps every Korean document of the pairs; returns the stamped files and a line for each file that failed. */
export function stampAll(root: string, config: DocumentsConfig): { changed: string[]; failed: string[] } {
  const changed: string[] = [];
  const failed: string[] = [];
  for (const english of documentsOf(root, config)) {
    const korean = english.replace(/\.md$/, '.ko.md');
    // documentsOf names the English file of every tracked document of a pair, and a pair has both files (check-documents
    // pair-missing).
    if (!existsSync(path.join(root, english))) {
      failed.push(`${english} is missing; it is the source of ${korean}`);
      continue;
    }
    if (!existsSync(path.join(root, korean))) {
      failed.push(`${korean} is missing; translate ${english} into it`);
      continue;
    }
    const before = readFileSync(path.join(root, korean), 'utf8');
    const after = stamped(before, sha256(readFileSync(path.join(root, english))));
    if (after === null) failed.push(`${korean} has no <!-- doc-id: ... --> line; add the doc-id of the English file first`);
    else if (after !== before) {
      writeAtomic(path.join(root, korean), after);
      changed.push(korean);
    }
  }
  return { changed, failed };
}

if (isMain(import.meta.url)) {
  if (!existsSync(path.join(repositoryRoot(), CONFIG))) {
    console.error(`[documents-stamp] ${CONFIG} does not exist`);
    process.exit(1);
  }
  const { changed, failed } = stampAll(repositoryRoot(), readConfig<DocumentsConfig>(repositoryRoot(), CONFIG, 'documents.schema.json'));
  for (const file of changed) console.log(`[documents-stamp] stamped ${file}`);
  for (const line of failed) console.error(`[documents-stamp] ${line}`);
  console.log(`[documents-stamp] ${changed.length} stamped, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
