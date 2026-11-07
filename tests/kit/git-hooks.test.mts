// Tests of the Git hooks and merges (scripts/kit/git-hooks.mts): `install` points core.hooksPath at the listed hooks of the
// repository, makes them executable and declares the merges; kit writes no hook (K1053); a second run changes nothing, and `check`
// fails with the cause and the fix for each listed hook or merge that is not installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { hooksIssue, installHooks, installMerges, mergeIssue } from '../../scripts/kit/git-hooks.mts';
import { checkout, git, run } from './gates-checkout.mts';
import { KIT_MAKEFILE, tool } from './kit-tools.mts';
import { korean, put, tree } from './tree.mts';

// The configuration of a repository that declares the pattern of its item IDs (K354-3).
const CONFIG_JSON = '{ "schema": 1, "hooks": [], "idPattern": "T[0-9]+(?:[.-][0-9]+)*" }\n';

const hooks = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'install']);
const check = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'check']);

// K1053: kit writes no hook; with no listed hook, make hooks sets no core.hooksPath and declares only the merges.
test('install writes no hook and sets no core.hooksPath while config/checklist.json lists none; it declares the merges (K1053)', (t) => {
  const { work } = checkout(t);
  assert.equal(check(work).status, 1, 'the merges are not declared yet');
  const installed = hooks(work);
  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout, /core\.hooksPath|written/);
  assert.notEqual(run(work, 'git', ['config', 'core.hooksPath']).status, 0, 'core.hooksPath stays unset');
  assert.equal(existsSync(path.join(work, '.githooks/pre-commit')), false);
  assert.equal(existsSync(path.join(work, '.githooks/commit-msg')), false);
  assert.equal(check(work).status, 0);
  const second = hooks(work);
  assert.match(second.stdout, /^\[git-hooks\] nothing to change\n/);
  assert.deepEqual(installHooks(work), []);
});

test('the listed hooks of the repository are checked and made executable, core.hooksPath points at them, and a missing one fails the check', (t) => {
  const config = { schema: 1, hooks: ['post-merge'], idPattern: 'T[0-9]+(?:[.-][0-9]+)*' };
  const { work } = checkout(t, { config });
  const failed = hooks(work);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /\.githooks\/post-merge does not exist; restore it from Git and run make hooks/);
  const hook = path.join(work, '.githooks/post-merge');
  mkdirSync(path.dirname(hook), { recursive: true });
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  assert.match(check(work).stderr, /\.githooks\/post-merge is not executable/);
  const installed = hooks(work);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /\.githooks\/post-merge made executable/);
  assert.equal(statSync(hook).mode & 0o100, 0o100);
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n', 'install does not rewrite a hook of the repository');
  assert.equal(git(work, 'config', 'core.hooksPath'), '.githooks');
  assert.equal(existsSync(path.join(work, '.githooks/pre-commit')), false, 'kit writes no hook of its own');
  assert.equal(hooksIssue(work), null);
  git(work, 'config', 'core.hooksPath', 'elsewhere');
  assert.match(check(work).stderr, /core\.hooksPath is "elsewhere", not \.githooks, so Git does not run the hooks; run make hooks/);
});

test('git-hooks takes only install or check', (t) => {
  const { work } = checkout(t);
  const refused = run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'remove']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Usage: node scripts\/kit\/git-hooks\.mts install \| check/);
});

