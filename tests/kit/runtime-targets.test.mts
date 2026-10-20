// Tests of scripts/kit/runtime-targets.mts: `make test-<runtime> CASES=<pattern>` runs the unit tests of each package of the
// runtime with the name filter of its runner, in the folder of the package; the integration and conformance suites live
// under tests/ of the root and run only in CI (K244).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuns, runtimeRuns, suiteRuns, taskTargets } from '../../scripts/kit/runtime-targets.mts';

const FILES = [
  'packages/ts/src/a.ts', 'packages/ts/tests/a.test.ts', 'packages/ts/package.json',
  'packages/validator/go/go.mod', 'packages/validator/go/a.go', 'packages/validator/go/a_test.go',
  'packages/php/tests/ATest.php', 'packages/python/tests/__init__.py', 'packages/python/tests/test_a.py', 'packages/rust/Cargo.toml',
  'tests/integration/go/go.mod', 'tests/integration/go/a_test.go', 'tests/conformance/ts/a.test.ts',
];
const node = () => false;

test('each package of a runtime runs its runner with the name filter of CASES in its folder (K244)', () => {
  assert.deepEqual(runtimeRuns(FILES, 'ts', 'parses', node), [{ cwd: 'packages/ts', tool: 'node', args: ['--test-name-pattern', 'parses', 'tests/a.test.ts'] }]);
  assert.deepEqual(runtimeRuns(FILES, 'ts', 'parses', () => true), [{ cwd: 'packages/ts', tool: 'vitest', args: ['-t', 'parses'] }]);
  assert.deepEqual(runtimeRuns(FILES, 'go', 'TestA', node), [{ cwd: 'packages/validator/go', tool: 'go', args: ['-run', 'TestA', './...'] }]);
  assert.deepEqual(runtimeRuns(FILES, 'php', 'parses', node), [{ cwd: 'packages/php', tool: 'phpunit', args: ['--filter', 'parses'] }]);
  assert.deepEqual(runtimeRuns(FILES, 'python', 'parses', node), [{ cwd: 'packages/python', tool: 'python', args: ['-k', 'parses'] }]);
  assert.deepEqual(runtimeRuns(FILES, 'rust', 'parses', node), [{ cwd: 'packages/rust', tool: 'cargo', args: ['parses'] }]);
  assert.deepEqual(runtimeRuns(FILES, 'go', undefined, node), [{ cwd: 'packages/validator/go', tool: 'go', args: ['./...'] }], 'without CASES every unit test runs, which run-tests allows only in CI');
  assert.throws(() => runtimeRuns(FILES, 'js', 'x', node), /no package of the runtime js/);
});

test('the tests of the PHP extension run on PHPUnit with the built extension loaded (S10)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/php-ext/tests/ATest.php'];
  assert.deepEqual(runtimeRuns(files, 'php-ext', 'parses', node, '/r/var/php-ext/polyspec_a.so'), [{ cwd: 'packages/php-ext', tool: 'phpunit', options: ['--php-extension', '/r/var/php-ext/polyspec_a.so'], args: ['--filter', 'parses'] }]);
  assert.throws(() => runtimeRuns(files, 'php-ext', 'parses', node), /load the built extension, which is not named/);
});

test('the extension with no tests of its own runs the PHPUnit files of packages/php with the extension loaded (S10, K285)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/php/tests/ATest.php', 'packages/php/composer.json'];
  assert.deepEqual(runtimeRuns(files, 'php-ext', 'parses', node, '/r/var/php-ext/polyspec_a.so'), [{ cwd: 'packages/php', tool: 'phpunit', options: ['--php-extension', '/r/var/php-ext/polyspec_a.so', '--without-library', 'packages/php'], args: ['--filter', 'parses'] }]);
  const both = [...files, 'packages/php-ext/tests/BTest.php'];
  assert.deepEqual(runtimeRuns(both, 'php-ext', undefined, node, '/r/x.so').map(run => run.cwd), ['packages/php', 'packages/php-ext']);
});

test('the extension of a repository with libraries per component runs the PHPUnit files of every library (K293)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/validator/php/tests/ATest.php', 'packages/generator/php/tests/BTest.php', 'packages/codec/php/src/c.php'];
  assert.deepEqual(runtimeRuns(files, 'php-ext', undefined, node, '/r/x.so').map(run => run.cwd), ['packages/generator/php', 'packages/validator/php']);
});

