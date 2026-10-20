// Tests of the plan utilities (scripts/kit/plan.mts): each writes the files of a plan or a row of a checklist only when the
// result passes the checks that the hooks and docs-check run on it (K249).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { commitItem, newItem, newPlan, setState, splitPlan, testItem } from '../../scripts/kit/plan.mts';
import { readChecklist, trackersOf } from '../../scripts/kit/checklist.mts';
import { sha256 } from '../../scripts/kit/bootstrap/digest.mts';
import { tree } from './tree.mts';

const CONFIG = { 'config/checklist.json': '{"schema":1,"hooks":["pre-push"],"idPattern":"T[0-9]+(?:[.-][0-9]+)*"}\n' };

test('plan-new writes the four files of a plan with their doc-ids, language links and revision markers (K249)', (t) => {
  const root = tree(t, CONFIG);
  const files = newPlan(root, { name: 'parser', title: 'Parser', titleKo: '파서' });
  assert.deepEqual(Object.keys(files).sort(), ['docs/plans/parser/checklist.ko.md', 'docs/plans/parser/checklist.md', 'docs/plans/parser/plan.ko.md', 'docs/plans/parser/plan.md']);
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  assert.equal(read('docs/plans/parser/plan.md'), '<!-- doc-id: plan-parser -->\n# Parser\n\n[한국어](plan.ko.md)\n');
  assert.equal(read('docs/plans/parser/plan.ko.md'), `<!-- doc-id: plan-parser -->\n<!-- source-sha256: ${sha256(read('docs/plans/parser/plan.md'))} -->\n# 파서\n\n[English](plan.md)\n`);
  assert.equal(read('docs/plans/parser/checklist.md'), '<!-- doc-id: checklist-parser -->\n# Parser checklist\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n');
  assert.match(read('docs/plans/parser/checklist.ko.md'), /^<!-- doc-id: checklist-parser -->\n<!-- source-sha256: [0-9a-f]{64} -->\n# 파서 체크리스트\n\n\| ID \| Task \|/);
  const [tracker] = trackersOf({ idPattern: 'T[0-9]+' }, Object.keys(files));
  assert.ok(tracker);
  assert.deepEqual(readChecklist(read(tracker.path), tracker, { strict: true }).items, []);
});

test('plan-new refuses a name that is no slug, an existing plan and a missing title (K249)', (t) => {
  const root = tree(t, CONFIG);
  newPlan(root, { name: 'parser', title: 'Parser', titleKo: '파서' });
  assert.throws(() => newPlan(root, { name: 'parser', title: 'Parser', titleKo: '파서' }), /docs\/plans\/parser exists/);
  assert.throws(() => newPlan(root, { name: 'Parser', title: 'P', titleKo: 'P' }), /the name "Parser" is no slug/);
  assert.throws(() => newPlan(root, { name: 'lexer', title: ' ', titleKo: '렉서' }), /TITLE is empty/);
  assert.throws(() => newPlan(root, { name: 'lexer', title: 'Lexer', titleKo: '' }), /TITLE_KO is empty/);
});

/** A checkout with the plans `names`, each made by newPlan. */
function plans(t: Parameters<typeof tree>[0], ...names: string[]) {
  const root = tree(t, CONFIG);
  for (const name of names) newPlan(root, { name, title: name, titleKo: name });
  return root;
}

const item = (plan: string, id: string, extra: Partial<Parameters<typeof newItem>[1]> = {}) => ({ plan, id, task: `Task ${id}`, taskKo: `작업 ${id}`, deliverables: '`a.mts`', verification: '`node --test a.test.mts`', ...extra });
const rows = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8').split('\n').filter(line => line.startsWith('| T'));

test('item-new adds a waiting row to a checklist and its twin, a sub-item after the last sub-item of its parent (K249-1)', (t) => {
  const root = plans(t, 'parser');
  for (const id of ['T1', 'T2', 'T1-1', 'T1-2', 'T1-1-1']) newItem(root, item('parser', id));
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.md').map(row => row.split(' | ')[0]), ['| T1', '| T1-1', '| T1-1-1', '| T1-2', '| T2']);
  assert.equal(rows(root, 'docs/plans/parser/checklist.md')[0], '| T1 | Task T1 | `a.mts` | `node --test a.test.mts` | [ ] |');
  assert.equal(rows(root, 'docs/plans/parser/checklist.ko.md')[0], '| T1 | 작업 T1 | `a.mts` | `node --test a.test.mts` | [ ] |');
});

test('item-new escapes a pipe of a cell, and refuses a line break (K249-1)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1', { task: 'Read `a | b`' }));
  assert.equal(rows(root, 'docs/plans/parser/checklist.md')[0], '| T1 | Read `a \\| b` | `a.mts` | `node --test a.test.mts` | [ ] |');
  assert.throws(() => newItem(root, item('parser', 'T2', { task: 'one\ntwo' })), /TASK holds a line break/);
});

