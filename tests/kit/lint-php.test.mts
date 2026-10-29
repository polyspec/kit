// Tests of the PHP lint: phpcs runs on the PHP files of the checkout without the stubs of an extension, PHPStan on the PHP
// files of each Composer package from its folder with its autoloader; every step runs after a failure of an earlier one, and
// a missing tool or autoloader fails with the fix. phpcs and phpstan are stubs.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { lint, lintSteps } from '../../scripts/kit/lint-php.mts';
import { declaredToolchain } from '../../scripts/kit/bootstrap/toolchain-declared.mts';
import { runLint } from '../../scripts/kit/lint-steps.mts';
import { kitFile } from '../../scripts/kit/kit-files.mts';
import { repositoryRoot } from '../../scripts/kit/paths.mts';
import { present } from '../../scripts/kit/present.mts';
import { initRepository } from './sandbox-repository.mts';
import { known } from './known.mts';
import { tree } from './tree.mts';

const FILES: Record<string, string> = {
  'packages/php/composer.json': '{}\n',
  'packages/php/src/Demo.php': '<?php\n',
  'packages/php/tests/DemoTest.php': '<?php\n',
  'packages/php/vendor/autoload.php': '<?php\n',
  'packages/php-ext/composer.json': '{}\n',
  'packages/php-ext/demo.stub.php': '<?php\n',
  'tests/consumer/composer.json': '{}\n',
};

