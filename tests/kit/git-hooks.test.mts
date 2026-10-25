// Tests of the Git hooks (scripts/kit/git-hooks.mts): `install` sets core.hooksPath, writes the pre-push hook and makes the
// listed hooks executable, a second run changes nothing, and `check` fails with the cause and the fix for each hook that is
// not installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { HOOKS_PATH, PRE_COMMIT, PRE_PUSH, PRE_PUSH_CONTENT, hooksIssue, installHooks, installMerges, mergeIssue } from '../../scripts/kit/git-hooks.mts';
import { CHECKLIST, TRANSLATION, checkout, git, prepared, run } from './gates-checkout.mts';
import { KIT_MAKEFILE, tool } from './kit-tools.mts';
import { korean, put, tree } from './tree.mts';

// The configuration of a repository that declares the pattern of its item IDs (K354-3).
const CONFIG_JSON = '{ "schema": 1, "hooks": ["pre-push"], "idPattern": "T[0-9]+(?:[.-][0-9]+)*" }\n';

// The owner rules of a fixture whose gate is bypass-check, the kit gate that fails on a --no-verify in a script: every path is owned.
const OWNERS = JSON.stringify({ schema: 1, owners: [{ paths: ['**'], targets: ['bypass-check'] }] }, null, 2) + '\n';

const hooks = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'install']);
const check = (work: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'check']);

test('install sets core.hooksPath and writes the executable pre-push hook; check passes', (t) => {
  const { work } = checkout(t);
  assert.equal(check(work).status, 1);
  const installed = hooks(work);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /\[git-hooks\] core\.hooksPath set to \.githooks \(was not set\)\n\[git-hooks\] \.githooks\/pre-commit written\n\[git-hooks\] \.githooks\/pre-merge-commit written\n\[git-hooks\] \.githooks\/pre-push written\n\[git-hooks\] \.githooks\/commit-msg written\n\[git-hooks\] \.githooks\/prepare-commit-msg written\n\[git-hooks\] \.githooks\/reference-transaction written\n\[git-hooks\] \.git\/info\/attributes: CHANGELOG\.md merge=kit-changelog, CHANGELOG\.ko\.md merge=kit-twin, docs\/plans\/\*\/checklist\.md merge=kit-checklist, docs\/plans\/\*\/checklist\.ko\.md merge=kit-twin added\n\[git-hooks\] merge\.kit-twin\.name set\n\[git-hooks\] merge\.kit-twin\.driver set\n\[git-hooks\] merge\.kit-changelog\.name set\n\[git-hooks\] merge\.kit-changelog\.driver set\n\[git-hooks\] merge\.kit-checklist\.name set\n\[git-hooks\] merge\.kit-checklist\.driver set\n\[git-hooks\] the hooks pre-push are installed: core\.hooksPath is \.githooks/);
  assert.equal(git(work, 'config', 'core.hooksPath'), HOOKS_PATH);
  assert.equal(readFileSync(path.join(work, PRE_PUSH), 'utf8'), PRE_PUSH_CONTENT);
  assert.equal(statSync(path.join(work, PRE_PUSH)).mode & 0o777, 0o755);
  assert.equal(check(work).status, 0);
});

test('a second install changes nothing: no file is rewritten and no setting is touched', (t) => {
  const { work } = checkout(t);
  assert.equal(hooks(work).status, 0);
  const before = statSync(path.join(work, PRE_PUSH));
  const second = hooks(work);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^\[git-hooks\] nothing to change\n\[git-hooks\] the hooks pre-push are installed/);
  const after = statSync(path.join(work, PRE_PUSH));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.ino, before.ino);
  assert.deepEqual(installHooks(work), []);
});

test('check fails while core.hooksPath is not .githooks, naming the value and make hooks', (t) => {
  const { work } = checkout(t);
  hooks(work);
  git(work, 'config', 'core.hooksPath', 'elsewhere');
  const failed = check(work);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /core\.hooksPath is "elsewhere", not \.githooks, so Git does not run the hooks; run make hooks/);
  git(work, 'config', '--unset', 'core.hooksPath');
  assert.match(check(work).stderr, /core\.hooksPath is not set, not \.githooks/);
});

