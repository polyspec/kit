// Tests of install-symbols.mts, the install of the PHP programs of kit: composer install of the lock of scripts/kit/symbols/php,
// done again on each install, with no RELEASE of kit (K861). composer is a stub, so no test installs a package.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { installDeclared, installDeclaredExtractors, installExtractor } from '../../scripts/kit/install-symbols.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

// The declarations that the PHP programs need: the Composer of mise.toml and the PHP of .php-version.
const PHP_DECLARED = {
  'mise.toml': '[tools]\n"http:composer" = { version = "2.9.0", url = "https://example.invalid/composer.phar" }\n',
  '.php-version': '8.4\n',
};

/** A checkout whose composer (var/tools/bin/composer) logs its arguments and the COMPOSER_HOME it sees. */
function checkout(t: TestContext, files: Record<string, string> = {}) {
  const root = toolchainCheckout(t, files);
  const log = path.join(root, 'composer.log');
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/composer'), `#!/bin/sh\necho "$* COMPOSER_HOME=\${COMPOSER_HOME:-unset}" >> ${JSON.stringify(log)}\n`);
  chmodSync(path.join(root, 'var/tools/bin/composer'), 0o755);
  return { root, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}

// K861: make kit-install-declared runs install-symbols --declared, which installs what the repository declares and nothing else.
test('K861: --declared installs the declared PHP programs, and nothing without a declaration', (t) => {
  const declared = toolchainCheckout(t, { ...PHP_DECLARED, 'config/toolchain.json': JSON.stringify({ schema: 1, symbolExtractors: ['php'] }) });
  const calls: string[] = [];
  const install = ({ extractor }: Parameters<typeof installExtractor>[0]) => { calls.push(extractor); };
  assert.deepEqual(installDeclared({ root: declared, install }), ['php']);
  assert.deepEqual(calls, ['php']);
  const bare = toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1 }) });
  assert.deepEqual(installDeclared({ root: bare, install }), []);
  assert.deepEqual(calls, ['php'], 'nothing is installed without a declaration');
});

// K1071: the EXTRACTORS argument names what to install; config/toolchain.json need not repeat it.
test('K1071: php that EXTRACTORS names installs without a symbolExtractors declaration', (t) => {
  const root = toolchainCheckout(t, { ...PHP_DECLARED, 'config/toolchain.json': JSON.stringify({ schema: 1 }) });
  const calls: string[] = [];
  installDeclaredExtractors({ root, extractors: ['php'], install: ({ extractor }) => { calls.push(extractor); } });
  assert.deepEqual(calls, ['php']);
});

test('the installer rejects an unknown name and an undeclared Composer before installing any', (t) => {
  const root = toolchainCheckout(t, { 'config/toolchain.json': JSON.stringify({ schema: 1 }) });
  const calls: string[] = [];
  const install = ({ extractor }: Parameters<typeof installExtractor>[0]) => { calls.push(extractor); };
  assert.throws(() => installDeclaredExtractors({ root, extractors: ['go'], install }), /unknown symbol extractor go; choose php/);
  assert.throws(() => installDeclaredExtractors({ root, extractors: ['php'], install }), /needs http:composer in mise.toml/);
  assert.deepEqual(calls, []);
});

test('K861 K1095: each install runs composer install again with the environment of the caller, no flag of kit and no RELEASE', (t) => {
  const { root, calls } = checkout(t);
  const saved = process.env.COMPOSER_HOME;
  process.env.COMPOSER_HOME = '/caller/composer';
  t.after(() => { if (saved === undefined) delete process.env.COMPOSER_HOME; else process.env.COMPOSER_HOME = saved; });
  installExtractor({ root, extractor: 'php' });
  installExtractor({ root, extractor: 'php' });
  assert.deepEqual(calls(), ['install COMPOSER_HOME=/caller/composer', 'install COMPOSER_HOME=/caller/composer']);
  assert.equal(existsSync(path.join(root, 'var/tools/symbols-php/RELEASE')), false, 'no RELEASE is recorded');
});
