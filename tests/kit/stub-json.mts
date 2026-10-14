// The JSON that the stubs of the tests write, their state and their call logs, read with a type: each shape is a
// JSONSchemaType of ajv, which TypeScript checks against its type, and the data is that type only once the schema accepts
// it (the type guard of ajv's compile). The JSON of kit's own files goes through the schemas of kit (json-fixture.mts).
import { readFileSync } from 'node:fs';
import { Ajv2020, type JSONSchemaType } from 'ajv/dist/2020.js';

const ajv = new Ajv2020({ strict: true, allErrors: true });

/** The JSON text `text` as T; throws with `source` and the errors of ajv when the schema refuses it. */
export function parseStub<T>(text: string, schema: JSONSchemaType<T>, source: string): T {
  // ajv caches the function that it compiles for a schema object.
  const check = ajv.compile(schema);
  const value: unknown = JSON.parse(text);
  if (check(value)) return value;
  throw new Error(`${source}: ${ajv.errorsText(check.errors)}`);
}

/** The JSON file `file` as T, as parseStub reads a text. */
export const readStub = <T,>(file: string, schema: JSONSchemaType<T>): T => parseStub(readFileSync(file, 'utf8'), schema, file);

/** Each line of the JSON-lines log `file` as T. */
export const readStubLines = <T,>(file: string, schema: JSONSchemaType<T>): T[] =>
  readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => parseStub(line, schema, file));

/** A list of texts. */
export const TEXTS: JSONSchemaType<string[]> = { type: 'array', items: { type: 'string' } };

/** A call that a stub logged: its arguments and its directory. */
export type StubCall = { args: string[]; cwd: string };
export const STUB_CALL: JSONSchemaType<StubCall> = { type: 'object', required: ['args', 'cwd'], properties: { args: TEXTS, cwd: { type: 'string' } } };