test('check fails while the pre-push hook is missing, not executable or changed; install repairs them', (t) => {
  const { work } = checkout(t);
  hooks(work);
  const file = path.join(work, PRE_PUSH);
  rmSync(file);
  assert.match(check(work).stderr, /\.githooks\/pre-push does not exist; restore it from Git and run make hooks/);

  assert.equal(hooks(work).status, 0);
  chmodSync(file, 0o644);
  assert.match(check(work).stderr, /\.githooks\/pre-push is not executable, so Git does not run it; run make hooks/);
  assert.equal(hooks(work).status, 0);
  assert.equal(statSync(file).mode & 0o777, 0o755);

  writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.match(check(work).stderr, /\.githooks\/pre-push differs from the hook of scripts\/kit\/git-hooks\.mts; run make hooks and commit the file/);
  assert.match(hooks(work).stdout, /\.githooks\/pre-push written/);
  assert.equal(check(work).status, 0);
});

test('the listed hooks of the repository are checked and made executable, and a missing one fails the check', (t) => {
  const config = { schema: 1, hooks: ['pre-push', 'post-merge'], idPattern: 'T[0-9]+(?:[.-][0-9]+)*' };
  const { work } = checkout(t, { config });
  const failed = hooks(work);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /\.githooks\/post-merge does not exist; restore it from Git and run make hooks/);
  const hook = path.join(work, '.githooks/post-merge');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  assert.match(check(work).stderr, /\.githooks\/post-merge is not executable/);
  const installed = hooks(work);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /\.githooks\/post-merge made executable/);
  assert.equal(statSync(hook).mode & 0o100, 0o100);
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n', 'install does not rewrite a hook of the repository');
  assert.equal(existsSync(path.join(work, '.githooks/pre-push')), true);
  assert.equal(hooksIssue(work), null);
});

test('check and install fail naming config/generated.json while the pre-commit hook is installed and the repository lacks it (K362)', (t) => {
  const { work } = checkout(t);
  const config = path.join(work, 'config/generated.json');
  const valid = readFileSync(config, 'utf8');
  rmSync(config);
  assert.throws(() => installHooks(work), /config\/generated\.json/);
  assert.notEqual(run(work, 'git', ['config', 'core.hooksPath']).status, 0, 'a refused install writes nothing, so core.hooksPath stays unset');
  assert.equal(existsSync(path.join(work, PRE_COMMIT)), false, 'a refused install writes no hook');

  writeFileSync(config, valid);
  assert.equal(hooks(work).status, 0);
  rmSync(config);
  assert.match(hooksIssue(work) ?? '', /config\/generated\.json/);
  assert.match(check(work).stderr, /config\/generated\.json/);
  assert.equal(check(work).status, 1);

  writeFileSync(config, '{"schema":1,"paths":[],"exceptions":[]}\n');
  assert.equal(hooks(work).status, 0);
  assert.equal(hooksIssue(work), null);
  assert.equal(check(work).status, 0);
});

test('git-hooks takes only install or check', (t) => {
  const { work } = checkout(t);
  const refused = run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/git-hooks.mts')), 'remove']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Usage: node scripts\/kit\/git-hooks\.mts install \| check/);
});

