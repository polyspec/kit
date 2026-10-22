// Tests of scripts/kit/markdown.mts: Markdown is read as CommonMark with GFM and YAML front matter, so a fence, a link and
// a heading are what GitHub and VitePress render, and a heading anchor is the slug that each of them writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { anchors, headingAnchors, lineBlocks, links, proseLines, scanFences, withoutInlineCode } from '../../scripts/kit/markdown.mts';

test('a setext heading has an anchor, as GitHub renders it', () => {
  assert.deepEqual(headingAnchors('The title\n=========\n\nText\n'), ['the-title']);
});

test('the anchor of a heading is the slug of its rendered text: HTML tags are no text, an escaped # is a #', () => {
  assert.deepEqual(headingAnchors('## a <b>c</b>\n\n## Count the \\#\n\n## Uses `code` and *emphasis*\n'), ['a-c', 'count-the-', 'uses-code-and-emphasis']);
});

test('repeated headings are numbered, and on a site a heading has its VitePress slug or its {#id}', () => {
  assert.deepEqual(headingAnchors('## Setup\n\n## Setup\n'), ['setup', 'setup-1']);
  assert.deepEqual(headingAnchors('## 1. Setup\n\n## Own {#custom}\n', { site: true }), ['1-setup', '_1-setup', 'own', 'custom']);
});

test('YAML front matter is no heading and no prose', () => {
  const text = '---\ntitle: Page not found\naside: false\n---\n\n# Missing\n';
  assert.deepEqual(headingAnchors(text), ['missing']);
  assert.deepEqual(proseLines(text).filter(line => line.text.trim()).map(line => line.line), [6]);
});

test('a fence indented by four spaces is an indented code block, not a fence', () => {
  assert.deepEqual(scanFences('    ```\n    code\n    ```\n').blocks, []);
});

test('fenced blocks have their info string, content and line, and a fence that never closes is reported', () => {
  const text = 'Text\n\n```sh title\nmake check\n```\n\n~~~\nplain\n';
  const { blocks, fenced, unclosed } = scanFences(text);
  assert.deepEqual(blocks, [{ info: 'sh title', body: 'make check', line: 3 }, { info: '', body: 'plain', line: 7 }]);
  assert.deepEqual(fenced, [false, false, true, true, true, false, true, true, true]);
  assert.equal(unclosed, 7);
});

test('a link whose text holds brackets is a link', () => {
  assert.deepEqual(links('See [a [b] c](x.md).\n'), { links: [{ target: 'x.md', line: 1, column: 5 }], problems: [] });
});

test('links, images, definitions and autolinks are read with their place; a bare URL and code are no link', () => {
  const text = 'A [x](a.md) ![i](i.png) <https://example.org> and https://bare.example.org `[c](c.md)`.\n\n[ref][one]\n\n[one]: b.md\n';
  assert.deepEqual(links(text).links, [
    { target: 'a.md', line: 1, column: 3 },
    { target: 'i.png', line: 1, column: 13 },
    { target: 'https://example.org', line: 1, column: 25 },
    { target: 'b.md', line: 5, column: 1 },
  ]);
  assert.deepEqual(links('See <a href="c.md">c</a>.\n').links, [{ target: 'c.md', line: 1, column: 8 }]);
});

test('a reference without a definition and an inline link that is not well formed are problems', () => {
  assert.deepEqual(links('[other][two]\n\nSee [x] (a.md) and [y](a b.md).\n').problems, [
    { line: 1, column: 1, message: 'the reference link [other][two] has no definition [two]: <target>' },
    { line: 3, column: 22, message: 'the inline link is not well formed; write [text](target) with no space and balanced parentheses' },
  ]);
});

test('explicit anchors are the a elements with an id or a name, in a block or inline', () => {
  assert.deepEqual(anchors('<a id="one"></a>\n\nText <a name="two"></a> more.\n\n`<a id="code"></a>`\n'), ['one', 'two']);
});

test('inline code is blanked in its place', () => {
  assert.equal(withoutInlineCode('a `b` c ``d ` e`` f'), 'a     c           f');
});

// K510: the lines of one text are read once. The push gate reads the checklists of every pushed commit, and most commits hold the same
// checklist text, so a second read of a text returns the blocks of the first instead of parsing the Markdown again.
test('the blocks of a text are read once and a second read of the same text returns them (K510)', () => {
  const text = '| ID | Task | State |\n|---|---|---|\n| T1 | Write the parser | [ ] |\n';
  const first = lineBlocks(text);
  assert.equal(lineBlocks(text), first, 'the same text returns the same blocks');
  assert.notEqual(lineBlocks(`${text}| T2 | Add the reader | [ ] |\n`), first, 'another text is read on its own');
});