test('the test directories of a Python package are packages, which unittest discovers only as such (K298)', () => {
  const ok = ['packages/python/pyproject.toml', 'packages/python/tests/__init__.py', 'packages/python/tests/test_a.py', 'packages/python/tests/sub/__init__.py', 'packages/python/tests/sub/test_b.py'];
  assert.deepEqual(runtimeRuns(ok, 'python', 'parses', node), [{ cwd: 'packages/python', tool: 'python', args: ['-k', 'parses'] }]);
  const flat = ['packages/python/pyproject.toml', 'packages/python/tests/test_a.py'];
  assert.throws(() => runtimeRuns(flat, 'python', 'parses', node), /packages\/python\/tests: unittest discovers a directory only as a package; add packages\/python\/tests\/__init__\.py/);
  const nested = ['packages/python/tests/__init__.py', 'packages/python/tests/sub/test_b.py'];
  assert.throws(() => runtimeRuns(nested, 'python', undefined, node), /add packages\/python\/tests\/sub\/__init__\.py/);
  assert.deepEqual(runtimeRuns(['packages/python/pyproject.toml'], 'python', undefined, node), [{ cwd: 'packages/python', tool: 'python', args: [] }]);
});

test('a suite runs the folder of each runtime under tests/<suite>/ of the root (K244)', () => {
  assert.deepEqual(suiteRuns(FILES, 'integration', node), [{ cwd: 'tests/integration/go', tool: 'go', args: ['./...'] }]);
  assert.deepEqual(suiteRuns(FILES, 'conformance', node), [{ cwd: 'tests/conformance/ts', tool: 'node', args: ['a.test.ts'] }]);
});

test('build-<runtime> runs the build of its ecosystem in each package, and names a runtime that has none (K246)', () => {
  const files = [...FILES, 'packages/ts/tsconfig.build.json', 'packages/python/pyproject.toml'];
  assert.deepEqual(buildRuns(files, 'go'), [{ cwd: 'packages/validator/go', command: 'go', args: ['build', './...'] }]);
  assert.deepEqual(buildRuns(files, 'rust'), [{ cwd: 'packages/rust', command: 'cargo', args: ['build', '--locked'] }]);
  assert.deepEqual(buildRuns(files, 'ts'), [{ cwd: 'packages/ts', command: 'tsc', args: ['-p', 'tsconfig.build.json'] }]);
  assert.deepEqual(buildRuns(files, 'python'), [{ cwd: 'packages/python', command: 'uv', args: ['build'] }]);
  assert.deepEqual(buildRuns(files, 'php'), [], 'a PHP library has no build step');
});

test('build, test and lint run the target of each runtime that packages/ holds (K246)', () => {
  assert.deepEqual(taskTargets(FILES, 'lint'), ['lint-go', 'lint-php', 'lint-python', 'lint-rust', 'lint-ts']);
  assert.deepEqual(taskTargets(FILES, 'test'), ['test-go', 'test-php', 'test-python', 'test-rust', 'test-ts']);
});

test('the tests of a Python package run in the environment of the package, found at or above it (K324)', () => {
  const files = ['packages/python/pyproject.toml', 'packages/python/tests/__init__.py', 'packages/python/tests/test_a.py'];
  assert.deepEqual(runtimeRuns(files, 'python', 'x', node, undefined, folder => (folder === 'packages/python' ? 'packages/python/.venv' : undefined)), [{ cwd: 'packages/python', tool: 'python', options: ['--venv', 'packages/python/.venv'], args: ['-k', 'x'] }]);
  assert.deepEqual(runtimeRuns(files, 'python', 'x', node), [{ cwd: 'packages/python', tool: 'python', args: ['-k', 'x'] }], 'without an environment the python of mise runs, as before');
});

test('the unit tests of a script package are its *.test.* and *.spec.* files, never a helper or a probe of tests/ (K325)', () => {
  const files = ['packages/js/tests/a.test.mjs', 'packages/js/tests/b.spec.js', 'packages/js/tests/probe.mjs', 'packages/js/tests/helper.mts', 'packages/js/src/c.test.ts'];
  assert.deepEqual(runtimeRuns(files, 'js', undefined, node), [{ cwd: 'packages/js', tool: 'node', args: ['tests/a.test.mjs', 'tests/b.spec.js', 'src/c.test.ts'] }]);
});
