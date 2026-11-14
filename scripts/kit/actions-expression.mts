// The expressions of GitHub Actions (`${{ <expression> }}` and `if:`) for the local run of a CI job (`ci-job.mts`, K1228),
// parsed and evaluated by `@actions/expressions`, the expression package that GitHub publishes with its language services:
// its Lexer, Parser and Evaluator give the literals, the property access with the filter `.*`, the operators with the
// coercion of GitHub and the functions contains, startsWith, endsWith, format, join, toJSON, fromJSON and case. This module
// adds what the runner gives beside them: the status functions success, failure, always and cancelled with the status of
// the run, the contexts as plain values, the texts with `${{ }}` of a workflow, and the references of an expression to its
// contexts, which the run checks before any step runs.
import { data, Evaluator, Lexer, Parser, type Expr } from '@actions/expressions';
import { Binary, ContextAccess, FunctionCall, Grouping, IndexAccess, Literal, Logical, Star, Unary } from '@actions/expressions/ast';
import type { FunctionDefinition } from '@actions/expressions/funcs/info';
import { truthy as dataTruthy } from '@actions/expressions/result';

/** A value of an expression as plain data: what a context holds and what an expression gives. */
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

/** The status functions of the run: what success(), failure() and cancelled() give where the expression is evaluated. */
export type Status = { success: boolean; failure: boolean; cancelled: boolean };

const STATUS_NAMES = ['success', 'failure', 'always', 'cancelled'];
const STATUS_INFO = STATUS_NAMES.map(name => ({ name, minArgs: 0, maxArgs: 0 }));

/** The context names that the parser accepts; ci-job.mts refuses by name those that the run does not give. */
const CONTEXTS = ['github', 'needs', 'matrix', 'runner', 'env', 'steps', 'inputs', 'secrets', 'vars', 'job', 'strategy'];

