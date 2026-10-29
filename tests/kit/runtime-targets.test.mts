// Tests of scripts/kit/runtime-targets.mts: `make test-<runtime> CASES=<pattern>` runs the unit tests of each package of the
// runtime with the name filter of its runner, in the folder of the package; the integration and conformance suites live
// under tests/ of the root and run only in CI (K244).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRuns, caseSensitiveSmokeRuns, goWorkspaceBuilds, goWorkspaceRuns, infrastructureRuns, phpExtensionFolders, runtimeRuns, suiteRuns, taskTargets, type Run } from '../../scripts/kit/runtime-targets.mts';
import { withCaseSensitiveDirectory } from '../../scripts/kit/case-sensitive-directory.mts';
import { libraryFolders } from '../../scripts/kit/php-extension.mts';

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

// PHPUnit's answer to `--list-tests --filter <CASES>` for each library: the tests named `Class::method` that the filter selects.
const phpunitList = (tests: Record<string, string[]>) => (run: Run) => (tests[run.cwd] ?? []).filter(name => new RegExp(run.args[1] ?? '').test(name));

test('the tests of the PHP extension run on PHPUnit with the built extension loaded (S10)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/php-ext/tests/ATest.php'];
  assert.deepEqual(runtimeRuns(files, 'php-ext', 'parses', node, '/r/var/php-ext/polyspec_a.so', undefined, phpunitList({ 'packages/php-ext': ['ATest::parses'] })), [{ cwd: 'packages/php-ext', tool: 'phpunit', options: ['--php-extension', '/r/var/php-ext/polyspec_a.so'], args: ['--filter', 'parses'] }]);
  assert.throws(() => runtimeRuns(files, 'php-ext', 'parses', node), /load the built extension, which is not named/);
});

test('the extension with no tests of its own runs the PHPUnit files of packages/php with the extension loaded (S10, K285)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/php/tests/ATest.php', 'packages/php/composer.json'];
  assert.deepEqual(runtimeRuns(files, 'php-ext', 'parses', node, '/r/var/php-ext/polyspec_a.so', undefined, phpunitList({ 'packages/php': ['ATest::parses'] })), [{ cwd: 'packages/php', tool: 'phpunit', options: ['--php-extension', '/r/var/php-ext/polyspec_a.so'], args: ['--filter', 'parses'] }]);
  const both = [...files, 'packages/php-ext/tests/BTest.php'];
  assert.deepEqual(runtimeRuns(both, 'php-ext', undefined, node, '/r/x.so').map(run => run.cwd), ['packages/php', 'packages/php-ext']);
});

test('the extension of a repository with libraries per component runs the PHPUnit files of every library (K293)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/validator/php/tests/ATest.php', 'packages/generator/php/tests/BTest.php', 'packages/codec/php/src/c.php'];
  assert.deepEqual(runtimeRuns(files, 'php-ext', undefined, node, '/r/x.so').map(run => run.cwd), ['packages/generator/php', 'packages/validator/php']);
});

test('test-php-ext runs CASES only in the libraries where it selects a test, and fails when it selects none (K390)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/validator/php/tests/ATest.php', 'packages/generator/php/tests/BTest.php'];
  const listed = phpunitList({ 'packages/validator/php': ['ATest::testAlpha'], 'packages/generator/php': ['BTest::testBeta'] });
  const notes: string[] = [];
  assert.deepEqual(runtimeRuns(files, 'php-ext', 'testAlpha', node, '/r/x.so', undefined, listed, notes), [{ cwd: 'packages/validator/php', tool: 'phpunit', options: ['--php-extension', '/r/x.so'], args: ['--filter', 'testAlpha'] }]);
  assert.deepEqual(notes, ['packages/generator/php: no case selected by CASES']);
  assert.throws(() => runtimeRuns(files, 'php-ext', 'testGamma', node, '/r/x.so', undefined, listed), /no test of packages\/generator\/php, packages\/validator\/php/);
});

test('test-php-ext takes the selection of CASES from PHPUnit, so a #[Test] method without the prefix counts (K390-1)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/validator/php/tests/ATest.php'];
  // The #[Test] method `reads` has no test prefix, so a reading of `function test…` misses it; PHPUnit lists it as ATest::reads.
  const listed = phpunitList({ 'packages/validator/php': ['ATest::reads'] });
  const notes: string[] = [];
  assert.deepEqual(runtimeRuns(files, 'php-ext', 'reads', node, '/r/x.so', undefined, listed, notes), [{ cwd: 'packages/validator/php', tool: 'phpunit', options: ['--php-extension', '/r/x.so'], args: ['--filter', 'reads'] }]);
  assert.deepEqual(notes, []);
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

