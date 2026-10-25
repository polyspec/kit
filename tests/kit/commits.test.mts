// Tests of scripts/kit/check-commits.mts: each rule of a commit message has a passing and a failing case, the rules of the
// checklist items that a commit changes have a passing and a failing case, and the command reads a range, a message file
// and the configuration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileMessage, findingLines, identityFindings, indexItemFindings, messageFindings, rangeFindings, rustTestLines } from '../../scripts/kit/check-commits.mts';
import { english, pair, put, tree } from './tree.mts';
import { tool } from './kit-tools.mts';

const CONFIG = { schema: 1, types: ['feat', 'fix', 'docs'], subjectMax: 50, bodyMax: 72 };
const rules = (message: string) => messageFindings(message, CONFIG).map(found => found.rule);

test('a message with a subject, a blank line and a wrapped body passes', () => {
  assert.deepEqual(rules('feat(docs): Merge the document checks (#K7.1)\n\nReplace the checks of the\nrepositories.\n\nCo-Authored-By: Name <a@b.c>\n'), []);
  assert.deepEqual(rules('fix(ci): Run every target (#T22.4-19-1)'), []);
});

test('commit-subject: the type, the scope and the id are required', () => {
  for (const subject of ['Merge the checks', 'chore(docs): Merge the checks (#K1)', 'feat: Merge the checks (#K1)', 'feat(Docs): Merge the checks (#K1)', 'feat(docs): Merge the checks', 'feat(docs): Merge the checks (K1)', 'feat(docs):  (#K1)']) {
    assert.deepEqual(rules(subject), ['commit-subject'], subject);
  }
  const [found] = messageFindings('chore(docs): Merge the checks (#K1)', CONFIG);
  assert.ok(found, 'the subject has no finding');
  assert.equal(found.message, 'the subject is "chore(docs): Merge the checks (#K1)"; expected "type(scope): Subject (#id)" with a type of feat, fix, docs');
});

test('a Subject that already holds the id of its item is a finding, since make commit adds it (K380-1)', () => {
  assert.deepEqual(rules('fix(core): Fix it (#T1) (#T1)'), ['commit-subject-id']);
  assert.deepEqual(rules('fix(core): Fix it (#T2) (#T1)'), ['commit-subject-id']);
  assert.deepEqual(rules('fix(core): Fix it (#T1)'), []);
  assert.deepEqual(rules('fix(core): Fix the parser (with tests) (#T1)'), []);
});

test('commit-capital, commit-period and commit-length: the Subject', () => {
  assert.deepEqual(rules('feat(docs): merge the checks (#K1)'), ['commit-capital']);
  assert.deepEqual(rules('feat(docs): Merge the checks. (#K1)'), ['commit-period']);
  assert.deepEqual(rules(`feat(docs): ${'A'.repeat(50)} (#K1)`), []);
  const long = messageFindings(`feat(docs): ${'A'.repeat(51)} (#K1)`, CONFIG);
  assert.deepEqual(long.map(found => [found.rule, found.message]), [['commit-length', 'the Subject has 51 characters; expected at most 50']]);
});

test('commit-language: a message holds no Hangul (K252)', () => {
  assert.deepEqual(rules('feat(core): Add the parser (#K1)\n\nThe body names 파서.\n'), ['commit-language']);
  assert.deepEqual(rules('feat(core): Add the parser (#K1)\n\nThe body is English.\n'), []);
});

test('commit-ai-footer: a message holds no co-author or session trailer of an AI tool (K264)', () => {
  const body = 'feat(core): Add the parser (#K1)\n\nThe body.\n\n';
  assert.deepEqual(rules(`${body}Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Claude-Session: https://claude.ai/code/session_1\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Generated with [Claude Code](https://claude.com/claude-code)\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Co-authored-by: GitHub Copilot <copilot@github.com>\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Co-Authored-By: Jane Roe <jane@example.com>\n`), [], 'a person is a co-author');
});

test('commit-blank and commit-width: the body', () => {
  assert.deepEqual(rules('feat(docs): Merge the checks (#K1)\nbody without a blank line'), ['commit-blank']);
  const wide = `feat(docs): Merge the checks (#K1)\n\n${'word '.repeat(15)}\nshort\n${'x'.repeat(100)}\n`;
  const found = messageFindings(wide, CONFIG);
  assert.deepEqual(found.map(entry => entry.rule), ['commit-width']);
  const width = found[0];
  assert.ok(width, 'the wide body has no finding');
  assert.match(width.message, /^line 3 of the message has 75 characters; expected at most 72; wrap the body$/);
  assert.deepEqual(rules(`feat(docs): Merge the checks (#K1)\n\n${'word '.repeat(14)}ab`), []);
});