/** Parses an expression, the text between `${{` and `}}`; throws the error of the parser for a syntax error or an unknown function or context. */
export function parseExpression(source: string): Expr {
  try {
    return new Parser(new Lexer(source).lex().tokens, CONTEXTS, STATUS_INFO).parse();
  } catch (error) {
    throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * A text of the workflow with its `${{ }}` expressions, in order. GitHub reads a text that is one `${{ }}` alone as that
 * expression, which keeps the kind of its value, and any other text as `format('<texts with {N}>', <expressions>)`; the
 * run joins the texts and the values written as texts, which is that format(), and does not pass its own texts through
 * the lexer of @actions/expressions 0.3.61, which turns only the first '' of a quoted text into a quote.
 */
export type Template = { text: string; parts: (string | Expr)[] };

/** The template of a text; throws for a `${{` without its `}}` and for an expression that does not parse. A `}}` inside a quoted text of an expression does not end it. */
export function parseTemplate(text: string): Template {
  const parts: (string | Expr)[] = [];
  let at = 0;
  for (;;) {
    const start = text.indexOf('${{', at);
    if (start < 0) break;
    if (start > at) parts.push(text.slice(at, start));
    let end = start + 3;
    let inQuote = false;
    while (end < text.length && (inQuote || !text.startsWith('}}', end))) {
      if (text[end] === "'") inQuote = !inQuote;
      end += 1;
    }
    if (end >= text.length) throw new Error(`${text} holds a \${{ without its closing }}`);
    parts.push(parseExpression(text.slice(start + 3, end).trim()));
    at = end + 2;
  }
  if (at < text.length) parts.push(text.slice(at));
  return { text, parts };
}

/** The value of a template: the value of its one expression, or the text that joins its pieces. */
export function evaluateTemplate(template: Template, contexts: Record<string, Value>, status?: Status): Value {
  const [first] = template.parts;
  if (template.parts.length === 1 && first !== undefined && typeof first !== 'string') return evaluate(first, contexts, status);
  return template.parts.map(part => (typeof part === 'string' ? part : toText(evaluate(part, contexts, status)))).join('');
}

function toData(value: Value): data.ExpressionData {
  if (value === null) return new data.Null();
  if (typeof value === 'boolean') return new data.BooleanData(value);
  if (typeof value === 'number') return new data.NumberData(value);
  if (typeof value === 'string') return new data.StringData(value);
  if (Array.isArray(value)) return new data.Array(...value.map(toData));
  return new data.Dictionary(...Object.entries(value).map(([key, item]) => ({ key, value: toData(item) })));
}

function fromData(value: data.ExpressionData): Value {
  if (value instanceof data.Null) return null;
  if (value instanceof data.BooleanData || value instanceof data.NumberData || value instanceof data.StringData) return value.value;
  if (value instanceof data.Array) return value.values().map(fromData);
  return Object.fromEntries(value.pairs().map(({ key, value: item }) => [key, fromData(item)]));
}

/** Evaluates `node` with the contexts by name and the status of the run. */
export function evaluate(node: Expr, contexts: Record<string, Value>, status: Status = { success: true, failure: false, cancelled: false }): Value {
  const results: Record<string, boolean> = {
    success: status.success && !status.cancelled, failure: status.failure && !status.cancelled, always: true, cancelled: status.cancelled,
  };
  const functions = new Map<string, FunctionDefinition>(STATUS_INFO.map(info => [info.name, { ...info, call: () => new data.BooleanData(results[info.name] ?? false) }]));
  const context = new data.Dictionary(...Object.entries(contexts).map(([key, item]) => ({ key, value: toData(item) })));
  return fromData(new Evaluator(node, context, functions).evaluate());
}

/** Whether a value is true in a condition, by the rule of GitHub. */
export function truthy(value: Value): boolean {
  return dataTruthy(toData(value));
}

/** A value as a text, as GitHub writes it into a text: null as '', an array as Array, an object as Object. */
export function toText(value: Value): string {
  return toData(value).coerceString();
}

function children(node: Expr): Expr[] {
  if (node instanceof Unary) return [node.expr];
  if (node instanceof Binary) return [node.left, node.right];
  if (node instanceof Logical || node instanceof FunctionCall) return node.args;
  if (node instanceof Grouping) return [node.group];
  if (node instanceof IndexAccess) return [node.expr, node.index];
  return [];
}

/** Whether the expression calls a status function; a condition without one holds only with success() (`success() && (...)`). */
export function callsStatus(node: Expr): boolean {
  if (node instanceof FunctionCall && STATUS_NAMES.includes(node.functionName.lexeme.toLowerCase())) return true;
  return children(node).some(callsStatus);
}

/**
 * A reference to a context: its name (lower case) and the property names that follow it while they are literal; `dynamic`
 * when a computed index or the filter `*` follows them.
 */
export type Reference = { path: string[]; dynamic: boolean };

/** The references to contexts of an expression. */
export function references(node: Expr): Reference[] {
  const result: Reference[] = [];
  const chain = (each: Expr): Reference | undefined => {
    if (each instanceof ContextAccess) return { path: [each.name.lexeme.toLowerCase()], dynamic: false };
    if (each instanceof IndexAccess) {
      const base = chain(each.expr);
      if (!(each.index instanceof Star)) walk(each.index);
      if (base === undefined || base.dynamic) return base;
      const key = each.index instanceof Literal ? fromData(each.index.literal) : undefined;
      if (typeof key === 'string' || typeof key === 'number') return { path: [...base.path, String(key)], dynamic: false };
      return { path: base.path, dynamic: true };
    }
    walk(each);
    return undefined;
  };
  const walk = (each: Expr): void => {
    if (each instanceof ContextAccess || each instanceof IndexAccess) {
      const found = chain(each);
      if (found) result.push(found);
      return;
    }
    children(each).forEach(walk);
  };
  walk(node);
  return result;
}
