// Tests of the checks of kit-check.mts that read the tracked files of a checkout: a repository tracks no symbolic link
// that it creates (K254), and the targets of the Makefile (K246).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { check, gateFindings, retiredFindings, ruleTargets, runtimeTargetFindings, symlinkFindings, taskNameFindings } from '../../scripts/kit/kit-check.mts';
import { tree } from './tree.mts';

test('a tracked symbolic link fails with its path, and a tree without one passes (K254)', (t) => {
  const root = tree(t, { 'a.txt': 'a\n', 'docs/b.md': '# B\n' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(symlinkFindings(root), []);
  symlinkSync('../a.txt', path.join(root, 'docs/link.txt'));
  assert.deepEqual(symlinkFindings(root), [], 'an untracked link is no tracked file');
  assert.equal(spawnSync('git', ['add', 'docs/link.txt'], { cwd: root }).status, 0);
  assert.deepEqual(symlinkFindings(root), ['docs/link.txt: a tracked symbolic link; the repository creates no link. Fix: git rm --cached docs/link.txt and track the file it names']);
});

test('a configuration that kit no longer reads is a finding (K243)', (t) => {
  const root = tree(t, { 'config/commits.json': '{}' });
  assert.deepEqual(retiredFindings(root), ['config/commits.json: kit no longer reads it; the commit rules are COMMIT_RULES of check-commits.mts (K243). Fix: git rm config/commits.json']);
  assert.deepEqual(retiredFindings(tree(t)), []);
});

test('the rules of a makefile name their targets, and no recipe line, variable or special target is one (K246)', () => {
  const text = '.PHONY: build\nNODE := node\nbuild test: ## Run\n\tcp a: b\nbuild: kit-build\nkit-build:\ninstall-packages dependency-review: export X := 1\nA ?= b:c\n';
  assert.deepEqual(ruleTargets(text), ['build', 'test', 'build', 'kit-build', 'install-packages', 'dependency-review']);
});

test('a target that repeats a fixed task under another name fails, and a prerequisite of a fixed task passes (K246)', () => {
  const kit = new Set(['build', 'test', 'lint', 'install', 'test-ts']);
  const makefile = 'build: kit-build\nkit-build:\ntest-unit:\ncheck:\ninstall-python:\ntest-ts: extra\nlinter:\ntypecheck:\n';
  const fix = 'Fix: name it <repository>-<task> and add it as a prerequisite of the fixed task, such as build: kit-build';
  assert.deepEqual(taskNameFindings(makefile, kit), ['test-unit', 'install-python'].map(name => `Makefile: the target ${name} repeats a fixed task of kit.mk under another name. ${fix}`));
});

test('a runtime of packages/ without its build, test or lint target fails (K246)', () => {
  const make = { targets: new Map(['build-ts', 'test-ts', 'lint-ts', 'build-php-ext'].map(name => [name, { prerequisites: [], recipe: '' }])), variables: new Map<string, string>() };
  const files = ['packages/ts/src/a.ts', 'packages/php-ext/src/a.c', 'packages/codec/ts/b.ts', 'docs/a.md'];
  assert.deepEqual(runtimeTargetFindings(files, make), ['test-php-ext', 'lint-php-ext'].map(target => `packages/: the runtime php-ext has no target ${target}; kit.mk defines the targets of each runtime`));
  assert.deepEqual(runtimeTargetFindings(['docs/a.md'], make), []);
});

test('a repository whose check suite lacks a gate of kit-gates fails, and a gate of a language it has not is not required (K289)', () => {
  const target = (name: string, prerequisites: string[] = []) => [name, { prerequisites, recipe: '' }] as const;
  const targets = new Map([target('kit-gates', ['kit-check', 'language-check', 'lint-php', 'lint-python']), target('kit-check'), target('language-check'), target('lint-php'), target('lint-python'), target('check-more', ['language-check'])]);
  const make = (suite: string) => ({ targets, variables: new Map([['CHECK_TARGETS', suite]]) });
  // A gate is run when the suite names it or a target that has it as a prerequisite.
  assert.deepEqual(gateFindings(['src/a.php'], make('kit-check check-more')), ['Makefile: CHECK_TARGETS runs no lint-php, a gate of kit-gates for the PHP of this repository; add it to CHECK_TARGETS']);
  assert.deepEqual(gateFindings(['src/a.php', 'src/b.py'], make('kit-check')), [
    'Makefile: CHECK_TARGETS runs no language-check, a gate of kit-gates; add it to CHECK_TARGETS',
    'Makefile: CHECK_TARGETS runs no lint-php, a gate of kit-gates for the PHP of this repository; add it to CHECK_TARGETS',
    'Makefile: CHECK_TARGETS runs no lint-python, a gate of kit-gates for the Python of this repository; add it to CHECK_TARGETS',
  ]);
  assert.deepEqual(gateFindings(['docs/a.md'], make('kit-check language-check')), []);
});

test('the words of CHECK_TARGETS are expanded: a gate that a $(VAR) word carries is in the suite (K321)', () => {
  const target = (name: string, prerequisites: string[] = []) => [name, { prerequisites, recipe: '' }] as const;
  const targets = new Map([target('kit-gates', ['kit-check', 'docs-check']), target('kit-check'), target('docs-check')]);
  const make = { targets, variables: new Map([['CHECK_TARGETS', 'kit-check $(MORE)'], ['MORE', 'docs-check']]) };
  assert.deepEqual(gateFindings(['docs/a.md'], make), []);
});

test('lint-rust is required in CHECK_TARGETS only where the repository holds Rust sources (K364)', () => {
  const target = (name: string, prerequisites: string[] = []) => [name, { prerequisites, recipe: '' }] as const;
  const targets = new Map([target('kit-gates', ['kit-check', 'lint-rust']), target('kit-check')]);
  const make = { targets, variables: new Map([['CHECK_TARGETS', 'kit-check']]) };
  assert.deepEqual(gateFindings(['docs/a.md', 'src/b.ts'], make), []);
  assert.deepEqual(gateFindings(['packages/rust/src/lib.rs'], make), ['Makefile: CHECK_TARGETS runs no lint-rust, a gate of kit-gates for the Rust of this repository; add it to CHECK_TARGETS']);
});

// K534: land and the commit gate run what the owners of the changed paths select, so kit-check verifies that the owner rules select,
// for each source path of a language whose lint is a gate of kit-gates, that lint and duplication-check.
test('kit-check names a language whose sources the owner rules send to no lint or duplication-check (K534)', (t) => {
  const repository = (targets: string[]) => {
    const root = tree(t, {
      'Makefile': ['CHECK_TARGETS = lint-php duplication-check feature-check', 'check: $(CHECK_TARGETS)', 'kit-gates: lint-php duplication-check',
        'lint-php:', '\ttrue', 'duplication-check:', '\ttrue', 'feature-check:', '\ttrue', ''].join('\n'),
      'config/owner-checks.json': `${JSON.stringify({ schema: 1, owners: [{ paths: ['src/**', 'Makefile', 'config/**'], targets }] })}\n`,
      'src/a.php': '<?php\n',
      'src/b.php': '<?php\n',
    });
    const added = spawnSync('git', ['add', '-A'], { cwd: root });
    assert.equal(added.status, 0);
    return check(root).filter(finding => finding.startsWith('config/owner-checks.json: '));
  };
  assert.deepEqual(repository(['feature-check']), [
    'config/owner-checks.json: 2 PHP source paths, such as src/a.php, select no lint-php, so land and the commit gate never run it on them; add lint-php to the targets of a rule that owns them',
    'config/owner-checks.json: 2 PHP source paths, such as src/a.php, select no duplication-check, so land and the commit gate never run it on them; add duplication-check to the targets of a rule that owns them',
  ]);
  assert.deepEqual(repository(['feature-check', 'lint-php', 'duplication-check']), []);
});
