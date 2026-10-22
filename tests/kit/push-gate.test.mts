// Tests of the push gate (scripts/kit/push-gate.mts). The pre-push hook that `git-hooks install` writes refuses a push while
// an item of a tracker is in the active state in a pushed commit or in the working tree, naming each item with its file and
// ID, and while it cannot read a tracker; the states that do not block pass. The command `commit <rev>` applies the same
// check to one commit and requires the hooks to be tracked with mode 100755. Each case pushes from a temporary checkout to
// a temporary bare repository.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CHECKLIST, TRANSLATION, commitAll, commitIndex, git, prepared, run } from './gates-checkout.mts';
import { tool } from './kit-tools.mts';

const push = (work: string, ...refspecs: string[]) => run(work, 'git', ['push', '--quiet', 'origin', ...(refspecs.length ? refspecs : ['HEAD:refs/heads/main'])]);
const remoteHead = (remote: string) => run(remote, 'git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).stdout.trim();
const gate = (work: string, args: string[], env: NodeJS.ProcessEnv = {}, input?: string) => run(work, process.execPath, [tool(import.meta.resolve('../../scripts/kit/push-gate.mts')), ...args], { env: { ...process.env, ...env }, input });
const edit = (work: string, file: string, change: (text: string) => string) => writeFileSync(path.join(work, file), change(readFileSync(path.join(work, file), 'utf8')));
// `text` with `from` replaced; a row that a fixture no longer holds fails here instead of leaving the text unchanged (K260).
const swap = (text: string, from: string | RegExp, to: string) => {
  const next = text.replace(from, to);
  assert.notEqual(next, text, `the text holds no ${String(from)}`);
  return next;
};
const start = (work: string, id = 'T1-1') => {
  for (const file of [CHECKLIST, TRANSLATION]) edit(work, file, text => swap(text, new RegExp(`(\\| ${id} \\|[^\\n]*)\\| \\[ \\] \\|`), '$1| [~] |'));
};

test('a push whose checklists hold waiting, done and bypassed items reaches the remote', (t) => {
  const { work, remote } = prepared(t);
  const pushed = push(work);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(remoteHead(remote), git(work, 'rev-parse', 'HEAD'));
});

test('a push whose commit has an item in progress is refused and names the file, the ID and what blocks', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work).status, 0);
  const before = remoteHead(remote);
  start(work);
  const active = commitAll(work, 'docs(checklist): Start T1-1 (#T1-1)');
  const pushed = push(work);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /push refused: 2 items are in the active state \(only the state \[~\] blocks; \[ \], \[o\], \[!\], \[-\] do not block\)/);
  assert.match(pushed.stderr, new RegExp(`  HEAD ${active.slice(0, 12)}: docs/plans/work/checklist\\.md T1-1 Print \`a \\\\\\| b\` for a union`));
  assert.match(pushed.stderr, /A push happens only when no item of a checklist is in its active state/);
  assert.match(pushed.stderr, /  working tree: docs\/plans\/work\/checklist\.md T1-1 /);
  assert.equal(remoteHead(remote), before);
});

test('a push is refused while the working tree has an item in progress and the pushed commit has none', (t) => {
  const { work, remote } = prepared(t);
  start(work);
  const pushed = push(work);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /  working tree: docs\/plans\/work\/checklist\.md T1-1 /);
  assert.doesNotMatch(pushed.stderr, /HEAD [0-9a-f]{12}:/);
  assert.equal(remoteHead(remote), '');
});

test('every item in progress is named, in each pushed commit and in the working tree', (t) => {
  const { work } = prepared(t);
  edit(work, CHECKLIST, text => swap(swap(text, '| T1 | Write the parser | `src/parser.ts` | `make test` | [o] |', '| T1 | Write the parser | `src/parser.ts` | `make test` | [~] |'), /(\| T1-1 \|[^\n]*)\| \[ \] \|/, '$1| [~] |'));
  edit(work, TRANSLATION, text => swap(swap(text, '| T1 | parser를 작성한다 | `src/parser.ts` | `make test` | [o] |', '| T1 | parser를 작성한다 | `src/parser.ts` | `make test` | [~] |'), /(\| T1-1 \|[^\n]*)\| \[ \] \|/, '$1| [~] |'));
  const pushed = push(work);
  assert.match(pushed.stderr, /2 items are in the active state/);
  assert.match(pushed.stderr, /working tree: docs\/plans\/work\/checklist\.md T1 Write the parser/);
  assert.match(pushed.stderr, /working tree: docs\/plans\/work\/checklist\.md T1-1 /);
});

