// Tests of the toolchain configuration: the schema accepts each representative shape and names a wrong value, and
// declaredToolchain reads every declaring file of the bootstrap and of the tools that mise does not install (the PHP lint:
// toolchain-lint.test.mts; the tools of mise.toml: toolchain-mise.test.mts) and fails with the file, the expected form and
// the actual value.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { parseJson, schemaFile, validate } from '../../scripts/kit/schema-validate.mts';
import { declaredToolchain } from '../../scripts/kit/bootstrap/toolchain-declared.mts';
import { FIXTURE_CONFIG, fixtureConfig, toolchainCheckout } from './toolchain-checkout.mts';

const SCHEMA = schemaFile('toolchain.schema.json');
const DIGEST = 'a'.repeat(128);

test('the schema accepts every representative toolchain configuration', () => {
  const names = readdirSync(FIXTURE_CONFIG).filter(name => name.startsWith('toolchain-'));
  assert.deepEqual(names, ['toolchain-files-only.json', 'toolchain-full.json']);
  for (const name of names) {
    const config: unknown = JSON.parse(fixtureConfig(name));
    assert.deepEqual(validate(config, SCHEMA), [], name);
  }
});

test('the schema names an unknown key, a wrong shape and a malformed version; a tool of mise.toml is an unknown key', () => {
  const errors = validate({ schema: 1, extra: 1, php: '8.5', phpunit: { version: '11.5' }, python: '3.14', node: { 'windows.zip': 'x' } }, SCHEMA);
  assert.deepEqual(errors, [
    '/ must NOT have additional properties {"additionalProperty":"extra"}',
    '/ must NOT have additional properties {"additionalProperty":"python"}',
    '/php must be array {"type":"array"}, value "8.5"',
    '/phpunit/version must match pattern "^\\d+\\.\\d+\\.\\d+$" {"pattern":"^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$"}, value "11.5"',
    '/node must NOT have additional properties {"additionalProperty":"windows.zip"}',
  ]);
});

test('declaredToolchain reads each declaring file of the full shape', (t) => {
  const root = toolchainCheckout(t, {
    'config/toolchain.json': fixtureConfig('toolchain-full.json'),
    '.node-version': '26.8.1\n',
    'package.json': JSON.stringify({ packageManager: `npm@12.2.0+sha512.${DIGEST}` }),
  });
  const { mise } = parseJson<{ mise: { sha256: Record<string, string> } }>(fixtureConfig('toolchain-full.json'), 'toolchain.schema.json', 'toolchain-full.json');
  assert.deepEqual(declaredToolchain(root), {
    node: { version: '26.8.1', source: '.node-version' },
    npm: { version: '12.2.0', sha512: DIGEST, source: 'packageManager of package.json' },
    php: { minors: ['8.2', '8.5'], source: 'config/toolchain.json php' },
    mise: { version: '2026.10.8', sha256: mise.sha256, source: 'config/toolchain.json mise' },
    pythonBackend: { requirement: 'setuptools==84.0.0', sha256: '51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670', source: 'config/toolchain.json pythonBackend' },
    phpunit: { version: '11.5.57', manifest: 'config/phpunit/composer.json', source: 'config/toolchain.json phpunit' },
    symbolExtractors: { extractors: ['go', 'php'], source: 'config/toolchain.json symbolExtractors' },
  });
});

test('declaredToolchain reads the version files when the configuration lists nothing; Python is a tool of mise.toml', (t) => {
  const root = toolchainCheckout(t, { '.php-version': '8.5\n', '.python-version': '3.14\n', 'package.json': '{ "packageManager": "npm@12.2.0" }' });
  assert.deepEqual(declaredToolchain(root), {
    npm: { version: '12.2.0', sha512: undefined, source: 'packageManager of package.json' },
    php: { minors: ['8.5'], source: '.php-version' },
  });
});

test('a declaration that is malformed or contradicts another fails with the file and the values', (t) => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ '.node-version': '26.8\n' }, /\.node-version must record the Node\.js release as <major>\.<minor>\.<patch>; it records "26\.8"/],
    [{ 'package.json': '{ "packageManager": "pnpm@11.0.0" }' }, /package\.json packageManager is "pnpm@11\.0\.0", expected npm@/],
    [{ 'package.json': '{}' }, /package\.json packageManager is "", expected npm@/],
    [{ 'config/toolchain.json': '{ "schema": 1, "php": ["8.5"] }', '.php-version': '8.4\n' }, /\.php-version declares 8\.4, but config\/toolchain\.json php lists 8\.5/],
    [{ 'config/toolchain.json': '{ "schema": 1, "mise": { "version": "2026.10", "sha256": {} } }' }, /config\/toolchain\.json mise must record version as <major>\.<minor>\.<patch>; it records "2026\.10"/],
    [{ 'config/toolchain.json': '{ "schema": 1, "mise": { "version": "2026.10.8", "sha256": {} } }' }, /config\/toolchain\.json mise must record the sha256 of the mise archive of each platform, for example linux-x64; it records none/],
    // A version is text: a JSON number or a list whose text matches is refused (K98).
    [{ 'package.json': '{ "packageManager": ["npm@12.2.0"] }' }, /package\.json packageManager is \["npm@12\.2\.0"\], expected npm@/],
    [{ 'config/toolchain.json': '{ "schema": 1, "phpunit": { "version": 11.5 } }' }, /config\/toolchain\.json phpunit must record the PHPUnit release as <major>\.<minor>\.<patch>; it records 11\.5/],
    [{ 'config/toolchain.json': `{ "schema": 1, "mise": { "version": ["2026.10.8"], "sha256": { "linux-x64": "${'a'.repeat(64)}" } } }` }, /config\/toolchain\.json mise must record version as <major>\.<minor>\.<patch>; it records \["2026\.10\.8"\]/],
  ];
  for (const [files, message] of cases) assert.throws(() => declaredToolchain(toolchainCheckout(t, files)), message);
});

test('declaredToolchain reads the symbol extractors that install-tools builds, and names a list of unknown ones (K75)', (t) => {
  const declared = (value: unknown) => declaredToolchain(toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1, symbolExtractors: value }) }));
  assert.deepEqual(declared(['go']).symbolExtractors, { extractors: ['go'], source: 'config/toolchain.json symbolExtractors' });
  assert.throws(() => declared(['cobol']), /config\/toolchain\.json symbolExtractors is \["cobol"\]; expected a list of go, php/);
  assert.throws(() => declared([]), /symbolExtractors is \[\]/);
  assert.deepEqual(validate({ schema: 1, symbolExtractors: ['go'] }, SCHEMA), []);
  assert.deepEqual(validate({ schema: 1, symbolExtractors: ['ts'] }, SCHEMA).length, 1);
});
