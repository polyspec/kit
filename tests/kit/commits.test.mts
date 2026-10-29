// Tests of scripts/kit/check-commits.mts: the AI footer and identity of a message, the red of a commit that moves a row to done and
// the test of a fix, each with a passing and a failing case, and the commit-msg command.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileMessage, identityFindings, indexItemFindings, messageFindings, rustTestLines } from '../../scripts/kit/check-commits.mts';
import { put, tree } from './tree.mts';
import { tool } from './kit-tools.mts';

const rules = (message: string) => messageFindings(message).map(found => found.rule);
const CHECKLIST = { schema: 1, hooks: [], idPattern: '[A-Z][0-9]+(?:[-.][0-9]+)*' };
// The checklist of the plan p, which kit finds by its folder (K241).
const PLAN = 'docs/plans/p/checklist.md';
const plan = (rows: Array<[string, string]>) => `# Plan\n\n| ID | Task | State |\n|---|---|---|\n${rows.map(([id, state]) => `| ${id} | Task ${id} | ${state} |`).join('\n')}\n`;

// A checkout that commits `base`, then stages `change`; returns the rules that the commit-msg check finds for `message`.
function staged(t: TestContext, base: Record<string, string>, change: Record<string, string>, message: string) {
  const root = tree(t, { 'config/checklist.json': JSON.stringify(CHECKLIST), ...base });
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feat(core): Start (#S1)').status, 0);
  put(root, change);
  git('add', '-A');
  return indexItemFindings(root, message).map(found => found.rule);
}

test('commit-ai-footer: a message holds no co-author or session trailer of an AI tool (K264)', () => {
  const body = 'feat(core): Add the parser (#K1)\n\nThe body.\n\n';
  assert.deepEqual(rules(`${body}Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Claude-Session: https://claude.ai/code/session_1\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Generated with [Claude Code](https://claude.com/claude-code)\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Co-authored-by: GitHub Copilot <copilot@github.com>\n`), ['commit-ai-footer']);
  assert.deepEqual(rules(`${body}Co-Authored-By: Jane Roe <jane@example.com>\n`), [], 'a person is a co-author');
});

test('commit-ai-identity: no AI tool is the author or the committer of a commit (K265)', () => {
  assert.deepEqual(identityFindings('Claude <noreply@anthropic.com>', 'author').map(found => found.rule), ['commit-ai-identity']);
  assert.deepEqual(identityFindings('min-0-max <max@blue.tools>', 'committer'), []);
});

test('a message file loses its comment lines, and a merge commit is not checked', () => {
  assert.equal(fileMessage('# comment\nfeat(docs): Merge the checks (#K1)\n# more\n'), 'feat(docs): Merge the checks (#K1)\n');
  assert.equal(fileMessage('Merge branch x\n'), null);
});

// K624: the commit that moves a row to done states its red in its body, `Red: <command> exit <n>` or `No-Red: <reason>`;
// only the line is checked.
test('commit-red: a commit that moves a row to done states its red or why it has none (K624)', (t) => {
  const red = (message: string) => staged(t, { [PLAN]: plan([['S1', '[~]']]) }, { [PLAN]: plan([['S1', '[o]']]) }, message);
  assert.deepEqual(red('feat(core): Finish S1 (#S1)'), ['commit-red']);
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nNo-Red: \n'), ['commit-red'], 'a No-Red line names its reason');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed: node --test a.test.mts exit 1 at 0123abc\n'), []);
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed-Test: node --test a.test.mts exit 1 at 0123abc\n'), [], 'the Red-Test line of an earlier commit counts');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed-Test: node scripts/kit/run-tests.mts node -- \\\n  --test-name-pattern=K746 tests/kit/commits.test.mts exit 1 at 0123abc\n'), [], 'a continued Red-Test keeps the exact command and evidence');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed-Test: node --test a.test.mts \\\n  at 0123abc\n'), ['commit-red'], 'a continuation without an exit status is not Red evidence');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed-Test: node --test a.test.mts exit 1 at unknown\n'), ['commit-red'], 'a continuation without a commit SHA is not Red evidence');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nNo-Red: the row deletes a script\n'), []);
});

