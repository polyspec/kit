// The syntax tree of a script for the checks that read its code (language-check.mts, test-markers.mts, K268): oxc-parser
// reads JavaScript, TypeScript, JSX and TSX as they are, with their comments, so no type stripping changes the text first. The
// tree is ESTree with the nodes of TypeScript and JSX; walk visits every node by its `type`, whatever its kind.
import { parseSync } from 'oxc-parser';
import { isJsonObject } from './bootstrap/files.mts';

/** A node of the tree: its type, its offset in the text and its fields. */
export type ScriptNode = { type: string; start: number; [field: string]: unknown };

/** Whether `value` is a node of the tree. */
export const isNode = (value: unknown): value is ScriptNode => isJsonObject(value) && typeof value.type === 'string' && typeof value.start === 'number';

/** The program and the comments of the script `text` of `file`; throws with the file and the first error of the parser. */
export function parseScript(file: string, text: string): { program: ScriptNode; comments: { value: string; start: number; end: number }[] } {
  const result = parseSync(file, text);
  const [error] = result.errors;
  if (error) throw new Error(`${file}: ${error.message}`);
  const program: unknown = result.program;
  if (!isNode(program)) throw new Error(`${file}: the parser gave no program`);
  return { program, comments: result.comments.map(comment => ({ value: comment.value, start: comment.start, end: comment.end })) };
}

/** Calls `visit` for `node` and every node below it, in the order of the text. */
export function walk(node: ScriptNode, visit: (node: ScriptNode) => void): void {
  visit(node);
  for (const [field, value] of Object.entries(node)) {
    if (field === 'parent') continue;
    for (const child of Array.isArray(value) ? value : [value]) if (isNode(child)) walk(child, visit);
  }
}

/** The name of a callee: `name`, or `object.name` for a member, or the empty string for another node. */
export function calleeName(node: unknown): string {
  if (!isNode(node)) return '';
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  if (node.type === 'MemberExpression') return `${calleeName(node.object)}.${calleeName(node.property)}`;
  return '';
}

/** The text of a string literal or a backquoted literal, or undefined for another node. */
export function stringText(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && Array.isArray(node.quasis)) {
    return node.quasis.map(quasi => (isJsonObject(quasi) && isJsonObject(quasi.value) && typeof quasi.value.raw === 'string' ? quasi.value.raw : '')).join('');
  }
  return undefined;
}

/** A TypeScript or JavaScript file, JSX and TSX included: the files that its parser reads (K954). */
export const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

/**
 * The text of the script `text` of `file` with its string literals, template text, regular expressions and comments blanked
 * and its line breaks kept, so a check that matches a line matches code only: a command or a flag written inside a string is
 * data (K954).
 */
export function codeText(file: string, text: string): string {
  const { program, comments } = parseScript(file, text);
  // Each span keeps the delimiters that the code around it needs to parse: the quotes of a string, the slashes of a regex
  // and nothing of a comment or a template text. Only the characters between them are blanked, so the rest stays code.
  const spans: [number, number, (raw: string) => string][] = comments.map(comment => [comment.start, comment.end, raw => raw.replace(/[^\n]/g, ' ')]);
  walk(program, node => {
    const end = typeof node.end === 'number' ? node.end : node.start;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      spans.push([node.start, end, raw => raw[0] + raw.slice(1, -1).replace(/[^\n]/g, ' ') + raw.slice(-1)]);
    } else if (node.type === 'Literal' && node.regex !== undefined) {
      spans.push([node.start, end, raw => raw.slice(0, 1) + raw.slice(1, raw.lastIndexOf('/')).replace(/[^\n]/g, ' ') + raw.slice(raw.lastIndexOf('/'))]);
    } else if (node.type === 'TemplateElement') {
      spans.push([node.start, end, raw => raw.replace(/[^\n]/g, ' ')]);
    }
  });
  spans.sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end, blank] of spans) {
    if (start < cursor) continue;
    out += text.slice(cursor, start) + blank(text.slice(start, end));
    cursor = end;
  }
  return out + text.slice(cursor);
}
