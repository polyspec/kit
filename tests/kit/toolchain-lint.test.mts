// Tests of the declaration of the PHP lint: the Composer project config/php-lint of the kit that runs (K614), with the phpcs and
// PHPStan releases that its lock holds, is read after the bootstrap by scripts/kit/toolchain-lint.mts, only by a checkout that
// declares PHP. The other lint tools are tools of mise.toml (toolchain-mise.test.mts), and the bootstrap names none of them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { declaredToolchain } from '../../scripts/kit/bootstrap/toolchain-declared.mts';
import { kitFile } from '../../scripts/kit/kit-files.mts';
import { readComposerLock } from '../../scripts/kit/manifests.mts';
import { readFileSync } from 'node:fs';
import { declaredLintTools } from '../../scripts/kit/toolchain-lint.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

const PHP = JSON.stringify({ schema: 1, php: ['8.5'] });

// The lock of the PHP lint of kit and the release of a package in it, without a v prefix.
const KIT_LOCK = readFileSync(kitFile('config/php-lint/composer.lock'), 'utf8');
const released = (name: string): string => (readComposerLock(kitFile('config/php-lint'), 'composer.lock').packages ?? []).find(entry => entry.name === name)?.version?.replace(/^v/, '') ?? '';

test('the PHP lint is the config/php-lint of kit, read after the bootstrap from its lock, and the bootstrap names none of it (K614)', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': PHP });
  const project = path.relative(root, kitFile('config/php-lint'));
  const lock = path.join(project, 'composer.lock');
  assert.deepEqual(declaredLintTools(root), {
    phpLint: { lock: createHash('sha256').update(KIT_LOCK).digest('hex'), manifest: path.join(project, 'composer.json'), source: lock },
    phpcs: { version: released('squizlabs/php_codesniffer'), source: lock },
    phpstan: { version: released('phpstan/phpstan'), source: lock },
  });
  const bootstrap = declaredToolchain(root) as Record<string, unknown>;
  for (const key of ['phpLint', 'phpcs', 'phpstan']) assert.equal(bootstrap[key], undefined, `the bootstrap reads ${key}`);
});

test('the PHP lint of kit is declared only by a checkout that declares PHP (K614)', (t) => {
  assert.deepEqual(declaredLintTools(toolchainCheckout(t, { 'config/toolchain.json': '{ "schema": 1 }' })), {});
  assert.deepEqual(Object.keys(declaredLintTools(toolchainCheckout(t, { '.php-version': '8.5\n' }))), ['phpLint', 'phpcs', 'phpstan']);
});