test('item-new refuses an ID of another checklist, a sub-item without its parent, an ID off the pattern, an empty text and an unknown plan, and writes nothing (K249-1)', (t) => {
  const root = plans(t, 'parser', 'lexer');
  newItem(root, item('parser', 'T1'));
  const before = () => ['parser', 'lexer'].flatMap(name => ['checklist.md', 'checklist.ko.md'].map(file => readFileSync(path.join(root, `docs/plans/${name}/${file}`), 'utf8')));
  const kept = before();
  assert.throws(() => newItem(root, item('lexer', 'T1')), /the item T1 is also an item of docs\/plans\/(?:parser|lexer)\/checklist.md/);
  assert.throws(() => newItem(root, item('lexer', 'T5-1')), /the sub-item T5-1 has no parent T5 in its checklist/);
  assert.throws(() => newItem(root, item('lexer', 'X1')), /the ID "X1" does not match T\[0-9\]/);
  assert.throws(() => newItem(root, item('lexer', 'T2', { taskKo: ' ' })), /TASK_KO is empty/);
  assert.throws(() => newItem(root, item('nothing', 'T2')), /docs\/plans\/nothing\/checklist.md is no checklist/);
  assert.deepEqual(before(), kept);
});

const CHANGELOG = '# Changelog\n\n## Unreleased\n\n';

/** A committed checkout with the plan parser and its items `ids`, each waiting. */
function committed(t: Parameters<typeof tree>[0], ...ids: string[]) {
  const root = plans(t, 'parser');
  for (const id of ids) newItem(root, item('parser', id));
  for (const [file, text] of Object.entries({ 'CHANGELOG.md': CHANGELOG, 'CHANGELOG.ko.md': CHANGELOG })) writeFileSync(path.join(root, file), text);
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'base']]) {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  }
  return root;
}

const states = (root: string, file: string) => rows(root, file).map(row => row.split(' | ').at(-1));

test('item-state performs an allowed transition in both languages and refuses another (K249-2)', (t) => {
  const root = committed(t, 'T1');
  setState(root, { id: 'T1', state: '[~]' });
  assert.deepEqual([states(root, 'docs/plans/parser/checklist.md'), states(root, 'docs/plans/parser/checklist.ko.md')], [['[~] |'], ['[~] |']]);
  assert.throws(() => setState(root, { id: 'T1', state: '[~]' }), /T1 is \[~\]; from \[~\] an item moves to \[o\], \[!\], \[-\] or \[ \]/);
  assert.throws(() => setState(root, { id: 'T9', state: '[~]' }), /T9 is no item of a checklist/);
  assert.throws(() => setState(root, { id: 'T1', state: '[x]' }), /the state "\[x\]" is none of/);
});

test('item-state sets done only when the working tree adds the item to the changelog of both languages (K249-2)', (t) => {
  const root = committed(t, 'T1');
  setState(root, { id: 'T1', state: '[~]' });
  assert.throws(() => setState(root, { id: 'T1', state: '[o]' }), /CHANGELOG.md adds no line with \(T1\)/);
  writeFileSync(path.join(root, 'CHANGELOG.md'), `${CHANGELOG}- Parse (T1).\n`);
  assert.throws(() => setState(root, { id: 'T1', state: '[o]' }), /CHANGELOG.ko.md adds no line with \(T1\)/);
  writeFileSync(path.join(root, 'CHANGELOG.ko.md'), `${CHANGELOG}- 파싱 (T1).\n`);
  setState(root, { id: 'T1', state: '[o]' });
  assert.deepEqual(states(root, 'docs/plans/parser/checklist.md'), ['[o] |']);
});

test('item-state writes the cause and the retry condition of a bypass and the cause of an impossible item in both languages (K249-2)', (t) => {
  const root = committed(t, 'T1', 'T2');
  setState(root, { id: 'T1', state: '[~]' });
  assert.throws(() => setState(root, { id: 'T1', state: '[!]', cause: 'no runner' }), /RETRY is empty/);
  setState(root, { id: 'T1', state: '[!]', cause: 'no runner', retry: 'T2 done', causeKo: 'runner 없음', retryKo: 'T2 완료' });
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.md')[0], '| T1 | Task T1 | `a.mts` | `node --test a.test.mts` | [!] cause: no runner; retry: T2 done |');
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.ko.md')[0], '| T1 | 작업 T1 | `a.mts` | `node --test a.test.mts` | [!] 원인: runner 없음; 재시도: T2 완료 |');
});

