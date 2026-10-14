// Tests of the schema validator and of the configuration check of kit-check: the schemas accept the fixture's
// configuration and name each error of a configuration that breaks them.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkConfig } from '../../scripts/kit/kit-check.mts';
import { ConfigError, parseJson, readConfig, readConfigFindings, SCHEMAS, SchemaError, schemaFile, validate } from '../../scripts/kit/schema-validate.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture');

test('the schemas accept the configuration of the fixture', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts/kit/schema'), { recursive: true });
  for (const name of ['dependency-policy', 'dependency-review']) {
    cpSync(path.join(HERE, '../../scripts/kit/schema', `${name}.schema.json`), path.join(root, 'scripts/kit/schema', `${name}.schema.json`));
  }
  mkdirSync(path.join(root, 'config'), { recursive: true });
  for (const name of ['dependency-policy', 'dependency-review']) cpSync(path.join(FIXTURE, 'config', `${name}.json`), path.join(root, 'config', `${name}.json`));
  assert.deepEqual(checkConfig(root), []);
  const policy = path.join(root, 'config/dependency-policy.json');
  writeFileSync(policy, JSON.stringify({ schema: 2, composerPlatforms: [], pythonManifests: [], pythonLocks: [], npmLocks: [], exceptions: [], extra: true }));
  const findings = checkConfig(root);
  assert.ok(findings.some(line => line === 'config/dependency-policy.json: /schema must be equal to constant {"allowedValue":1}, value 2. Rule: the schema dependency-policy.schema.json of @polyspec/kit'), findings.join('\n'));
  assert.ok(findings.some(line => line.startsWith('config/dependency-policy.json: / must NOT have additional properties {"additionalProperty":"extra"}')), findings.join('\n'));
  rmSync(policy);
  assert.deepEqual(checkConfig(root), [], 'a repository without a declared configuration file has no finding');
});

test('the validator prints the path, the message and the params of ajv and the value, and refuses an invalid schema', () => {
  const schema = { type: 'object', required: ['name'], additionalProperties: false, properties: {
    name: { type: 'string', pattern: '^a' }, kind: { type: 'string', enum: ['npm'] }, list: { type: 'array', minItems: 1, items: { type: 'integer' } },
  } };
  assert.deepEqual(validate({ name: 'b', kind: 'pip', list: [] }, schema), [
    '/name must match pattern "^a" {"pattern":"^a"}, value "b"',
    '/kind must be equal to one of the allowed values {"allowedValues":["npm"]}, value "pip"',
    '/list must NOT have fewer than 1 items {"limit":1}',
  ]);
  assert.deepEqual(validate('x', schema), ['/ must be object {"type":"object"}, value "x"']);
  assert.throws(() => validate({}, { oneOf: [] }), /schema is invalid: data\/oneOf must NOT have fewer than 1 items/);
  assert.throws(() => validate({}, { unknownKeyword: 1 }), /strict mode: unknown keyword: "unknownKeyword"/);
});

test('a Composer manifest of the policy is a relative path to a composer.json, at the root or below it', () => {
  const schema = schemaFile('dependency-policy.schema.json');
  const policy = (manifest: string) => ({ schema: 1, composerPlatforms: [{ manifest, php: '8.2.0' }], pythonManifests: [], pythonLocks: [], npmLocks: [], exceptions: [] });
  for (const manifest of ['composer.json', 'examples/board/composer.json']) assert.deepEqual(validate(policy(manifest), schema), [], manifest);
  for (const manifest of ['/composer.json', 'a\\composer.json', 'xcomposer.json', 'composer.lock']) assert.notDeepEqual(validate(policy(manifest), schema), [], manifest);
});

test('a Python manifest of the policy is a relative path to a pyproject.toml, at the root or below it', () => {
  const schema = schemaFile('dependency-policy.schema.json');
  const policy = (manifest: string) => ({ schema: 1, composerPlatforms: [], pythonManifests: [manifest], pythonLocks: [], npmLocks: [], exceptions: [] });
  for (const manifest of ['pyproject.toml', 'packages/x-python/pyproject.toml']) assert.deepEqual(validate(policy(manifest), schema), [], manifest);
  for (const manifest of ['/pyproject.toml', 'xpyproject.toml', 'setup.py']) assert.notDeepEqual(validate(policy(manifest), schema), [], manifest);
});

test('an npm lock of the policy is a relative path to a package-lock.json, at the root or below it', () => {
  const schema = schemaFile('dependency-policy.schema.json');
  const policy = (lock: string) => ({ schema: 1, composerPlatforms: [], pythonManifests: [], pythonLocks: [], npmLocks: [lock], exceptions: [] });
  for (const lock of ['package-lock.json', 'tests/package-install/package-lock.json']) assert.deepEqual(validate(policy(lock), schema), [], lock);
  for (const lock of ['/package-lock.json', 'a\\package-lock.json', 'xpackage-lock.json', 'npm-shrinkwrap.json']) assert.notDeepEqual(validate(policy(lock), schema), [], lock);
});

test('a key named like a member of Object.prototype is no declared property and no present required key (K112)', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } };
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    const value: unknown = JSON.parse(`{ "name": "a", ${JSON.stringify(key)}: 1 }`);
    assert.notDeepEqual(validate(value, schema), [], `the extra key ${key} is refused`);
  }
  assert.notDeepEqual(validate({}, { type: 'object', required: ['toString'], properties: { toString: { type: 'integer' } } }), [], 'a required key is an own key');
});

// The JSON boundary of kit (K158): a file or the output of a command is T only once its schema accepts it; otherwise the
// error names the file or the command and the JSON Pointer of each error of ajv.
test('readConfig gives the JSON of a file as the type of its schema, and invalid data fails with the file and the ajv path (K158)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-json-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'record.json'), JSON.stringify({ id: 7 }));
  const record = readConfig<{ id: number }>(root, 'record.json', 'release-record.schema.json');
  assert.equal(record.id, 7);
  writeFileSync(path.join(root, 'record.json'), JSON.stringify({ id: 'seven' }));
  assert.throws(() => readConfig<{ id: number }>(root, 'record.json', 'release-record.schema.json'), (error: unknown) => {
    assert.ok(error instanceof SchemaError);
    assert.deepEqual(error.lines, ['record.json: /id must be integer {"type":"integer"}, value "seven"']);
    return true;
  });
  assert.deepEqual(readConfigFindings<{ id: number }>(root, 'record.json', 'release-record.schema.json'), { errors: ['record.json: /id must be integer {"type":"integer"}, value "seven"'] });
  writeFileSync(path.join(root, 'record.json'), '{');
  assert.throws(() => readConfigFindings<{ id: number }>(root, 'record.json', 'release-record.schema.json'), (error: unknown) => error instanceof ConfigError && !(error instanceof SchemaError) && error.message.startsWith('record.json is no JSON: '));
  assert.throws(() => readConfig<{ id: number }>(root, 'missing.json', 'release-record.schema.json'), /missing\.json is missing; the repository declares it \(schema release-record\.schema\.json of kit\)/);
  assert.throws(() => parseJson<[number, string, string, string | null]>('[1, "ci", "completed"]', 'github-check-run.schema.json', 'gh api'), /gh api: \/ must NOT have fewer than 4 items/);
});

test('every schema of kit compiles in the strict mode of ajv (K158)', () => {
  for (const file of readdirSync(SCHEMAS).filter(name => name.endsWith('.schema.json'))) {
    assert.doesNotThrow(() => validate(null, schemaFile(file)), file);
  }
});
