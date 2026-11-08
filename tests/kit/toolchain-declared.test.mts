// Tests of the toolchain configuration, which has no schema of kit (K1076): declaredToolchain reads every declaring file of the bootstrap and of the tools that mise does not install (the PHP lint:
// toolchain-lint.test.mts; the tools of mise.toml: toolchain-mise.test.mts) and fails with the file, the expected form and
// the actual value.
import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredToolchain } from '../../scripts/kit/bootstrap/toolchain-declared.mts';
import { fixtureConfig, toolchainCheckout } from './toolchain-checkout.mts';

test('declaredToolchain reads each declaring file of the full shape', (t) => {
  const root = toolchainCheckout(t, {
    'config/toolchain.json': fixtureConfig('toolchain-full.json'),
  });
  const { mise } = JSON.parse(fixtureConfig('toolchain-full.json')) as { mise: { sha256: Record<string, string> } };
  assert.deepEqual(declaredToolchain(root), {
    php: { minors: ['8.2', '8.5'], source: 'config/toolchain.json php' },
    mise: { version: '2026.10.8', sha256: mise.sha256, source: 'config/toolchain.json mise' },
    phpunit: { version: '11.5.57', manifest: 'config/phpunit/composer.json', source: 'config/toolchain.json phpunit' },
    symbolExtractors: { extractors: ['go', 'php'], source: 'config/toolchain.json symbolExtractors' },
  });
});

test('declaredToolchain reads the version files when the configuration lists nothing; Python is a tool of mise.toml', (t) => {
  const root = toolchainCheckout(t, { '.php-version': '8.5\n', '.python-version': '3.14\n' });
  assert.deepEqual(declaredToolchain(root), {
    php: { minors: ['8.5'], source: '.php-version' },
  });
});

// K1076: a version is the text the repository declares; kit fixes no shape of it.
test('K1076: declaredToolchain reads versions of any form as their text', (t) => {
  const sha256 = { 'linux-x64': 'a'.repeat(64) };
  const root = toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1, mise: { version: '2026.10', sha256 }, phpunit: { version: '11.5' }, php: ['8.4.1', '8'] }) });
  const declared = declaredToolchain(root);
  assert.equal(declared.mise?.version, '2026.10');
  assert.equal(declared.phpunit?.version, '11.5');
  assert.deepEqual(declared.php?.minors, ['8.4.1', '8']);
});

test('a declaration that is malformed or contradicts another fails with the file and the values', (t) => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ 'config/toolchain.json': '{ "schema": 1, "mise": { "version": "2026.10.8", "sha256": {} } }' }, /config\/toolchain\.json mise must record the sha256 of the mise archive of each platform, for example linux-x64; it records none/],
    // A version is text, which the install passes: a JSON number or a list is no version (K98, K1076).
    [{ 'config/toolchain.json': '{ "schema": 1, "phpunit": { "version": 11.5 } }' }, /config\/toolchain\.json phpunit must record the PHPUnit release as text; it records 11\.5/],
    [{ 'config/toolchain.json': `{ "schema": 1, "mise": { "version": ["2026.10.8"], "sha256": { "linux-x64": "${'a'.repeat(64)}" } } }` }, /config\/toolchain\.json mise must record version as text; it records \["2026\.10\.8"\]/],
  ];
  for (const [files, message] of cases) assert.throws(() => declaredToolchain(toolchainCheckout(t, files)), message);
});

test('declaredToolchain reads the symbol extractors that make kit-install-symbols builds, and names a list of unknown ones (K75)', (t) => {
  const declared = (value: unknown) => declaredToolchain(toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1, symbolExtractors: value }) }));
  assert.deepEqual(declared(['go']).symbolExtractors, { extractors: ['go'], source: 'config/toolchain.json symbolExtractors' });
  assert.throws(() => declared(['cobol']), /config\/toolchain\.json symbolExtractors is \["cobol"\]; expected a list of go, php/);
  assert.throws(() => declared([]), /symbolExtractors is \[\]/);
});
