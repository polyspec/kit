// Tests of the currency of a Composer project installation (K284): an installation in var/tools is kept only while its
// composer.lock equals the lock of the project and `composer check-platform-reqs --lock` passes in it; a stale one is installed
// again. The Composer is a fake shim of the checkout that logs its commands, so no real Composer, PHP or network is involved.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { installComposerProject } from '../../scripts/kit/install-composer-project.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

const LOCK = '{"packages":[]}\n';

/** A checkout with the project config/demo and a fake Composer shim: `install` makes vendor and clears the platform failure, `check-platform-reqs` fails while the file `platform-failure` exists. */
function checkout(t: TestContext) {
  const root = toolchainCheckout(t, { 'config/demo/composer.json': '{}\n', 'config/demo/composer.lock': LOCK });
  const log = path.join(root, 'composer.log');
  const failure = path.join(root, 'platform-failure');
  mkdirSync(path.join(root, 'var/tools/mise/shims'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/mise/shims/composer'), `#!/bin/sh
echo "$1" >> '${log}'
case "$1" in
  install) rm -f '${failure}'; mkdir vendor ;;
  check-platform-reqs) [ -e '${failure}' ] && { echo 'php 8.4.26 does not satisfy >= 8.5.0' >&2; exit 2; } ; exit 0 ;;
esac
`, { mode: 0o755 });
  const installed = (lock: string) => {
    const directory = path.join(root, 'var/tools/demo');
    mkdirSync(path.join(directory, 'vendor'), { recursive: true });
    writeFileSync(path.join(directory, 'composer.lock'), lock);
  };
  const install = () => installComposerProject({
    root, label: 'demo', folder: 'demo', project: 'config/demo', recorded: 'r1', plugins: false, wrappers: {}, comment: 'demo',
    installedRelease: (directory: string) => (existsSync(path.join(directory, 'vendor')) ? 'r1' : undefined),
  });
  const commands = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  return { failure, installed, install, commands };
}

test('an installation whose lock differs from the lock of the project is installed again (K284)', (t) => {
  const { installed, install, commands } = checkout(t);
  installed('{"packages":["older"]}\n');
  assert.equal(install().installed, true);
  assert.ok(commands().includes('install'), `composer ran ${commands().join(', ')}`);
});

test('an installation whose platform requirements are unmet under the wrapped PHP is installed again (K284)', (t) => {
  const { failure, installed, install, commands } = checkout(t);
  installed(LOCK);
  writeFileSync(failure, '');
  assert.equal(install().installed, true);
  assert.deepEqual(commands(), ['check-platform-reqs', 'install', 'check-platform-reqs']);
});

test('an installation with the same lock and met platform requirements is kept (K284)', (t) => {
  const { installed, install, commands } = checkout(t);
  installed(LOCK);
  assert.equal(install().installed, false);
  assert.deepEqual(commands(), ['check-platform-reqs']);
});
