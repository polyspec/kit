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
