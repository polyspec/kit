// Tests of the S10 library rule of layout-check (library-frameworks.mts, K425, K783).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { libraryFrameworkFindings } from '../../scripts/kit/library-frameworks.mts';
import { initRepository } from './sandbox-repository.mts';
import { put, tree } from './tree.mts';

const manifest = (name: string, require: Record<string, string>, requireDev: Record<string, string> = {}) => JSON.stringify({ name, type: 'library', require: { php: '>=8.2', ...require }, 'require-dev': requireDev });

/** Commits every file of `root`, so that the tracked files of the check hold them. */
function commit(root: string) {
  for (const args of [['add', '-A'], ['commit', '--quiet', '-m', 'fixture']]) assert.equal(spawnSync('git', ['-C', root, ...args]).status, 0);
}

test('a PHP library that requires an application framework in require is a finding, and require-dev and an application package beside it pass (K783)', (t) => {
  const root = tree(t, {});
  initRepository(root);
  put(root, { 'packages/php/composer.json': manifest('polyspec/a', { 'symfony/console': '^7.0' }) });
  commit(root);
  assert.deepEqual(libraryFrameworkFindings(root).map(item => item.split(';')[0]), ['packages/php/composer.json: requires symfony/console in require']);
  put(root, { 'packages/php/composer.json': manifest('polyspec/a', {}, { 'symfony/console': '^7.0' }), 'packages/cli/composer.json': manifest('polyspec/a-cli', { 'polyspec/a': '*', 'symfony/console': '^7.0' }) });
  commit(root);
  assert.deepEqual(libraryFrameworkFindings(root), []);
});
