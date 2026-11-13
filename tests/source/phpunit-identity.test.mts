// The parser reads the actual TeamCity events of PHPUnit by their fully qualified native cases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { phpunitEvents, toProgress, type Sink } from '../../scripts/kit/test-output.mts';
import { createProgress } from '../../scripts/kit/test-progress.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { toolsEnvironment } from '../kit/tools-environment.mts';
import { tree } from '../kit/tree.mts';
const ROOT = path.resolve(import.meta.dirname, '../..');

test('native PHPUnit preserves namespaces, duplicate methods and datasets in the parser', t => {
  const classes = ['NativeProbe\\One\\SharedIdentityTest', 'NativeProbe\\Two\\SharedIdentityTest'];
  const files = Object.fromEntries(classes.map((name, index) => [`${index}/SharedIdentityTest.php`, `<?php
namespace ${name.slice(0,name.lastIndexOf('\\'))};
use PHPUnit\\Framework\\TestCase;
use PHPUnit\\Framework\\Attributes\\DataProvider;
final class SharedIdentityTest extends TestCase {
public static function values(): array { return ['same' => [1]]; }
#[DataProvider('values')]
public function testShared(int $value): void { self::assertSame(1, $value); }
}
`]));
  const root = tree(t, { ...files, 'phpunit.xml': '<phpunit/>' });
  const vendor = toolsPath(ROOT, 'phpunit/vendor');
  const run = spawnSync(toolsPath(ROOT,'bin/php'), [path.join(vendor,'bin/phpunit'), '--configuration', path.join(root,'phpunit.xml'), '--teamcity', ...Object.keys(files).map(file => path.join(root,file))], {
    cwd: root, env: toolsEnvironment(ROOT), encoding:'utf8',
  });
  assert.equal(run.status,0, `${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  const expected = classes.map(name => `${name}::testShared with data set "same"`);
  const starts: string[] = [], passes: string[] = [];
  const sink: Sink = { start:(test,options) => { if (!options?.group) starts.push(test.id); }, pass:test => { if (test.id.includes('::')) passes.push(test.id); },
    fail:test => assert.fail(`native case failed: ${test.id}`), skip:test => assert.fail(`native case skipped: ${test.id}`), todo:test => assert.fail(`native case incomplete: ${test.id}`), notRun:count => assert.fail(`${count} native cases did not run`), line:()=>{}, raw:()=>{} };
  const read = phpunitEvents(sink);
  for (const line of run.stdout.split('\n')) read(line);
  assert.deepEqual(starts,expected);
  assert.deepEqual(passes,expected);
});

// K1214: PHPUnit reports a class whose setUpBeforeClass throws as one failed test with no location inside the suite of the
// class, and no message for its tests, which do not start. testCount names the tests of the run, as --list-tests lists them.
test('K1214: native PHPUnit counts the tests of a class whose setUpBeforeClass throws, and the summary names them as not run', t => {
  const root = tree(t, {
    'phpunit.xml': '<phpunit><testsuites><testsuite name="t"><directory>tests</directory></testsuite></testsuites></phpunit>\n',
    'tests/BrokenTest.php': `<?php
namespace NativeProbe;
use PHPUnit\\Framework\\TestCase;
final class BrokenTest extends TestCase {
public static function setUpBeforeClass(): void { throw new \\RuntimeException('no database'); }
public function testOne(): void { self::assertTrue(true); }
public function testTwo(): void { self::assertTrue(true); }
}
`,
    'tests/GoodTest.php': `<?php
namespace NativeProbe;
use PHPUnit\\Framework\\TestCase;
final class GoodTest extends TestCase {
public function testA(): void { self::assertTrue(true); }
}
`,
  });
  const phpunit = (...args: string[]) => spawnSync(toolsPath(ROOT, 'bin/php'), [path.join(toolsPath(ROOT, 'phpunit/vendor'), 'bin/phpunit'), '--configuration', path.join(root, 'phpunit.xml'), ...args], { cwd: root, env: toolsEnvironment(ROOT), encoding: 'utf8' });
  const list = phpunit('--list-tests');
  assert.equal(list.status, 0, `${list.error?.message ?? ''}\n${list.stdout}\n${list.stderr}`);
  const listed = list.stdout.split('\n').flatMap(line => /^\s*-\s+(\S.*)$/.exec(line)?.[1] ?? []);
  assert.deepEqual(listed, ['NativeProbe\\BrokenTest::testOne', 'NativeProbe\\BrokenTest::testTwo', 'NativeProbe\\GoodTest::testA']);
  const run = phpunit('--teamcity');
  assert.equal(run.status, 2, `${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^##teamcity\[testCount count='3' /m, run.stdout);
  const lines: string[] = [];
  const progress = createProgress({ write: text => lines.push(text), heartbeatMs: 10_000, resultFile: '' });
  const read = phpunitEvents(toProgress(progress));
  for (const line of run.stdout.split('\n')) read(line);
  read.end();
  const result: { passed: number; failed: number; skipped: number; notRun?: number; ok: boolean } = progress.close('phpunit', { exitCode: run.status });
  const text = lines.join('');
  assert.match(text, /✖ phpunit: 1 passed, 0 failed, 0 skipped, 2 not run, 1 group failed, the tool exited with 2 /, text);
  assert.equal(result.passed + result.failed + result.skipped + (result.notRun ?? 0), listed.length, text);
  assert.equal(result.ok, false);
  assert.equal(text.split('\n').filter(line => line.includes('✖ NativeProbe\\BrokenTest')).length, 1, text);
  assert.match(text, /✖ NativeProbe\\BrokenTest[^\n]*\n\s+RuntimeException: no database/, text);
  assert.match(text, /✔ NativeProbe\\GoodTest::testA/, text);
});
