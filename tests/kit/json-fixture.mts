// The JSON files of a fixture as the tests read and edit them: each file is read through the schema of kit that describes
// it (readConfig of scripts/kit/schema-validate.mts, K158), as the tools read it, and a test names the type of the fields
// that it reads or edits. A file without a schema of kit is no fixture JSON of this helper.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { readConfig } from '../../scripts/kit/schema-validate.mts';

// The schema of each JSON file of a fixture, by its base name.
const SCHEMAS: Record<string, string> = {
  'package.json': 'npm-manifest.schema.json',
  'package-lock.json': 'npm-lock.schema.json',
  'composer.json': 'composer-manifest.schema.json',
  'composer.lock': 'composer-lock.schema.json',
  'installed.json': 'composer-lock.schema.json',
  'knip.json': 'knip.schema.json',
  'checklist.json': 'checklist.schema.json',
  'commits.json': 'commits.schema.json',
  'dependency-policy.json': 'dependency-policy.schema.json',
  'dependency-review.json': 'dependency-review.schema.json',
  'documents.json': 'documents.schema.json',
  'owner-checks.json': 'owner-checks.schema.json',
  'parity.json': 'parity.schema.json',
  'release.json': 'release.schema.json',
  'toolchain.json': 'toolchain.schema.json',
  'record.json': 'run-record.schema.json',
  'settings.json': 'claude-settings.schema.json',
};

/** The schema file of kit of the JSON file `file`; throws for a file that no schema describes. */
function schemaOf(file: string): string {
  // The record of a draft release that make release-publish writes: var/release/<tag>.json.
  if (file.startsWith('var/release/') && file.endsWith('.json')) return 'release-record.schema.json';
  const schema = SCHEMAS[path.basename(file)];
  if (schema === undefined) throw new Error(`${file}: no schema of kit describes it; add its schema to tests/kit/json-fixture.mts`);
  return schema;
}

/** The JSON file `file` of `root` as Data, the fields of it that the test reads, validated against its schema. */
export const readFixture = <Data,>(root: string, file: string): Data => readConfig<Data>(root, file, schemaOf(file));

/** Applies `change` to the JSON file `file` of `root`, read as readFixture reads it, and writes it back. */
export function editFixture<Data>(root: string, file: string, change: (data: Data) => void): void {
  const data = readFixture<Data>(root, file);
  change(data);
  writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
}
