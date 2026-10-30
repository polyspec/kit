// K511: a consumer includes the bootstrap and kit.mk of its installed package before make runs.
// install-packages then installs its release lock with npm ci; source linking remains a later install-link step.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bootstrap = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/kit-bootstrap.mk');

test('install-packages of a consumer with the installed kit bootstrap runs npm ci of its lock (K511, K671-4)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-install-packages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, 'node_modules/@polyspec/kit/scripts/kit');
  mkdirSync(installed, { recursive: true });
  for (const file of ['kit-bootstrap.mk', 'kit.mk']) copyFileSync(path.join(path.dirname(bootstrap), file), path.join(installed, file));
  writeFileSync(path.join(root, 'Makefile'), 'include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\n');
  const run = spawnSync('make', ['--no-print-directory', '-n', 'install-packages'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /var\/tools\/bin\/npm ci\b/);
  // The link is install-link's, after the tools and the steps of the repository; install-packages calls no target of kit.mk.
  assert.doesNotMatch(run.stdout, /link\.(?:mts|mjs)/);
});
