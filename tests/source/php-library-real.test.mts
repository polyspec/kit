// The extension run of the tests of the PHP library on the real Composer and the real PHPUnit of this checkout (K329, S10): the tests
// of `packages/php` run with the autoloader that holds the dependencies and the autoload-dev of the library and none of its own
// autoload, so a library and its extension never coexist in one process; a test that requires a source of the library fails the run.
// `make install-tools` installs Composer and PHPUnit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { initRepository } from '../kit/sandbox-repository.mts';
import { put } from '../kit/tree.mts';
import { sandboxMise, sandboxShims } from './real-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A checkout whose packages/php holds a library with a psr-4 autoload and a files autoload, two tests, and the vendor of the PHPUnit of kit. */
function checkout(t: { after: (callback: () => void) => void }): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-php-library-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, {
    'packages/php/composer.json': JSON.stringify({
      name: 'polyspec/demo', autoload: { 'psr-4': { 'Acme\\': 'src/' }, files: ['src/helpers.php'] }, 'autoload-dev': { 'psr-4': { 'Acme\\Tests\\': 'tests/' } },
    }),
    'packages/php/src/Greeter.php': '<?php\n\nnamespace Acme;\n\nfinal class Greeter\n{\n}\n',
    'packages/php/src/helpers.php': '<?php\n\nnamespace Acme;\n\nfunction helper(): void\n{\n}\n',
    'packages/php/tests/NoLibraryTest.php': "<?php\n\nnamespace Acme\\Tests;\n\nuse PHPUnit\\Framework\\TestCase;\n\nfinal class NoLibraryTest extends TestCase\n{\n    public function testNoSourceOfTheLibraryIsLoaded(): void\n    {\n        self::assertFalse(class_exists('Acme\\\\Greeter'));\n        self::assertFalse(function_exists('Acme\\\\helper'));\n    }\n}\n",
    'packages/php/tests/RequiresLibraryTest.php': "<?php\n\nnamespace Acme\\Tests;\n\nuse PHPUnit\\Framework\\TestCase;\n\nfinal class RequiresLibraryTest extends TestCase\n{\n    public function testIncludesASource(): void\n    {\n        require_once __DIR__ . '/../src/Greeter.php';\n        self::assertTrue(true);\n    }\n}\n",
  });
  // The vendor directory that composer install gives the library: the packages of the PHPUnit of kit, linked, and an autoloader that
  // also holds the autoload of the library, which Composer dumps over them.
  const tools = toolsPath(ROOT, 'phpunit/vendor');
  const vendor = path.join(root, 'packages/php/vendor');
  mkdirSync(path.join(vendor, 'composer'), { recursive: true });
  for (const entry of readdirSync(tools)) if (!['composer', 'autoload.php', 'bin'].includes(entry)) symlinkSync(realpathSync(path.join(tools, entry)), path.join(vendor, entry));
  cpSync(path.join(tools, 'composer/installed.json'), path.join(vendor, 'composer/installed.json'));
  // The proxy of Composer: PHPUnit takes the autoloader of the library, which holds the autoload of the library.
  mkdirSync(path.join(vendor, 'bin'), { recursive: true });
  writeFileSync(path.join(vendor, 'bin/phpunit'), `#!/usr/bin/env php\n<?php\n$GLOBALS['_composer_autoload_path'] = __DIR__ . '/../autoload.php';\ninclude ${JSON.stringify(path.join(realpathSync(tools), 'phpunit/phpunit/phpunit'))};\n`, { mode: 0o755 });
  sandboxShims(root, ['composer', 'php']);
  sandboxMise(root);
  writeFileSync(path.join(root, 'var/tools/bin/php'), `#!/bin/sh\nexec '${path.join(root, 'var/tools/mise/shims/php')}' "$@"\n`, { mode: 0o755 });
  const dumped = spawnSync(path.join(root, 'var/tools/mise/shims/composer'), ['dump-autoload', '--dev', '--no-scripts', '--no-interaction', '--working-dir', path.join(root, 'packages/php')], { encoding: 'utf8' });
  assert.equal(dumped.status, 0, dumped.stdout + dumped.stderr);
  mkdirSync(path.join(root, 'var'), { recursive: true });
  initRepository(root);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  return root;
}

/** Runs `run-tests phpunit` of this checkout in `root` with `flags` and the test file `file`. */
function runTests(root: string, file: string, ...flags: string[]) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/kit/run-tests.mts'), 'phpunit', '--cwd', 'packages/php', ...flags, '--', file], { cwd: root, encoding: 'utf8', env: { ...process.env, TEST_ROOT: root, KIT_ROOT: root} });
}

test('the tests of the library run without any source of the library, and a test that requires one fails the run (K329)', (t) => {
  const root = checkout(t);
  const plain = runTests(root, 'tests/NoLibraryTest.php');
  assert.notEqual(plain.status, 0, 'with the autoload of the library the sources are loaded:\n' + plain.stdout + plain.stderr);
  const without = runTests(root, 'tests/NoLibraryTest.php', '--without-library', 'packages/php');
  assert.equal(without.status, 0, without.stdout + without.stderr);
  const required = runTests(root, 'tests/RequiresLibraryTest.php', '--without-library', 'packages/php');
  assert.notEqual(required.status, 0, 'a test that requires a source of the library is refused');
});
