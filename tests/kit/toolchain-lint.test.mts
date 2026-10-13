// Tests of the declaration of the PHP lint: the Composer project of config/php-lint, with the phpcs and PHPStan releases that
// its lock holds, is read after the bootstrap by scripts/kit/toolchain-lint.mts, which fails with the file and the value. The
// other lint tools are tools of mise.toml (toolchain-mise.test.mts), and the bootstrap names none of them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { declaredToolchain } from '../../scripts/kit/bootstrap/toolchain-declared.mts';
import { declaredLintTools } from '../../scripts/kit/toolchain-lint.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

const LOCK = `${JSON.stringify({ packages: [{ name: 'phpstan/phpstan', version: '2.3.1' }, { name: 'squizlabs/php_codesniffer', version: 'v4.0.4' }] })}\n`;

test('the PHP lint is read after the bootstrap from its lock, and the bootstrap names none of it', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': '{ "schema": 1 }', 'config/php-lint/composer.lock': LOCK });
  assert.deepEqual(declaredLintTools(root), {
    phpLint: { lock: createHash('sha256').update(LOCK).digest('hex'), manifest: 'config/php-lint/composer.json', source: 'config/php-lint/composer.lock' },
    phpcs: { version: '4.0.4', source: 'config/php-lint/composer.lock' },
    phpstan: { version: '2.3.1', source: 'config/php-lint/composer.lock' },
  });
  const bootstrap = declaredToolchain(root) as Record<string, unknown>;
  for (const key of ['phpLint', 'phpcs', 'phpstan']) assert.equal(bootstrap[key], undefined, `the bootstrap reads ${key}`);
});

test('a checkout without the PHP lint declares none', (t) => {
  assert.deepEqual(declaredLintTools(toolchainCheckout(t, { 'config/toolchain.json': '{ "schema": 1 }' })), {});
});

test('a lock without a release of a lint tool fails with the file and the value', (t) => {
  assert.throws(() => declaredLintTools(toolchainCheckout(t, { 'config/php-lint/composer.lock': '{ "packages": [] }' })), /config\/php-lint\/composer\.lock must lock squizlabs\/php_codesniffer at a release <major>\.<minor>\.<patch>; it locks undefined/);
});
