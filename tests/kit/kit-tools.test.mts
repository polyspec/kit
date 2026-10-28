// Tests of the sandboxes of the tests: a sandbox holds no copy of the tools of kit, so a tool runs from scripts/kit of this
// checkout with the sandbox as the working directory and resolves the packages of kit's dependencies from this checkout.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fixtureCheckout } from './checkout.mts';
import { checkout } from './gates-checkout.mts';
import { KIT, tool } from './kit-tools.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';
import { initRepository } from './sandbox-repository.mts';

test('a sandbox of the tests holds no copy of scripts/kit', (t) => {
  for (const [helper, root] of [['fixtureCheckout', fixtureCheckout(t)], ['gates checkout', checkout(t).work], ['toolchainCheckout', toolchainCheckout(t)]] as const) {
    assert.ok(!existsSync(path.join(root, 'scripts/kit')), `${helper} copies scripts/kit`);
  }
});

test('the tools of a sandbox are the tools of this checkout', () => {
  assert.equal(KIT, path.resolve(import.meta.dirname, '../../scripts/kit'));
  assert.ok(existsSync(tool(import.meta.resolve('../../scripts/kit/kit-check.mts'))), tool(import.meta.resolve('../../scripts/kit/kit-check.mts')));
});

test('a clean consumer can parse its first npm bootstrap before Node exists and gates discover only afterward', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-clean-parity-bootstrap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'config'));
  writeFileSync(path.join(root, 'config/parity.json'), JSON.stringify({
    schema: 1,
    implementations: [{ name: 'rust-client', runner: 'rust', roots: ['packages/rust'] }],
    requirements: { pattern: 'REQ-[0-9]+' },
    units: [],
  }));
  writeFileSync(path.join(root, 'Makefile'), `include ${path.join(KIT, 'kit-bootstrap.mk')}\n`);
  initRepository(root);

  const node = path.join(root, 'var/tools/bin/node');
  assert.equal(existsSync(node), false, 'the clean checkout has no installed Kit Node wrapper');
  const bootstrap = spawnSync('make', ['--no-print-directory', '-n', 'install-tools', 'TOOLS=npm'], { cwd: root, encoding: 'utf8' });
  assert.equal(bootstrap.status, 0, bootstrap.stdout + bootstrap.stderr);
  assert.match(bootstrap.stdout, /bootstrap\/bootstrap\.mts/);
  assert.doesNotMatch(bootstrap.stderr, /config\/parity\.json implementation names could not be read safely/);
  const mixed = spawnSync('make', ['--no-print-directory', '-n', 'install-tools', 'TOOLS=npm', 'parity-api-check'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(mixed.status, 0, 'combining bootstrap with a provider phase still requires phase enumeration');
  assert.match(mixed.stderr, /config\/parity\.json implementation names could not be read safely/);

  const workflow = readFileSync(path.join(KIT, '../../workflows/gates.yml'), 'utf8');
  const discoverStart = workflow.indexOf('\n  discover:');
  const discoverEnd = workflow.indexOf('\n  shared:', discoverStart + 1);
  assert.ok(discoverStart >= 0 && discoverEnd > discoverStart, 'the copied gates workflow declares its discovery job');
  const discovery = workflow.slice(discoverStart, discoverEnd);
  const npm = discovery.indexOf('run: make install-tools TOOLS=npm');
  const packages = discovery.indexOf('run: make install-packages');
  const plan = discovery.indexOf('run: make kit-ci-plan');
  assert.ok(npm >= 0 && packages > npm && plan > packages, 'the workflow installs Node, installs locked packages, then discovers parity targets');
  assert.doesNotMatch(discovery, /NODE=|KIT_NODE/, 'discovery uses the installed Kit Node, with no alternate Node bypass');
});