test('item-state refuses while another item has a state other than that of HEAD, as the commit check would (K249-2)', (t) => {
  const root = committed(t, 'T1', 'T2');
  setState(root, { id: 'T1', state: '[~]' });
  assert.throws(() => setState(root, { id: 'T2', state: '[~]' }), /the commit changes the state of 2 items/);
});

test('item-new refuses an open item whose Verification cell runs a suite or names no command (K249-3)', (t) => {
  const root = plans(t, 'parser');
  assert.throws(() => newItem(root, item('parser', 'T1', { verification: '`node scripts/kit/run-tests.mts node -- tests`' })), /runs a whole runtime without a selection/);
  assert.throws(() => newItem(root, item('parser', 'T1', { verification: 'a red test' })), /names no command in backticks/);
});

test('item-test runs the commands of the Verification cell in order and fails on the first that fails (K249-3)', (t) => {
  const root = plans(t, 'parser');
  const writes = (file: string) => `\`node -e "require('fs').writeFileSync('${file}', '1')"\``;
  newItem(root, item('parser', 'T1', { verification: `${writes('one')}, ${writes('two')}` }));
  newItem(root, item('parser', 'T2', { verification: `\`node -e "process.exit(3)"\`, ${writes('three')}` }));
  const quiet = () => {};
  assert.equal(testItem(root, 'T1', quiet).length, 2);
  assert.ok(existsSync(path.join(root, 'one')) && existsSync(path.join(root, 'two')));
  assert.throws(() => testItem(root, 'T2', quiet), /`node -e "process.exit\(3\)"` of T2 ended with exit status 3/);
  assert.ok(!existsSync(path.join(root, 'three')), 'no command runs after the first that failed');
  assert.throws(() => testItem(root, 'T9', quiet), /T9 is no item/);
});

// K309: vitest and node transpile without checking the types, so a type error of a changed TypeScript file is refused before the commit
// and before the verification of the item, with the real tsc of this checkout.
function typed(t: Parameters<typeof tree>[0]) {
  const root = committed(t, 'T1');
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  symlinkSync(path.resolve('node_modules/.bin/tsc'), path.join(root, 'node_modules/.bin/tsc'));
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', target: 'es2022', allowImportingTsExtensions: true }, include: ['*.mts'] }));
  return root;
}