test('commit-ai-identity: no AI tool is the author or the committer of a commit (K265)', (t) => {
  assert.deepEqual(identityFindings('Claude <noreply@anthropic.com>', 'author').map(found => found.rule), ['commit-ai-identity']);
  assert.deepEqual(identityFindings('min-0-max <max@blue.tools>', 'committer'), []);
  const { root, git } = repository(t, ['feat(docs): Start (#K1)'], ['K1', 'K2']);
  put(root, { 'g.txt': 'g' });
  git('add', '-A');
  assert.equal(git('commit', '-q', '--author', 'Claude <noreply@anthropic.com>', '-m', 'feat(docs): Add (#K2)').status, 0);
  const findings = rangeFindings(root, 'HEAD~1..HEAD', CONFIG);
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /: commit-ai-identity: the author Claude <noreply@anthropic\.com> is an AI tool; the account of a commit is a person \(K265\)/);
});

test('an author or committer other than the identity of config/commit-identity.json is refused, at commit time and in a range (K405)', (t) => {
  const identity = { schema: 1, name: 'min-0-max', email: 'max@blue.tools' };
  const root = tree(t, { 'config/checklist.json': JSON.stringify(CHECKLIST), 'config/commit-identity.json': JSON.stringify(identity), [PLAN]: plan([['K404', '[ ]'], ['K405', '[ ]'], ['K406', '[ ]']]) });
  // The environment of the fixture without the identity variables of the caller, so that each commit names its own identity.
  const plain = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(key)));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: plain });
  let count = 0;
  // Each commit names its own identity in its author and committer, through the variables that git reads before the config.
  const commit = (name: string, email: string, message: string) => {
    put(root, { [`f${++count}.txt`]: message });
    const env = { ...plain, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
    spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8', env });
    const result = spawnSync('git', ['commit', '-q', '-m', message], { cwd: root, encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
  };
  commit('min-0-max', 'max@blue.tools', 'feat(commits): Start (#K404)');
  commit('min-median-max', 'max@blue.tools', 'feat(commits): Add the check (#K405)');
  commit('min-0-max', 'max@blue.tools', 'feat(commits): Add more (#K406)');
  const findings = rangeFindings(root, 'HEAD~2..HEAD', CONFIG);
  assert.equal(findings.length, 2, findings.join('\n'));
  for (const found of findings) {
    assert.match(found, /: commit-identity: the (author|committer) min-median-max <max@blue\.tools> is not the identity that config\/commit-identity\.json declares, min-0-max <max@blue\.tools> \(K405\)\. Fix: git config user\.name "min-0-max" and git config user\.email "max@blue\.tools" of the clone$/);
  }
  assert.deepEqual(rangeFindings(root, 'HEAD~1..HEAD', CONFIG), [], 'the last commit is made by the declared identity');
  // The commit-msg hook reads the identity that git gives the next commit, here the one set in the config of the clone.
  assert.equal(git('config', 'user.name', 'min-median-max').status, 0);
  assert.equal(git('config', 'user.email', 'max@blue.tools').status, 0);
  assert.equal(git('checkout', '-q', '-b', 'fix/identity-K405').status, 0);
  const file = path.join(root, 'MSG');
  writeFileSync(file, 'feat(commits): Add the check (#K405)\n');
  const command = (...args: string[]) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-commits.mts')), ...args], { cwd: root, encoding: 'utf8', env: plain });
  const refused = command('--message', file);
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /\[check-commits\] commit-identity: the author min-median-max <max@blue\.tools> is not the identity that config\/commit-identity\.json declares, min-0-max <max@blue\.tools>/);
  assert.equal(git('config', 'user.name', 'min-0-max').status, 0);
  const accepted = command('--message', file);
  assert.equal(accepted.status, 0, accepted.stderr);
});

test('a repository without config/commit-identity.json accepts any identity that is no AI tool (K405)', (t) => {
  const root = tree(t, { 'config/checklist.json': JSON.stringify(CHECKLIST) });
  const plain = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(key)));
  put(root, { 'f.txt': 'f' });
  const env = { ...plain, GIT_AUTHOR_NAME: 'min-median-max', GIT_AUTHOR_EMAIL: 'max@blue.tools', GIT_COMMITTER_NAME: 'min-median-max', GIT_COMMITTER_EMAIL: 'max@blue.tools' };
  spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8', env });
  assert.equal(spawnSync('git', ['commit', '-q', '-m', 'feat(commits): Add the check (#K405)'], { cwd: root, encoding: 'utf8', env }).status, 0);
  assert.deepEqual(rangeFindings(root, 'HEAD', CONFIG), []);
});

test('a message file loses its comment lines, and a merge commit is not checked', () => {
  assert.equal(fileMessage('# comment\nfeat(docs): Merge the checks (#K1)\n# more\n'), 'feat(docs): Merge the checks (#K1)\n');
  assert.equal(fileMessage('Merge branch x\n'), null);
});

