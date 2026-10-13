// Tests of the declarations of the lint tools: ruff, vulture, golangci-lint, deadcode and the PHP lint are read after the
// bootstrap by scripts/kit/toolchain-lint.mts, which fails with the file, the expected form and the actual value. The
// bootstrap reads only what is needed before npm ci, so declaredToolchain names none of them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { declaredToolchain } from '../../scripts/kit/bootstrap/toolchain-declared.mts';
import { declaredLintTools } from '../../scripts/kit/toolchain-lint.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

const DIGEST = 'f'.repeat(64);
const LOCK = '{ "packages": [] }\n';
const TOOLCHAIN = {
  schema: 1,
  ruff: { version: '0.17.0', sha256: { 'linux-x64': DIGEST } },
  vulture: { version: '2.16', sha256: DIGEST },
  golangciLint: { version: '2.14.0', sha256: { 'linux-x64': DIGEST } },
  deadcode: '0.52.0',
};
const FILES = { 'config/toolchain.json': JSON.stringify(TOOLCHAIN), 'config/php-lint/composer.lock': LOCK };

test('the lint tools are read after the bootstrap, and the bootstrap names none of them', (t) => {
  const root = toolchainCheckout(t, FILES);
  assert.deepEqual(declaredLintTools(root), {
    ruff: { version: '0.17.0', sha256: { 'linux-x64': DIGEST }, source: 'config/toolchain.json ruff' },
    vulture: { version: '2.16', sha256: DIGEST, source: 'config/toolchain.json vulture' },
    golangciLint: { version: '2.14.0', sha256: { 'linux-x64': DIGEST }, source: 'config/toolchain.json golangciLint' },
    deadcode: { version: '0.52.0', source: 'config/toolchain.json deadcode' },
    phpLint: { lock: createHash('sha256').update(LOCK).digest('hex'), manifest: 'config/php-lint/composer.json', source: 'config/php-lint/composer.lock' },
  });
  const bootstrap = declaredToolchain(root) as Record<string, unknown>;
  for (const key of ['ruff', 'vulture', 'golangciLint', 'deadcode', 'phpLint']) assert.equal(bootstrap[key], undefined, `the bootstrap reads ${key}`);
});

test('a checkout without lint tools declares none', (t) => {
  assert.deepEqual(declaredLintTools(toolchainCheckout(t, { 'config/toolchain.json': '{ "schema": 1 }' })), {});
});

test('a malformed lint tool declaration fails with the file and the value', (t) => {
  const cases: [object, RegExp][] = [
    [{ ruff: { version: '0.16', sha256: {} } }, /config\/toolchain\.json ruff must record version as <major>\.<minor>\.<patch>; it records "0\.16"/],
    [{ ruff: { version: '0.16.10', sha256: {} } }, /config\/toolchain\.json ruff must record the sha256 of the ruff wheel of each platform, for example linux-x64; it records none/],
    [{ ruff: { version: '0.16.10', sha256: { 'linux-x64': 'a'.repeat(63) } } }, /config\/toolchain\.json ruff must record the sha256 of linux-x64 as 64 lowercase hexadecimal digits/],
    [{ vulture: { version: 'latest', sha256: DIGEST } }, /config\/toolchain\.json vulture must record version as the PyPI release, for example 2\.16; it records "latest"/],
    [{ vulture: { version: '2.16', sha256: 'x' } }, /config\/toolchain\.json vulture must record sha256 as 64 lowercase hexadecimal digits; it records "x"/],
    [{ golangciLint: { version: '2.14', sha256: {} } }, /config\/toolchain\.json golangciLint must record version as <major>\.<minor>\.<patch>; it records "2\.14"/],
    [{ deadcode: '0.52' }, /config\/toolchain\.json must record deadcode as <major>\.<minor>\.<patch>; it records "0\.52"/],
  ];
  for (const [config, message] of cases) assert.throws(() => declaredLintTools(toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1, ...config }) })), message);
});
