// A validator for the JSON Schema keywords that the schemas of scripts/kit/schema use: type, required, properties,
// additionalProperties (false), items, enum, const, pattern, minItems, minLength and minimum. Other keywords fail the schema
// itself, so a schema never passes unchecked. `kit-check` validates config/<name>.json against
// scripts/kit/schema/<name>.schema.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './bootstrap/files.mts';

/** The directory of the schemas of kit. */
export const SCHEMAS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema');

const KEYWORDS = new Set(['$schema', 'title', 'description', 'type', 'required', 'properties', 'additionalProperties', 'items', 'enum', 'const', 'pattern', 'minItems', 'minLength', 'minimum']);

/** A JSON Schema; a keyword that kit does not support fails validate. */
export type Schema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  [keyword: string]: unknown;
};

const typeOf = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

/** The errors of `value` against `schema` at `where`, each a sentence naming the location, the rule and the values. */
export function validate(value: unknown, schema: Schema, where = '$'): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) throw new Error(`schema keyword ${key} at ${where} is not supported by kit`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!types.includes(actual) && !(types.includes('number') && actual === 'integer')) errors.push(`${where} is ${actual}, the schema requires ${types.join(' or ')}`);
    if (errors.length) return errors;
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${where} is ${JSON.stringify(value)}, the schema requires ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where} is ${JSON.stringify(value)}, the schema allows ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${where} is ${JSON.stringify(value)}, the schema requires a match of ${schema.pattern}`);
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) errors.push(`${where} is ${JSON.stringify(value)}, the schema requires at least ${schema.minLength} characters`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) errors.push(`${where} is ${value}, the schema requires at least ${schema.minimum}`);
  if (typeOf(value) === 'object') {
    // typeOf answers object only for an object that is neither null nor an array.
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in object)) errors.push(`${where} lacks ${key}, the schema requires it`);
    const properties = schema.properties ?? {};
    for (const key of Object.keys(object)) {
      // The key is in properties.
      if (key in properties) errors.push(...validate(object[key], properties[key]!, `${where}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${where}.${key} is not in the schema`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${where} has ${value.length} items, the schema requires at least ${schema.minItems}`);
    const { items } = schema;
    if (items) value.forEach((item, index) => errors.push(...validate(item, items, `${where}[${index}]`)));
  }
  return errors;
}

/** The JSON value of the file `file` of `root` and its errors, each prefixed with `file`, against the schema `schema` (a file name in SCHEMAS). */
// Config is the shape that the schema declares; it holds only when errors is empty. Its default is any because the callers in
// other groups name no shape yet.
export function readConfig<Config = any>(root: string, file: string, schema: string): { value: Config; errors: string[] } {
  const value = readJson(root, file);
  // A schema file of kit is an object of keywords; validate throws for a keyword that it does not support.
  const rules = readJson(SCHEMAS, schema) as Schema;
  return { value, errors: validate(value, rules).map(error => `${file}: ${error}`) };
}