function repository(t: TestContext, messages: string[], rows: string[] = []) {
  const root = tree(t, { 'config/checklist.json': JSON.stringify(CHECKLIST), [PLAN]: plan(rows.map(id => [id, '[ ]'])) });
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  messages.forEach((message, index) => {
    put(root, { [`f${index}.txt`]: String(index) });
    git('add', '-A');
    const result = git('commit', '-q', '-m', message);
    assert.equal(result.status, 0, result.stderr);
  });
  return { root, git };
}

test('the commits of a range are checked and each finding names the commit', (t) => {
  const { root, git } = repository(t, ['feat(docs): Start (#K1)', 'bad subject', 'feat(ci): Fine (#K2)'], ['K1', 'K2']);
  const findings = rangeFindings(root, 'HEAD~2..HEAD', CONFIG);
  const bad = git('rev-parse', '--short', 'HEAD~1').stdout.trim();
  assert.equal(findings.length, 1);
  const first = findings[0];
  assert.ok(first !== undefined, 'rangeFindings found nothing');
  assert.match(first, new RegExp(`^${bad}\\w*: commit-subject: the subject is "bad subject"`));
  assert.deepEqual(rangeFindings(root, 'HEAD', CONFIG), [], 'HEAD alone is the last commit');
  assert.throws(() => rangeFindings(root, 'nonsense', CONFIG), /the range "nonsense" is not <base>\.\.<head>/);
  assert.throws(() => rangeFindings(root, 'nothere..HEAD', CONFIG), /the range nothere\.\.HEAD does not resolve in this checkout: .*; fetch its commits/);
});

// K402: make land checks RANGE=main..<branch>, and the branch of a row whose id holds a dot (P10), such as fix/name-T2.60, holds one.
test('a range whose refs hold a dot is a range, and three dots, an empty side or a side that starts or ends with a dot is not (K402)', (t) => {
  const { root, git } = repository(t, ['feat(docs): Start (#K1)', 'feat(ci): Fine (#T2.60)'], ['K1', 'T2.60']);
  git('branch', '-q', 'base.1', 'HEAD~1');
  git('branch', '-q', 'fix/name-T2.60');
  assert.deepEqual(rangeFindings(root, 'base.1..fix/name-T2.60', CONFIG), []);
  for (const range of ['base.1...fix/name-T2.60', '..fix/name-T2.60', 'base.1..', 'base.1..fix/name-T2.60.', '.base..HEAD', 'base 1..HEAD']) {
    assert.throws(() => rangeFindings(root, range, CONFIG), /is not <base>\.\.<head>/, range);
  }
});

test('a merge commit in the range is not checked', (t) => {
  const { root, git } = repository(t, ['feat(docs): Start (#K1)'], ['K1', 'K2', 'K3']);
  git('checkout', '-q', '-b', 'side');
  put(root, { 'side.txt': 'x' });
  git('add', '-A');
  git('commit', '-q', '-m', 'feat(ci): Side (#K2)');
  git('checkout', '-q', '-');
  put(root, { 'main.txt': 'x' });
  git('add', '-A');
  git('commit', '-q', '-m', 'feat(ci): Main (#K3)');
  const merged = git('merge', '--no-ff', '-m', 'Merge branch side', 'side');
  assert.equal(merged.status, 0, merged.stderr);
  assert.deepEqual(rangeFindings(root, 'HEAD~2..HEAD', CONFIG), []);
});

test('the command checks a range or a message file and exits with the findings', (t) => {
  const { root, git } = repository(t, ['feat(docs): Start (#K1)', 'bad subject'], ['K1', 'K2']);
  // The message being committed is checked on its own branch here; the gates that a commit on main also runs are not part of this check (K404-1).
  git('checkout', '-q', '-b', 'feat/name-K2');
  const command = (...args: string[]) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-commits.mts')), ...args], { cwd: root, encoding: 'utf8' });
  const range = command('--range', 'HEAD~1..HEAD');
  assert.equal(range.status, 1, range.stdout + range.stderr);
  assert.match(range.stderr, /\[check-commits\] \w+: commit-subject: the subject is "bad subject"/);
  assert.match(range.stderr, /1 findings in the commits of HEAD~1\.\.HEAD \(the commit rules of kit\)/);
  const file = path.join(root, 'MSG');
  writeFileSync(file, '# comment\nfeat(ci): Fine (#K2)\n');
  const good = command('--message', file);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /the message being committed passed/);
  writeFileSync(file, 'wip\n');
  const refused = command('--message', file);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /\[check-commits\] commit-subject: the subject is "wip"/);
  assert.equal(command('--range', 'bogus').status, 1);
});

test('the item rules need config/checklist.json: a range of a checkout without it fails and names the file', (t) => {
  const { root } = repository(t, ['feat(docs): Start (#K1)']);
  put(root, { 'config/checklist.json': null });
  assert.throws(() => rangeFindings(root, 'HEAD', CONFIG), /config\/checklist\.json does not exist in .*; the repository declares its hooks and the pattern of its item IDs there/);
});

