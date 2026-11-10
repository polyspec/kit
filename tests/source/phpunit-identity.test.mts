// The parser reads the actual TeamCity events of PHPUnit by their fully qualified native cases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { phpunitEvents, type Sink } from '../../scripts/kit/test-output.mts';
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
    fail:test => assert.fail(`native case failed: ${test.id}`), skip:test => assert.fail(`native case skipped: ${test.id}`), todo:test => assert.fail(`native case incomplete: ${test.id}`), line:()=>{}, raw:()=>{} };
  const read = phpunitEvents(sink);
  for (const line of run.stdout.split('\n')) read(line);
  assert.deepEqual(starts,expected);
  assert.deepEqual(passes,expected);
});
