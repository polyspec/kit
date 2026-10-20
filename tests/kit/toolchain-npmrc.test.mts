// Tests of the .npmrc check of scripts/kit/toolchain-floors.mts: a project .npmrc may not keep npm from linking (S1), and
// npm itself reads each .npmrc, so a key reads as npm reads it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { npmrcFindings } from '../../scripts/kit/toolchain-floors.mts';
import { tree } from './tree.mts';
import { checkoutTools } from './checkout-stubs.mts';

test('an .npmrc that sets install-links=true or bin-links=false fails; other keys and the defaults pass', (t) => {
  const root = tree(t, {
    'package.json': '{}',
    '.npmrc': 'install-links=true\nbin-links=false\nallow-remote=root\n',
    'packages/a/package.json': '{}',
    'packages/a/.npmrc': 'install-links = false\nbin-links = true\n',
    'packages/b/package.json': '{}',
    'packages/b/.npmrc': '; a comment\nallow-git=none\n',
    'packages/c/package.json': '{}',
    'packages/c/.npmrc': "bin-links='false'\n",
  });
  checkoutTools(root, ['npm']);
  // The npm configuration of the user and of the environment does not count, only the .npmrc of the checkout.
  const env = { ...process.env, npm_config_install_links: 'true', NPM_CONFIG_BIN_LINKS: 'false' };
  assert.deepEqual(npmrcFindings(root, env), [
    '.npmrc: install-links is true, so npm packs each file: dependency instead of linking it; remove the key',
    '.npmrc: bin-links is false, so npm does not link the bins of the packages; remove the key',
    'packages/c/.npmrc: bin-links is false, so npm does not link the bins of the packages; remove the key',
  ]);
});