const TRACKED = { schema: 1, types: ['feat', 'fix', 'docs'], subjectMax: 50, bodyMax: 72, changelog: { path: 'CHANGELOG.md', translation: 'CHANGELOG.ko.md' } };
const CHECKLIST = { schema: 1, hooks: ['pre-push'], idPattern: '[A-Z][0-9]+(?:[-.][0-9]+)*' };
// The checklist of the plan p, which kit finds by its folder (K241).
const PLAN = 'docs/plans/p/checklist.md';
const plan = (rows: Array<[string, string]>) => `# Plan\n\n| ID | Task | State |\n|---|---|---|\n${rows.map(([id, state]) => `| ${id} | Task ${id} | ${state} |`).join('\n')}\n`;

function tracked(t: TestContext, steps: Array<[string, Record<string, string | null>]>) {
  const root = tree(t, { 'config/checklist.json': JSON.stringify(CHECKLIST) });
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  for (const [message, files] of steps) {
    put(root, files);
    git('add', '-A');
    const result = git('commit', '-q', '-m', message);
    assert.equal(result.status, 0, result.stderr);
  }
  return { root, git };
}

test('commit-changelog: a commit that moves an item to its done state also changes the changelog in both languages', (t) => {
  const { root } = tracked(t, [
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[~]'], ['S2', '[ ]']]), 'CHANGELOG.md': '# Changelog\n', 'CHANGELOG.ko.md': '# 변경 기록\n' }],
    ['feat(core): Finish S1 (#S1)\n\nNo-Red: a fixture of the item rules\n', { [PLAN]: plan([['S1', '[o]'], ['S2', '[ ]']]), 'CHANGELOG.md': '# Changelog\n\n- S1\n' }],
    ['feat(core): Finish S2 (#S2)\n\nNo-Red: a fixture of the item rules\n', { [PLAN]: plan([['S1', '[o]'], ['S2', '[o]']]), 'CHANGELOG.md': '# Changelog\n\n- S1\n- S2\n', 'CHANGELOG.ko.md': '# 변경 기록\n\n- S2\n' }],
  ]);
  const findings = rangeFindings(root, 'HEAD~2..HEAD', TRACKED);
  assert.equal(findings.length, 1, findings.join('\n'));
  const first = findings[0];
  assert.ok(first !== undefined, 'rangeFindings found nothing');
  assert.match(first, /: commit-changelog: the commit moves S1 to \[o\] in docs\/plans\/p\/checklist\.md but does not change CHANGELOG\.ko\.md; record the item in the changelog of both languages$/);
});

test('commit-items: a commit changes the state of at most one item, and a row it adds is not a change', (t) => {
  const { root } = tracked(t, [
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[ ]'], ['S2', '[ ]']]) }],
    ['docs(plan): Start two tasks (#S1)', { [PLAN]: plan([['S1', '[~]'], ['S2', '[~]'], ['S3', '[ ]'], ['S4', '[o]']]) }],
    ['docs(plan): Add a sub-task (#S1)', { [PLAN]: plan([['S1', '[~]'], ['S2', '[~]'], ['S3', '[ ]'], ['S4', '[o]'], ['S1-1', '[o]']]) }],
  ]);
  const findings = rangeFindings(root, 'HEAD~2..HEAD', TRACKED);
  assert.equal(findings.length, 1, findings.join('\n'));
  const first = findings[0];
  assert.ok(first !== undefined, 'rangeFindings found nothing');
  assert.match(first, /: commit-items: the commit changes the state of 2 items \(S1 \[ \] → \[~\], S2 \[ \] → \[~\]\); change one item per commit$/);
});

test('a checklist that a revision lacks reads as empty, and any other failure of git show names the revision and the file', (t) => {
  const { root, git } = tracked(t, [
    ['docs(core): Start (#S1)', { 'README.md': 'x\n' }],
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[ ]']]) }],
    ['docs(plan): Start S1 (#S1)', { [PLAN]: plan([['S1', '[~]']]) }],
  ]);
  assert.deepEqual(rangeFindings(root, 'HEAD~2..HEAD', TRACKED), [], 'the parent of the second commit has no checklist');
  // The blob of the checklist at HEAD~1 is a loose object; without it, git show fails although the tree names the file.
  const blob = git('rev-parse', `HEAD~1:${PLAN}`).stdout.trim();
  rmSync(path.join(root, '.git/objects', blob.slice(0, 2), blob.slice(2)));
  assert.throws(() => rangeFindings(root, 'HEAD~1..HEAD', TRACKED), /git show [0-9a-f]+\^:docs\/plans\/p\/checklist\.md failed: .*/);
});