// K354-1: the rebase of a branch puts the changelog entry of the branch above the newer entries of main, in the style of the list of
// main, and the Korean twin alike, with its marker of the merged English (the T26.7-2-6-2 case).
test('a rebase puts the changelog entry of the branch first, in a tight and in a loose list, with a current twin (K354-1)', (t) => {
  for (const gap of ['', '\n']) {
    const root = tree(t, { 'Makefile': KIT_MAKEFILE });
    const git = (...args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
      return { ...result, ok: result.status === 0 };
    };
    const head = '<!-- doc-id: changelog -->\n# Changelog\n\n## Unreleased\n\n';
    const write = (lines: string[]) => {
      const en = `${head}${lines.map(line => `${line}\n`).join(gap)}`;
      put(root, { 'CHANGELOG.md': en, 'CHANGELOG.ko.md': korean(en, en.split('\n').slice(1).join('\n').replace('# Changelog', '# 변경 기록')) });
      assert.ok(git('add', '-A').ok);
      assert.ok(git('commit', '--quiet', '-m', 'step').ok);
    };
    write(['- a (T1).']);
    assert.ok(git('branch', '-M', 'main').ok);
    assert.ok(git('checkout', '--quiet', '-b', 'row').ok);
    write(['- b (T2).', '- a (T1).']);
    assert.ok(git('checkout', '--quiet', 'main').ok);
    write(['- c (T3).', '- a (T1).']);
    assert.ok(git('checkout', '--quiet', 'row').ok);
    // A checkout whose hooks predate K354-1 merges CHANGELOG.md with merge=union; make hooks puts the driver in its place.
    const attributes = path.join(root, '.git/info/attributes');
    mkdirSync(path.dirname(attributes), { recursive: true });
    writeFileSync(attributes, 'CHANGELOG.md merge=union\n');
    installMerges(root);
    assert.doesNotMatch(readFileSync(attributes, 'utf8'), /^CHANGELOG\.md merge=union$/m, 'the union of CHANGELOG.md is replaced');
    assert.match(readFileSync(attributes, 'utf8'), /^CHANGELOG\.md merge=kit-changelog$/m);
    const rebase = git('rebase', 'main');
    assert.equal(rebase.status, 0, `the rebase conflicts: ${rebase.stdout}${rebase.stderr}`);
    const en = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const ko = readFileSync(path.join(root, 'CHANGELOG.ko.md'), 'utf8');
    const style = gap === '' ? 'tight' : 'loose';
    assert.equal(en, `${head}${['- b (T2).', '- c (T3).', '- a (T1).'].map(line => `${line}\n`).join(gap)}`, `the ${style} English list`);
    assert.match(ko, new RegExp(`- b \\(T2\\)\\.\\n${gap}- c \\(T3\\)\\.\\n${gap}- a \\(T1\\)\\.\\n`), `the ${style} Korean list`);
    assert.equal(/<!-- source-sha256: ([0-9a-f]+) -->/.exec(ko)?.[1], createHash('sha256').update(en).digest('hex'), 'the twin is current');
  }
});

// K354-2: a checkout whose hooks predate K354-1 merges CHANGELOG.md with merge=union while its kit-twin is the driver of the kit it
// reads, so the twin takes the marker of the English file as git merges it, by the attribute of that file.
test('the twin of a changelog that still merges with union holds the marker of the English file that the rebase writes (K354-2)', (t) => {
  const root = tree(t, { 'Makefile': KIT_MAKEFILE });
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
    return { ...result, ok: result.status === 0 };
  };
  const head = '<!-- doc-id: changelog -->\n# Changelog\n\n## Unreleased\n\n';
  const write = (lines: string[]) => {
    const en = `${head}${lines.map(line => `${line}\n`).join('')}`;
    put(root, { 'CHANGELOG.md': en, 'CHANGELOG.ko.md': korean(en, en.split('\n').slice(1).join('\n').replace('# Changelog', '# 변경 기록')) });
    assert.ok(git('add', '-A').ok);
    assert.ok(git('commit', '--quiet', '-m', 'step').ok);
  };
  write(['- a (T1).']);
  assert.ok(git('branch', '-M', 'main').ok);
  assert.ok(git('checkout', '--quiet', '-b', 'row').ok);
  write(['- b (T2).', '- a (T1).']);
  assert.ok(git('checkout', '--quiet', 'main').ok);
  write(['- c (T3).', '- a (T1).']);
  assert.ok(git('checkout', '--quiet', 'row').ok);
  installMerges(root);
  const attributes = path.join(root, '.git/info/attributes');
  writeFileSync(attributes, readFileSync(attributes, 'utf8').replace('CHANGELOG.md merge=kit-changelog', 'CHANGELOG.md merge=union'));
  const rebase = git('rebase', 'main');
  assert.equal(rebase.status, 0, `the rebase conflicts: ${rebase.stdout}${rebase.stderr}`);
  const en = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const ko = readFileSync(path.join(root, 'CHANGELOG.ko.md'), 'utf8');
  assert.equal(/<!-- source-sha256: ([0-9a-f]+) -->/.exec(ko)?.[1], createHash('sha256').update(en).digest('hex'), 'the twin is current');
});

