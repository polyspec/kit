// A utility of kit starts a tool of the checkout with the environment of its caller: it sets no MISE_* and no PATH of its own,
// since the recipe that runs it exports them (scripts/kit/mise-tools.mts, K1093).
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as miseTools from '../../scripts/kit/mise-tools.mts';
import { goWorkFile } from '../../scripts/kit/toolchain-files.mts';
import { tree } from './tree.mts';

test('K1093 a utility starts the tool of the checkout with the MISE_* and PATH of its caller only', (t) => {
  const root = tree(t, { 'var/tools/bin/go': '#!/bin/sh\necho "MISE_DATA_DIR=${MISE_DATA_DIR:-unset} PATH=$PATH"\n' });
  chmodSync(path.join(root, 'var/tools/bin/go'), 0o755);
  assert.equal(goWorkFile(root, '.', { PATH: '/caller/bin' }), 'MISE_DATA_DIR=unset PATH=/caller/bin');
  assert.equal('toolsEnvironment' in miseTools, false, 'mise-tools builds no environment for a child');
});
