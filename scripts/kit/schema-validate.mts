// The validation of a configuration against its JSON Schema (draft 2020-12) by ajv, in strict mode with every error. A schema
// that strict mode refuses (an unknown keyword, an invalid value of a keyword) throws, so a schema never passes unchecked.
// `kit-check` validates config/<name>.json against scripts/kit/schema/<name>.schema.json.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { readJson } from './bootstrap/files.mts';

/** The directory of the schemas of kit. */
export const SCHEMAS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema');

/** A JSON Schema of draft 2020-12. */
export type Schema = Record<string, unknown>;

const ajv = new Ajv2020({ strict: true, allErrors: true, verbose: true });

/**
 * One error of ajv as a line: the JSON Pointer of the value (`/` for the whole document), the message of ajv and its
 * params, which name the key of an additional or required property; the value follows when it is not an object or array.
 */
function errorLine(error: ErrorObject): string {
  const value = error.data === null || typeof error.data !== 'object' ? `, value ${JSON.stringify(error.data)}` : '';
  return `${error.instancePath || '/'} ${error.message} ${JSON.stringify(error.params)}${value}`;
}

/** A configuration file of the repository that a tool needs and does not find; a tool reports its message without a stack (K146). */
export class ConfigError extends Error {}

/** The errors of `value` against `schema`, one line each; throws for a schema that ajv refuses. */
export function validate(value: unknown, schema: Schema): string[] {
  const check = ajv.compile(schema);
  return check(value) ? [] : (check.errors ?? []).map(errorLine);
}

/** The JSON value of the file `file` of `root` and its errors, each prefixed with `file`, against the schema `schema` (a file name in SCHEMAS). */
// Config is the shape that the schema declares; it holds only when errors is empty.
export function readConfig<Config = unknown>(root: string, file: string, schema: string): { value: Config; errors: string[] } {
  if (!existsSync(path.join(root, file))) throw new ConfigError(`${file} is missing; the repository declares it (schema ${schema} of kit)`);
  const value = readJson(root, file) as Config;
  // A schema file of kit is a JSON object; validate throws for a schema that ajv refuses.
  const rules = readJson(SCHEMAS, schema) as Schema;
  return { value, errors: validate(value, rules).map(error => `${file}: ${error}`) };
}
