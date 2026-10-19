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
export function parseScript(file: string, text: string): { program: ScriptNode; comments: { value: string; start: number }[] } {
  const result = parseSync(file, text);
  const [error] = result.errors;
  if (error) throw new Error(`${file}: ${error.message}`);
  const program: unknown = result.program;
  if (!isNode(program)) throw new Error(`${file}: the parser gave no program`);
  return { program, comments: result.comments.map(comment => ({ value: comment.value, start: comment.start })) };
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

/** The text of a string literal or a template literal, or undefined for another node. */
export function stringText(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && Array.isArray(node.quasis)) {
    return node.quasis.map(quasi => (isJsonObject(quasi) && isJsonObject(quasi.value) && typeof quasi.value.raw === 'string' ? quasi.value.raw : '')).join('');
  }
  return undefined;
}
