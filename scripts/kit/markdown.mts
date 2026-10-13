// Reading Markdown for the document checks: fenced code blocks, prose without code, links with their line and column,
// explicit anchors and heading anchors. The text is read as CommonMark with GFM and YAML front matter by
// mdast-util-from-markdown (micromark), so a fence, a link and a heading are what GitHub and VitePress render; a heading
// anchor is the slug of github-slugger (GitHub) and of @mdit-vue/shared (VitePress). Lines and columns count from 1.
import { slugify } from '@mdit-vue/shared';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toString } from 'mdast-util-to-string';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { visit } from 'unist-util-visit';

/** A fenced code block: its info string, its content and the line of its opening fence. */
export type FenceBlock = { info: string; body: string; line: number };

/** A link target of the prose and where it stands. */
export type LinkTarget = { target: string; line: number; column: number };

/** A link that is not well formed or has no definition. */
export type LinkProblem = { line: number; column: number; message: string };

/** The syntax tree of `text`: CommonMark with GFM and YAML front matter. */
const parse = (text: string) => fromMarkdown(text, { extensions: [gfm(), frontmatter()], mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown()] });

/** A node as the parser writes it: every node of a parsed text has its position. */
type Placed = { position?: { start: { line: number; column: number; offset?: number | undefined }; end: { line: number; column: number; offset?: number | undefined } } | undefined };

/** The start and end offsets and the lines of `node`. */
function placeOf(node: Placed): { start: number; end: number; startLine: number; endLine: number; column: number } {
  // fromMarkdown writes the position, with its offsets, on every node of the tree it returns.
  const { start, end } = node.position!;
  return { start: start.offset!, end: end.offset!, startLine: start.line, endLine: end.line, column: start.column };
}

/** The line and column of the offset `offset` of `text`. */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split('\n');
  // split returns at least one part.
  return { line: before.length, column: before.at(-1)!.length + 1 };
}

const OPENING = /^(`{3,}|~{3,})/;

/**
 * The fenced code blocks of `text`: `{ info, body, line }` with the info string, the content and the line of the opening
 * fence; `fenced[i]` is true for each line (0-based) that is a fence line or lies inside a block; `unclosed` is the line of
 * a fence that never closes, or null. An indented code block is no fenced block.
 */
export function scanFences(text: string): { blocks: FenceBlock[]; fenced: boolean[]; unclosed: number | null } {
  const lines = text.split('\n');
  const fenced = lines.map(() => false);
  const blocks: FenceBlock[] = [];
  let unclosed: number | null = null;
  visit(parse(text), 'code', (node) => {
    const place = placeOf(node);
    const opening = OPENING.exec(text.slice(place.start));
    if (!opening) return;
    for (let line = place.startLine; line <= place.endLine; line += 1) fenced[line - 1] = true;
    blocks.push({ info: [node.lang, node.meta].filter(Boolean).join(' '), body: node.value, line: place.startLine });
    // A block that never closes runs to the end of its container; a closed block ends with its closing fence. The group of
    // OPENING always takes part in a match, and the end line exists.
    const fence = opening[1]!;
    const closing = new RegExp(`^[\\s>]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
    if (unclosed === null && (place.endLine === place.startLine || !closing.test(lines[place.endLine - 1]!))) unclosed = place.startLine;
  });
  return { blocks, fenced, unclosed };
}

/** `text` with the inline code spans of `tree` replaced by spaces, so that lines and columns keep their place. */
function blankInlineCode(text: string, tree: ReturnType<typeof parse>): string {
  let result = text;
  visit(tree, 'inlineCode', (node) => {
    const { start, end } = placeOf(node);
    result = result.slice(0, start) + result.slice(start, end).replace(/[^\n]/g, ' ') + result.slice(end);
  });
  return result;
}

/** `line` with each inline code span replaced by spaces, so that columns keep their place. */
export function withoutInlineCode(line: string): string {
  return blankInlineCode(line, parse(line));
}