test('the item rules of the commit-msg hook compare the index with HEAD', (t) => {
  const { root, git } = tracked(t, [['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[~]']]), 'CHANGELOG.md': '# Changelog\n', 'CHANGELOG.ko.md': '# 변경 기록\n' }]]);
  put(root, { [PLAN]: plan([['S1', '[o]']]) });
  git('add', '-A');
  assert.deepEqual(indexItemFindings(root, TRACKED, 'feat(core): Finish S1 (#S1)\n\nNo-Red: a fixture of the item rules\n').map(found => found.message.split(' does not change ')[1]), ['CHANGELOG.md; record the item in the changelog of both languages', 'CHANGELOG.ko.md; record the item in the changelog of both languages']);
  put(root, { 'CHANGELOG.md': '# Changelog\n\n- S1\n', 'CHANGELOG.ko.md': '# 변경 기록\n\n- S1\n' });
  git('add', '-A');
  assert.deepEqual(indexItemFindings(root, TRACKED, 'feat(core): Finish S1 (#S1)\n\nNo-Red: a fixture of the item rules\n'), []);
});

test('a repository without a changelog keeps the one item rule', (t) => {
  const { root } = tracked(t, [
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[~]']]) }],
    ['feat(core): Finish S1 (#S1)\n\nNo-Red: a fixture of the item rules\n', { [PLAN]: plan([['S1', '[o]']]) }],
  ]);
  assert.deepEqual(rangeFindings(root, 'HEAD~1..HEAD', CONFIG), []);
});

// K624: the commit that moves a row to done states its red in its body, `Red: <command> exit <n> at <sha>` or `No-Red: <reason>`;
// only the line is checked, and the recorder that blocked done is gone.
test('commit-red: a commit that moves a row to done states its red or why it has none (K624)', (t) => {
  const steps = (message: string): Array<[string, Record<string, string | null>]> => [
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[~]']]) }],
    [message, { [PLAN]: plan([['S1', '[o]']]) }],
  ];
  const red = (message: string) => rangeFindings(tracked(t, steps(message)).root, 'HEAD~1..HEAD', CONFIG);
  assert.match(red('feat(core): Finish S1 (#S1)').join('\n'), /: commit-red: the commit moves S1 to done and its body states no red/);
  assert.match(red('feat(core): Finish S1 (#S1)\n\nNo-Red: \n').join('\n'), /: commit-red: /, 'a No-Red line names its reason');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed: node --test a.test.mts exit 1 at 0123abc\n'), []);
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed-Test: node --test a.test.mts exit 1 at 0123abc\n'), [], 'the Red-Test line of an earlier commit counts');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nNo-Red: the row deletes a script\n'), []);
  const fix = tracked(t, [
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[ ]']]), 'src/a.ts': 'export const a = 1;\n' }],
    ['fix(core): Correct a configuration (#S1)\n\nNo-Red: the configuration has no behaviour a test shows\n', { 'src/a.ts': 'export const a = 2;\n' }],
  ]);
  assert.deepEqual(rangeFindings(fix.root, 'HEAD~1..HEAD', CONFIG), [], 'a fix that states No-Red needs no test file');
});

test('commit-fix-test: a fix commit changes a test file of a runner of kit (K257)', (t) => {
  const { root } = tracked(t, [
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[ ]']]), 'src/a.ts': 'export const a = 1;\n' }],
    ['fix(core): Correct a without a test (#S1)', { 'src/a.ts': 'export const a = 2;\n' }],
    ['fix(core): Correct a with its test (#S1)', { 'src/a.ts': 'export const a = 3;\n', 'tests/a.test.ts': 'test;\n' }],
    ['fix(go): Correct b with its test (#S1)', { 'b.go': 'package b\n', 'b_test.go': 'package b\n' }],
    ['feat(core): Extend a without a test (#S1)', { 'src/a.ts': 'export const a = 4;\n' }],
  ]);
  const findings = rangeFindings(root, 'HEAD~4..HEAD', TRACKED);
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0] ?? '', /: commit-fix-test: the fix commit changes no test file \(tests\/, \*\.test\.\*, \*_test\.go, test_\*\.py, \*Test\.php, tests\.rs, #\[cfg\(test\)\] or #\[test\] code of \*\.rs\); a fix starts with a test that reproduces the defect, or states No-Red: <reason> when no test can show it$/);
});

