// Tests of scripts/kit/runtime-targets.mts: `runtime-targets test --runner <runner> --roots <folder>...` runs the
// unit tests of each root that the caller selects with the name filter of its runner, in the folder of the root; kit sets no runtime,
// package layout, test folder or build command (K244, K1106).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRuns, caseSensitiveSmokeRuns, infrastructureRuns, nothingRan, selectionOf, testRuns, type Run } from '../../scripts/kit/runtime-targets.mts';
import { withCaseSensitiveDirectory } from '../../scripts/kit/case-sensitive-directory.mts';
import { tool } from './kit-tools.mts';
import { tree } from './tree.mts';

const FILES = [
  'packages/ts/src/a.ts', 'packages/ts/tests/a.test.ts', 'packages/ts/package.json',
  'packages/validator/go/go.mod', 'packages/validator/go/a.go', 'packages/validator/go/a_test.go',
  'packages/php/tests/ATest.php', 'packages/python/tests/__init__.py', 'packages/python/tests/test_a.py', 'packages/rust/Cargo.toml',
];

test('each root runs its runner with the name filter of CASES in its folder (K244, K1106)', () => {
  assert.deepEqual(testRuns(FILES, 'node', ['packages/ts'], 'parses'), [{ cwd: 'packages/ts', tool: 'node', args: ['--test-name-pattern', 'parses'] }]);
  assert.deepEqual(testRuns(FILES, 'vitest', ['packages/ts'], 'parses'), [{ cwd: 'packages/ts', tool: 'vitest', args: ['-t', 'parses'] }]);
  assert.deepEqual(testRuns(FILES, 'go', ['packages/validator/go'], 'TestA'), [{ cwd: 'packages/validator/go', tool: 'go', args: ['-run', 'TestA', './...'] }]);
  assert.deepEqual(testRuns(FILES, 'php', ['packages/php'], 'parses'), [{ cwd: 'packages/php', tool: 'phpunit', args: ['--filter', 'parses'] }]);
  assert.deepEqual(testRuns(FILES, 'python', ['packages/python'], 'parses'), [{ cwd: 'packages/python', tool: 'python', args: ['-k', 'parses'] }]);
  assert.deepEqual(testRuns(FILES, 'cargo', ['packages/rust'], 'parses'), [{ cwd: 'packages/rust', tool: 'cargo', args: ['parses'] }]);
  assert.deepEqual(testRuns(FILES, 'go', ['packages/validator/go'], undefined), [{ cwd: 'packages/validator/go', tool: 'go', args: ['./...'] }], 'without CASES every unit test runs');
});

// PHPUnit's answer to `--list-tests --filter <CASES>` for each library: the tests named `Class::method` that the filter selects.
const phpunitList = (tests: Record<string, string[]>) => (run: Run) => (tests[run.cwd] ?? []).filter(name => new RegExp(run.args[1] ?? '').test(name));

test('the tests of the PHP extension run on PHPUnit with the built extension loaded (S10)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/php-ext/tests/ATest.php'];
  assert.deepEqual(testRuns(files, 'php', ['packages/php-ext'], 'parses', '/r/var/php-ext/polyspec_a.so', undefined, phpunitList({ 'packages/php-ext': ['ATest::parses'] }), []), [{ cwd: 'packages/php-ext', tool: 'phpunit', options: ['--php-extension', '/r/var/php-ext/polyspec_a.so'], args: ['--filter', 'parses'] }]);
});

test('the extension runs the PHPUnit files of each selected root that holds a test, with the extension loaded (S10, K285, K293)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/php/tests/ATest.php', 'packages/php/composer.json'];
  assert.deepEqual(testRuns(files, 'php', ['packages/php', 'packages/php-ext'], undefined, '/r/x.so').map(run => run.cwd), ['packages/php']);
  const both = [...files, 'packages/php-ext/tests/BTest.php'];
  assert.deepEqual(testRuns(both, 'php', ['packages/php-ext', 'packages/php'], undefined, '/r/x.so').map(run => run.cwd), ['packages/php', 'packages/php-ext']);
  const components = ['packages/php-ext/src/a.c', 'packages/validator/php/tests/ATest.php', 'packages/generator/php/tests/BTest.php', 'packages/codec/php/src/c.php'];
  assert.deepEqual(testRuns(components, 'php', ['packages/validator/php', 'packages/generator/php', 'packages/codec/php'], undefined, '/r/x.so').map(run => run.cwd), ['packages/generator/php', 'packages/validator/php']);
});

