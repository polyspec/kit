// Helpers of the tests of the document, owner and commit checks: a temporary Git repository with the given files, and
// the Korean twin of an English document with its revision marker.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { initRepository } from './sandbox-repository.mts';

/** A temporary Git repository holding `files` ({ path: text }), removed with `t.after`. */
export function tree(t: Pick<TestContext, 'after'>, files: Record<string, string | null> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-tree-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initRepository(root);
  put(root, files);
  return root;
}

/** Writes `files` ({ path: text, or null to remove }) below `root`. */
export function put(root: string, files: Record<string, string | null>) {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, file);
    if (text === null) { rmSync(target, { force: true }); continue; }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

/** The English document with the doc-id `id` and `body`. */
export const english = (id: string, body = '') => `<!-- doc-id: ${id} -->\n# Title\n\n${body}`;

/** The Korean twin of `en`: the same doc-id, the revision of `en` and `body` (the body of `en` when omitted). */
export function korean(en: string, body?: string) {
  const marker = /<!-- doc-id: (.*?) -->/.exec(en);
  if (!marker) throw new Error(`korean: the English text has no doc-id marker: ${en}`);
  const id = marker[1];
  const hash = createHash('sha256').update(en).digest('hex');
  return `<!-- doc-id: ${id} -->\n<!-- source-sha256: ${hash} -->\n${body ?? en.split('\n').slice(1).join('\n')}`;
}

/** The two files of a document at `file` (an English path): `{ [file]: en, [file.ko.md]: ko }`. */
export function pair(file: string, id: string, body = '', koBody?: string): Record<string, string> {
  const en = english(id, body);
  return { [file]: en, [file.replace(/\.md$/, '.ko.md')]: korean(en, koBody ?? en.split('\n').slice(1).join('\n')) };
}
