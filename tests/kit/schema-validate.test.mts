// Tests of the schemas of scripts/kit/schema: each schema checks only the keys its tool reads (K1069): a key that no tool reads,
// such as a note of the repository, and the absence of the version key "schema", which no tool reads, give no finding.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SCHEMAS, schemaFile, validate } from '../../scripts/kit/schema-validate.mts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Adds the key `note` to every object of `value` and removes the key `schema` from its top level. */
function withNotes(value: unknown, top = true): unknown {
  if (Array.isArray(value)) return value.map(item => withNotes(item, false));
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value).filter(([key]) => !(top && key === 'schema')).map(([key, item]) => [key, withNotes(item, false)]);
  return { ...Object.fromEntries(entries), note: 'a key that no tool reads' };
}

test('K1069: a repository configuration with keys no tool reads and without the key schema passes its schema', () => {
  const names = readdirSync(path.join(ROOT, 'config')).filter(name => name.endsWith('.json') && existsSync(path.join(SCHEMAS, name.replace(/\.json$/, '.schema.json'))));
  assert.ok(names.length > 5, `kit declares its configuration: ${names.join(', ')}`);
  for (const name of names) {
    const config: unknown = JSON.parse(readFileSync(path.join(ROOT, 'config', name), 'utf8'));
    assert.deepEqual(validate(withNotes(config), schemaFile(name.replace(/\.json$/, '.schema.json'))), [], `config/${name}`);
  }
});

test('K1069: no schema of kit refuses a key that it does not describe', () => {
  for (const file of readdirSync(SCHEMAS).filter(name => name.endsWith('.schema.json'))) {
    assert.doesNotMatch(readFileSync(path.join(SCHEMAS, file), 'utf8'), /"additionalProperties":\s*false/, file);
  }
});

test('K1069: no schema of kit requires a key that its tool does not read', () => {
  const schema = (name: string) => schemaFile(`${name}.schema.json`);
  assert.deepEqual(validate({ exclude: [{ glob: 'tests/**' }] }, schema('duplication')), [], 'duplication-check reads no reason');
  assert.deepEqual(validate({ paths: [], exceptions: [{ path: 'a.bin' }], tracked: [{ path: 'b.bin' }] }, schema('generated')), [], 'generated-files reads no reason');
  assert.deepEqual(validate({ setup: { shared: [], runtimes: { ts: [] } } }, schema('ci')), [], 'ci-setup reads the setup of the runtimes of the repository only');
  assert.deepEqual(validate({ owners: [{ paths: ['a'], targets: ['t'] }], ciExempt: [{ target: 't' }] }, schema('owner-checks')), [], 'owner-check reads no ciExempt');
});
