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

test('Playwright accepts an explicit test path or grep filter but not an unfiltered or list-only run (K747)', () => {
  assert.equal(selects('playwright', ['test', '--config', 'tests/e2e/playwright.config.ts', 'tests/e2e/login.spec.ts'], noFile), true);
  assert.equal(selects('playwright', ['test', '-g', 'logs in', '--config=tests/e2e/playwright.config.ts'], noFile), true);
  assert.equal(selects('playwright', ['test', '--grep=logs in'], noFile), true);
  assert.equal(selects('playwright', ['test', '--test-list', 'tests/e2e/selected-tests.txt'], noFile), true);
  assert.equal(selects('playwright', ['test', '--config', 'tests/e2e/playwright.config.ts'], noFile), false);
  assert.equal(selects('playwright', ['test', '--list', 'tests/e2e/login.spec.ts'], noFile), true);
  assert.equal(selects('playwright', ['test', '--list'], noFile), false);
  assert.equal(selects('playwright', ['test', '--grep-invert', 'slow'], noFile), false);
});