// K354: two branches that both add changelog lines and checklist rows rebase without a conflict, and each commit that the rebase
// writes holds Korean twins whose marker is the sha256 of their English file.
test('the merges that make hooks declares rebase two branches of changelog lines and checklist rows with current Korean twins (K354)', (t) => {
  // The driver runs the make target of kit.mk, as in every repository that includes it, and reads the pattern of the IDs of the
  // checklists from config/checklist.json.
  const root = tree(t, { 'Makefile': KIT_MAKEFILE, 'config/checklist.json': CONFIG_JSON });
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
    return { ...result, ok: result.status === 0 };
  };
  const english = { changelog: 'CHANGELOG.md', checklist: 'docs/plans/p/checklist.md' };
  const head = { changelog: '<!-- doc-id: changelog -->\n# Changelog\n\n## Unreleased\n\n', checklist: '<!-- doc-id: checklist-p -->\n# P\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n' };
  // A side writes its lines into both languages and the marker of its English files, as make commit leaves them.
  const write = (lines: { changelog: string[]; checklist: string[] }) => {
    for (const key of ['changelog', 'checklist'] as const) {
      const en = `${head[key]}${lines[key].map(line => `${line}\n`).join('')}`;
      const ko = korean(en, `${en.split('\n').slice(1).join('\n').replace('# Changelog', '# 변경 기록')}`);
      put(root, { [english[key]]: en, [english[key].replace(/\.md$/, '.ko.md')]: ko });
    }
    assert.ok(git('add', '-A').ok);
    assert.ok(git('commit', '--quiet', '-m', 'step').ok);
  };
  write({ changelog: ['- a (T1).'], checklist: ['| T1 | a | `a` | `a` | [o] |'] });
  assert.ok(git('branch', '-M', 'main').ok);
  assert.ok(git('checkout', '--quiet', '-b', 'row').ok);
  write({ changelog: ['- b (T2).', '- a (T1).'], checklist: ['| T1 | a | `a` | `a` | [o] |', '| T2 | b | `b` | `b` | [o] |'] });
  assert.ok(git('checkout', '--quiet', 'main').ok);
  write({ changelog: ['- c (T3).', '- a (T1).'], checklist: ['| T1 | a | `a` | `a` | [o] |', '| T3 | c | `c` | `c` | [o] |'] });
  assert.ok(git('checkout', '--quiet', 'row').ok);
  const plain = git('rebase', 'main');
  assert.notEqual(plain.status, 0, 'without the merges of make hooks the rebase conflicts');
  assert.ok(git('rebase', '--abort').ok);
  assert.notEqual(mergeIssue(root), null);
  installMerges(root);
  assert.equal(mergeIssue(root), null);
  const rebase = git('rebase', 'main');
  assert.equal(rebase.status, 0, `the rebase conflicts: ${rebase.stdout}${rebase.stderr}`);
  for (const key of ['changelog', 'checklist'] as const) {
    const en = readFileSync(path.join(root, english[key]), 'utf8');
    const ko = readFileSync(path.join(root, english[key].replace(/\.md$/, '.ko.md')), 'utf8');
    for (const id of ['T1', 'T2', 'T3']) assert.ok(en.includes(id) && ko.includes(id), `${english[key]} and its twin hold ${id}`);
    assert.equal(/<!-- source-sha256: ([0-9a-f]+) -->/.exec(ko)?.[1], createHash('sha256').update(en).digest('hex'), `the twin of ${english[key]} is current`);
    assert.equal(ko.match(/source-sha256/g)?.length, 1, 'one marker');
  }
});

// K354-3: the rows of a checklist merge by their ID, so a rebase keeps the row that main closes once, beside the row that the
// branch appends, and its Korean twin holds the same rows with a current marker.
test('a rebase merges checklist rows by id, so a row that main closes is kept once beside the rows that the branch appends (K354-3)', (t) => {
  const root = tree(t, { 'Makefile': KIT_MAKEFILE, 'config/checklist.json': CONFIG_JSON });
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
    return { ...result, ok: result.status === 0 };
  };
  const english = 'docs/plans/p/checklist.md';
  const head = '<!-- doc-id: checklist-p -->\n# P\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n';
  const row = (id: string, state: string) => `| ${id} | task ${id} | \`${id}\` | \`${id}\` | ${state} |`;
  const write = (rows: string[]) => {
    const en = `${head}${rows.map(line => `${line}\n`).join('')}`;
    put(root, { [english]: en, [english.replace(/\.md$/, '.ko.md')]: korean(en, en.split('\n').slice(1).join('\n').replace('# P', '# 피')) });
    assert.ok(git('add', '-A').ok);
    assert.ok(git('commit', '--quiet', '-m', 'step').ok);
  };
  write([row('T1', '[ ]')]);
  assert.ok(git('branch', '-M', 'main').ok);
  assert.ok(git('checkout', '--quiet', '-b', 'row').ok);
  write([row('T1', '[ ]'), row('T2', '[ ]')]);
  assert.ok(git('checkout', '--quiet', 'main').ok);
  write([row('T1', '[o]')]);
  assert.ok(git('checkout', '--quiet', 'row').ok);
  installMerges(root);
  const rebase = git('rebase', 'main');
  assert.equal(rebase.status, 0, `the rebase conflicts: ${rebase.stdout}${rebase.stderr}`);
  const en = readFileSync(path.join(root, english), 'utf8');
  assert.equal(en, `${head}${row('T1', '[o]')}\n${row('T2', '[ ]')}\n`);
  const ko = readFileSync(path.join(root, english.replace(/\.md$/, '.ko.md')), 'utf8');
  assert.equal(ko, korean(en, en.split('\n').slice(1).join('\n').replace('# P', '# 피')), 'the twin holds the same rows and the marker of the merged English');
});
