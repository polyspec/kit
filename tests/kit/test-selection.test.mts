import assert from 'node:assert/strict';
import test from 'node:test';
import { selects } from '../../scripts/kit/test-selection.mts';

const noFile = () => false;

test('Cargo exact filters require a selected native test case (K568)', () => {
  assert.equal(selects('cargo', ['test', '--test', 'package_entry', 'public_package_entry', '--', '--exact'], noFile), true);
  assert.equal(selects('cargo', ['test', '--test', 'package_entry', '--', '--exact'], noFile), false);
  assert.equal(selects('cargo', ['test', '-p', 'polyspec-orm'], noFile), false);
  assert.equal(selects('cargo', ['test', '--workspace'], noFile), false);
});

test('Python unittest discovery accepts an exact filename pattern as a scoped selection (K issue 7)', () => {
  const discovery = (pattern: string) => ['discover', '-s', 'packages/server/python/tests', '-t', 'packages/server/python', '-p', pattern];
  assert.equal(selects('python', discovery('test_files.py'), noFile), true);
  assert.equal(selects('python', discovery('render_files.py'), noFile), true);
  assert.equal(selects('python', discovery('test_*.py'), noFile), false);
  assert.equal(selects('python', [...discovery('test_files.py'), '-p', 'test_*.py'], noFile), false);
  assert.equal(selects('python', [...discovery('test_*.py'), '-p', 'render_files.py'], noFile), true);
  assert.equal(selects('python', ['discover', '-ptest_files.py'], noFile), true);
  assert.equal(selects('python', ['discover', '--pattern=test_files.py'], noFile), true);
  assert.equal(selects('python', ['polyspec.test_files'], noFile), true);
});
