// A shim of mise runs the tool of the checkout from any directory (K127): the environment of mise of the checkout names its
// mise.toml as the global configuration, so a command that kit starts outside the checkout, in a sandbox or a virtual
// environment, never reaches the next command of the same name on PATH. Runs the mise and the Python of this checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toolCommand, toolsEnvironment } from '../../scripts/kit/mise-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('a shim of mise runs the python3 of the checkout from a directory outside it', (t) => {
  const outside = mkdtempSync(path.join(tmpdir(), 'kit-mise-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const env = toolsEnvironment(ROOT, { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' });
  const result = spawnSync(toolCommand(ROOT, 'python3'), ['-c', 'import sys; print(sys.executable)'], { cwd: outside, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().startsWith(path.join(ROOT, 'var/tools/mise/installs/python/')), `the shim ran ${result.stdout.trim()}`);
});
