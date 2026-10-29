// Tests of scripts/kit/documents-stamp.mts: the revision marker of the Korean documents is written from the English file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { check } from '../../scripts/kit/check-documents.mts';
import { stampAll, stamped } from '../../scripts/kit/documents-stamp.mts';
import { pair, put, tree } from './tree.mts';

const CONFIG = { schema: 1, include: ['**/*.md'] };

test('a stale marker is replaced and a missing marker follows the doc-id line, so the pair stays current', (t) => {
  const root = tree(t, { ...pair('a.md', 'alpha', 'body\n'), ...pair('b.md', 'beta', 'other\n') });
  put(root, {
    'a.md': '<!-- doc-id: alpha -->\n# Title\n\nchanged\n',
    'b.ko.md': '<!-- doc-id: beta -->\n# Title\n\nother\n',
  });
  const result = stampAll(root, CONFIG, ['a.ko.md', 'b.ko.md']);
  assert.deepEqual(result, { changed: ['a.ko.md', 'b.ko.md'], moved: [], failed: [] });
  assert.deepEqual(check(root, CONFIG).findings, []);
  assert.deepEqual(stampAll(root, CONFIG, ['a.ko.md', 'b.ko.md']), { changed: [], moved: [], failed: [] });
});

test('an English document without its Korean file fails and names the file, not a skipped pair', (t) => {
  const root = tree(t, { ...pair('a.md', 'alpha'), 'b.md': '<!-- doc-id: beta -->\n# Title\n' });
  assert.deepEqual(stampAll(root, CONFIG), { changed: [], moved: [], failed: ['b.ko.md is missing; translate b.md into it'] });
  put(root, { 'b.md': null, 'c.ko.md': '<!-- doc-id: gamma -->\n# Title\n' });
  assert.deepEqual(stampAll(root, CONFIG).failed, ['c.md is missing; it is the source of c.ko.md']);
});

test('a Korean file without a doc-id line fails and is not changed; a marker in a code block is not the marker', (t) => {
  const root = tree(t, pair('a.md', 'alpha'));
  put(root, { 'a.ko.md': '# Title\n' });
  assert.deepEqual(stampAll(root, CONFIG, ['a.ko.md']), { changed: [], moved: [], failed: ['a.ko.md has no <!-- doc-id: ... --> line; add the doc-id of the English file first'] });
  assert.equal(readFileSync(path.join(root, 'a.ko.md'), 'utf8'), '# Title\n');
  const text = '<!-- doc-id: x -->\n```\n<!-- source-sha256: old -->\n```\n';
  assert.equal(stamped(text, 'new'), '<!-- doc-id: x -->\n<!-- source-sha256: new -->\n```\n<!-- source-sha256: old -->\n```\n');
});

test('the stamp writes only the marker line after the doc-id line; a marker example in the body stays byte-identical (K818)', () => {
  const body = '# Title\n\nWrite `<!-- source-sha256: <sha> -->` after the doc-id line:\n\n<!-- source-sha256: example -->\n';
  const current = `<!-- doc-id: x -->\n<!-- source-sha256: new -->\n${body}`;
  assert.equal(stamped(`<!-- doc-id: x -->\n${body}`, 'new'), current);
  assert.equal(stamped(`<!-- doc-id: x -->\n<!-- source-sha256: old -->\n${body}`, 'new'), current);
});

// K877: a stamp says that a twin matches its source, so only the twins that PATHS names are stamped; with no PATHS nothing is stamped
// and each twin whose source moved is listed, so a twin that nobody re-translated keeps the marker of the source it was made from.
test('documents-stamp stamps only the twins that PATHS names, and with no PATHS lists the moved twins and stamps none (K877)', (t) => {
  const root = tree(t, { ...pair('a.md', 'alpha', 'body\n'), ...pair('b.md', 'beta', 'other\n') });
  put(root, { 'a.md': '<!-- doc-id: alpha -->\n# Title\n\nchanged\n', 'a.ko.md': '<!-- doc-id: alpha -->\n# Title\n\nchanged ko\n', 'b.md': '<!-- doc-id: beta -->\n# Title\n\nmoved\n' });
  const before = readFileSync(path.join(root, 'b.ko.md'), 'utf8');
  assert.deepEqual(stampAll(root, CONFIG), { changed: [], moved: ['a.ko.md', 'b.ko.md'], failed: [] });
  assert.deepEqual(stampAll(root, CONFIG, ['a.ko.md']), { changed: ['a.ko.md'], moved: [], failed: [] });
  assert.equal(readFileSync(path.join(root, 'b.ko.md'), 'utf8'), before, 'the twin that PATHS does not name keeps its marker');
  assert.deepEqual(stampAll(root, CONFIG), { changed: [], moved: ['b.ko.md'], failed: [] });
  assert.deepEqual(stampAll(root, CONFIG, ['c.ko.md']).failed, ['c.ko.md is no Korean twin of config/documents.json']);
});