test('commit-fix-test takes a Rust unit test: src/tests.rs and a change inside a cfg(test) module or a #[test] function (K370)', (t) => {
  const lib = (adder: string, assertion: string) => [
    `pub fn add(a: i32, b: i32) -> i32 {`,
    `    ${adder}`,
    '}',
    '',
    '#[cfg(test)]',
    'mod tests {',
    '    use super::*;',
    '',
    '    #[test]',
    '    fn adds() {',
    `        ${assertion}`,
    '    }',
    '}',
    '',
  ].join('\n');
  const { root } = tracked(t, [
    ['feat(core): Add the adder (#K370)', { 'src/lib.rs': lib('a.wrapping_add(b)', 'assert_eq!(add(1, 2), 3);'), [PLAN]: plan([['K370', '[ ]']]) }],
    ['fix(rust): Correct the adder with its test (#K370)', { 'src/lib.rs': lib('a.saturating_add(b)', 'assert_eq!(add(1, 2), 3, "sum");') }],
    ['fix(rust): Correct the adder with tests.rs (#K370)', { 'src/tests.rs': '#[test]\nfn adds() {}\n' }],
    ['fix(rust): Correct the adder without a test (#K370)', { 'src/lib.rs': lib('b.wrapping_add(a)', 'assert_eq!(add(1, 2), 3, "sum");') }],
  ]);
  const findings = rangeFindings(root, 'HEAD~3..HEAD', TRACKED);
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0] ?? '', /: commit-fix-test: /);
});

test('rustTestLines: the lines of a #[cfg(test)] module, not the braces of strings, chars and comments (K370)', () => {
  const text = [
    'fn f() {',
    '}',
    '',
    '#[cfg(test)]',
    'mod tests {',
    '    // }',
    '    #[test]',
    '    fn a() {',
    '        let s = "{";',
    "        let c = '{';",
    '        /* } */ assert!(s.len() > 0);',
    '    }',
    '}',
    'fn after() {}',
  ].join('\n');
  assert.deepEqual([...rustTestLines(text)].sort((a, b) => a - b), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test('commits-check finds in each commit of its range what the hooks refuse at commit time (K351)', (t) => {
  const root = tree(t, {});
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  const commit = (message: string, files: Record<string, string>, ...flags: string[]) => {
    put(root, files);
    git('add', '-A');
    const result = git('commit', '-q', ...flags, '-m', message);
    assert.equal(result.status, 0, result.stderr);
    return git('rev-parse', '--short', 'HEAD').stdout.trim();
  };
  commit('feat(docs): Start (#K1)', {
    'config/checklist.json': JSON.stringify(CHECKLIST),
    [PLAN]: plan([['K1', '[ ]'], ['K2', '[ ]'], ['K3', '[ ]'], ['K4', '[ ]']]),
    'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [] }),
    'config/documents.json': JSON.stringify({ schema: 1, include: ['docs/**/*.md'] }),
    ...pair('docs/a.md', 'a', 'Body of a.\n'),
  });
  const clean = commit('feat(docs): Add the second document (#K2)', pair('docs/b.md', 'b', 'Body of b.\n'));
  const generated = commit('feat(deps): Vendor a file (#K3)', { 'node_modules/x/index.js': 'x\n' }, '--no-verify');
  const stale = commit('docs(docs): Change the first document (#K4)', { 'docs/a.md': english('a', 'Changed body of a.\n') }, '--no-verify');
  const findings = rangeFindings(root, 'HEAD~3..HEAD', CONFIG);
  assert.equal(findings.length, 2, findings.join('\n'));
  assert.ok(!findings.some(line => line.startsWith(`${clean}: `)), 'a clean commit gives no finding');
  const generatedLines = findings.filter(line => line.startsWith(`${generated}: `));
  assert.equal(generatedLines.length, 1, findings.join('\n'));
  assert.match(generatedLines[0] ?? '', /: commit-generated: node_modules\/x\/index\.js is a generated file/);
  const twinLines = findings.filter(line => line.startsWith(`${stale}: `));
  assert.equal(twinLines.length, 1, findings.join('\n'));
  assert.match(twinLines[0] ?? '', /: commit-twin: docs\/a\.ko\.md: revision: /);
});

// K416: commits-check reads the content of each changed file of a commit, so an executable object committed with --no-verify fails.
test('commits-check finds an executable object in a commit of its range, whatever its path (K416)', (t) => {
  const root = tree(t, {});
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  put(root, { 'config/checklist.json': JSON.stringify(CHECKLIST), 'config/generated.json': JSON.stringify({ schema: 1, paths: [], exceptions: [] }), 'cmd/tool/main.go': 'package main\n' });
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feat(cmd): Start (#K1)').status, 0);
  writeFileSync(path.join(root, 'cmd/tool/tool'), Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(56)]));
  git('add', '-A');
  assert.equal(git('commit', '-q', '--no-verify', '-m', 'feat(cmd): Build the tool (#K2)').status, 0);
  const built = git('rev-parse', '--short', 'HEAD').stdout.trim();
  const findings = rangeFindings(root, 'HEAD~1..HEAD', CONFIG);
  assert.deepEqual(findings.map(line => line.replace(/^[0-9a-f]+: /, `${built}: `)).filter(line => line.includes('commit-generated')), [`${built}: commit-generated: cmd/tool/tool is an executable object (ELF), whatever its path; remove it from the commit, or declare it an exception in config/generated.json`]);
});

// K424: the subject of a commit names a row of a checklist of the tree of that commit; the first commit of a repository has no parent and passes.
test('commit-row: a subject names a row of a checklist of the tree of its commit, and the first commit passes (K424)', (t) => {
  const ROWS = { schema: 1, hooks: ['pre-push'], idPattern: 'T[0-9]+' };
  const root = tree(t, {});
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  const commit = (message: string, files: Record<string, string>) => {
    put(root, files);
    git('add', '-A');
    const result = git('commit', '-q', '-m', message);
    assert.equal(result.status, 0, result.stderr);
    return git('rev-parse', '--short', 'HEAD').stdout.trim();
  };
  // The first commit names T9, which its tree lacks: it has no parent, so it passes.
  commit('feat(core): Start (#T9)', { 'config/checklist.json': JSON.stringify(ROWS), [PLAN]: plan([['T1', '[ ]']]) });
  commit('feat(core): Finish T1 (#T1)', { 'a.txt': 'a\n' });
  const unnamed = commit('feat(core): Start T9 (#T9)', { 'b.txt': 'b\n' });
  commit('docs(plan): Register T2 (#T2)', { [PLAN]: plan([['T1', '[ ]'], ['T2', '[ ]']]) });
  const findings = rangeFindings(root, 'HEAD~3..HEAD', CONFIG);
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0] ?? '', new RegExp(`^${unnamed}\\w*: commit-row: the subject names T9, which is no item of a checklist of docs/plans in the tree of the commit; register the row first with make item-new$`));
  const rootCommit = git('rev-list', '--max-parents=0', 'HEAD').stdout.trim();
  assert.deepEqual(findingLines(root, [{ id: rootCommit, message: 'feat(core): Start (#T9)' }], CONFIG), [], 'the first commit has no parent');
  // The commit-msg hook compares the index: a row that the index adds passes, and a row that it lacks fails.
  put(root, { 'c.txt': 'c\n' });
  git('add', '-A');
  assert.deepEqual(indexItemFindings(root, CONFIG, 'feat(core): Start T9 (#T9)').map(found => found.rule), ['commit-row']);
  assert.deepEqual(indexItemFindings(root, CONFIG, 'feat(core): Finish T1 (#T1)'), []);
  put(root, { [PLAN]: plan([['T1', '[ ]'], ['T2', '[ ]'], ['T9', '[ ]']]) });
  git('add', '-A');
  assert.deepEqual(indexItemFindings(root, CONFIG, 'feat(core): Start T9 (#T9)'), [], 'the index holds the row that the commit adds');
  const fresh = tree(t, { 'config/checklist.json': JSON.stringify(ROWS), [PLAN]: plan([['T1', '[ ]']]) });
  spawnSync('git', ['add', '-A'], { cwd: fresh, encoding: 'utf8' });
  assert.deepEqual(indexItemFindings(fresh, CONFIG, 'feat(core): Start (#T9)'), [], 'the first commit of a repository passes');
});

