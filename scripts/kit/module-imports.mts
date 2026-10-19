// The imports of a JavaScript or TypeScript module, read as Node.js reads it: amaro (the TypeScript remover of Node.js, in
// transform mode) turns TypeScript into JavaScript, acorn parses it, and acorn-walk finds the import and export
// declarations with a source, the dynamic imports and the calls of require. The editor boundaries (check-editor-boundaries)
// and the import graph of owner-check read modules through it; the graph also follows the modules that a module starts
// rather than imports (moduleReferences).
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse, type Program } from 'acorn';
import { simple } from 'acorn-walk';
import { transformSync } from 'amaro';
import { isJsonObject } from './bootstrap/files.mts';

const TYPESCRIPT = /\.[cm]?ts$/;
const COMMONJS = /\.c[jt]s$/;
// A relative import of TypeScript names the JavaScript file that the compiler writes.
const COMPILED: Record<string, string> = { '.js': '.ts', '.mjs': '.mts', '.cjs': '.cts' };

/** An import of a module: its specifier, or null for a computed one. */
export type Import = string | null;

/**
 * The program of the JavaScript or TypeScript `text` of `file`, as acorn parses it; a CommonJS file is a script. The mode
 * strip-only of amaro replaces the types with blanks, so a position of the program is that of `text`; it fails on the
 * TypeScript that needs a transform, such as an enum.
 */
export function parseModule(file: string, text: string, mode: 'transform' | 'strip-only' = 'transform'): Program {
  try {
    const code = TYPESCRIPT.test(file) ? transformSync(text, { mode, filename: file }).code : text;
    return parse(code, { ecmaVersion: 'latest', sourceType: COMMONJS.test(file) ? 'script' : 'module', ranges: true });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/** The imports of the `program` of `file`: static imports, re-exports, dynamic imports and calls of require. */
export function moduleImports(file: string, program: Program): Import[] {
  const imports: Import[] = [];
  const source = (node: { source?: unknown }) => {
    // The source of an import or an export from another module is a string literal.
    const value = isJsonObject(node.source) ? node.source.value : undefined;
    if (typeof value !== 'string') throw new Error(`${file}: an import names no string source`);
    imports.push(value);
  };
  simple(program, {
    ImportDeclaration: source,
    ExportAllDeclaration: source,
    ExportNamedDeclaration(node) { if (node.source) source(node); },
    ImportExpression(node) { imports.push(node.source.type === 'Literal' && typeof node.source.value === 'string' ? node.source.value : null); },
    CallExpression(node) {
      const [argument] = node.arguments;
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require' || !argument) return;
      imports.push(argument.type === 'Literal' && typeof argument.value === 'string' ? argument.value : null);
    },
  });
  return imports;
}

/**
 * The modules that the `program` of `file` names to start rather than import, each as a specifier: the literal argument of
 * `import.meta.resolve`, the module resolution of Node.js, and the tool of `siblingTool(import.meta.url, '<name>')` of
 * paths.mts, the file `<name>` beside the module with its extension.
 */
export function moduleReferences(file: string, program: Program): string[] {
  const references: string[] = [];
  const isImportMeta = (node: unknown, property: string) =>
    isJsonObject(node) && node.type === 'MemberExpression' && isJsonObject(node.object) && node.object.type === 'MetaProperty'
    && isJsonObject(node.property) && node.property.type === 'Identifier' && node.property.name === property;
  simple(program, {
    CallExpression(node) {
      const [first, second] = node.arguments;
      if (isImportMeta(node.callee, 'resolve') && first?.type === 'Literal' && typeof first.value === 'string') references.push(first.value);
      if (node.callee.type === 'Identifier' && node.callee.name === 'siblingTool' && isImportMeta(first, 'url') && second?.type === 'Literal' && typeof second.value === 'string') {
        references.push(`./${second.value}${path.extname(file)}`);
      }
    },
  });
  return references;
}

/** The file of the relative `specifier` of `from`: the named file, or the TypeScript file of a named JavaScript file. */
export function resolveRelative(from: string, specifier: string): string | null {
  const named = path.resolve(path.dirname(from), specifier);
  if (existsSync(named) && statSync(named).isFile()) return named;
  const extension = path.extname(named);
  const compiled = COMPILED[extension];
  if (compiled === undefined) return null;
  const typescript = `${named.slice(0, -extension.length)}${compiled}`;
  return existsSync(typescript) ? typescript : null;
}