test('a push is refused when a pushed commit has no checklist', (t) => {
  const { work, remote } = prepared(t);
  git(work, 'rm', '--quiet', '--cached', CHECKLIST, TRANSLATION);
  const removed = commitIndex(work, 'docs(checklist): Remove the checklist (#T1)');
  const pushed = push(work);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /push refused: the push gate cannot read the checklists/);
  assert.match(pushed.stderr, new RegExp(`HEAD ${removed.slice(0, 12)}: it holds no checklist; a plan is docs/plans/<plan>/`));
  assert.equal(remoteHead(remote), '');
});

test('a document without an item or with an unknown state is unreadable and refuses the push', (t) => {
  const { work } = prepared(t);
  edit(work, CHECKLIST, () => '# Execution checklist\n');
  assert.match(push(work).stderr, /working tree: docs\/plans\/work\/checklist\.md: it has no item/);
  edit(work, CHECKLIST, () => '| ID | Task | State |\n|---|---|---|\n| T1 | A | [x] |\n');
  assert.match(push(work).stderr, /line 3: T1 has the state "\[x\]"/);
});

test('a translation with another state than its document refuses the push', (t) => {
  const { work, remote } = prepared(t);
  edit(work, TRANSLATION, text => swap(text, /(\| T1-1 \|[^\n]*)\| \[ \] \|/, '$1| [o] |'));
  commitAll(work, 'docs(checklist): Differ the translation (#T1-1)');
  const pushed = push(work);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /push refused: the push gate cannot read the checklists/);
  assert.match(pushed.stderr, /T1-1 is \[ \] in docs\/plans\/work\/checklist\.md and \[o\] in docs\/plans\/work\/checklist\.ko\.md/);
  assert.equal(remoteHead(remote), '');
});

test('the deletion of a remote branch reads only the working tree', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work, 'HEAD:refs/heads/main', 'HEAD:refs/heads/feat/other-T1').status, 0);
  const deleted = push(work, ':refs/heads/feat/other-T1');
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.equal(run(remote, 'git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/other-T1']).stdout.trim(), '');
  start(work);
  const refused = push(work, ':refs/heads/main');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /working tree: docs\/plans\/work\/checklist\.md T1-1/);
  assert.notEqual(remoteHead(remote), '');
});

test('a gate that cannot understand its input does not allow the push', (t) => {
  const { work } = prepared(t);
  const refused = gate(work, ['hook'], {}, 'refs/heads/main abc\n');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /push refused: the push gate failed: the pre-push input line "refs\/heads\/main abc" is not "<local ref> <local sha> <remote ref> <remote sha>"/);
  const sha = git(work, 'rev-parse', 'HEAD');
  assert.equal(gate(work, ['hook'], {}, `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`).status, 0);
  assert.equal(gate(work, ['hook'], {}, '').status, 0);
  assert.equal(gate(work, ['other']).status, 2);
  assert.match(gate(work, ['commit']).stderr, /Usage: node scripts\/kit\/push-gate\.mts hook \| commit <rev>/);
});

test('a gate without configuration refuses the push', (t) => {
  const { work } = prepared(t);
  git(work, 'rm', '--quiet', '-f', 'config/checklist.json');
  const refused = gate(work, ['hook'], {}, '');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /push refused: the push gate failed: config\/checklist\.json does not exist/);
});

