// Tests of the sandboxes of the tests: a sandbox holds no copy of the tools of kit, so a tool runs from scripts/kit of this
// checkout with the sandbox as the working directory and resolves the packages of kit's dependencies from this checkout.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fixtureCheckout } from './checkout.mts';
import { checkout } from './gates-checkout.mts';
import { KIT, tool } from './kit-tools.mts';
import { toolchainCheckout } from './toolchain-checkout.mts';

test('a sandbox of the tests holds no copy of scripts/kit', (t) => {
  for (const [helper, root] of [['fixtureCheckout', fixtureCheckout(t)], ['gates checkout', checkout(t).work], ['toolchainCheckout', toolchainCheckout(t)]] as const) {
    assert.ok(!existsSync(path.join(root, 'scripts/kit')), `${helper} copies scripts/kit`);
  }
});

test('the tools of a sandbox are the tools of this checkout', () => {
  assert.equal(KIT, path.resolve(import.meta.dirname, '../../scripts/kit'));
  assert.ok(existsSync(tool('kit-check')), tool('kit-check'));
});