test('the extension runs CASES only in the roots where it selects a test, and fails when it selects none (K390)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/validator/php/tests/ATest.php', 'packages/generator/php/tests/BTest.php'];
  const roots = ['packages/validator/php', 'packages/generator/php'];
  const listed = phpunitList({ 'packages/validator/php': ['ATest::testAlpha'], 'packages/generator/php': ['BTest::testBeta'] });
  const notes: string[] = [];
  assert.deepEqual(testRuns(files, 'php', roots, 'testAlpha', '/r/x.so', undefined, listed, notes), [{ cwd: 'packages/validator/php', tool: 'phpunit', options: ['--php-extension', '/r/x.so'], args: ['--filter', 'testAlpha'] }]);
  assert.deepEqual(notes, ['packages/generator/php: no case selected by CASES']);
  assert.throws(() => testRuns(files, 'php', roots, 'testGamma', '/r/x.so', undefined, listed, []), /no test of packages\/generator\/php, packages\/validator\/php/);
});

test('the extension takes the selection of CASES from PHPUnit, so a #[Test] method without the prefix counts (K390-1)', () => {
  const files = ['packages/php-ext/src/a.c', 'packages/validator/php/tests/ATest.php'];
  // The #[Test] method `reads` has no test prefix, so a reading of `function test…` misses it; PHPUnit lists it as ATest::reads.
  const listed = phpunitList({ 'packages/validator/php': ['ATest::reads'] });
  const notes: string[] = [];
  assert.deepEqual(testRuns(files, 'php', ['packages/validator/php'], 'reads', '/r/x.so', undefined, listed, notes), [{ cwd: 'packages/validator/php', tool: 'phpunit', options: ['--php-extension', '/r/x.so'], args: ['--filter', 'reads'] }]);
  assert.deepEqual(notes, []);
});

test('the infrastructure run is node --test in each path that the caller names, with its runner arguments (K739, K1106)', () => {
  assert.deepEqual(infrastructureRuns(['tests']), [{ cwd: 'tests', tool: 'node', args: [] }]);
  assert.deepEqual(infrastructureRuns(['tools/', 'tests/darwin'], ['--test-concurrency=1']), [{ cwd: 'tests/darwin', tool: 'node', args: ['--test-concurrency=1'] }, { cwd: 'tools', tool: 'node', args: ['--test-concurrency=1'] }]);
});