test('the commit command passes for a commit without an item in progress and tracked hooks', (t) => {
  const { work } = prepared(t);
  const summary = path.join(work, '..', 'summary.md');
  const clean = gate(work, ['commit', 'HEAD'], { GITHUB_STEP_SUMMARY: summary });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /\[push-gate\] commit [0-9a-f]{12}: no item is in an active state and every hook of config\/checklist\.json is tracked with mode 100755/);
  assert.equal(clean.stderr, '');
});

test('the commit command fails for an item in progress with an annotation for each line and a summary', (t) => {
  const { work } = prepared(t);
  const summary = path.join(work, '..', 'summary.md');
  start(work);
  edit(work, CHECKLIST, text => swap(text, 'Print `a \\| b` for a union', '100% done\\|'));
  edit(work, TRANSLATION, text => swap(text, 'union을 `a \\| b`로 출력한다', '100% 끝'));
  commitAll(work, 'docs(checklist): Start T1-1 (#T1-1)');
  const failed = gate(work, ['commit', 'HEAD'], { GITHUB_STEP_SUMMARY: summary });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^::error::push refused: 1 item is in the active state/m);
  assert.match(failed.stdout, /^::error::  commit [0-9a-f]{12}: docs\/plans\/work\/checklist\.md T1-1 100%25 done\\\|$/m);
  assert.match(failed.stderr, /T1-1 100% done/);
  assert.match(readFileSync(summary, 'utf8'), /^## Push gate\n\n```\npush refused: 1 item is in the active state[\s\S]*T1-1 100% done/);
});

test('the commit command fails for a commit whose hook is missing or not executable', (t) => {
  const { work } = prepared(t);
  git(work, 'update-index', '--chmod=-x', '.githooks/pre-push');
  commitIndex(work, 'feat(core): Add a hook without mode (#T1-1)');
  const mode = gate(work, ['commit', 'HEAD']);
  assert.equal(mode.status, 1);
  assert.match(mode.stdout, /^::error::push refused: \.githooks\/pre-push is tracked with mode 100644, not 100755, in commit [0-9a-f]{12}/m);

  git(work, 'rm', '--quiet', '--cached', '.githooks/pre-push');
  commitIndex(work, 'feat(core): Remove the pre-push hook (#T1-1)');
  const missing = gate(work, ['commit', 'HEAD']);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /^::error::push refused: \.githooks\/pre-push is not tracked in commit [0-9a-f]{12}/m);
});

test('the commit command checks every hook that the configuration lists', (t) => {
  const config = { schema: 1, hooks: ['pre-push', 'post-merge'], idPattern: 'T[0-9]+(?:[.-][0-9]+)*' };
  const { work } = prepared(t);
  writeFileSync(path.join(work, 'config/checklist.json'), JSON.stringify(config));
  commitAll(work, 'feat(core): List the post-merge hook (#T1-1)');
  const missing = gate(work, ['commit', 'HEAD']);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /^::error::push refused: \.githooks\/post-merge is not tracked in commit /m);
  assert.doesNotMatch(missing.stdout, /pre-push is not tracked/);
});

test('the commit command refuses a revision that is not a commit', (t) => {
  const { work } = prepared(t);
  const refused = gate(work, ['commit', 'no-such-revision']);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /^::error::push refused: no-such-revision is not a commit of this repository$/m);
});

// The commit messages of the pushed range, checked with the commit rules of kit (the same check as make commits-check).
const WIDE = `${'word '.repeat(14)}abcd`; // 74 characters with a space, so the line is not a single long word
const note = (work: string, name: string, message: string) => {
  writeFileSync(path.join(work, name), `${name}\n`);
  return commitAll(work, message);
};
// The commit skips the commit-time checks, as a commit that reaches the push gate past them does (K380).
const wideNote = (work: string, name: string, message: string) => {
  writeFileSync(path.join(work, name), `${name}\n`);
  git(work, 'add', '--all');
  return commitIndex(work, message);
};

