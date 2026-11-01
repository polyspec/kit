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

  const workflow = readFileSync(path.join(KIT, '../../workflows/ci-pipeline.yml'), 'utf8');
  const sharedStart = workflow.indexOf('\n  shared:');
  const sharedEnd = workflow.indexOf('\n  parity:', sharedStart + 1);
  assert.ok(sharedStart >= 0 && sharedEnd > sharedStart, 'the copied CI pipeline declares its shared job, which plans the others');
  const discovery = workflow.slice(sharedStart, sharedEnd);
  // K992: the shared job bootstraps with the action of kit, which installs Node and npm, then the locked packages.
  const uses = discovery.indexOf('uses: ./.github/actions/kit-bootstrap');
  const plan = discovery.indexOf('run: make kit-ci-plan');
  assert.ok(uses >= 0 && plan > uses, 'the workflow bootstraps with the action of kit, then discovers parity targets');
  const action = readFileSync(path.join(KIT, '../../actions/kit-bootstrap/action.yml'), 'utf8');
  const npm = action.indexOf('run: make install-tools TOOLS=npm');
  const packages = action.indexOf('run: make install-packages');
  assert.ok(action.indexOf('node-version-file: mise.toml') >= 0 && npm > 0 && packages > npm, 'the action installs Node, npm, then the locked packages');
  assert.doesNotMatch(discovery, /NODE=|KIT_NODE/, 'discovery uses the installed Kit Node, with no alternate Node bypass');
});
