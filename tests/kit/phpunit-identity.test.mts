// Native PHPUnit TeamCity identities retain their namespace, method and data set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { phpunitEvents, type Sink, type TestRef } from '../../scripts/kit/test-output.mts';
import { outcomesOf, runOf } from '../../scripts/kit/parity-runners.mts';
import { repository, ENV } from './parity-support.mts';

const names = ['NativeProbe\\One\\SharedIdentityTest', 'NativeProbe\\Two\\SharedIdentityTest'] as const;
const method = 'testShared with data set "same"';
// The structure is recorded from PHPUnit's native --teamcity output, including the qualified locationHint.
const started = (name: string, flow = '1') => `##teamcity[testStarted name='${method}' locationHint='php_qn:///fixture/SharedIdentityTest.php::\\${name}::${method}' flowId='${flow}']`;
const finished = (flow = '1') => `##teamcity[testFinished name='${method}' duration='1' flowId='${flow}']`;
function events(lines: string[]): { starts: TestRef[]; passes: TestRef[] } {
  const starts: TestRef[] = [], passes: TestRef[] = [];
  const sink: Sink = { start: test => starts.push(test), pass: test => passes.push(test), fail: () => {}, skip: () => {}, todo: () => {}, line: () => {}, raw: () => {} };
  const read = phpunitEvents(sink);
  for (const line of lines) read(line);
  return { starts, passes };
}

test('PHPUnit events retain distinct fully qualified classes with equal method and dataset names', () => {
  const actual = events(names.flatMap(name => [started(name), finished()]));
  const expected = names.map(name => ({ id: `${name}::${method}`, name: method }));
  assert.deepEqual(actual.starts, expected);
  assert.deepEqual(actual.passes, expected);
});

test('PHPUnit flow identities cannot overwrite another class awaiting its finish', () => {
  const actual = events([started(names[0], '1'), started(names[1], '2'), finished('1'), finished('2')]);
  assert.deepEqual(actual.passes.map(test => test.id), names.map(name => `${name}::${method}`));
});

test('parity maps fully qualified PHPUnit feature identity without accepting another namespace', t => {
  const root = repository(t);
  const expected = `${names[0]}::testShared`;
  const run = runOf({ runner: 'php' }, root, { test: 'php/tests/RoundtripTest.php', ids: [expected] }, 'feature', ENV);
  if (run.error) throw new Error(run.error);
  assert.equal(run.caseOf({ id: `${names[0]}::${method}`, name: method }), expected);
  assert.equal(run.caseOf({ id: `${names[1]}::${method}`, name: method }), `${names[1]}::${method}`);
  assert.deepEqual(outcomesOf(run, { stdout: [started(names[0]), finished(), started(names[1]), finished()].join('\n'), stderr:'' }), [[expected,'pass'],[`${names[1]}::${method}`,'pass']]);
});

test('a qualified PHPUnit suite cannot satisfy its dataset with another namespace', t => {
  const run = runOf({ runner:'php' }, repository(t), { test:'php/tests/RoundtripTest.php', symbol:`${names[0]}::testShared` }, 'suite', ENV);
  if (run.error) throw new Error(run.error);
  assert.equal(run.caseOf({id:`${names[0]}::${method}`,name:method}),'same');
  assert.equal(run.caseOf({id:`${names[1]}::${method}`,name:method}),undefined);
});