test('a push is refused when a pushed commit has a body line wider than bodyMax, and names the commit and the line', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work).status, 0);
  const before = remoteHead(remote);
  const wide = wideNote(work, 'wide.txt', `docs(checklist): Add the notes (#T1)\n\n${WIDE}\n`);
  const pushed = push(work);
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /push refused: 1 commit finding/);
  assert.match(pushed.stderr, new RegExp(`^  ${wide.slice(0, 7)}[0-9a-f]*: commit-width: line 3 of the message has 74 characters; expected at most 72; wrap the body$`, 'm'));
  assert.equal(remoteHead(remote), before);
});

test('a push of a clean range is allowed, and its commit messages pass', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work).status, 0);
  const clean = note(work, 'clean.txt', `docs(checklist): Add the notes (#T1)\n\n${'word '.repeat(14)}ab\n`);
  const pushed = push(work);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(remoteHead(remote), clean);
});

test('a new branch is checked for the commits that no remote ref holds', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work).status, 0);
  const wide = wideNote(work, 'wide.txt', `docs(checklist): Add the notes (#T1)\n\n${WIDE}\n`);
  const refused = push(work, 'HEAD:refs/heads/feat/other-T1');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, new RegExp(`^  ${wide.slice(0, 7)}[0-9a-f]*: commit-width: line 3 `, 'm'));
  assert.equal(run(remote, 'git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/other-T1']).stdout.trim(), '');
});

test('a push checks only the commits after the remote sha, so a wide commit the remote holds does not refuse', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work).status, 0);
  wideNote(work, 'wide.txt', `docs(checklist): Add the notes (#T1)\n\n${WIDE}\n`);
  assert.equal(push(work, '--no-verify', 'HEAD:refs/heads/main').status, 0);
  const clean = note(work, 'clean.txt', `docs(checklist): Add the more notes (#T1)\n\n${'word '.repeat(14)}ab\n`);
  const pushed = push(work);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(remoteHead(remote), clean);
});

test('a deleted ref pushes no commit and is not checked', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work).status, 0);
  wideNote(work, 'wide.txt', `docs(checklist): Add the notes (#T1)\n\n${WIDE}\n`);
  assert.equal(push(work, '--no-verify', 'HEAD:refs/heads/feat/other-T1').status, 0);
  const deleted = push(work, ':refs/heads/feat/other-T1');
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.equal(run(remote, 'git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/other-T1']).stdout.trim(), '');
});

test('a pushed branch other than main is named {type}/{shortname}-{item id} (K253)', (t) => {
  const { work, remote } = prepared(t);
  assert.equal(push(work).status, 0);
  assert.equal(push(work, 'HEAD:refs/heads/feat/parser-T1').status, 0);
  const pushed = push(work, 'HEAD:refs/heads/wip');
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /push refused: the branch wip is not named \{type\}\/\{shortname\}-\{checklist id\}/);
  assert.equal(run(remote, 'git', ['rev-parse', '--verify', '--quiet', 'refs/heads/wip']).stdout.trim(), '');
});

test('a branch that main has merged, or a worktree whose folder breaks its name, refuses the push (K253)', (t) => {
  const { work } = prepared(t);
  git(work, 'branch', 'feat/parser-T1');
  writeFileSync(path.join(work, 'later.txt'), 'later\n');
  commitAll(work, 'feat(core): Add a later file (#T1)');
  const merged = push(work);
  assert.notEqual(merged.status, 0);
  assert.match(merged.stderr, /the branch feat\/parser-T1 is merged into main; delete it with git branch -d feat\/parser-T1/);
  git(work, 'branch', '-d', 'feat/parser-T1');
  git(work, 'worktree', 'add', '--quiet', '-b', 'feat/lexer-T2', path.join(path.dirname(work), 'scratch'));
  const named = push(work);
  assert.notEqual(named.status, 0);
  assert.match(named.stderr, /the worktree .*scratch is not named \{project\}-\{shortname\}-\{checklist id\}, here work-<shortname>-<id>/);
  git(work, 'worktree', 'remove', path.join(path.dirname(work), 'scratch'));
  git(work, 'worktree', 'add', '--quiet', '-b', 'feat/lexer-T3', path.join(path.dirname(work), 'work-lexer-T3'));
  assert.equal(push(work).status, 0, 'a worktree named for its item, on a branch that main has not merged, passes');
});