function checkout(t: TestContext, { installed = ['phpcs', 'phpstan'], failing = '', omit = '', tempLeak = false, files = {} }: { installed?: string[]; failing?: string; omit?: string; tempLeak?: boolean; files?: Record<string, string> } = {}) {
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
${tempLeak && tool === 'phpstan' ? `printf '%s' "$TMPDIR" > "${root}/phpstan-tmpdir"; mkdir -p "$TMPDIR/phpstan/cache/nette.configurator"` : ''}
${failing ? `case "${tool}" in "${failing}") echo "found a problem" >&2; exit 1;; esac` : ''}
`);
    chmodSync(path.join(root, 'var/tools/bin', tool), 0o755);
  }
  initRepository(root);
  return { root, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.replace(/ \[kit-lint-php-[^\]]*\]$/, ' [root]').replaceAll(`${root}/`, '')) };
}

const ALL = [
  `phpcs -q -s --report=emacs --standard=${kitFile('phpcs.xml.dist')} packages/php/src/Demo.php packages/php/tests/DemoTest.php [root]`,
  `phpstan analyse --no-progress --error-format=raw --memory-limit=-1 --configuration=${kitFile('phpstan.dist.neon')} --autoload-file=vendor/autoload.php src/Demo.php tests/DemoTest.php [php]`,
];

test('the PHP extractor used for autoload-file lint is declared for install-tools', () => {
  const root = repositoryRoot();
  const declaration = declaredToolchain(root).symbolExtractors;
  assert.ok(declaration?.extractors.includes('php'), 'config/toolchain.json declares the PHP parser installed for the native autoload-file lint');
});

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

test('PHPStan temporary configuration is removed after its lint step', (t) => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'kit-lint-phpstan-cleanup-'));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = temporary;
  try {
    const { root } = checkout(t, { tempLeak: true });
    assert.deepEqual(lint(root, () => {}), []);
    const phpstanTemporaryDirectory = readFileSync(path.join(root, 'phpstan-tmpdir'), 'utf8');
    assert.equal(existsSync(path.join(phpstanTemporaryDirectory, 'phpstan/cache/nette.configurator')), false);

    const failing = checkout(t, { failing: 'phpstan', tempLeak: true });
    assert.deepEqual(lint(failing.root, () => {}), ['phpstan packages/php']);
    const failingTemporaryDirectory = readFileSync(path.join(failing.root, 'phpstan-tmpdir'), 'utf8');
    assert.equal(existsSync(path.join(failingTemporaryDirectory, 'phpstan/cache/nette.configurator')), false);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('a missing tool or autoloader fails with its fix', (t) => {
  assert.throws(() => lintSteps(checkout(t, { installed: ['phpstan'] }).root), /var\/tools\/bin\/phpcs is missing; run make install-tools, which installs config\/php-lint/);
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

test('a repository without PHP sources lints nothing, with no tool and no configuration installed (K319)', (t) => {
  assert.deepEqual(lintSteps(tree(t, { 'docs/a.md': '# a\n' })), []);
});

// K346: the memory that PHPStan needs grows with the package, and php.ini stops it at 128M; a limit only stops the analysis.
test('phpstan runs with no memory limit, so a large package is analysed (K346)', (t) => {
  const steps = lintSteps(checkout(t).root).filter(step => step.label.startsWith('phpstan'));
  assert.equal(steps.length, 1);
  const step = present(steps[0], 'the phpstan step');
  assert.ok(step.args.includes('--memory-limit=-1'), step.args.join(' '));
});

// K377: an autoload file of a Composer package holds only declarations of namespaced functions and constants (S2), and the
// PHP lint reads it with the parser of the PHP symbol extractor, so a require or a class fails with its file and line.
function autoloadFile(t: TestContext, text: string) {
  return checkout(t, { files: { 'packages/php/composer.json': '{"autoload":{"files":["src/functions.php"]}}\n', 'packages/php/src/functions.php': text } });
}

test('an autoload files entry that is not only namespaced functions and constants fails the PHP lint (K377)', (t) => {
  const required = autoloadFile(t, "<?php\n\nrequire __DIR__ . '/impl.php';\n");
  const output: string[] = [];
  assert.deepEqual(lint(required.root, text => output.push(text)), ['autoload files']);
  assert.match(output.join(''), /packages\/php\/src\/functions\.php:3:/);
  assert.deepEqual(lint(autoloadFile(t, '<?php\nnamespace Foo; function bar(): int { return 1; } const BAZ = 1;\n').root, () => {}), []);
  const cls = autoloadFile(t, '<?php\n\nnamespace Foo;\n\nclass Bar {}\n');
  const classOutput: string[] = [];
  assert.deepEqual(lint(cls.root, text => classOutput.push(text)), ['autoload files']);
  assert.match(classOutput.join(''), /packages\/php\/src\/functions\.php:5:/);
});

// K873: the polyfill guard of symfony/polyfill-* bootstrap files: an if whose condition is only !function_exists or !defined of the
// namespaced name that its body alone declares still only declares, so it passes; a guard around anything else, or naming another
// name, fails.
test('an autoload file passes with the polyfill guard of its own declaration and fails with any other guard (K873)', (t) => {
  const guarded = `<?php

declare(strict_types=1);

namespace Polyspec\\OrderedJson;

if (!\\defined('Polyspec\\OrderedJson\\MAX_DEPTH')) {
    \\define('Polyspec\\OrderedJson\\MAX_DEPTH', 256);
}

if (!\\function_exists('Polyspec\\OrderedJson\\parse')) {
    function parse(string $source): string
    {
        return $source;
    }
}

if (!function_exists('\\Polyspec\\OrderedJson\\stringify')) {
    function stringify(string $value): string
    {
        return $value;
    }
}
`;
  assert.deepEqual(lint(autoloadFile(t, guarded).root, () => {}), []);
  for (const [text, line] of [
    ["<?php\nnamespace Foo;\nif (!function_exists('Foo\\\\bar')) {\n    echo 1;\n}\n", 3],
    ["<?php\nnamespace Foo;\nif (!function_exists('Foo\\\\bar')) {\n    function baz(): int { return 1; }\n}\n", 3],
    ["<?php\nnamespace Foo;\nif (!defined('Foo\\\\A')) {\n    define('Foo\\\\B', 1);\n}\n", 3],
    ["<?php\nnamespace Foo;\nif (!function_exists('Foo\\\\bar')) {\n    function bar(): int { return 1; }\n    function baz(): int { return 1; }\n}\n", 3],
    ["<?php\nnamespace Foo;\nif (!function_exists('Foo\\\\bar')) {\n    function bar(): int { return 1; }\n} else {\n    echo 1;\n}\n", 3],
    ["<?php\nif (!function_exists('bar')) {\n    function bar(): int { return 1; }\n}\n", 2],
  ] as const) {
    const output: string[] = [];
    assert.deepEqual(lint(autoloadFile(t, text).root, chunk => output.push(chunk)), ['autoload files'], text);
    assert.match(output.join(''), new RegExp(`packages/php/src/functions\\.php:${line}:`), text);
  }
});

// K514: phpcs and PHPStan read the phpcs.xml.dist and phpstan.dist.neon of the kit package that runs, never a copy.
test('phpcs and PHPStan read the configurations of the kit package, and a checkout without them lints (K514)', (t) => {
  const root = checkout(t).root;
  const steps = lintSteps(root);
  assert.ok(steps.find(step => step.label === 'phpcs')?.args.includes(`--standard=${kitFile('phpcs.xml.dist')}`), JSON.stringify(steps));
  assert.ok(steps.filter(step => step.label.startsWith('phpstan')).every(step => step.args.includes(`--configuration=${kitFile('phpstan.dist.neon')}`)), JSON.stringify(steps));
});

for (const status of [0, 7]) {
  test(`K686-3: cleanup failure preserves tool exit ${status} diagnostics and runs later steps`, (t) => {
    const root = tree(t);
    const directories: string[] = [];
    t.after(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });
    const reports: string[] = [];
    t.mock.method(console, 'log', (...values: unknown[]) => { reports.push(values.map(String).join(' ')); });
    const output: string[] = [];
    const failed = runLint('test-lint', [
      { label: 'first', command: process.execPath, args: ['-e', `console.log('original stdout'); console.error('original stderr'); process.exit(${status});`], cwd: '.', isolatedTemporaryDirectory: true },
      { label: 'later', command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('later-ran', 'yes'); console.log('later stdout');"], cwd: '.' },
    ], root, text => output.push(text), directory => {
      assert.match(path.basename(directory), /^kit-lint-step-/);
      assert.ok(existsSync(directory), 'cleanup receives only the created owned directory');
      directories.push(directory);
      throw new Error('simulated cleanup failure');
    });
    assert.deepEqual(failed, ['first']);
    assert.equal(directories.length, 1);
    assert.equal(readFileSync(path.join(root, 'later-ran'), 'utf8'), 'yes');
    assert.match(output.join(''), /original stdout/);
    assert.match(output.join(''), /original stderr/);
    assert.match(output.join(''), /later stdout/);
    assert.match(reports.join('\n'), /simulated cleanup failure/);
    if (status !== 0) assert.match(reports.join('\n'), /exit status 7/);
  });
}
