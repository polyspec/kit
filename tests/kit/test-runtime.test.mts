// Tests of scripts/kit/test-runtime.mts: `make test-<runtime> CASES=<pattern>` runs the unit tests of each package of the
// runtime with the name filter of its runner, in the folder of the package; the integration and conformance suites live
// under tests/ of the root and run only in CI (K244).
import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeRuns, suiteRuns } from '../../scripts/kit/test-runtime.mts';

const FILES = [
  'packages/ts/src/a.ts', 'packages/ts/tests/a.test.ts', 'packages/ts/package.json',
  'packages/validator/go/go.mod', 'packages/validator/go/a.go', 'packages/validator/go/a_test.go',
  'packages/php/tests/ATest.php', 'packages/python/tests/test_a.py', 'packages/rust/Cargo.toml',
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

test('a suite runs the folder of each runtime under tests/<suite>/ of the root (K244)', () => {
  assert.deepEqual(suiteRuns(FILES, 'integration', node), [{ cwd: 'tests/integration/go', tool: 'go', args: ['./...'] }]);
  assert.deepEqual(suiteRuns(FILES, 'conformance', node), [{ cwd: 'tests/conformance/ts', tool: 'node', args: ['a.test.ts'] }]);
});
