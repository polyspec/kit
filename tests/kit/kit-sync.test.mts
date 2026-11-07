// Tests of what the package @polyspec/kit gives a repository: it writes no copy into a repository, so each repository owns
// the files that it took from the examples (K1052), and it ships no owner rule (K1053). No test runs npm or uses the network.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';

const KIT_ROOT = path.join(import.meta.dirname, '../..');

// K1052: a file that a repository takes from kit is the repository's own. The package declares no copy, kit has no command
// that writes or compares one, and the lint utilities leave no file of a repository out as a copy of kit.
test('kit writes no copy into a repository and compares none (K1052)', () => {
  const manifest: unknown = JSON.parse(readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8'));
  assert.ok(isJsonObject(manifest) && isJsonObject(manifest.kit), 'package.json of kit holds its kit object');
  assert.equal(manifest.kit.copies, undefined, 'package.json of kit declares no kit.copies');
  assert.ok(!existsSync(path.join(KIT_ROOT, 'scripts/kit/kit-sync.mts')), 'kit has no kit-sync');
  const mk = readFileSync(path.join(KIT_ROOT, 'scripts/kit/kit.mk'), 'utf8');
  assert.doesNotMatch(mk, /^kit-sync:|^kit-inject-check:|\bkit-inject-check\b/m, 'kit.mk has no kit-sync or kit-inject-check');
  assert.doesNotMatch(readFileSync(path.join(KIT_ROOT, 'scripts/kit/lint-ts.mts'), 'utf8'), /kitCopyIgnores|ignore-pattern/, 'lint-ts lints every file of the repository');
  // K1053: kit writes no hook, so it ships no owner rule either.
  assert.equal(manifest.kit.owners, undefined, 'package.json of kit declares no kit.owners');
});
