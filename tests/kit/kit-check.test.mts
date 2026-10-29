// Tests of the checks of kit-check.mts that read the tracked files of a checkout: a repository tracks no symbolic link
// that it creates (K254), and the targets of the Makefile (K246).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { check, gateFindings, parityPhaseFindings, retiredFindings, ruleTargets, runtimeTargetFindings, symlinkFindings, taskNameFindings } from '../../scripts/kit/kit-check.mts';
import { initRepository } from './sandbox-repository.mts';
import { put, tree } from './tree.mts';

test('a tracked symbolic link fails with its path, and a tree without one passes (K254)', (t) => {
  const root = tree(t, { 'a.txt': 'a\n', 'docs/b.md': '# B\n' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(symlinkFindings(root), []);
  symlinkSync('../a.txt', path.join(root, 'docs/link.txt'));
  assert.deepEqual(symlinkFindings(root), [], 'an untracked link is no tracked file');
  assert.equal(spawnSync('git', ['add', 'docs/link.txt'], { cwd: root }).status, 0);
  assert.deepEqual(symlinkFindings(root), ['docs/link.txt: a tracked symbolic link; a repository tracks regular files, including the shared files copied from its installed kit package (K671-2). Fix: git rm --cached docs/link.txt and track the file it names']);
});

// Shared package copies have no tracked-link exception, including when the old sibling checkout exists.
test('tracked shared files are regular copies even when a sibling kit checkout exists (K621, K671-2)', (t) => {
  const parent = mkdtempSync(path.join(tmpdir(), 'kit-links-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  put(path.join(parent, 'kit'), { 'PRINCIPLES.md': '# P\n', 'PRINCIPLES.ko.md': '# P\n', '.editorconfig': 'root = true\n', 'claude/settings.json': '{}\n' });
  const root = path.join(parent, 'repo');
  mkdirSync(path.join(root, '.claude'), { recursive: true });
  initRepository(root);
  for (const [file, target] of Object.entries({ 'PRINCIPLES.md': '../kit/PRINCIPLES.md', 'PRINCIPLES.ko.md': '../kit/PRINCIPLES.ko.md', '.editorconfig': '../kit/.editorconfig', '.claude/settings.json': '../../kit/claude/settings.json' })) symlinkSync(target, path.join(root, file));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(symlinkFindings(root).length, 4);
  const finding = (file: string) => `${file}: a tracked symbolic link; a repository tracks regular files, including the shared files copied from its installed kit package (K671-2). Fix: git rm --cached ${file} and track the file it names`;
  rmSync(path.join(root, 'PRINCIPLES.ko.md'));
  symlinkSync('../kit/PRINCIPLES.md', path.join(root, 'PRINCIPLES.ko.md'));
  symlinkSync('../kit/AGENTS.md', path.join(root, 'AGENTS.md'));
  rmSync(path.join(parent, 'kit/.editorconfig'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(symlinkFindings(root).sort(), [finding('.claude/settings.json'), finding('.editorconfig'), finding('AGENTS.md'), finding('PRINCIPLES.ko.md'), finding('PRINCIPLES.md')]);
});

test('a configuration that kit no longer reads is a finding (K243)', (t) => {
  const root = tree(t, { 'config/commits.json': '{}' });
  assert.deepEqual(retiredFindings(root), ['config/commits.json: kit no longer reads it; the commit rules are COMMIT_RULES of check-commits.mts (K243). Fix: git rm config/commits.json']);
  assert.deepEqual(retiredFindings(tree(t)), []);
});

test('the rules of a makefile name their targets, and no recipe line, variable or special target is one (K246)', () => {
  const text = '.PHONY: build\nNODE := node\nbuild test: ## Run\n\tcp a: b\nbuild: kit-build\nkit-build:\ninstall-packages publish: export X := 1\nA ?= b:c\n';
  assert.deepEqual(ruleTargets(text), ['build', 'test', 'build', 'kit-build', 'install-packages', 'publish']);
});

// K617: a repository holds no copy of kit-bootstrap.mk since K614, so the fixed tasks that it defines, such as install, are read
// from the kit-bootstrap.mk of the kit that runs; a Makefile that adds its steps as prerequisites of install passes.
test('the fixed tasks of kit include those of the kit-bootstrap.mk of the kit that runs, without a copy in the repository (K617)', async () => {
  const { kitTargets } = await import('../../scripts/kit/kit-check.mts');
  assert.equal(typeof kitTargets, 'function', 'kit-check exports kitTargets');
  const kit = kitTargets();
  for (const target of ['install', 'install-kit', 'install-packages', 'install-link']) assert.ok(kit.has(target), `${target} is a fixed task of kit`);
  assert.deepEqual(taskNameFindings('install: repo-install\nrepo-install:\n\t@true\n', kit), []);
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

test('a complete provider-owned parity phase partition covers the mandatory parity gate', () => {
  const target = (name: string, prerequisites: string[] = [], recipe = '') => [name, { prerequisites, recipe }] as const;
  const implementations = ['go', 'php-extension'];
  const valid = {
    targets: new Map([
      target('kit-gates', ['parity-check']), target('parity-check'),
      target('parity-api-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api'),
      target('parity-bindings-%-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation $*'),
      target('parity-phases', ['parity-api-check', 'parity-bindings-go-check', 'parity-bindings-php-extension-check']),
      target('parity-bindings-go-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation go'),
      target('parity-bindings-php-extension-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation php-extension'),
    ]),
    variables: new Map([['CHECK_TARGETS', 'parity-phases']]),
  };
  assert.deepEqual(parityPhaseFindings(valid, implementations), []);
  assert.deepEqual(gateFindings([], valid, implementations), []);
  const evalDatabase = {
    targets: new Map(valid.targets),
    variables: new Map(valid.variables),
  };
  evalDatabase.targets.set('parity-bindings-go-check', { prerequisites: [], recipe: '$$(NODE) $$(KIT)/parity.$$(KIT_EXT) --phase bindings --implementation go' });
  evalDatabase.targets.set('parity-bindings-php-extension-check', { prerequisites: [], recipe: '$$(NODE) $$(KIT)/parity.$$(KIT_EXT) --phase bindings --implementation php-extension' });
  assert.deepEqual(parityPhaseFindings(evalDatabase, implementations), []);
});

test('parity phase coverage rejects missing, duplicate, mixed, empty and unknown selectors', () => {
  const target = (name: string, prerequisites: string[] = [], recipe = '') => [name, { prerequisites, recipe }] as const;
  const implementations = ['go', 'php-extension'];
  const make = (suite: string) => ({
    targets: new Map([
      target('parity-api-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api'), target('parity-check'),
      target('parity-bindings-%-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation $*'),
      target('parity-bindings-go-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation go'),
      target('parity-bindings-php-extension-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation php-extension'),
      target('parity-bindings--check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation '),
      target('parity-bindings-other-check', [], '$(NODE) $(KIT)/parity.$(KIT_EXT) --phase bindings --implementation other'),
    ]),
    variables: new Map([['CHECK_TARGETS', suite]]),
  });
  assert.ok(parityPhaseFindings(make('parity-api-check parity-bindings-go-check'), implementations).some(finding => finding.includes('parity-bindings-php-extension-check exactly once; found 0')));
  assert.ok(parityPhaseFindings(make('parity-api-check parity-api-check parity-bindings-go-check parity-bindings-php-extension-check'), implementations).some(finding => finding.includes('parity-api-check exactly once; found 2')));
  assert.ok(parityPhaseFindings(make('parity-api-check parity-bindings-go-check parity-bindings-go-check parity-bindings-php-extension-check'), implementations).some(finding => finding.includes('parity-bindings-go-check exactly once; found 2')));
  assert.ok(parityPhaseFindings(make('parity-check parity-api-check parity-bindings-go-check parity-bindings-php-extension-check'), implementations).some(finding => finding.includes('mixes parity-check with parity phases')));
  const invalidSelectors = parityPhaseFindings(make('parity-api-check parity-bindings-go-check parity-bindings-php-extension-check parity-bindings--check parity-bindings-other-check'), implementations);
  assert.ok(invalidSelectors.some(finding => finding.includes('unknown parity implementation (empty)')));
  assert.ok(invalidSelectors.some(finding => finding.includes('unknown parity implementation other')));
  const overridden = make('parity-api-check parity-bindings-go-check parity-bindings-php-extension-check');
  overridden.targets.set('parity-bindings-go-check', { prerequisites: [], recipe: 'node scripts/kit/parity.mts --phase bindings --implementation go' });
  assert.ok(parityPhaseFindings(overridden, implementations).some(finding => finding.includes('parity-bindings-go-check does not use its provider binding recipe')));
});

test('the default complete parity gate does not require phase targets in CHECK_TARGETS', () => {
  const target = (name: string): [string, { prerequisites: string[]; recipe: string }] => [name, { prerequisites: [], recipe: '' }];
  const make = { targets: new Map([target('parity-check'), target('parity-api-check'), target('parity-bindings-%-check')]), variables: new Map([['CHECK_TARGETS', 'parity-check']]) };
  assert.deepEqual(parityPhaseFindings(make, ['go']), []);
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