/** The prose lines of `text` as `{ line, text }`: outside fenced blocks and front matter, inline code blanked. */
export function proseLines(text: string): { line: number; text: string }[] {
  const tree = parse(text);
  const { fenced } = scanFences(text);
  visit(tree, 'yaml', (node) => {
    const place = placeOf(node);
    for (let line = place.startLine; line <= place.endLine; line += 1) fenced[line - 1] = true;
  });
  return blankInlineCode(text, tree).split('\n').flatMap((line, index) => (fenced[index] ? [] : [{ line: index + 1, text: line }]));
}

const UNDEFINED_REFERENCE = /(?<!\\)\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
const BROKEN_INLINE = /(?<!\\)\]\(/;

/**
 * The link targets of `text`: `{ target, line, column }` for links, images, reference definitions, autolinks and the
 * `href` of HTML elements, at the start of each; a bare URL (the GFM autolink literal) is no link. `problems` holds a
 * reference link without a definition and an inline link that is not well formed, which the parser leaves as text.
 */
export function links(text: string): { links: LinkTarget[]; problems: LinkProblem[] } {
  const found: LinkTarget[] = [];
  const problems: LinkProblem[] = [];
  const tree = parse(text);
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return;
    const place = placeOf(node);
    // A link written as a bare URL starts with neither [ nor <.
    if (node.type === 'link' && !'[<'.includes(text[place.start] ?? '')) return;
    found.push({ target: node.url, line: place.startLine, column: place.column });
  });
  // An href of an HTML element is a link that GitHub and VitePress render.
  visit(tree, 'html', (node) => {
    const place = placeOf(node);
    for (const match of node.value.matchAll(/\bhref="([^"]+)"/g)) found.push({ target: match[1]!, ...lineColumn(text, place.start + match.index) }); // The group always takes part in a match.
  });
  visit(tree, 'text', (node) => {
    const place = placeOf(node);
    const source = text.slice(place.start, place.end);
    for (const match of source.matchAll(UNDEFINED_REFERENCE)) {
      // Both groups always take part in a match.
      const identifier = (match[2] || match[1]!).toLowerCase();
      problems.push({ ...lineColumn(text, place.start + match.index), message: `the reference link [${match[1]}][${match[2]}] has no definition [${identifier}]: <target>` });
    }
    const broken = BROKEN_INLINE.exec(source);
    if (broken) problems.push({ ...lineColumn(text, place.start + broken.index), message: 'the inline link is not well formed; write [text](target) with no space and balanced parentheses' });
  });
  return { links: found, problems };
}

/** The explicit anchors of `text`, the HTML elements `<a id="x">` and `<a name="x">`, in order. */
export function anchors(text: string): string[] {
  const found: string[] = [];
  visit(parse(text), 'html', (node) => {
    for (const match of node.value.matchAll(/<a\s+(?:id|name)="([A-Za-z0-9][\w.-]*)"\s*>/g)) found.push(match[1]!); // The group always takes part in a match.
  });
  return found;
}

/**
 * The heading anchors of `text` as GitHub writes them (github-slugger, repeats numbered). With `site` (a VitePress site) a
 * heading also has its VitePress slug (@mdit-vue/shared), and a heading that ends with `{#id}` has that id instead.
 */
