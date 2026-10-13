// The parts of var/ that a sandbox takes from the checkout (K91). Other source tests write under var/ while a sandbox copies
// it: python-lock-real.test.mjs keeps its run in var/python-lock-real-<pid>, and uv writes its cache var/tools/uv-cache. A
// copy of all of var/ met a file that such a run removed (ENOENT under var/python-lock-real-<pid>/tmp/pip-build-env-*).
import assert from 'node:assert/strict';
import test from 'node:test';
import { installedTool } from './checkout.mjs';

test('a sandbox takes the installed tools of var/tools and neither the cache of uv nor the runs of other tests', () => {
  assert.equal(installedTool('var/tools/bin/python3'), true);
  assert.equal(installedTool('var/tools/uv-python/cpython-3.14/bin/python3'), true);
  assert.equal(installedTool('var/tools'), true);
  assert.equal(installedTool('var/tools/uv-cache'), false);
  assert.equal(installedTool('var/tools/uv-cache/archive-v0/x/a.py'), false);
  assert.equal(installedTool('var/python-lock-real-83112/tmp/pip-build-env-x/overlay'), false);
  assert.equal(installedTool('var/kit-test.log'), false);
});
