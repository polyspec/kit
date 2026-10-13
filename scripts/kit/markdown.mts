// Reading Markdown for the document checks: fenced code blocks, prose without code, links with their line and
// column, explicit anchors and heading anchors. Lines and columns count from 1, the column in characters.

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/** A fenced code block: its info string, its content and the line of its opening fence. */
export type FenceBlock = { info: string; body: string; line: number };

/** A link target of the prose and where it stands. */
export type LinkTarget = { target: string; line: number; column: number };

/** A link that is not well formed or has no definition. */
export type LinkProblem = { line: number; column: number; message: string };

type OpenFence = { fence: string; info: string; body: string[]; line: number };

/**
 * The fenced code blocks of `text`: `{ info, body, line }` with the info string, the content and the line of the opening
 * fence; `fenced[i]` is true for each line (0-based) that is a fence line or lies inside a block; `unclosed` is the line of
 * a fence that never closes, or null.
 */
export function scanFences(text: string): { blocks: FenceBlock[]; fenced: boolean[]; unclosed: number | null } {
  const lines = text.split('\n');
  const fenced = lines.map(() => false);
  const blocks: FenceBlock[] = [];
  // The callback below assigns it; without the wider type TypeScript would keep it null after the forEach.
  let open = null as OpenFence | null;
  lines.forEach((line, index) => {
    const marker = FENCE.exec(line);
    if (open) {
      fenced[index] = true;
      // Both groups of FENCE always take part in a match.
      if (marker && marker[1]![0] === open.fence[0] && marker[1]!.length >= open.fence.length && marker[2]!.trim() === '') {
        blocks.push({ info: open.info, body: open.body.join('\n'), line: open.line });
        open = null;
      } else open.body.push(line);
    } else if (marker) {
      fenced[index] = true;
      // Both groups of FENCE always take part in a match.
      open = { fence: marker[1]!, info: marker[2]!.trim(), body: [], line: index + 1 };
    }
  });
  return { blocks, fenced, unclosed: open ? open.line : null };
}

/** `line` with each inline code span replaced by spaces, so that columns keep their place. */
export function withoutInlineCode(line: string): string {
  return line.replace(/(`+)[^`]*?\1/g, span => ' '.repeat(span.length));
}

/** The prose lines of `text` as `{ line, text }`: outside fenced blocks, inline code blanked. */
export function proseLines(text: string): { line: number; text: string }[] {
  const { fenced } = scanFences(text);
  return text.split('\n').flatMap((line, index) => (fenced[index] ? [] : [{ line: index + 1, text: withoutInlineCode(line) }]));
}

const INLINE_LINK = /!?\[[^\]\n]*\]\((<[^>\n]+>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"]*")?\)/g;
const DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/;

/**
 * The link targets of the prose of `text`: `{ target, line, column }` for inline links and images, reference definitions,
 * autolinks and `href` attributes, and `problems` for a reference link without a definition and for an inline link that is
 * not well formed.
 */
export function links(text: string): { links: LinkTarget[]; problems: LinkProblem[] } {
  const found: LinkTarget[] = [];
  const problems: LinkProblem[] = [];
  const prose = proseLines(text);
  const definitions = new Set<string>();
  for (const { line, text: content } of prose) {
    const definition = DEFINITION.exec(content);
    if (definition) {
      // Both groups of DEFINITION always take part in a match.
      definitions.add(definition[1]!.toLowerCase());
      // Both groups of DEFINITION always take part in a match.
      found.push({ target: definition[2]!.replace(/^<|>$/g, ''), line, column: content.indexOf(definition[2]!) + 1 });
    }
  }
  for (const { line, text: content } of prose) {
    for (const match of content.matchAll(INLINE_LINK)) {
      // The group of INLINE_LINK always takes part in a match.
      found.push({ target: match[1]!.replace(/^<|>$/g, ''), line, column: match.index + match[0].indexOf('(') + 2 });
    }
    // The group always takes part in a match.
    for (const match of content.matchAll(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g)) found.push({ target: match[1]!, line, column: match.index + 2 });
    // The group always takes part in a match.
    for (const match of content.matchAll(/\bhref="([^"]+)"/g)) found.push({ target: match[1]!, line, column: match.index + 7 });
    for (const match of content.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      // Both groups always take part in a match.
      const identifier = (match[2] || match[1]!).toLowerCase();
      if (!definitions.has(identifier)) problems.push({ line, column: match.index + 1, message: `the reference link [${match[1]}][${match[2]}] has no definition [${identifier}]: <target>` });
    }
    const rest = content.replace(INLINE_LINK, ' ');
    const broken = rest.indexOf('](');
    if (broken !== -1) problems.push({ line, column: broken + 1, message: 'the inline link is not well formed; write [text](target) with no space and balanced parentheses' });
  }
  return { links: found, problems };
}

/** The explicit anchors `<a id="x"></a>` of the prose of `text`, in order. */
export function anchors(text: string): string[] {
  const found: string[] = [];
  for (const { text: content } of proseLines(text)) {
    for (const match of content.matchAll(/<a\s+(?:id|name)="([A-Za-z0-9][\w.-]*)"\s*>\s*<\/a>/g)) found.push(match[1]!); // The group always takes part in a match.
  }
  return found;
}

// The slug of VitePress (markdown-it-anchor): combining marks and control characters removed, each run of separators and
// punctuation one hyphen, a leading digit prefixed with an underscore.
const vitepressSlug = (text: string): string => text.normalize('NFKD').replace(/[\u0300-\u036F]/g, '').replace(/[\u0000-\u001f]/g, '')
  .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'\u201c\u201d\u2018\u2019<>,.?/]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, '_$1').toLowerCase();

/**
 * The heading anchors of `text` as GitHub writes them: lower case, punctuation removed, spaces as hyphens, repeats numbered.
 * With `site` (a VitePress site) a heading also has its VitePress slug, and a heading that ends with `{#id}` has that id.
 */
export function headingAnchors(text: string, { site = false }: { site?: boolean | undefined } = {}): string[] {
  const { fenced } = scanFences(text);
  const seen = new Map<string, number>();
  const seenSite = new Map<string, number>();
  const result: string[] = [];
  const numbered = (counts: Map<string, number>, base: string): string => {
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
  text.split('\n').forEach((line, index) => {
    const heading = fenced[index] ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) return;
    // The group always takes part in a match.
    const custom = site ? /\s*\{#([^}\s]+)\}$/.exec(heading[1]!) : null;
    const title = custom ? heading[1]!.slice(0, custom.index) : heading[1]!; // The group always takes part in a match.
    const plain = title.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replaceAll('`', '');
    result.push(numbered(seen, plain.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-')));
    if (custom) result.push(custom[1]!.toLowerCase()); // The group always takes part in a match.
    else if (site) result.push(numbered(seenSite, vitepressSlug(plain)));
  });
  return result;
}

/** The cells of a table row split on `|` that is not escaped, with the column (0-based) at which each begins. */
export function tableCells(line: string): { text: string; start: number }[] {
  const result: { text: string; start: number }[] = [];
  let start = line.indexOf('|') + 1;
  for (let index = start; index < line.length; index += 1) {
    if (line[index] === '|' && line[index - 1] !== '\\') {
      result.push({ text: line.slice(start, index), start });
      start = index + 1;
    }
  }
  return line.trimEnd().endsWith('|') ? result : [...result, { text: line.slice(start), start }];
}
