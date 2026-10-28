// The real PHP lint: lint-php.mts runs the phpcs and the PHPStan of var/tools (config/php-lint, make install-tools
// TOOLS=phpLint) on a repository that holds the phpcs.xml.dist and phpstan.dist.neon of this checkout, with the autoloader that
// the Composer of var/tools dumps for its package. A package that follows S2 passes; each violation planted into a copy of it
// fails with the sniff or the rule that names it. Nothing is stubbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint } from '../../scripts/kit/lint-php.mts';
import { installedBinary } from './real-tools.mts';
import { known } from '../kit/known.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// phpcs and phpstan are the wrappers of the Composer project config/php-lint; Composer is the one of mise.toml.
const TOOLS = ['phpcs', 'phpstan'].map(name => path.join(ROOT, 'var/tools/bin', name));
const COMPOSER_HOME = path.join(ROOT, 'var/tools/composer/home');

const php = (body: string) => `<?php\n\ndeclare(strict_types=1);\n\nnamespace Polyspec\\Demo;\n\n${body}`;
const DEMO = 'packages/php/src/Demo.php';

// A library that loads its classes by PSR-4 and its tests by autoload-dev, and a stub of a PHP extension, which declares
// several classes by the design of gen_stub.php.
const GOOD: Record<string, string> = {
  '.gitignore': 'var/\nvendor/\n',
  'packages/php/composer.json': JSON.stringify({ name: 'polyspec/demo', type: 'library', license: 'MIT', autoload: { 'psr-4': { 'Polyspec\\Demo\\': 'src/' } }, 'autoload-dev': { 'psr-4': { 'Polyspec\\Demo\\Tests\\': 'tests/' } } }, null, 4),
  [DEMO]: php('final class Demo\n{\n    public function double(int $value): int\n    {\n        return $value * 2;\n    }\n}\n'),
  'packages/php-ext/demo.stub.php': '<?php\n\n/** @generate-class-entries */\n\nnamespace Polyspec\\Demo\\Native;\n\nfinal class Engine {}\n\nfinal class Value {}\n',
};

// One violation for each rule: the files it adds or replaces, and the text that the failing step prints for it.
const VIOLATIONS: { name: string; files: Record<string, string>; finding: RegExp }[] = [
  { name: 'an extra class in a file', files: { [DEMO]: `${GOOD[DEMO]}\nfinal class Extra\n{\n}\n` }, finding: /src\/Demo\.php:\d+:\d+: error - Each class must be in a file by itself \(PSR1\.Classes\.ClassDeclaration\.MultipleClasses\)/ },
  { name: 'a class file with a side effect', files: { [DEMO]: `${GOOD[DEMO]}\necho 'loaded';\n` }, finding: /src\/Demo\.php:1:1: warning - A file should declare new symbols .* \(PSR1\.Files\.SideEffects\.FoundWithSymbols\)/ },
  { name: 'spl_autoload_register', files: { 'packages/php/src/Loader.php': php('final class Loader\n{\n    public static function register(): void\n    {\n        spl_autoload_register(static fn (string $class) => null);\n    }\n}\n') }, finding: /Calling spl_autoload_register\(\) is forbidden, S2: classes load through the PSR-4 autoloader of Composer; never register an autoloader/ },
  { name: 'spl_autoload_register through a string variable', files: { 'packages/php/src/Loader.php': php("final class Loader\n{\n    public static function register(): void\n    {\n        $register = 'spl_autoload_register';\n        $register(static fn (string $class) => null);\n    }\n}\n") }, finding: /Calling spl_autoload_register\(\) is forbidden/ },
  { name: 'a ClassLoader changed at run time', files: { 'packages/php/src/Loader.php': php("final class Loader\n{\n    public static function register(\\Composer\\Autoload\\ClassLoader $loader): void\n    {\n        $loader->addPsr4('Generated\\\\', __DIR__);\n    }\n}\n") }, finding: /Calling Composer\\Autoload\\ClassLoader::addPsr4\(\) is forbidden, S2: classes load through the PSR-4 autoloader of Composer; never change a ClassLoader at run time/ },
  // No swallowed error (K256): an empty catch.
  { name: 'an empty catch', files: { [DEMO]: php('final class Demo\n{\n    public function double(int $value): int\n    {\n        try {\n            return $value * 2;\n        } catch (\\Throwable $error) {\n        }\n        return 0;\n    }\n}\n') }, finding: /Generic\.CodeAnalysis\.EmptyStatement/ },
  // P8 (K334): an error suppressed with @, and a catch that holds only a comment.
  { name: 'an error suppression with @', files: { [DEMO]: php('final class Demo\n{\n    public function double(int $value): int\n    {\n        return (int) @file_get_contents(__FILE__) * $value;\n    }\n}\n') }, finding: /Generic\.PHP\.NoSilencedErrors/ },
  { name: 'a catch that holds only a comment', files: { [DEMO]: php('final class Demo\n{\n    public function double(int $value): int\n    {\n        try {\n            return $value * 2;\n        } catch (\\Throwable $error) {\n            // nothing\n        }\n        return 0;\n    }\n}\n') }, finding: /Generic\.CodeAnalysis\.EmptyStatement/ },
];

// The variants that state their need pass (P8): phpcs:ignore with the sniff and its reason.
const STATED: { name: string; files: Record<string, string> }[] = [
  { name: 'an error suppression with its reason', files: { [DEMO]: php('final class Demo\n{\n    public function double(int $value): int\n    {\n        // phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged -- the read fails on a missing file, which the next line checks\n        $text = @file_get_contents(__FILE__);\n        return $text === false ? 0 : $value * 2;\n    }\n}\n') } },
];