// K875: land rebases a branch, so a sha of the red names a commit that main never holds; the command and its exit status stay true.
test('commit-red takes a Red line with the command and its exit status and no sha (K875)', (t) => {
  const red = (message: string) => staged(t, { [PLAN]: plan([['S1', '[~]']]) }, { [PLAN]: plan([['S1', '[o]']]) }, message);
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed: node --test a.test.mts exit 1\n'), []);
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed: node --test a.test.mts exit 1 at 0123abc\n'), [], 'a sha is still accepted');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed: node --test a.test.mts\n'), ['commit-red'], 'a line without an exit status is not Red evidence');
  assert.deepEqual(red('feat(core): Finish S1 (#S1)\n\nRed: node --test a.test.mts exit 0\n'), ['commit-red'], 'a red exits with a failure');
});

test('commit-fix-test: a fix commit changes a test file of a runner of kit, or states its red (K257, K693)', (t) => {
  const base = { [PLAN]: plan([['S1', '[ ]']]), 'src/a.ts': 'export const a = 1;\n' };
  assert.deepEqual(staged(t, base, { 'src/a.ts': 'export const a = 2;\n' }, 'fix(core): Correct a (#S1)'), ['commit-fix-test']);
  assert.deepEqual(staged(t, base, { 'src/a.ts': 'export const a = 3;\n', 'tests/a.test.ts': 'test;\n' }, 'fix(core): Correct a (#S1)'), []);
  assert.deepEqual(staged(t, base, { 'b.go': 'package b\n', 'b_test.go': 'package b\n' }, 'fix(go): Correct b (#S1)'), []);
  assert.deepEqual(staged(t, base, { 'src/a.ts': 'export const a = 4;\n' }, 'feat(core): Extend a (#S1)'), []);
  assert.deepEqual(staged(t, base, { 'src/a.ts': 'export const a = 5;\n' }, 'fix(core): Correct a (#S1)\n\nRed: make test exit 2 at f1711648\n'), []);
  assert.deepEqual(staged(t, base, { 'src/a.ts': 'export const a = 6;\n' }, 'fix(core): Correct a (#S1)\n\nNo-Red: the change only adjusts a declaration.\n'), []);
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
  const base = { 'src/lib.rs': lib('a.wrapping_add(b)', 'assert_eq!(add(1, 2), 3);'), [PLAN]: plan([['K370', '[ ]']]) };
  assert.deepEqual(staged(t, base, { 'src/lib.rs': lib('a.saturating_add(b)', 'assert_eq!(add(1, 2), 3, "sum");') }, 'fix(rust): Correct the adder (#K370)'), []);
  assert.deepEqual(staged(t, base, { 'src/tests.rs': '#[test]\nfn adds() {}\n' }, 'fix(rust): Correct the adder (#K370)'), []);
  assert.deepEqual(staged(t, base, { 'src/lib.rs': lib('b.wrapping_add(a)', 'assert_eq!(add(1, 2), 3);') }, 'fix(rust): Correct the adder (#K370)'), ['commit-fix-test']);
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

test('the command checks a message file and exits with the findings', (t) => {
  const root = tree(t, { 'config/checklist.json': JSON.stringify(CHECKLIST) });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'feat(core): Start (#S1)'], { cwd: root });
  const command = (...args: string[]) => spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-commits.mts')), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const file = path.join(root, 'MSG');
  writeFileSync(file, '# comment\nwip\n');
  const good = command('--message', file);
  assert.equal(good.status, 0, good.stderr);
  writeFileSync(file, 'wip\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
  const refused = command('--message', file);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /\[check-commits\] commit-ai-footer: line 3 of the message is the footer of an AI tool/);
  assert.equal(command('--range', 'HEAD').status, 1);
});