test('the Go workspace is the source of truth for every standard module test and build (K739)', () => {
  const files = ['go.work', 'packages/go/go.mod', 'examples/go.mod', 'tests/conformance/go/go.mod'];
  const directories = ['examples', 'packages/go', 'tests/conformance/go'];
  assert.deepEqual(goWorkspaceRuns(files, directories), [{ cwd: '.', tool: 'go', args: ['./examples/...', './packages/go/...', './tests/conformance/go/...'] }]);
  assert.deepEqual(goWorkspaceRuns(['go.work', 'go.mod'], ['.']), [{ cwd: '.', tool: 'go', args: ['./...'] }]);
  assert.deepEqual(goWorkspaceBuilds(files, directories), directories.map(cwd => ({ cwd, command: 'go', args: ['build', './...'] })));
  assert.throws(() => goWorkspaceRuns(files, ['packages/go', 'missing']), /without a tracked go.mod: missing/);
  assert.throws(() => goWorkspaceRuns(files, []), /go.work declares no modules/);
});

test('CASES selects the tests of the one workspace go test by -run, as it does in each module (K832)', () => {
  const files = ['go.work', 'packages/go/go.mod', 'examples/go.mod'];
  assert.deepEqual(goWorkspaceRuns(files, ['examples', 'packages/go'], 'TestToken|TestLock'), [{ cwd: '.', tool: 'go', args: ['-run', 'TestToken|TestLock', './examples/...', './packages/go/...'] }]);
  assert.deepEqual(goWorkspaceRuns(files, ['examples', 'packages/go'], undefined), [{ cwd: '.', tool: 'go', args: ['./examples/...', './packages/go/...'] }]);
});

test('the infrastructure target discovers every tracked Node test and rejects an empty inventory (K739)', () => {
  const files = ['tests/a.test.mts', 'tests/darwin/mount.test.mts', 'tests/linux/fs.test.mts', 'tests/helper.mts'];
  assert.deepEqual(infrastructureRuns(files, 'darwin'), [{ cwd: '.', tool: 'node', args: ['tests/a.test.mts', 'tests/darwin/mount.test.mts'] }]);
  assert.deepEqual(infrastructureRuns(files, 'linux'), [{ cwd: '.', tool: 'node', args: ['tests/a.test.mts', 'tests/linux/fs.test.mts'] }]);
  assert.throws(() => infrastructureRuns(['tests/helper.mts']), /no tracked Node infrastructure tests/);
});

test('the platform smoke requires its tracked fixture and uses the standard Node runner (K739)', () => {
  const fixture = 'tests/kit/standard-case-sensitive-smoke.mts';
  assert.deepEqual(caseSensitiveSmokeRuns([fixture]), [{ cwd: '.', tool: 'node', args: [fixture] }]);
  assert.throws(() => caseSensitiveSmokeRuns([]), /is not tracked/);
});

test('case-sensitive directory uses the platform provisioner and restores the named environment', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'kit-case-test-'));
  const key = 'KIT_CASE_SENSITIVE_TEST_DIR';
  const previous = process.env[key];
  const calls: { file: string; args: string[] }[] = [];
  let verified = false;
  const command = (file: string, args: string[]) => {
    calls.push({ file, args });
    return { status: 0, stdout: '', stderr: '' };
  };
  try {
    let used = '';
    const result = withCaseSensitiveDirectory(key, directory => {
      used = directory;
      assert.equal(process.env[key], directory);
      return 'ran';
    }, { parent, platform: process.platform, command, verify: directory => { verified = existsSync(directory); } });
    assert.equal(result, 'ran');
    assert.equal(verified, true);
    assert.equal(process.env[key], previous);
    assert.equal(existsSync(used), false, 'the temporary test directory is removed');
    if (process.platform === 'darwin') assert.deepEqual(calls.map(call => call.file), ['hdiutil', 'hdiutil', 'hdiutil']);
    else if (process.platform === 'win32') assert.match(calls[0]?.file ?? '', /fsutil\.exe$/);
    else assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    rmSync(parent, { recursive: true, force: true });
  }
});