// A make target is the interface of kit that stays across its versions, and the path of a tool does not: the pre-push hook
// calls the target push-gate-hook, which kit.mk runs from the tools of KIT.
test('the pre-push hook calls the make target push-gate-hook and names no tool path', () => {
  assert.doesNotMatch(PRE_PUSH_CONTENT, /scripts\/kit|node_modules|\.mts|\.mjs/);
  assert.match(PRE_PUSH_CONTENT, /^exec make --no-print-directory push-gate-hook$/m);
  const dry = spawnSync('make', ['-n', '--no-print-directory', '-f', path.join(import.meta.dirname, '../../scripts/kit/kit.mk'), 'push-gate-hook', 'KIT=node_modules/@polyspec/kit/dist', 'KIT_EXT=mjs'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  // kit.mk starts the tool with the node of the checkout by its absolute path (K171); make names the directory by its real path.
  assert.equal(dry.stdout.trim(), `${path.join(realpathSync(process.cwd()), 'var/tools/bin/node')} node_modules/@polyspec/kit/dist/push-gate.mjs hook`);
});

// K380: kit owns the commit-msg hook, which runs the message checks of make commit on every commit, an amend included.
test('make hooks writes the commit-msg hook of kit, which refuses the footer of an AI tool at commit time (K380)', (t) => {
  const { work } = checkout(t, { files: { 'config/owner-checks.json': OWNERS } });
  assert.equal(hooks(work).status, 0);
  const hook = path.join(work, '.githooks/commit-msg');
  assert.equal(statSync(hook).mode & 0o100, 0o100, 'the commit-msg hook is executable');
  const text = readFileSync(hook, 'utf8');
  assert.doesNotMatch(text, /scripts\/kit|node_modules|\.mts|\.mjs/);
  assert.match(text, /^cd "\$\(git rev-parse --show-toplevel\)" \|\| exit 1$/m);
  assert.match(text, /^exec make --no-print-directory commit-msg-hook MESSAGE="\$1"$/m);
  assert.equal(check(work).status, 0);

  rmSync(hook);
  assert.match(hooksIssue(work) ?? '', /\.githooks\/commit-msg does not exist; restore it from Git and run make hooks/);
  assert.match(check(work).stderr, /\.githooks\/commit-msg does not exist/);
  assert.equal(hooks(work).status, 0);

  // End to end: a commit with a valid message is made, and an amend that adds the footer of an AI tool is refused. The owner rules are
  // staged too, since the gates of a commit on main read the index (K404-1).
  writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', '-A');
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  const valid = 'feat(hooks): Refuse the footer of an AI tool (#T1-1)\n\nThe body names the change.\n';
  const first = run(work, 'git', [...identity, 'commit', '--quiet', '-m', valid]);
  assert.equal(first.status, 0, first.stderr);
  const head = git(work, 'rev-parse', 'HEAD');
  const footer = `${valid}\nCo-Authored-By: Claude Opus <noreply@anthropic.com>\n`;
  const amended = run(work, 'git', [...identity, 'commit', '--amend', '--quiet', '-m', footer]);
  assert.equal(amended.status, 1, 'the commit-msg hook refuses the amend');
  assert.match(amended.stderr, /commit-ai-footer/);
  assert.equal(git(work, 'rev-parse', 'HEAD'), head, 'the refused amend changes no commit');
});

// K380-2: an amend replaces HEAD, so the commit-msg check reads the index against the parent of the amended commit, which holds the
// test of the fix; a plain commit is still checked against HEAD.
test('an amend that restages a document of a fix commit with its test passes the commit-msg check (K380-2)', (t) => {
  const { work } = checkout(t);
  assert.equal(hooks(work).status, 0);
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(work, 'add', '-A');
  const first = run(work, 'git', [...identity, 'commit', '--quiet', '-m', 'feat(hooks): Create the repository (#T1-1)\n\nThe body names the change.\n']);
  assert.equal(first.status, 0, `the first commit creates main: ${first.stderr}`);
  git(work, 'checkout', '--quiet', '-b', 'fix/name-K380-2');

  mkdirSync(path.join(work, 'src'), { recursive: true });
  mkdirSync(path.join(work, 'tests'), { recursive: true });
  mkdirSync(path.join(work, 'docs'), { recursive: true });
  writeFileSync(path.join(work, 'src/tool.mts'), 'export const tool = 1;\n');
  writeFileSync(path.join(work, 'tests/tool.test.mts'), "import test from 'node:test';\n");
  git(work, 'add', '-A');
  const fix = run(work, 'git', [...identity, 'commit', '--quiet', '-m', 'fix(hooks): Check the tool (#T1-1)\n\nThe body names the change.\n']);
  assert.equal(fix.status, 0, fix.stderr);

  writeFileSync(path.join(work, 'docs/notes.md'), '# Notes\n');
  git(work, 'add', 'docs/notes.md');
  const amended = run(work, 'git', [...identity, 'commit', '--amend', '--no-edit', '--quiet']);
  assert.equal(amended.status, 0, `the amend restages a document of the fix commit, which holds its test: ${amended.stderr}`);

  writeFileSync(path.join(work, 'src/tool.mts'), 'export const tool = 2;\n');
  git(work, 'add', 'src/tool.mts');
  const plain = run(work, 'git', [...identity, 'commit', '--quiet', '-m', 'fix(hooks): Change the tool (#T1-1)\n\nThe body names the change.\n']);
  assert.equal(plain.status, 1, 'a plain fix commit that changes no test is refused');
  assert.match(plain.stderr, /commit-fix-test/);
});

// K446: work is done on main directly. The commit-msg hook accepts a commit while HEAD is main, as it accepts one on any branch; the
// gates of land run in make commit instead (K446).
test('the commit-msg hook accepts a commit while HEAD is main (K446)', (t) => {
  const { work } = checkout(t, { files: { 'config/owner-checks.json': OWNERS } });
  assert.equal(hooks(work).status, 0);
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  const message = 'feat(hooks): Commit on main (#T1-1)\n\nThe body names the change.\n';
  git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(work, 'add', '-A');
  const first = run(work, 'git', [...identity, 'commit', '--quiet', '-m', message]);
  assert.equal(first.status, 0, `the first commit creates main: ${first.stderr}`);
  writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', 'a.txt');
  const onMain = run(work, 'git', [...identity, 'commit', '--quiet', '-m', message]);
  assert.equal(onMain.status, 0, onMain.stderr);
  git(work, 'checkout', '--quiet', '-b', 'fix/name-T1-1');
  writeFileSync(path.join(work, 'b.txt'), 'b\n');
  git(work, 'add', 'b.txt');
  const onBranch = run(work, 'git', [...identity, 'commit', '--quiet', '-m', message]);
  assert.equal(onBranch.status, 0, onBranch.stderr);
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

// K380-3: the prepare-commit-msg hook only records an amend, so a plain commit prints nothing of it.
test('the prepare-commit-msg hook prints nothing on a plain commit (K380-3)', (t) => {
  const root = tree(t, { 'Makefile': KIT_MAKEFILE });
  const prepared = spawnSync('make', ['--no-print-directory', 'prepare-commit-msg-hook', 'SOURCE=message', 'SHA='], { cwd: root, encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(prepared.stdout, '', 'the hook prints nothing');
});

// K603: a commit runs no gate, the user's ruling of 2026-10-25: the gates run once, at land. A commit on main that adds a finding of
// a gate passes the pre-commit hook.
test('the pre-commit hook on main runs no gate, so a commit that adds a finding of a gate passes (K603)', (t) => {
  const { work } = prepared(t, { files: { 'config/owner-checks.json': OWNERS } });
  assert.equal(hooks(work).status, 0);
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  const commit = (subject: string) => run(work, 'git', [...identity, 'commit', '--quiet', '-m', `${subject}\n\nThe body names the change.\n`]);
  mkdirSync(path.join(work, 'scripts'), { recursive: true });
  writeFileSync(path.join(work, 'scripts/unstaged.mts'), "export const flag = '--no-verify';\n");
  writeFileSync(path.join(work, 'scripts/a.mts'), 'export const a = 1;\n');
  git(work, 'add', 'scripts/a.mts');
  const clean = commit('feat(hooks): Add a script (#T1-1)');
  assert.equal(clean.status, 0, `a clean gated commit on main passes: ${clean.stderr}`);
  const head = git(work, 'rev-parse', 'HEAD');

  writeFileSync(path.join(work, 'scripts/b.mts'), "export const flag = '--no-verify';\n");
  git(work, 'add', 'scripts/b.mts');
  const gated = commit('feat(hooks): Add a flag (#T1-1)');
  assert.equal(gated.status, 0, `a commit with a finding of a gate passes: ${gated.stderr}`);
  assert.notEqual(git(work, 'rev-parse', 'HEAD'), head, 'the commit is made');
});

// K404-1-1: the commit gate on main reads the kit checklists beside the checkout, as make land does, so a row that names a kit item the
// kit checklists lack is refused, and a row that names one they hold passes.
test('the commit gate on main refuses a row that names a kit item beside the checkout lacks, as land does (K404-1-1)', (t) => {
  const owners = JSON.stringify({ schema: 1, owners: [{ paths: ['**'], targets: ['docs-check'] }] }, null, 2) + '\n';
  const { work } = prepared(t, { files: { 'config/owner-checks.json': owners, 'config/documents.json': JSON.stringify({ schema: 1, include: ['docs/**/*.md'] }) } });
  assert.equal(hooks(work).status, 0);
  // The kit checkout beside the repository holds K365 only.
  const kit = path.join(path.dirname(work), 'kit');
  mkdirSync(path.join(kit, 'config'), { recursive: true });
  mkdirSync(path.join(kit, 'docs/plans/kit'), { recursive: true });
  writeFileSync(path.join(kit, 'config/checklist.json'), JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: 'K[0-9]+(?:[.-][0-9]+)*' }));
  writeFileSync(path.join(kit, 'docs/plans/kit/checklist.md'), '# Kit\n\n| ID | Task | Deliverables | Verification | State |\n| --- | --- | --- | --- | --- |\n| K365 | a | `a.mts` | `node --test a.test.mts` | [o] |\n');
  // A kit checkout is a Git work tree: its checklists are read through git ls-files, so the fixture commits them.
  git(kit, 'init', '--quiet');
  git(kit, 'add', '-A');
  git(kit, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'Add the kit checklists');
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  const commit = (subject: string) => run(work, 'git', [...identity, 'commit', '--quiet', '-m', `${subject}\n\nThe body names the change.\n`]);
  const addRow = (kitItem: string) => {
    const row = `| T1-2 | waits on ${kitItem} | \`a.mts\` | \`node --test a.test.mts\` | [ ] |`;
    for (const file of [CHECKLIST, TRANSLATION]) writeFileSync(path.join(work, file), readFileSync(path.join(work, file), 'utf8').replace(/(\| T1-1 \|[^\n]*\n)/, `$1${row}\n`));
    // The Korean twin carries the sha256 of its English file, as make documents-stamp writes it (the revision check of docs-check).
    const english = readFileSync(path.join(work, CHECKLIST));
    const korean = readFileSync(path.join(work, TRANSLATION), 'utf8').replace(/<!-- source-sha256: [0-9a-f]+ -->\n/, '');
    writeFileSync(path.join(work, TRANSLATION), `<!-- source-sha256: ${createHash('sha256').update(english).digest('hex')} -->\n${korean}`);
    git(work, 'add', CHECKLIST, TRANSLATION);
  };
  addRow('K99999');
  const refused = commit('docs(checklist): Wait on a kit item (#T1-1)');
  assert.equal(refused.status, 1, `a row that names a kit item the kit checklists lack is refused on main: ${refused.stdout}${refused.stderr}`);
  assert.match(refused.stderr, /docs-check/, 'the refusal names the gate');
  assert.match(refused.stderr, /checklist-kit/, 'the refusal names the finding');
  assert.match(refused.stderr, /K99999/, 'the refusal names the kit item');
  git(work, 'reset', '--quiet', '--hard');
  addRow('K365');
  const clean = commit('docs(checklist): Wait on a kit item (#T1-1)');
  assert.equal(clean.status, 0, `a row that names a kit item the kit checklists hold passes: ${clean.stderr}`);
});

// K404-1: a merge commit on main is refused by the pre-merge-commit hook, so main moves only by commits and fast-forwards. A merge
// commit on another branch and a fast-forward of main pass.
test('the pre-merge-commit hook refuses a merge commit on main and passes a fast-forward and a merge on another branch (K404-1)', (t) => {
  const { work } = prepared(t, { files: { 'config/owner-checks.json': OWNERS } });
  assert.equal(hooks(work).status, 0);
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  const run2 = (...args: string[]) => run(work, 'git', [...identity, ...args]);
  const change = (name: string, subject: string) => {
    writeFileSync(path.join(work, name), `${name}\n`);
    git(work, 'add', name);
    const made = run2('commit', '--quiet', '-m', `${subject}\n\nThe body names the change.\n`);
    assert.equal(made.status, 0, made.stderr);
  };
  change('a.txt', 'feat(hooks): Add the first file (#T1-1)');
  git(work, 'checkout', '--quiet', '-b', 'fix/merge-T1-1');
  change('b.txt', 'feat(hooks): Add the branch file (#T1-1)');
  git(work, 'checkout', '--quiet', 'main');
  change('c.txt', 'feat(hooks): Add the main file (#T1-1)');

  const head = git(work, 'rev-parse', 'HEAD');
  const merged = run2('merge', '--no-ff', '--quiet', '-m', 'feat(hooks): Merge the branch (#T1-1)', 'fix/merge-T1-1');
  assert.equal(merged.status, 1, 'a merge commit on main is refused');
  assert.match(merged.stderr, /merge commit on main/, 'the refusal names the rule');
  assert.equal(git(work, 'rev-parse', 'HEAD'), head, 'the refused merge changes no commit');

  git(work, 'checkout', '--quiet', 'fix/merge-T1-1');
  const onBranch = run2('merge', '--no-ff', '--quiet', '-m', 'feat(hooks): Merge main into the branch (#T1-1)', 'main');
  assert.equal(onBranch.status, 0, `a merge commit on another branch passes: ${onBranch.stderr}`);
  git(work, 'checkout', '--quiet', 'main');
  // A fast-forward of main is the merge of make land, which sets KIT_MAIN_WRITER for the reference-transaction hook (K495).
  const forward = run(work, 'git', [...identity, 'merge', '--ff-only', '--quiet', 'fix/merge-T1-1'], { env: { ...process.env, KIT_MAIN_WRITER: 'land' } });
  assert.equal(forward.status, 0, `a fast-forward of main by make land passes: ${forward.stderr}`);
});

test('the pre-merge-commit hook that make hooks writes calls the make target merge-commit-hook and names no tool path (K404-1)', (t) => {
  const { work } = prepared(t);
  assert.equal(hooks(work).status, 0);
  const hook = readFileSync(path.join(work, '.githooks/pre-merge-commit'), 'utf8');
  assert.doesNotMatch(hook, /scripts\/kit|node_modules|\.mts|\.mjs/);
  assert.match(hook, /^exec make --no-print-directory merge-commit-hook$/m);
});

// K495: main moves only through make land, which sets KIT_MAIN_WRITER, and through a commit whose pre-commit hook passed. The
// reference-transaction hook that make hooks writes refuses a fast-forward, an update-ref and a commit with --no-verify on main, and
// lets a commit on main or on a branch, a pack of the refs and a move under KIT_MAIN_WRITER pass.
test('the reference-transaction hook refuses a move of main outside make land and a hooked commit (K495)', (t) => {
  const { work } = prepared(t, { files: { 'config/owner-checks.json': OWNERS } });
  assert.equal(hooks(work).status, 0);
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com'];
  const run2 = (...args: string[]) => run(work, 'git', [...identity, ...args]);
  const change = (name: string, subject: string) => {
    writeFileSync(path.join(work, name), `${name}\n`);
    git(work, 'add', name);
    const made = run2('commit', '--quiet', '-m', `${subject}\n\nThe body names the change.\n`);
    assert.equal(made.status, 0, made.stderr);
  };
  change('a.txt', 'feat(hooks): Add the first file (#T1-1)');
  git(work, 'checkout', '--quiet', '-b', 'fix/move-T1-1');
  change('b.txt', 'feat(hooks): Add the branch file (#T1-1)');
  git(work, 'checkout', '--quiet', 'main');
  const head = git(work, 'rev-parse', 'main');

  const forward = run2('merge', '--ff-only', '--quiet', 'fix/move-T1-1');
  assert.notEqual(forward.status, 0, 'a fast-forward of main outside make land is refused');
  assert.match(forward.stderr, /make land/, 'the refusal names make land');
  assert.equal(git(work, 'rev-parse', 'main'), head);
  const updated = run2('update-ref', 'refs/heads/main', 'fix/move-T1-1');
  assert.notEqual(updated.status, 0, 'an update-ref of main is refused');
  assert.equal(git(work, 'rev-parse', 'main'), head);
  writeFileSync(path.join(work, 'c.txt'), 'c\n');
  git(work, 'add', 'c.txt');
  const skipped = run2('commit', '--quiet', '--no-verify', '-m', 'feat(hooks): Skip the hooks (#T1-1)\n\nThe body names the change.\n');
  assert.notEqual(skipped.status, 0, 'a commit on main that skips its pre-commit hook is refused');
  assert.equal(git(work, 'rev-parse', 'main'), head);

  assert.equal(run2('pack-refs', '--all').status, 0, 'a pack of the refs keeps main and passes');
  const writer = run(work, 'git', [...identity, 'merge', '--ff-only', '--quiet', 'fix/move-T1-1'], { env: { ...process.env, KIT_MAIN_WRITER: 'land' } });
  assert.equal(writer.status, 0, `make land moves main: ${writer.stderr}`);
  assert.equal(git(work, 'rev-parse', 'main'), git(work, 'rev-parse', 'fix/move-T1-1'));
});