/** Writes `files` below `root`. */
function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}

const composer = (cwd: string, ...args: string[]) => spawnSync(installedBinary('composer'), ['--no-interaction', ...args], { cwd, encoding: 'utf8', env: { ...process.env, COMPOSER_HOME } });

// K163: the development project of a Composer monorepo at the root, which requires the library through a path repository
// and installs the one vendor/ of the checkout; Packagist is off, so the install reads no network.
const MONOREPO: Record<string, string> = {
  'composer.json': JSON.stringify({ name: 'polyspec/development', type: 'project', license: 'MIT', repositories: [{ packagist: false }, { type: 'path', url: 'packages/php' }], require: { 'polyspec/demo': '*@dev' } }, null, 4),
};

/**
 * A repository in a temporary folder: GOOD with `files` over it, the PHP lint files of this checkout, its tools and the
 * autoloader of its package; with `install` the vendor/ that composer update writes for the project of that folder instead,
 * and with null no vendor/.
 */
function repository(t: TestContext, files: Record<string, string> = {}, install: string | null = 'packages/php'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-php-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, { ...GOOD, ...files });
  for (const file of ['phpcs.xml.dist', 'phpstan.dist.neon']) copyFileSync(path.join(ROOT, file), path.join(root, file));
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  for (const tool of TOOLS) symlinkSync(tool, path.join(root, 'var/tools/bin', path.basename(tool)));
  if (install !== null) {
    const dump = install === 'packages/php' ? composer(path.join(root, install), 'dump-autoload', '--quiet') : composer(path.join(root, install), 'update', '--quiet', '--no-audit');
    assert.equal(dump.status, 0, dump.stderr);
  }
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return root;
}

/** The labels of the failed steps of the lint of `root` and everything the steps printed. */
function lintOf(root: string): { failed: string[]; output: string } {
  let output = '';
  const failed = lint(root, text => { output += text; });
  return { failed, output };
}

test('the PHP lint passes on a PSR-4 library and the stub of an extension', (t) => {
  for (const tool of TOOLS) assert.ok(existsSync(tool), `${path.relative(ROOT, tool)} is missing; make install-tools installs it`);
  const { failed, output } = lintOf(repository(t));
  assert.deepEqual(failed, [], output);
});

test('the PHP lint fails on each planted violation with the sniff or the rule that names it', (t) => {
  for (const { name, files, finding } of VIOLATIONS) {
    const { failed, output } = lintOf(repository(t, files));
    assert.notDeepEqual(failed, [], `${name}: the violation passed:\n${output}`);
    assert.match(output, finding, `${name} is not named:\n${output}`);
  }
});

test('the PHP lint requires a replacement exception to retain its caught cause (P8, K334)', (t) => {
  const lostCause = php('final class Demo\n{\n    public function double(int $value): int\n    {\n        try {\n            return $value * 2;\n        } catch (\\Throwable $error) {\n            throw new \\RuntimeException("doubling failed");\n        }\n    }\n}\n');
  const failed = lintOf(repository(t, { [DEMO]: lostCause }));
  assert.deepEqual(failed.failed, ['phpstan packages/php'], `only PHPStan should reject the cause loss:\n${failed.output}`);
  assert.match(failed.output, /shipmonk\.missingPreviousException/, 'the PHPStan rule did not name the cause loss');

  for (const source of [
    php('final class Demo\n{\n    public function double(int $value): int\n    {\n        try {\n            return $value * 2;\n        } catch (\\Throwable $error) {\n            throw new \\RuntimeException("doubling failed", 0, $error);\n        }\n    }\n}\n'),
    php('final class Demo\n{\n    public function double(int $value): int\n    {\n        try {\n            return $value * 2;\n        } catch (\\Throwable $error) {\n            throw $error;\n        }\n    }\n}\n'),
  ]) {
    const result = lintOf(repository(t, { [DEMO]: source }));
    assert.deepEqual(result.failed, [], result.output);
  }
});

test('the PHP lint resolves a library of a Composer monorepo with the autoloader of the root project', (t) => {
  const root = repository(t, MONOREPO, '.');
  assert.ok(!existsSync(path.join(root, 'packages/php/vendor')), 'the library has a vendor/ of its own');
  const { failed, output } = lintOf(root);
  assert.deepEqual(failed, [], output);
  const planted = repository(t, { ...MONOREPO, ...known(VIOLATIONS[4], 'VIOLATIONS[4]').files }, '.');
  assert.match(lintOf(planted).output, known(VIOLATIONS[4], 'VIOLATIONS[4]').finding);
});

test('a library with no vendor/ in it or in a project above it still fails with the install it needs', (t) => {
  const root = repository(t, MONOREPO, null);
  assert.throws(() => lintOf(root), /packages\/php\/vendor\/autoload\.php is missing, and no Composer project above packages\/php has one/);
});

// The false green of the plan's verification: --strict-psr accepts a file whose first class matches its name and drops the
// others in silence, so only the phpcs sniff of the lint holds one class per file.
test('composer dump-autoload --strict-psr passes the extra class that the PHP lint fails', (t) => {
  const root = repository(t, known(VIOLATIONS[0], 'VIOLATIONS[0]').files);
  const strict = composer(path.join(root, 'packages/php'), 'dump-autoload', '--optimize', '--strict-psr');
  assert.equal(strict.status, 0, `${strict.stdout}${strict.stderr}`);
  assert.deepEqual(lintOf(root).failed, ['phpcs']);
});

test('a variant that states its need passes the PHP lint', (t) => {
  for (const { name, files } of STATED) {
    const { failed, output } = lintOf(repository(t, files));
    assert.deepEqual(failed, [], `${name}: ${output}`);
  }
});