// K449: a docs or chore commit is for documents only; a fix or a change of code is committed with its own type, staged alone.
test('a docs(plan) or chore commit that stages code, a test or a recipe is refused, and names the paths (K449)', (t) => {
  const { root, git } = repository(t, ['feat(core): Start (#K1)'], ['K1']);
  put(root, { 'scripts/kit/link.mts': 'export {};\n' });
  git('add', '-A');
  const found = indexItemFindings(root, CONFIG, 'docs(plan): Close K1 (#K1)').filter(entry => entry.rule === 'commit-type');
  assert.equal(found.length, 1, found.map(entry => entry.message).join('\n'));
  assert.match(found[0]?.message ?? '', /scripts\/kit\/link\.mts.*stage the fix alone and commit it with its own type/);
  assert.deepEqual(indexItemFindings(root, CONFIG, 'fix(link): Close K1 (#K1)').filter(entry => entry.rule === 'commit-type'), [], 'a fix may stage code');
  git('reset', '-q');
  put(root, { 'docs/notes.md': 'n\n' });
  git('add', 'docs/notes.md');
  assert.deepEqual(indexItemFindings(root, CONFIG, 'docs(plan): Note (#K1)').filter(entry => entry.rule === 'commit-type'), [], 'a document may be committed as docs');
});

// K449: a chore commit is held to the same rule, and a recipe is code: a Makefile staged with a chore is refused, a document is not.
test('a chore commit that stages a Makefile is refused, and a chore that stages a document is not (K449)', (t) => {
  const { root, git } = repository(t, ['feat(core): Start (#K1)'], ['K1']);
  put(root, { 'Makefile': 'all:\n\ttrue\n' });
  git('add', 'Makefile');
  assert.equal(indexItemFindings(root, CONFIG, 'chore(plan): Close K1 (#K1)').filter(entry => entry.rule === 'commit-type').length, 1, 'a Makefile is a recipe');
  git('reset', '-q');
  put(root, { 'docs/readme.md': 'r\n' });
  git('add', 'docs/readme.md');
  assert.deepEqual(indexItemFindings(root, CONFIG, 'chore(plan): Note (#K1)').filter(entry => entry.rule === 'commit-type'), [], 'a document may be committed as chore');
});