test('a commit and an item test refuse a changed TypeScript file with a type error, and accept it once fixed (K309)', (t) => {
  const root = typed(t);
  writeFileSync(path.join(root, 'a.mts'), "export const n: number = 'text';\n");
  stage(root, 'a.mts', 'tsconfig.json');
  const body = path.join(root, 'body.txt');
  writeFileSync(body, 'Why.\n');
  const commit = { id: 'T1', type: 'feat', scope: 'parser', subject: 'Parse the input', bodyFile: body };
  assert.throws(() => commitItem(root, commit, identity), /tsc --noEmit -p tsconfig\.json failed:[\s\S]*TS2322/);
  newItem(root, item('parser', 'T2', { verification: '`node -e "process.exit(0)"`' }));
  assert.throws(() => testItem(root, 'T2', () => {}), /T2: tsc --noEmit -p tsconfig\.json failed:[\s\S]*TS2322/);
  writeFileSync(path.join(root, 'a.mts'), 'export const n: number = 1;\n');
  stage(root, 'a.mts');
  commitItem(root, commit, identity);
  assert.match(log(root), /^feat\(parser\): Parse the input \(#T1\)/);
});

const log = (root: string) => spawnSync('git', ['log', '-1', '--format=%B'], { cwd: root, encoding: 'utf8' }).stdout;
const stage = (root: string, ...files: string[]) => assert.equal(spawnSync('git', ['add', ...files], { cwd: root }).status, 0);
const identity = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };

test('commit writes the message of an item: the subject, a blank line and the body wrapped, its trailers kept (K249-4)', (t) => {
  const root = committed(t, 'T1');
  writeFileSync(path.join(root, 'a.mts'), 'export {};\n');
  stage(root, 'a.mts');
  const body = path.join(root, 'body.txt');
  writeFileSync(body, `${'word '.repeat(30).trim()}\n\nSecond paragraph.\n\nCo-Authored-By: Some One <some.one@example.com>\nRefs: T1\n`);
  commitItem(root, { id: 'T1', type: 'feat', scope: 'parser', subject: 'Parse the input', bodyFile: body }, identity);
  const message = log(root);
  const lines = message.trimEnd().split('\n');
  assert.equal(lines[0], 'feat(parser): Parse the input (#T1)');
  assert.equal(lines[1], '');
  assert.ok(lines.every(line => line.length <= 72), message);
  assert.match(message, /\n\nSecond paragraph\.\n\nCo-Authored-By: Some One <some\.one@example\.com>\nRefs: T1\n+$/);
});

test('commit refuses what the commit-msg hook refuses and an empty index, and commits nothing (K249-4)', (t) => {
  const root = committed(t, 'T1', 'T2');
  const body = path.join(root, 'body.txt');
  writeFileSync(body, 'Why.\n');
  const head = log(root);
  assert.throws(() => commitItem(root, { id: 'T1', type: 'feat', scope: 'parser', subject: 'Parse', bodyFile: body }, identity), /nothing is staged/);
  writeFileSync(path.join(root, 'a.mts'), 'export {};\n');
  stage(root, 'a.mts');
  assert.throws(() => commitItem(root, { id: 'T1', type: 'wip', scope: 'parser', subject: 'Parse', bodyFile: body }, identity), /expected "type\(scope\): Subject \(#id\)"/);
  assert.throws(() => commitItem(root, { id: 'T1', type: 'feat', scope: 'parser', subject: 'parse.', bodyFile: body }, identity), /does not start with a capital letter/);
  setState(root, { id: 'T1', state: '[~]' });
  writeFileSync(path.join(root, 'docs/plans/parser/checklist.md'), readFileSync(path.join(root, 'docs/plans/parser/checklist.md'), 'utf8').replace(/(\| T2 \|[^\n]*)\| \[ \] \|/, '$1| [~] |'));
  stage(root, '-A');
  assert.throws(() => commitItem(root, { id: 'T1', type: 'feat', scope: 'parser', subject: 'Parse', bodyFile: body }, identity), /changes the state of 2 items/);
  assert.equal(log(root), head);
});

test('plan-split moves rows with their sub-items from a plan to another plan, in both languages (K292)', (t) => {
  const root = plans(t, 'all');
  for (const id of ['T1', 'T1-1', 'T2', 'T3', 'T3-1']) newItem(root, item('all', id));
  splitPlan(root, { from: 'all', to: 'parser', ids: ['T1', 'T1-1'], title: 'Parser', titleKo: '파서' });
  const ids = (file: string) => rows(root, file).map(row => row.split(' | ')[0]);
  assert.deepEqual(ids('docs/plans/all/checklist.md'), ['| T2', '| T3', '| T3-1']);
  assert.deepEqual(ids('docs/plans/parser/checklist.md'), ['| T1', '| T1-1']);
  assert.deepEqual(ids('docs/plans/parser/checklist.ko.md'), ['| T1', '| T1-1']);
  assert.equal(rows(root, 'docs/plans/parser/checklist.ko.md')[0], '| T1 | 작업 T1 | `a.mts` | `node --test a.test.mts` | [ ] |');
  // The target exists now: more rows move into it without titles.
  splitPlan(root, { from: 'all', to: 'parser', ids: ['T2'], title: undefined, titleKo: undefined });
  assert.deepEqual(ids('docs/plans/parser/checklist.md'), ['| T1', '| T1-1', '| T2']);
});

test('plan-split refuses an unknown item, a sub-item apart from its parent and a new plan without titles, and writes nothing (K292)', (t) => {
  const root = plans(t, 'all');
  for (const id of ['T1', 'T1-1', 'T2']) newItem(root, item('all', id));
  const before = readFileSync(path.join(root, 'docs/plans/all/checklist.md'), 'utf8');
  assert.throws(() => splitPlan(root, { from: 'all', to: 'parser', ids: ['T9'], title: 'P', titleKo: 'P' }), /T9 is no item of docs\/plans\/all/);
  assert.throws(() => splitPlan(root, { from: 'all', to: 'parser', ids: ['T1'], title: 'P', titleKo: 'P' }), /T1-1, a sub-item of T1, stays/);
  assert.throws(() => splitPlan(root, { from: 'all', to: 'parser', ids: ['T1-1'], title: 'P', titleKo: 'P' }), /T1-1 moves without its parent T1/);
  assert.throws(() => splitPlan(root, { from: 'all', to: 'parser', ids: ['T2'], title: undefined, titleKo: undefined }), /TITLE is empty/);
  assert.equal(readFileSync(path.join(root, 'docs/plans/all/checklist.md'), 'utf8'), before);
  assert.equal(existsSync(path.join(root, 'docs/plans/parser')), false);
});

test('item-state refuses a bypassed or impossible state whose cause cites a release, a flake, an unrelated failure or the environment (K315)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1'));
  setState(root, { id: 'T1', state: '[~]' });
  for (const cause of ['waits for the next release', 'not reproducible here', 'a flaky test', 'a transient network failure', 'unrelated to this item', 'the environment of the runner']) {
    assert.throws(() => setState(root, { id: 'T1', state: '[!]', cause, retry: 'later', causeKo: '원인', retryKo: '나중' }), /no cause that closes an item/, cause);
  }
  assert.throws(() => setState(root, { id: 'T1', state: '[-]', cause: 'a release', causeKo: '원인' }), /cites "release"/);
});
