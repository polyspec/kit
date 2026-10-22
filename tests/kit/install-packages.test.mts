// K511: install-packages of kit-bootstrap.mk installs the packages of package-lock.json with npm ci, the lock as it is (the release
// record), so a checkout without kit.mk, as a CI runner, installs @polyspec/kit; make install links after it through install-link.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bootstrap = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/kit-bootstrap.mk');

test('install-packages of a checkout without kit.mk runs npm ci of its lock (K511)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-install-packages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts/kit'), { recursive: true });
  copyFileSync(bootstrap, path.join(root, 'scripts/kit/kit-bootstrap.mk'));
  writeFileSync(path.join(root, 'Makefile'), 'include scripts/kit/kit-bootstrap.mk\n');
  const run = spawnSync('make', ['--no-print-directory', '-n', 'install-packages'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /var\/tools\/bin\/npm ci\b/);
});
