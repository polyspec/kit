// Tests of scripts/kit/check-commits.mts: each rule of a commit message has a passing and a failing case, the rules of the
// checklist items that a commit changes have a passing and a failing case, and the command reads a range, a message file
// and the configuration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileMessage, identityFindings, indexItemFindings, messageFindings, rangeFindings } from '../../scripts/kit/check-commits.mts';
import { put, tree } from './tree.mts';
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
  const { root, git } = repository(t, ['feat(docs): Start (#K1)']);
  put(root, { 'g.txt': 'g' });
  git('add', '-A');
  assert.equal(git('commit', '-q', '--author', 'Claude <noreply@anthropic.com>', '-m', 'feat(docs): Add (#K2)').status, 0);
  const findings = rangeFindings(root, 'HEAD~1..HEAD', CONFIG);
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /: commit-ai-identity: the author Claude <noreply@anthropic\.com> is an AI tool; the account of a commit is a person \(K265\)/);
});

test('a message file loses its comment lines, and a merge commit is not checked', () => {
  assert.equal(fileMessage('# comment\nfeat(docs): Merge the checks (#K1)\n# more\n'), 'feat(docs): Merge the checks (#K1)\n');
  assert.equal(fileMessage('Merge branch x\n'), null);
});

function repository(t: TestContext, messages: string[]) {
  const root = tree(t, { 'config/checklist.json': JSON.stringify(CHECKLIST) });
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
  const { root, git } = repository(t, ['feat(docs): Start (#K1)', 'bad subject', 'feat(ci): Fine (#K2)']);
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

test('a merge commit in the range is not checked', (t) => {
  const { root, git } = repository(t, ['feat(docs): Start (#K1)']);
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
  const { root } = repository(t, ['feat(docs): Start (#K1)', 'bad subject']);
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
const CHECKLIST = { schema: 1, hooks: ['pre-push'], idPattern: 'S[0-9]+(?:-[0-9]+)*' };
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
    ['feat(core): Finish S1 (#S1)', { [PLAN]: plan([['S1', '[o]'], ['S2', '[ ]']]), 'CHANGELOG.md': '# Changelog\n\n- S1\n' }],
    ['feat(core): Finish S2 (#S2)', { [PLAN]: plan([['S1', '[o]'], ['S2', '[o]']]), 'CHANGELOG.md': '# Changelog\n\n- S1\n- S2\n', 'CHANGELOG.ko.md': '# 변경 기록\n\n- S2\n' }],
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
  assert.deepEqual(indexItemFindings(root, TRACKED, 'feat(core): Finish S1 (#S1)').map(found => found.message.split(' does not change ')[1]), ['CHANGELOG.md; record the item in the changelog of both languages', 'CHANGELOG.ko.md; record the item in the changelog of both languages']);
  put(root, { 'CHANGELOG.md': '# Changelog\n\n- S1\n', 'CHANGELOG.ko.md': '# 변경 기록\n\n- S1\n' });
  git('add', '-A');
  assert.deepEqual(indexItemFindings(root, TRACKED, 'feat(core): Finish S1 (#S1)'), []);
});

test('a repository without a changelog keeps the one item rule', (t) => {
  const { root } = tracked(t, [
    ['docs(plan): Add the tasks (#S1)', { [PLAN]: plan([['S1', '[~]']]) }],
    ['feat(core): Finish S1 (#S1)', { [PLAN]: plan([['S1', '[o]']]) }],
  ]);
  assert.deepEqual(rangeFindings(root, 'HEAD~1..HEAD', CONFIG), []);
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
  assert.match(findings[0] ?? '', /: commit-fix-test: the fix commit changes no test file \(tests\/, \*\.test\.\*, \*_test\.go, test_\*\.py, \*Test\.php\); a fix starts with a test that reproduces the defect, or, for a finding of a gate of kit-gates .* a Red-Gate line of the commit that moves the item to done \(K357\)$/);
});