test('the platform smoke runs the files that the caller names with the standard Node runner (K739, K1074)', () => {
  const fixture = 'tests/kit/standard-case-sensitive-smoke.mts';
  assert.deepEqual(caseSensitiveSmokeRuns([fixture]), [{ cwd: '.', tool: 'node', args: [fixture] }]);
  assert.throws(() => caseSensitiveSmokeRuns([]), /needs the smoke files as arguments/);
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

test('build runs the command of the caller in each root (K246, K1106)', () => {
  assert.deepEqual(buildRuns(['packages/rust', 'benchmarks/rust', 'packages/rust/'], 'cargo', ['build', '--locked']), [
    { cwd: 'benchmarks/rust', command: 'cargo', args: ['build', '--locked'] },
    { cwd: 'packages/rust', command: 'cargo', args: ['build', '--locked'] },
  ]);
  assert.deepEqual(buildRuns(['packages/ts'], 'tsc', ['-p', 'tsconfig.build.json']), [{ cwd: 'packages/ts', command: 'tsc', args: ['-p', 'tsconfig.build.json'] }]);
});

test('the tests of a Python package run in the environment that the caller names in each root, or with the python of PATH (K324, K1106)', () => {
  const files = ['packages/python/pyproject.toml', 'packages/python/tests/test_a.py', 'tools/python/tests/test_b.py'];
  assert.deepEqual(testRuns(files, 'python', ['packages/python', 'tools/python'], 'x', undefined, '.venv'), [
    { cwd: 'packages/python', tool: 'python', options: ['--venv', 'packages/python/.venv'], args: ['-k', 'x'] },
    { cwd: 'tools/python', tool: 'python', options: ['--venv', 'tools/python/.venv'], args: ['-k', 'x'] },
  ]);
  assert.deepEqual(testRuns(files, 'python', ['packages/python'], 'x'), [{ cwd: 'packages/python', tool: 'python', args: ['-k', 'x'] }], 'without --venv kit looks for no environment');
});

test('K1106 a node root is node --test in its folder, which finds the test files itself; kit lists none', () => {
  assert.deepEqual(testRuns(['packages/js/tests/helper.mts'], 'node', ['packages/js'], undefined), [{ cwd: 'packages/js', tool: 'node', args: [] }]);
});

// K1074, K1106: a target that runs nothing fails; with no file list of kit, the count that each run records shows it.
test('K1106 a run whose recorded count shows no test that ran is found nothing to run', (t) => {
  assert.equal(nothingRan('packages/js', { ran: 3, skipped: 0 }), undefined);
  assert.equal(nothingRan('packages/js', { ran: 0, skipped: 2 }), 'packages/js: found nothing to run (0 tests ran)');
  assert.equal(nothingRan('packages/js', undefined), 'packages/js: found nothing to run (the run reported no test count)');
  // A node root without a test file: node --test finds none, and the target fails.
  const root = tree(t, { 'packages/js/package.json': '{}\n', 'packages/js/tests/helper.mjs': 'export const a = 1;\n' });
  const cli = tool(import.meta.resolve('../../scripts/kit/runtime-targets.mts'));
  const empty = spawnSync(process.execPath, [cli, 'test', '--runner', 'node', '--roots', 'packages/js'], { cwd: root, encoding: 'utf8' });
  assert.equal(empty.status, 1, `${empty.stdout}\n${empty.stderr}`);
  assert.match(empty.stderr, /packages\/js: found nothing to run/);
});

test('K1106 the runner arguments of the caller after -- go to every run, and kit adds no flag of its own', () => {
  assert.deepEqual(selectionOf(['--runner', 'go', '--roots', 'a', 'b', '--', '-count=1', '-timeout=0']), { runner: 'go', roots: ['a', 'b'], command: ['-count=1', '-timeout=0'] });
  assert.deepEqual(selectionOf(['--runner', 'python', '--roots', 'a', '--venv', '.venv']), { runner: 'python', roots: ['a'], venv: '.venv', command: [] });
  assert.deepEqual(testRuns([], 'go', ['a', 'b'], 'TestA', undefined, undefined, undefined, [], ['-count=1', '-timeout=0']), [{ cwd: '.', tool: 'go', args: ['-run', 'TestA', '-count=1', '-timeout=0', './a/...', './b/...'] }]);
  assert.deepEqual(testRuns([], 'cargo', ['a'], 'parses', undefined, undefined, undefined, [], ['--', '--test-threads=1']), [{ cwd: 'a', tool: 'cargo', args: ['parses', '--', '--test-threads=1'] }]);
  assert.deepEqual(testRuns([], 'node', ['a'], undefined, undefined, undefined, undefined, [], ['--test-concurrency=1']), [{ cwd: 'a', tool: 'node', args: ['--test-concurrency=1'] }]);
  assert.deepEqual(testRuns([], 'vitest', ['a'], undefined), [{ cwd: 'a', tool: 'vitest', args: [] }]);
});

test('a PHP package of type project runs its tests as a root of its own (K433)', () => {
  const files = ['packages/php/composer.json', 'packages/php/tests/ATest.php', 'packages/cli/php/composer.json', 'packages/cli/php/tests/CTest.php'];
  assert.deepEqual(testRuns(files, 'php', ['packages/php', 'packages/cli/php'], undefined), [
    { cwd: 'packages/cli/php', tool: 'phpunit', args: [] },
    { cwd: 'packages/php', tool: 'phpunit', args: [] },
  ]);
});

test('K1106 several go roots run in one go test from the root with their ./<root>/... patterns', () => {
  assert.deepEqual(testRuns([], 'go', ['packages/go', 'examples'], 'TestA'), [{ cwd: '.', tool: 'go', args: ['-run', 'TestA', './examples/...', './packages/go/...'] }]);
  assert.deepEqual(testRuns([], 'go', ['packages/go', 'examples'], undefined), [{ cwd: '.', tool: 'go', args: ['./examples/...', './packages/go/...'] }]);
  assert.equal(testRuns([], 'cargo', ['crates/a', 'crates/b'], undefined).length, 2, 'cargo runs each root on its own');
});

// K1106: the caller names the runner and the roots; kit reads
// no layout, and a call without a selection is a usage error.
test('K1106 the runner and the roots are the caller\'s, inside or outside packages/', (t) => {
  assert.equal(selectionOf([]), undefined);
  assert.equal(selectionOf(['--runner', 'go']), undefined);
  assert.equal(selectionOf(['--runner', 'go', '--roots', 'a', '--parity', 'p']), undefined, 'kit takes no declaration of roots');
  assert.equal(selectionOf(['--runner', 'ruby', '--roots', 'a']), undefined);
  assert.deepEqual(selectionOf(['--runner', 'go', '--roots', 'lib/go', 'tools']), { runner: 'go', roots: ['lib/go', 'tools'], command: [] });
  assert.deepEqual(selectionOf(['--roots', 'crates/a', '--runner', 'cargo', '--', 'cargo', 'build', '--locked']), { roots: ['crates/a'], runner: 'cargo', command: ['cargo', 'build', '--locked'] });
  assert.deepEqual(testRuns(['lib/go/go.mod', 'lib/go/a_test.go'], 'go', ['lib/go'], undefined), [{ cwd: 'lib/go', tool: 'go', args: ['./...'] }]);
  const cli = tool(import.meta.resolve('../../scripts/kit/runtime-targets.mts'));
  const root = tree(t, { 'README.md': 'a\n', 'src/helper.mts': 'x\n' });
  const bare = spawnSync(process.execPath, [cli], { cwd: root, encoding: 'utf8' });
  assert.equal(bare.status, 2, bare.stderr);
  assert.match(bare.stderr, /--roots <folder>\.\.\. \[--php-extension/);
  const unselected = spawnSync(process.execPath, [cli, 'test', '--runner', 'node'], { cwd: root, encoding: 'utf8' });
  assert.equal(unselected.status, 2, unselected.stderr);
  const empty = spawnSync(process.execPath, [cli, 'test', '--runner', 'php', '--roots', 'src', '--php-extension', 'x.so'], { cwd: root, encoding: 'utf8' });
  assert.equal(empty.status, 1, empty.stderr);
  assert.match(empty.stderr, /test found nothing to run/);
});

// A command that writes its error to standard output and nothing to standard error is named by that output (K1150).
test('a failed command of the case-sensitive directory names its standard output when its standard error is empty (K1150)', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'kit-case-stdout-'));
  try {
    assert.throws(() => withCaseSensitiveDirectory('KIT_CASE_SENSITIVE_TEST_DIR', () => assert.fail('must not run'), {
      platform: 'darwin', parent, verify: () => undefined,
      command: () => ({ status: 1, stdout: 'hdiutil: create failed - the disk is full', stderr: '' }),
    }), /the disk is full/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// The failure of a detach names what hdiutil said in its message, which the caller prints, not only in its cause (K1151).
test('a failed detach names the output of hdiutil in its message (K1151)', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'kit-case-detach-message-'));
  try {
    assert.throws(() => withCaseSensitiveDirectory('KIT_CASE_SENSITIVE_TEST_DIR', () => 'ran', {
      platform: 'darwin', parent, verify: () => undefined,
      command: (_file, args) => (args[0] === 'detach' ? { status: 1, stderr: 'hdiutil: couldn\'t unmount: resource busy' } : { status: 0, stdout: '', stderr: '' }),
    }), /could not confirm detachment.*resource busy/s);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// A build that fails names its command and how it ended, a signal included (K1164).
test('a failed build of runtime-targets names its command and its exit status or signal (K1164)', (t) => {
  const root = tree(t, { 'sub/a.txt': 'a\n' });
  const build = (command: string) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/runtime-targets.mts')), 'build', '--roots', 'sub', '--', 'sh', '-c', command], { cwd: root, encoding: 'utf8' });
  const status = build('exit 3');
  assert.equal(status.status, 1);
  assert.match(status.stderr, /\[runtime-targets\] sub: sh -c exit 3 exited with 3/);
  const signal = build('kill -TERM $$');
  assert.equal(signal.status, 1);
  assert.match(signal.stderr, /ended by signal SIGTERM/);
});
