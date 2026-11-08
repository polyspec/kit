// Actual PHPUnit events and its configured deadlines must name the same fully qualified native cases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { phpunitEvents, type Sink } from '../../scripts/kit/test-output.mts';
import { parseTestEvent } from '../../scripts/kit/test-gap.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { toolsEnvironment } from '../kit/tools-environment.mts';
import { tree } from '../kit/tree.mts';
const ROOT = path.resolve(import.meta.dirname, '../..');

test('native PHPUnit preserves namespaces, duplicate methods and datasets across parser and deadline events', t => {
  const classes = ['NativeProbe\\One\\SharedIdentityTest', 'NativeProbe\\Two\\SharedIdentityTest'];
  const files = Object.fromEntries(classes.map((name, index) => [`${index}/SharedIdentityTest.php`, `<?php
namespace ${name.slice(0,name.lastIndexOf('\\'))};
use PHPUnit\\Framework\\TestCase;
use PHPUnit\\Framework\\Attributes\\DataProvider;
use PHPUnit\\Framework\\Attributes\\Small;
#[Small]
final class SharedIdentityTest extends TestCase {
public static function values(): array { return ['same' => [1]]; }
#[DataProvider('values')]
public function testShared(int $value): void { self::assertSame(1, $value); }
}
`]));
  const root = tree(t, { ...files, 'phpunit.xml': '<phpunit enforceTimeLimit="true" timeoutForSmallTests="6"><extensions><bootstrap class="Polyspec\\Kit\\PHPUnit\\DeadlineExtension"/></extensions></phpunit>' });
  const vendor = toolsPath(ROOT, 'phpunit/vendor');
  const run = spawnSync(toolsPath(ROOT,'bin/php'), ['-d', `auto_prepend_file=${path.join(ROOT,'scripts/kit/php-library/phpunit-deadline-prepend.php')}`,
    path.join(vendor,'bin/phpunit'), '--configuration', path.join(root,'phpunit.xml'), '--teamcity', ...Object.keys(files).map(file => path.join(root,file))], {
    cwd: root, env: { ...toolsEnvironment(ROOT), KIT_PHPUNIT_AUTOLOAD: path.join(vendor,'autoload.php'), KIT_TEST_EVENTS:'3' }, encoding:'utf8', stdio:['ignore','pipe','pipe','pipe'],
  });
  assert.equal(run.status,0, `${run.error?.message ?? ''}\n${run.stdout}\n${run.stderr}`);
  const expected = classes.map(name => `${name}::testShared with data set "same"`);
  const starts: string[] = [], passes: string[] = [];
  const sink: Sink = { start:(test,options) => { if (!options?.group) starts.push(test.id); }, pass:test => { if (test.id.includes('::')) passes.push(test.id); },
    fail:test => assert.fail(`native case failed: ${test.id}`), skip:test => assert.fail(`native case skipped: ${test.id}`), todo:test => assert.fail(`native case incomplete: ${test.id}`), line:()=>{}, raw:()=>{} };
  const read = phpunitEvents(sink);
  for (const line of run.stdout.split('\n')) read(line);
  assert.deepEqual(starts,expected);
  assert.deepEqual(passes,expected);
  const output = run.output[3];
  assert.ok(output,'PHPUnit wrote no configured native deadlines');
  const deadlines = output.toString().trim().split('\n').map(parseTestEvent);
  assert.deepEqual(deadlines.map(event => event.id),expected);
  assert.ok(deadlines.every(event => event.kind === 'timeout' && event.timeoutMs === 6000));
});