export function headingAnchors(text: string, { site = false }: { site?: boolean | undefined } = {}): string[] {
  const github = new GithubSlugger();
  const seenSite = new Map<string, number>();
  const result: string[] = [];
  visit(parse(text), 'heading', (node) => {
    const title = toString(node, { includeHtml: false });
    const custom = site ? /\s*\{#([^}\s]+)\}$/.exec(title) : null;
    const plain = custom ? title.slice(0, custom.index) : title;
    result.push(github.slug(plain));
    if (custom) result.push(custom[1]!.toLowerCase()); // The group always takes part in a match.
    else if (site) {
      const base = slugify(plain);
      const count = seenSite.get(base) ?? 0;
      seenSite.set(base, count + 1);
      result.push(count ? `${base}-${count}` : base);
    }
  });
  return result;
}

/**
 * A heading of the top level of a document: its depth, its title as text, its first and last line, and the HTML of the
 * block right before it (such as an anchor `<a id="x"></a>`, an HTML block or a paragraph of inline HTML only), or null when
 * the block before it is no HTML.
 */
export type Heading = { depth: number; title: string; line: number; endLine: number; htmlBefore: string | null };

/** The headings of the top level of `text` in order, ATX and setext; a `#` line in a fenced block or an HTML block is none. */
export function headings(text: string): Heading[] {
  const blocks = parse(text).children;
  return blocks.flatMap((node, index) => {
    if (node.type !== 'heading') return [];
    const before = blocks[index - 1];
    const place = placeOf(node);
    // `<a id="x"></a>` on its own line is a paragraph of inline HTML: an HTML block of CommonMark starts with an open tag only.
    const html = before?.type === 'html' || (before?.type === 'paragraph' && before.children.every(child => child.type === 'html'));
    return [{ depth: node.depth, title: toString(node, { includeHtml: false }).trim(), line: place.startLine, endLine: place.endLine, htmlBefore: before && html ? text.slice(placeOf(before).start, placeOf(before).end) : null }];
  });
}

/** A cell of a table row: its source between the pipes, untrimmed, and the column (0-based) of the line at which it begins. */
export type LineCell = { text: string; start: number };

/**
 * What a line of a document is, as the Markdown tree reads it: blank, a heading, HTML, a table header row, a delimiter row,
 * a body row with its cells, the first line of a list item, a further line of a list item, or another block (a paragraph,
 * code, a quote).
 */
export type LineBlock =
  | { kind: 'blank' | 'heading' | 'html' | 'tableHeader' | 'tableDelimiter' | 'listItem' | 'listContinuation' | 'other' }
  | { kind: 'tableRow'; cells: LineCell[] };

/** The block of each line of `text` (index 0 is line 1); a nested list item has its own first line. */
export function lineBlocks(text: string): LineBlock[] {
  const lines = text.split('\n');
  const blocks: LineBlock[] = lines.map(line => ({ kind: line.trim() === '' ? 'blank' : 'other' }));
  const mark = (from: number, to: number, block: LineBlock) => {
    for (let line = from; line <= to; line += 1) if (blocks[line - 1]?.kind !== 'blank') blocks[line - 1] = block;
  };
  const tree = parse(text);
  visit(tree, 'listItem', (item) => {
    const place = placeOf(item);
    mark(place.startLine + 1, place.endLine, { kind: 'listContinuation' });
  });
  visit(tree, 'listItem', (item) => {
    blocks[placeOf(item).startLine - 1] = { kind: 'listItem' };
  });
  visit(tree, (node) => {
    if (node.type === 'heading') mark(placeOf(node).startLine, placeOf(node).endLine, { kind: 'heading' });
    if (node.type === 'html') mark(placeOf(node).startLine, placeOf(node).endLine, { kind: 'html' });
  });
  visit(tree, 'table', (table) => {
    const place = placeOf(table);
    mark(place.startLine, place.endLine, { kind: 'tableDelimiter' });
    table.children.forEach((row, index) => {
      const line = placeOf(row).startLine;
      if (index === 0) {
        blocks[line - 1] = { kind: 'tableHeader' };
        return;
      }
      const cells = row.children.map((cell, cellIndex) => {
        const at = placeOf(cell);
        let start = at.start;
        let end = at.end;
        let column = at.column - 1;
        if (text[start] === '|') { start += 1; column += 1; }
        if (cellIndex === row.children.length - 1 && end > start && text[end - 1] === '|') end -= 1;
        return { text: text.slice(start, end), start: column };
      });
      blocks[line - 1] = { kind: 'tableRow', cells };
    });
  });
  return blocks;
}
