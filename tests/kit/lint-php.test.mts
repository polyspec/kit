// Tests of the PHP lint: phpcs runs on the PHP files of the checkout without the stubs of an extension, PHPStan on the PHP
// files of each Composer package from its folder with its autoloader; every step runs after a failure of an earlier one, and
// a missing tool, configuration or autoloader fails with the fix. phpcs and phpstan are stubs.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-php.mts';
import { initRepository } from './sandbox-repository.mts';
import { known } from './known.mts';

const FILES: Record<string, string> = {
  'phpcs.xml.dist': '<ruleset/>\n',
  'phpstan.dist.neon': 'parameters: {}\n',
  'packages/php/composer.json': '{}\n',
  'packages/php/src/Demo.php': '<?php\n',
  'packages/php/tests/DemoTest.php': '<?php\n',
  'packages/php/vendor/autoload.php': '<?php\n',
  'packages/php-ext/composer.json': '{}\n',
  'packages/php-ext/demo.stub.php': '<?php\n',
  'tests/consumer/composer.json': '{}\n',
};

function checkout(t: TestContext, { installed = ['phpcs', 'phpstan'], failing = '', omit = '', files = {} }: { installed?: string[]; failing?: string; omit?: string; files?: Record<string, string> } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-php-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ...FILES, ...files })) {
    if (file === omit) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  writeFileSync(path.join(root, '.gitignore'), 'var/\nvendor/\n*.log\n');
  const log = path.join(root, 'calls.log');
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const tool of installed) {
    writeFileSync(path.join(root, 'var/tools/bin', tool), `#!/bin/sh
echo "${tool} $* [$(basename "$PWD")]" >> "${log}"
${failing ? `case "${tool}" in "${failing}") echo "found a problem" >&2; exit 1;; esac` : ''}
`);
    chmodSync(path.join(root, 'var/tools/bin', tool), 0o755);
  }
  initRepository(root);
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.replace(/ \[kit-lint-php-[^\]]*\]$/, ' [root]').replaceAll(`${root}/`, '')) };
}

const ALL = [
  'phpcs -q -s --report=emacs --standard=phpcs.xml.dist packages/php/src/Demo.php packages/php/tests/DemoTest.php [root]',
  'phpstan analyse --no-progress --error-format=raw --configuration=phpstan.dist.neon --autoload-file=vendor/autoload.php src/Demo.php tests/DemoTest.php [php]',
];

test('phpcs runs on the PHP files without the stubs, and PHPStan on each package with PHP files from its folder', (t) => {
  const { root, calls } = checkout(t);
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), ALL);
});

test('every step runs after an earlier one failed, and each failure is named', (t) => {
  const { root, calls } = checkout(t, { failing: 'phpcs' });
  assert.deepEqual(lint(root, () => {}), ['phpcs']);
  assert.deepEqual(calls(), ALL);
  assert.deepEqual(lint(checkout(t, { failing: 'phpstan' }).root, () => {}), ['phpstan packages/php']);
});

test('a missing tool, configuration or autoloader fails with its fix', (t) => {
  assert.throws(() => lintSteps(checkout(t, { installed: ['phpstan'] }).root), /var\/tools\/bin\/phpcs is missing; run make install-tools, which installs config\/php-lint/);
  assert.throws(() => lintSteps(checkout(t, { omit: 'phpstan.dist.neon' }).root), /phpstan\.dist\.neon is missing; it is the PHP lint configuration that kit copies into every repository \(make kit-sync\)/);
  assert.throws(() => lintSteps(checkout(t, { omit: 'packages/php/vendor/autoload.php' }).root), /packages\/php\/vendor\/autoload\.php is missing, and no Composer project above packages\/php has one; PHPStan resolves the calls of the package with its autoloader: run composer install in packages\/php, or in the project that requires it/);
});

// K163: a Composer monorepo has one development composer.json at the root, which requires its libraries through path
// repositories, and one vendor/; a library commits no lock and has no vendor/ of its own.
const MONOREPO = { 'composer.json': '{}\n', 'vendor/autoload.php': '<?php\n' };

test('PHPStan runs a package of a Composer monorepo with the autoloader of the root project', (t) => {
  const { root, calls } = checkout(t, { omit: 'packages/php/vendor/autoload.php', files: MONOREPO });
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), [ALL[0], known(ALL[1], 'ALL[1]').replace('--autoload-file=vendor/autoload.php', '--autoload-file=../../vendor/autoload.php')]);
});

test('the autoloader of a package is the one of the nearest project that installed its vendor directory', (t) => {
  const { root, calls } = checkout(t, { files: MONOREPO });
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), ALL);
});

test('a package of a monorepo whose root project has no vendor directory still fails', (t) => {
  assert.throws(() => lintSteps(checkout(t, { omit: 'packages/php/vendor/autoload.php', files: { 'composer.json': '{}\n' } }).root), /packages\/php\/vendor\/autoload\.php is missing, and no Composer project above packages\/php has one/);
});

test('COMPOSER_VENDOR_DIR names the vendor directory of each project, as for run-tests', (t) => {
  const { root, calls } = checkout(t, { omit: 'packages/php/vendor/autoload.php', files: { 'composer.json': '{}\n', 'var/vendor/autoload.php': '<?php\n' } });
  t.after(() => { delete process.env.COMPOSER_VENDOR_DIR; });
  process.env.COMPOSER_VENDOR_DIR = 'var/vendor';
  assert.deepEqual(lint(root, () => {}), []);
  assert.deepEqual(calls(), [ALL[0], known(ALL[1], 'ALL[1]').replace('--autoload-file=vendor/autoload.php', '--autoload-file=../../var/vendor/autoload.php')]);
});