test('case-sensitive directory rejects an invalid environment key before running the action', () => {
  assert.throws(() => withCaseSensitiveDirectory('BAD-NAME', () => assert.fail('must not run')), /invalid environment variable name/);
});

test('a failed disk-image detach retains its resources and preserves the action failure (K739)', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'kit-case-detach-'));
  const actionError = new Error('case-sensitive action failed');
  const calls: string[][] = [];
  let directory = '';
  try {
    assert.throws(() => withCaseSensitiveDirectory('KIT_CASE_SENSITIVE_TEST_DIR', (place) => {
      directory = place;
      writeFileSync(path.join(place, 'owned'), 'preserve');
      throw actionError;
    }, {
      platform: 'darwin',
      parent,
      verify: () => undefined,
      command: (_file, args) => {
        calls.push(args);
        return args[0] === 'detach' ? { status: 1, stderr: 'busy' } : { status: 0, stdout: '', stderr: '' };
      },
    }), error => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], actionError);
      assert.match(String(error.errors[1]), /retained the mountpoint and image/);
      assert.match(String(error.errors[1]), /hdiutil detach/);
      return true;
    });
    assert.deepEqual(calls.map(args => args[0]), ['create', 'attach', 'detach']);
    assert.equal(readFileSync(path.join(directory, 'owned'), 'utf8'), 'preserve', 'the mounted directory was not recursively removed');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a failed attach with an unconfirmed detach retains the possibly mounted path (K739)', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'kit-case-attach-'));
  const calls: string[][] = [];
  let mountpoint = '';
  let ran = false;
  try {
    assert.throws(() => withCaseSensitiveDirectory('KIT_CASE_SENSITIVE_TEST_DIR', () => { ran = true; }, {
      platform: 'darwin',
      parent,
      verify: () => undefined,
      command: (_file, args) => {
        calls.push(args);
        if (args[0] === 'attach') {
          mountpoint = args[3] ?? '';
          return { status: 1, stderr: 'attach outcome uncertain' };
        }
        return args[0] === 'detach' ? { status: 1, stderr: 'not confirmed detached' } : { status: 0, stdout: '', stderr: '' };
      },
    }), error => {
      assert.ok(error instanceof AggregateError);
      assert.match(String(error.errors[0]), /hdiutil attach/);
      assert.match(String(error.errors[1]), /retained the mountpoint and image/);
      return true;
    });
    assert.equal(ran, false);
    assert.deepEqual(calls.map(args => args[0]), ['create', 'attach', 'detach']);
    assert.equal(existsSync(mountpoint), true, 'an uncertain mountpoint is left in place');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
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

// A Composer package of type project is an application, not a library: the extension run and the S10 checks leave it out, and
// test-php runs its tests as a package of its own.
const K433_TEXTS: Record<string, string> = {
  'packages/php/composer.json': '{"name":"polyspec/kit"}',
  'packages/cli/php/composer.json': '{"name":"polyspec/kit-cli","type":"project"}',
};
const k433Read = (file: string) => K433_TEXTS[file];
const K433_FILES = ['packages/php-ext/src/a.c', 'packages/php/composer.json', 'packages/php/tests/ATest.php', 'packages/cli/php/composer.json', 'packages/cli/php/tests/CTest.php'];

test('a PHP package of type project is left out of the extension run, whose libraries are the others (K433)', () => {
  assert.deepEqual(phpExtensionFolders(K433_FILES, 'packages/php-ext', k433Read), ['packages/php']);
  const listed = phpunitList({ 'packages/php': ['ATest::parses'], 'packages/cli/php': ['CTest::parses'] });
  assert.deepEqual(runtimeRuns(K433_FILES, 'php-ext', 'parses', node, '/r/x.so', undefined, listed, [], k433Read).map(run => run.cwd), ['packages/php']);
});

test('test-php runs the tests of a PHP package of type project as a package of its own (K433)', () => {
  assert.deepEqual(runtimeRuns(K433_FILES, 'php', undefined, node, undefined, undefined, undefined, undefined, k433Read), [
    { cwd: 'packages/cli/php', tool: 'phpunit', args: [] },
    { cwd: 'packages/php', tool: 'phpunit', args: [] },
  ]);
});

test('libraryFolders leaves out a PHP package of type project (K433)', () => {
  assert.deepEqual(libraryFolders(K433_FILES, k433Read), ['packages/php']);
});
