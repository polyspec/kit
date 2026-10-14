// The validation of a configuration against its JSON Schema (draft 2020-12) by ajv, in strict mode with every error. A schema
// that strict mode refuses (an unknown keyword, an invalid value of a keyword) throws, so a schema never passes unchecked.
// `kit-check` validates config/<name>.json against scripts/kit/schema/<name>.schema.json.
//
// The JSON boundary of kit (K158): every JSON that a tool reads, a file or the output of a command, goes through readConfig
// or parseJson with a schema of scripts/kit/schema and the type T that the schema describes. ajv's type guard,
// `ajv.compile<T>(schema)` with its ValidateFunction<T>, gives the value its type only once the schema accepts it; data that
// breaks the schema throws a SchemaError that names the file or the command and each error of ajv (its JSON Pointer).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type SchemaObject, type ValidateFunction } from 'ajv/dist/2020.js';
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

/** JSON that breaks its schema: `lines` holds one line for each error of ajv, prefixed with the file or the command. */
export class SchemaError extends ConfigError {
  readonly lines: string[];
  constructor(lines: string[]) {
    super(lines.join('\n'));
    this.lines = lines;
  }
}

/** The errors of `value` against `schema`, one line each; throws for a schema that ajv refuses. */
export function validate(value: unknown, schema: Schema): string[] {
  const check = ajv.compile(schema);
  return check(value) ? [] : (check.errors ?? []).map(errorLine);
}

/** Whether `value` is a JSON object, the shape of every schema file of kit. */
const isSchemaObject = (value: unknown): value is SchemaObject => typeof value === 'object' && value !== null && !Array.isArray(value);

// The schema files, read once: ajv caches the function that it compiles for a schema object, so a schema is compiled once.
const schemaFiles = new Map<string, SchemaObject>();

/** The validator of the schema file `schema` (a file name in SCHEMAS) for data of type T; throws for a schema that ajv refuses. */
function validatorOf<T>(schema: string): ValidateFunction<T> {
  let rules = schemaFiles.get(schema);
  if (!rules) {
    const value = readJson(SCHEMAS, schema);
    if (!isSchemaObject(value)) throw new Error(`${schema} of kit is no JSON object`);
    schemaFiles.set(schema, value);
    rules = value;
  }
  return ajv.compile<T>(rules);
}

/**
 * The JSON text `text` as T, the type that the schema file `schema` (a file name in SCHEMAS) describes. `source` names the
 * text, a file or a command, in the ConfigError of invalid JSON and in each line of the SchemaError of data that breaks the
 * schema.
 */
export function parseJson<T>(text: string, schema: string, source: string): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${source} is no JSON: ${(error as Error).message}`);
  }
  const check = validatorOf<T>(schema);
  if (check(value)) return value;
  throw new SchemaError((check.errors ?? []).map(error => `${source}: ${errorLine(error)}`));
}

/** The JSON file at `file` as T against the schema file `schema`; `label` names the file in each error. */
function readValidated<T>(file: string, label: string, schema: string): T {
  if (!existsSync(file)) throw new ConfigError(`${label} is missing; the repository declares it (schema ${schema} of kit)`);
  return parseJson<T>(readFileSync(file, 'utf8'), schema, label);
}

/**
 * The JSON file `file` of `root` as T, the type that the schema file `schema` (a file name in SCHEMAS) describes; throws a
 * ConfigError that names `file` when it is missing or no JSON, and a SchemaError when it breaks the schema.
 */
export const readConfig = <T,>(root: string, file: string, schema: string): T => readValidated<T>(path.join(root, file), file, schema);

/** The JSON file at the path `file`, absolute or relative to the working directory, as readConfig reads a file of a repository. */
export const readJsonFile = <T,>(file: string, schema: string): T => readValidated<T>(file, file, schema);

/**
 * readConfig for a check that reports the errors of the schema as its findings: `{ value }`, or `{ errors }` with the lines
 * of the SchemaError. A missing file or invalid JSON still throws its ConfigError.
 */
export function readConfigFindings<T>(root: string, file: string, schema: string): { value: T; errors?: undefined } | { value?: undefined; errors: string[] } {
  try {
    return { value: readConfig<T>(root, file, schema) };
  } catch (error) {
    if (error instanceof SchemaError) return { errors: error.lines };
    throw error;
  }
}