// K497: a commit on a branch is refused when its index holds a row with an ID that main holds with another task, unless the ID is
// the row of the branch itself; the finding names the ID, the task on main and the next free ID. main itself is the reference.
test('row-id: a commit on a branch refuses a row whose ID main holds with another task (K497)', (t) => {
  const ROWS = { schema: 1, hooks: ['pre-push'], idPattern: 'T[0-9]+' };
  const root = tree(t, {});
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  const rows = (pairs: Array<[string, string]>) => `# Plan\n\n| ID | Task | State |\n|---|---|---|\n${pairs.map(([id, task]) => `| ${id} | ${task} | [ ] |`).join('\n')}\n`;
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  put(root, { 'config/checklist.json': JSON.stringify(ROWS), [PLAN]: rows([['T1', 'Write the parser'], ['T5', 'Print the union on main']]) });
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feat(core): Start (#T1)').status, 0);
  const stage = (branch: string, pairs: Array<[string, string]>) => {
    assert.equal(git('checkout', '-q', '-B', branch, 'main').status, 0);
    put(root, { [PLAN]: rows(pairs) });
    git('add', '-A');
  };
  stage('fix/other-T9', [['T1', 'Write the parser'], ['T5', 'Link the composer shim']]);
  const clash = indexItemFindings(root, CONFIG, 'docs(plan): Register T5 (#T5)').filter(found => found.rule === 'row-id');
  assert.equal(clash.length, 1, JSON.stringify(clash));
  assert.match(clash[0]?.message ?? '', /T5/);
  assert.match(clash[0]?.message ?? '', /Print the union on main/);
  assert.match(clash[0]?.message ?? '', /T6/);
  stage('fix/edit-T5', [['T1', 'Write the parser'], ['T5', 'Print the union of two types']]);
  assert.deepEqual(indexItemFindings(root, CONFIG, 'docs(plan): Restate T5 (#T5)').filter(found => found.rule === 'row-id'), [], 'the branch of T5 restates its own row');
  git('reset', '-q', '--hard');
  assert.equal(git('checkout', '-q', 'main').status, 0);
  put(root, { [PLAN]: rows([['T1', 'Write the parser'], ['T5', 'Print the union of two types']]) });
  git('add', '-A');
  assert.deepEqual(indexItemFindings(root, CONFIG, 'docs(plan): Restate T5 (#T5)').filter(found => found.rule === 'row-id'), [], 'main is the reference');
});

// K497-1: only a row that the branch adds or changes is compared with main. A branch that forked before main restated a row holds the
// old task of that row, which the branch never touched; that is no clash.
test('row-id: a row that only main changed after the branch forked is no clash (K497-1)', (t) => {
  const ROWS = { schema: 1, hooks: ['pre-push'], idPattern: 'T[0-9]+' };
  const root = tree(t, {});
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  const rows = (pairs: Array<[string, string]>) => `# Plan\n\n| ID | Task | State |\n|---|---|---|\n${pairs.map(([id, task]) => `| ${id} | ${task} | [ ] |`).join('\n')}\n`;
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  put(root, { 'config/checklist.json': JSON.stringify(ROWS), [PLAN]: rows([['T1', 'Write the parser'], ['T5', 'Print the union']]) });
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feat(core): Start (#T1)').status, 0);
  assert.equal(git('branch', 'fix/other-T7').status, 0);
  // main restates T5 after the branch forked.
  put(root, { [PLAN]: rows([['T1', 'Write the parser'], ['T5', 'Print the union of two types']]) });
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'docs(plan): Restate T5 (#T5)').status, 0);
  // The branch adds its own row T7 and keeps the T5 that it forked with.
  assert.equal(git('checkout', '-q', 'fix/other-T7').status, 0);
  put(root, { [PLAN]: rows([['T1', 'Write the parser'], ['T5', 'Print the union'], ['T7', 'Add the reader']]) });
  git('add', '-A');
  assert.deepEqual(indexItemFindings(root, CONFIG, 'docs(plan): Register T7 (#T7)').filter(found => found.rule === 'row-id'), [], 'T5 is unchanged by the branch');
  // A row that the branch itself changes is still compared with main.
  put(root, { [PLAN]: rows([['T1', 'Write the parser'], ['T5', 'Link the composer shim'], ['T7', 'Add the reader']]) });
  git('add', '-A');
  assert.equal(indexItemFindings(root, CONFIG, 'docs(plan): Register T7 (#T7)').filter(found => found.rule === 'row-id').length, 1, 'a T5 that the branch changes clashes');
});
