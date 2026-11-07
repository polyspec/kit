// Tests of what the package @polyspec/kit gives a repository: it writes no copy into a repository, so each repository owns
// the files that it took from the examples (K1052), and the owner rules that kit ships own the hooks that make hooks writes
// (K522, K542). No test runs npm or uses the network.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validate } from '../../scripts/kit/owner-check.mts';
import { isJsonObject } from '../../scripts/kit/bootstrap/files.mts';
import { tree } from './tree.mts';
import { COMMIT_MSG, PRE_COMMIT } from '../../scripts/kit/git-hooks.mts';
import { readFixture } from './json-fixture.mts';
import type { NpmManifest } from '../../scripts/kit/manifests.mts';

const KIT_ROOT = path.join(import.meta.dirname, '../..');
// The hooks that make hooks writes into every checkout (K495).
const HOOKS = [PRE_COMMIT, COMMIT_MSG];

const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

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
  const owners = isJsonObject(manifest.kit) && Array.isArray(manifest.kit.owners) ? manifest.kit.owners : [];
  const paths: unknown[] = owners.flatMap((owner: unknown): unknown[] => (isJsonObject(owner) && Array.isArray(owner.paths) ? owner.paths.map((glob: unknown) => glob) : []));
  assert.deepEqual(paths.filter(glob => typeof glob === 'string' && !glob.startsWith('.githooks/')), [], 'the owner rules that kit ships own no file of a repository but the hooks');
});

// K522: the owner rules that kit ships own every hook that make hooks writes, so a consumer that commits them needs no rule of its own.
test('the owner rules that kit ships own every hook that make hooks writes (K522)', () => {
  const kit = readFixture<NpmManifest>(KIT_ROOT, 'package.json');
  const paths = (kit.kit?.owners ?? []).flatMap(rule => rule.paths);
  for (const hook of HOOKS) assert.ok(paths.includes(hook), `${hook} is owned`);
});

// K542: a consumer commits the hooks that it wants, so a glob of a rule that kit ships that matches no tracked path of the consumer is
// no error, while a glob of its own rules that matches nothing still is.
test('owner-validate passes a consumer that tracks some of the paths that the shipped rules own (K542)', (t) => {
  const kit = readFixture<NpmManifest>(KIT_ROOT, 'package.json');
  const root = tree(t, { 'package.json': '{ "name": "consumer", "private": true }\n' });
  const some = HOOKS.slice(0, 1);
  for (const hook of some) write(root, hook, '#!/bin/sh\n');
  const owned = ['package.json', 'config/owner-checks.json'];
  const shipped = (kit.kit?.owners ?? []).map(rule => ({ ...rule, shipped: true as const })).filter(rule => rule.paths.some(glob => glob.startsWith('.githooks/')));
  const targets = new Set(shipped.flatMap(rule => rule.targets ?? []).concat(['owner-validate']));
  const project = { make: { targets: new Map([...targets].map(name => [name, { prerequisites: [], recipe: '' }])), variables: new Map<string, string>() }, scripts: {}, workspaces: [], prefixes: [] };
  const exists = (file: string) => existsSync(path.join(root, file));
  const own = { paths: owned, targets: ['owner-validate'] };
  assert.deepEqual(validate({ owners: [own, ...shipped] }, [...owned, ...some], project, exists), [], 'the hooks that the consumer lacks are no error');
  const stale = { paths: ['ruff.toml'], targets: ['owner-validate'] };
  assert.deepEqual(validate({ owners: [own, stale, ...shipped] }, [...owned, ...some], project, exists), ['config/owner-checks.json: the glob ruff.toml matches no tracked path; remove it or correct it']);
});
