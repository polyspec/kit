#!/usr/bin/env node
// Writes the revision marker of the Korean documents (`make documents-stamp PATHS=<twin>...`): each named Korean twin of a pair that
// config/documents.json selects gets `<!-- source-sha256: <sha256 of the English file> -->`, on the line after its
// `<!-- doc-id: ... -->` line, replacing the marker there. A stamp says that the twin matches its source, so only the twins re-translated
// are named (K877); with no PATHS nothing is stamped, and each twin whose source moved is listed with the command that stamps it.
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

/**
 * Stamps the Korean twins of the pairs that `paths` names (K877); with no `paths` it stamps none. Returns the stamped twins, the twins
 * whose source moved and that it did not stamp, and a line for each file that failed.
 */
export function stampAll(root: string, config: DocumentsConfig, paths?: readonly string[]): { changed: string[]; moved: string[]; failed: string[] } {
  const changed: string[] = [];
  const moved: string[] = [];
  const failed: string[] = [];
  const twins = documentsOf(root, config).map(english => english.replace(/\.md$/, '.ko.md'));
  for (const named of paths ?? []) if (!twins.includes(named)) failed.push(`${named} is no Korean twin of ${CONFIG}`);
  for (const english of documentsOf(root, config)) {
    const korean = english.replace(/\.md$/, '.ko.md');
    if (paths !== undefined && !paths.includes(korean)) continue;
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
    else if (after !== before && paths === undefined) moved.push(korean);
    else if (after !== before) {
      writeAtomic(path.join(root, korean), after);
      changed.push(korean);
    }
  }
  return { changed, moved, failed };
}

if (isMain(import.meta.url)) {
  if (!existsSync(path.join(repositoryRoot(), CONFIG))) {
    console.error(`[documents-stamp] ${CONFIG} does not exist`);
    process.exit(1);
  }
  const paths = process.argv.slice(2);
  const { changed, moved, failed } = stampAll(repositoryRoot(), readConfig<DocumentsConfig>(repositoryRoot(), CONFIG, 'documents.schema.json'), paths.length > 0 ? paths : undefined);
  for (const file of changed) console.log(`[documents-stamp] stamped ${file}`);
  for (const file of moved) console.log(`[documents-stamp] ${file}: its source moved; after re-translating it, run make documents-stamp PATHS=${file}`);
  for (const line of failed) console.error(`[documents-stamp] ${line}`);
  console.log(`[documents-stamp] ${changed.length} stamped, ${moved.length} moved and not named, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
