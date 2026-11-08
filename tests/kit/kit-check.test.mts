// Tests of the removal of kit-check (K1070): kit validates no config/<name>.json of a repository against the schema of kit
// of that name. Each tool validates the configuration it reads; a repository that still runs kit-check fails, since its tool
// is gone, until it removes the call.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('K1070: kit has no kit-check tool and no kit-check make target', () => {
  assert.equal(existsSync(new URL('../../scripts/kit/kit-check.mts', import.meta.url)), false, 'scripts/kit/kit-check.mts is gone');
  assert.doesNotMatch(readFileSync(new URL('../../scripts/kit/kit.mk', import.meta.url), 'utf8'), /\bkit-check\b(?!list)/);
});
