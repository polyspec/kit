// Tests of the plan utilities (scripts/kit/plan.mts): each writes the files of a plan or a row of a checklist only when the
// result passes the checks that the hooks and docs-check run on it (K249).
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { wrapBody, commitItem, editItem, newItem, newPlan, setState, splitPlan, stagedNewRowIds, testItem, verifyDone } from '../../scripts/kit/plan.mts';
import { readChecklist, trackersOf } from '../../scripts/kit/checklist.mts';
import { sha256 } from '../../scripts/kit/bootstrap/digest.mts';
import { typeErrors } from '../../scripts/kit/ts-typecheck.mts';
import { COMMIT_RULES, indexItemFindings, rangeFindings } from '../../scripts/kit/check-commits.mts';
import { put, tree } from './tree.mts';
import { KIT_MAKEFILE } from './kit-tools.mts';

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

// K457: make expands a dollar sign of a variable's value, so the texts of item-new and item-edit reach the tool as they are written.
test('item-new and item-edit write each text through make as given, with its dollar signs, parentheses and quotes (K457)', (t) => {
  const root = plans(t, 'parser');
  writeFileSync(path.join(root, 'Makefile'), KIT_MAKEFILE);
  const text = 'run $(RUN_TESTS) and $$HOME, it\'s "quoted"';
  const made = spawnSync('make', ['--no-print-directory', '-C', root, 'item-new', 'PLAN=parser', 'ID=T1', `TASK=${text}`, 'TASK_KO=작업', 'DELIVERABLES=`a.mts`', 'VERIFICATION=`node --test a.test.mts`'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.ok((rows(root, 'docs/plans/parser/checklist.md')[0] ?? '').includes(` | ${text} | `), rows(root, 'docs/plans/parser/checklist.md').join('\n'));
  const edited = `run $(HOME) and $$(date), it's`;
  const changed = spawnSync('make', ['--no-print-directory', '-C', root, 'item-edit', 'ID=T1', `TASK=${edited}`, 'TASK_KO=작업 $(HOME)'], { encoding: 'utf8' });
  assert.equal(changed.status, 0, changed.stdout + changed.stderr);
  assert.ok((rows(root, 'docs/plans/parser/checklist.md')[0] ?? '').includes(` | ${edited} | `), rows(root, 'docs/plans/parser/checklist.md').join('\n'));
  assert.ok((rows(root, 'docs/plans/parser/checklist.ko.md')[0] ?? '').includes(' | 작업 $(HOME) | '), rows(root, 'docs/plans/parser/checklist.ko.md').join('\n'));
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

function commitState(root: string, message: string): void {
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', message]]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}

test('item-state performs an allowed transition in both languages and refuses another (K249-2)', (t) => {
  const root = committed(t, 'T1');
  setState(root, { id: 'T1', state: '[~]' });
  assert.deepEqual([states(root, 'docs/plans/parser/checklist.md'), states(root, 'docs/plans/parser/checklist.ko.md')], [['[~] |'], ['[~] |']]);
  commitState(root, 'start');
  setState(root, { id: 'T1', state: '[v]' });
  commitState(root, 'verification');
  assert.deepEqual(states(root, 'docs/plans/parser/checklist.md'), ['[v] |']);
  assert.throws(() => setState(root, { id: 'T1', state: '[v]' }), /T1 is \[v\]; from \[v\] an item moves to \[~\] or \[o\]/);
  setState(root, { id: 'T1', state: '[~]' });
  assert.throws(() => setState(root, { id: 'T9', state: '[~]' }), /T9 is no item of a checklist/);
  assert.throws(() => setState(root, { id: 'T1', state: '[x]' }), /the state "\[x\]" is none of/);
});

test('item-state sets done only when the working tree adds the item to the changelog of both languages (K249-2)', (t) => {
  const root = committed(t, 'T1');
  setState(root, { id: 'T1', state: '[~]' });
  commitState(root, 'start');
  setState(root, { id: 'T1', state: '[v]' });
  commitState(root, 'verification');
  // The red of the Verification is recorded before the done state.
  assert.throws(() => setState(root, { id: 'T1', state: '[o]' }), /CHANGELOG.md adds no line with \(T1\)/);
  writeFileSync(path.join(root, 'CHANGELOG.md'), `${CHANGELOG}- Parse (T1).\n`);
  assert.throws(() => setState(root, { id: 'T1', state: '[o]' }), /CHANGELOG.ko.md adds no line with \(T1\)/);
  writeFileSync(path.join(root, 'CHANGELOG.ko.md'), `${CHANGELOG}- 파싱 (T1).\n`);
  setState(root, { id: 'T1', state: '[o]' });
  assert.deepEqual(states(root, 'docs/plans/parser/checklist.md'), ['[o] |']);
});

test('item-state may complete a unit-tested item directly from development without entering verification', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1', { verification: '`node -e "process.exit(0)"`' }));
  writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
  writeFileSync(path.join(root, 'CHANGELOG.ko.md'), CHANGELOG);
  setState(root, { id: 'T1', state: '[~]' });
  commitState(root, 'start');
  writeFileSync(path.join(root, 'CHANGELOG.md'), `${CHANGELOG}- Parse (T1).\n`);
  writeFileSync(path.join(root, 'CHANGELOG.ko.md'), `${CHANGELOG}- 파싱 (T1).\n`);
  verifyDone(root, 'T1', () => {});
  setState(root, { id: 'T1', state: '[o]' });
  assert.deepEqual(states(root, 'docs/plans/parser/checklist.md'), ['[o] |']);
});

test('item-state writes the cause and the retry condition of a bypass and the cause of an impossible item in both languages (K249-2)', (t) => {
  const root = committed(t, 'T1', 'T2');
  setState(root, { id: 'T1', state: '[~]' });
  commitState(root, 'start');
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

test('item-new, item-edit and item-state write the marker of the new English text into a current Korean twin, and keep a stale one stale (K368)', (t) => {
  const root = committed(t, 'T1');
  const english = 'docs/plans/parser/checklist.md';
  const twin = 'docs/plans/parser/checklist.ko.md';
  const text = (file: string) => readFileSync(path.join(root, file), 'utf8');
  const marker = () => /<!-- source-sha256: ([^>]*?) -->/.exec(text(twin))?.[1];
  newItem(root, item('parser', 'T2'));
  assert.equal(marker(), sha256(text(english)));
  editItem(root, { id: 'T1', verification: '`node --test b.test.mts`' });
  assert.equal(marker(), sha256(text(english)));
  setState(root, { id: 'T1', state: '[~]' });
  assert.equal(marker(), sha256(text(english)));
  const wrong = '0'.repeat(64);
  writeFileSync(path.join(root, twin), text(twin).replace(/<!-- source-sha256: [^>]*? -->/, `<!-- source-sha256: ${wrong} -->`));
  newItem(root, item('parser', 'T3'));
  assert.equal(marker(), wrong);
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
  // npm is the tool of the checkout (K393-1): its wrapper runs the npm of PATH, whose scripts these tests run on purpose.
  const npm = execFileSync('/bin/sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  mkdirSync(path.join(root, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(root, 'var/tools/bin/npm'), `#!/bin/sh\nexec '${npm}' "$@"\n`);
  chmodSync(path.join(root, 'var/tools/bin/npm'), 0o755);
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', target: 'es2022', allowImportingTsExtensions: true }, include: ['*.mts'] }));
  return root;
}

test('an item test refuses a changed TypeScript file with a type error, and a commit then passes once fixed (K309, K603)', (t) => {
  const root = typed(t);
  writeFileSync(path.join(root, 'a.mts'), "export const n: number = 'text';\n");
  stage(root, 'a.mts', 'tsconfig.json');
  const body = path.join(root, 'body.txt');
  writeFileSync(body, 'Why.\n');
  const commit = { id: 'T1', type: 'feat', scope: 'parser', subject: 'Parse the input', bodyFile: body };
  newItem(root, item('parser', 'T2', { verification: '`node -e "process.exit(0)"`' }));
  assert.throws(() => testItem(root, 'T2', () => {}), /T2: the type check of \. failed:[\s\S]*TS2322/);
  writeFileSync(path.join(root, 'a.mts'), 'export const n: number = 1;\n');
  stage(root, 'a.mts');
  commitItem(root, commit, identity);
  assert.match(log(root), /^feat\(parser\): Parse the input \(#T1\)/);
});

// K335: the done state is no word of the agent: the verification of the row runs on the tree that the commit holds, and a failing one refuses.
test('verifyDone runs the Verification of the row and refuses a failing command and a deliverable that is neither staged nor committed (K335)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1', { deliverables: '`a.mts`', verification: '`node -e "process.exit(0)"`' }));
  newItem(root, item('parser', 'T2', { deliverables: '`a.mts`', verification: '`node -e "process.exit(3)"`' }));
  const quiet = () => {};
  // Both rows are active: the transition is checked first (K353-1).
  for (const file of ['docs/plans/parser/checklist.md', 'docs/plans/parser/checklist.ko.md']) {
    writeFileSync(path.join(root, file), readFileSync(path.join(root, file), 'utf8').replaceAll(' | [ ] |', ' | [v] |'));
  }
  writeFileSync(path.join(root, 'a.mts'), 'export {};\n');
  assert.throws(() => verifyDone(root, 'T1', quiet), /T1: the verification must run on the tree that the commit holds[\s\S]*\?\? a\.mts/, 'an untracked deliverable');
  stage(root, 'a.mts');
  verifyDone(root, 'T1', quiet);
  assert.throws(() => verifyDone(root, 'T2', quiet), /exit status 3/, 'a failing command refuses');
  writeFileSync(path.join(root, 'a.mts'), 'export const changed = 1;\n');
  assert.throws(() => verifyDone(root, 'T1', quiet), /the verification must run on the tree that the commit holds[\s\S]*a\.mts/, 'a change after the staging');
  assert.throws(() => verifyDone(root, 'T9', quiet), /T9 is no item/);
});

// K353-1: the transition is refused before the files, and says where a waiting row goes.
test('verifyDone refuses a waiting row for its transition before it looks at the files (K353-1)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1', { deliverables: '`a.mts`', verification: '`node -e "process.exit(0)"`' }));
  writeFileSync(path.join(root, 'a.mts'), 'export {};\n');
  assert.throws(() => verifyDone(root, 'T1', () => {}), /T1 is \[ \]; from \[ \] an item moves to \[~\] or \[-\]/);
});

// K353-2: item-test runs a command in the root, so it judges the files that the command names from the root.
test('item-test resolves a file of a Verification command from the root, where it runs the command (K353-2)', (t) => {
  const root = plans(t, 'parser');
  put(root, { 'tests/RootTest.php': '<?php\n', 'vendor/bin/phpunit': '#!/bin/sh\nexit 0\n' });
  chmodSync(path.join(root, 'vendor/bin/phpunit'), 0o755);
  newItem(root, item('parser', 'T1', { verification: '`vendor/bin/phpunit tests/RootTest.php`' }));
  assert.ok(!existsSync('tests/RootTest.php'), 'the working directory of this process holds no such file');
  assert.deepEqual(testItem(root, 'T1', () => {}), ['vendor/bin/phpunit tests/RootTest.php']);
});

// K355: the checker of the package is its typecheck script when it has one (svelte-check for a package with .svelte files), tsc otherwise.
test('the type check runs the typecheck script of the package when it has one, and tsc otherwise (K355)', (t) => {
  const root = typed(t);
  put(root, { 'a.mts': "export const n: number = 'text';\n" });
  assert.match(typeErrors(root, ['.'])[0]?.output ?? '', /TS2322/, 'without a script tsc judges the folder');
  put(root, { 'package.json': JSON.stringify({ name: 'pkg', scripts: { typecheck: 'node -e "process.exit(0)"' } }) });
  assert.deepEqual(typeErrors(root, ['.']), [], 'the checker of the package judges it, and it passes');
  put(root, { 'package.json': JSON.stringify({ name: 'pkg', scripts: { typecheck: 'node -e \\"console.error(1);process.exit(2)\\"' } }) });
  assert.equal(typeErrors(root, ['.']).length, 1, 'a failing script refuses');
});

// K353: a Verification cell is edited by a utility, and the type check builds the workspace package it cannot find.
test('item-edit replaces the Verification cell in both languages, through the checks of item-new, and not of a done item (K353)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1'));
  editItem(root, { id: 'T1', verification: '`node -e "process.exit(0)"`' });
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.md'), ['| T1 | Task T1 | `a.mts` | `node -e "process.exit(0)"` | [ ] |']);
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.ko.md'), ['| T1 | 작업 T1 | `a.mts` | `node -e "process.exit(0)"` | [ ] |']);
  assert.throws(() => editItem(root, { id: 'T1', verification: '`node scripts/kit/run-tests.mts node -- tests`' }), /runs a whole runtime without a selection/);
  assert.throws(() => editItem(root, { id: 'T1', verification: 'a red test' }), /names no command in backticks/);
  assert.throws(() => editItem(root, { id: 'T9', verification: '`node -e "1"`' }), /T9 is no item/);
});

// K376: an escaped pipe of a cell is read unescaped, so `A\|B` is the pipeline `go test -run A | B`, which hides the exit status of `go test`.
test('item-new and item-edit refuse a Verification command that is a pipeline, and accept a quoted pipe (K376)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1'));
  assert.throws(() => editItem(root, { id: 'T1', verification: '`go test -run A|B ./...`' }), /pipeline/);
  assert.throws(() => newItem(root, item('parser', 'T2', { verification: '`node --test a.test.mts | tee out.txt`' })), /pipeline/);
  editItem(root, { id: 'T1', verification: "`go test -run 'A|B' ./...`" });
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.md'), ["| T1 | Task T1 | `a.mts` | `go test -run 'A\\|B' ./...` | [ ] |"]);
});

test('the type check builds the workspace package that tsc cannot find, once, and then passes (K353)', (t) => {
  const root = typed(t);
  put(root, {
    'libs/dep/package.json': JSON.stringify({ name: 'dep', version: '0.0.0', types: 'dist/index.d.ts', scripts: { build: 'mkdir -p dist && echo "export declare const x: number;" > dist/index.d.ts' } }),
    'a.mts': "import { x } from 'dep';\nexport const y: number = x;\n",
  });
  symlinkSync(path.join(root, 'libs/dep'), path.join(root, 'node_modules/dep'));
  assert.deepEqual(typeErrors(root, ['.']), []);
  assert.ok(existsSync(path.join(root, 'libs/dep/dist/index.d.ts')), 'the package was built');
  put(root, { 'a.mts': "import { x } from 'dep';\nexport const y: string = x;\n" });
  assert.match(typeErrors(root, ['.'])[0]?.output ?? '', /TS2322/, 'a real type error still fails after the build');
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

test('blocked and dropped refuse an excuse that cites no kit row, and a deleted test needs Replaced-By (K339)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1'));
  newItem(root, item('parser', 'T2'));
  setState(root, { id: 'T1', state: '[~]' });
  setState(root, { id: 'T2', state: '[~]' });
  for (const cause of ['waits for the next release', 'the version tag v1.2.0', 'not reproducible here', 'a flaky test', 'a transient network failure', 'unrelated to this item', 'the environment of the runner']) {
    assert.throws(() => setState(root, { id: 'T1', state: '[!]', cause, retry: 'later', causeKo: '원인', retryKo: '나중' }), /no cause that closes an item/, cause);
    assert.throws(() => setState(root, { id: 'T1', state: '[-]', cause, causeKo: '원인' }), /no cause that closes an item/, cause);
  }
  assert.throws(() => setState(root, { id: 'T1', state: '[-]', cause: 'the version tag v1.2.0', causeKo: '원인' }), /cites "version tag"/);
  setState(root, { id: 'T1', state: '[!]', cause: 'waits for the next release of K392-1', retry: 'K392-1 done', causeKo: '원인', retryKo: '나중' });
  setState(root, { id: 'T2', state: '[-]', cause: 'unrelated to K392-2', causeKo: '원인' });

  const repo = committed(t, 'T1');
  const runGit = (...args: string[]) => {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  put(repo, { 'tests/a.test.mts': 'test;\n', 'tests/b.test.mts': 'test;\n', 'tests/c.test.mts': 'test;\n' });
  runGit('add', '-A');
  runGit('commit', '--quiet', '--no-verify', '-m', 'Add the tests');
  const message = 'refactor(parser): Drop the old test (#T1)\n\nThe test of a is covered elsewhere.\n';
  rmSync(path.join(repo, 'tests/a.test.mts'));
  stage(repo, '-A');
  assert.deepEqual(indexItemFindings(repo, COMMIT_RULES, message).map(found => found.rule), ['commit-deleted-test']);
  assert.deepEqual(indexItemFindings(repo, COMMIT_RULES, `${message}Replaced-By: tests/missing.test.mts\n`).map(found => found.rule), ['commit-deleted-test']);
  assert.deepEqual(indexItemFindings(repo, COMMIT_RULES, `${message}Replaced-By: tests/b.test.mts\n`), []);
  runGit('commit', '--quiet', '--no-verify', '-m', message);
  rmSync(path.join(repo, 'tests/b.test.mts'));
  stage(repo, '-A');
  runGit('commit', '--quiet', '--no-verify', '-m', 'refactor(parser): Drop the other test (#T1)\n\nThe test of b is covered elsewhere.\nReplaced-By: tests/c.test.mts\n');
  assert.deepEqual(rangeFindings(repo, 'HEAD~1..HEAD', COMMIT_RULES), [], 'a deletion that names a tracked test passes');
  assert.match(rangeFindings(repo, 'HEAD~2..HEAD~1', COMMIT_RULES).join('\n'), /: commit-deleted-test: /, 'a range refuses a deletion without Replaced-By');
});

test('K647: Archived-To requires a held row and an ancestor with identical deleted test files', (t) => {
  const deletion = (state: '[!]' | '[-]' | '[~]', archiveContent = 'archived test\n', deletedContent = archiveContent, archiveBeforeFile = false) => {
    const root = committed(t, 'T1', 'T2');
    const runGit = (...args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    let archive: string;
    if (archiveBeforeFile) {
      archive = runGit('rev-parse', 'HEAD');
      put(root, { 'tests/archived.test.mts': deletedContent });
      runGit('add', '-A');
      runGit('commit', '--quiet', '--no-verify', '-m', 'Add the test');
    } else {
      put(root, { 'tests/archived.test.mts': archiveContent });
      runGit('add', '-A');
      runGit('commit', '--quiet', '--no-verify', '-m', 'Archive the test');
      archive = runGit('rev-parse', 'HEAD');
      if (deletedContent !== archiveContent) {
        put(root, { 'tests/archived.test.mts': deletedContent ?? '' });
        runGit('add', '-A');
        runGit('commit', '--quiet', '--no-verify', '-m', 'Change the test');
      }
    }
    setState(root, { id: 'T1', state: '[~]' });
    if (state === '[!]') setState(root, { id: 'T1', state, cause: 'waits for the next release of K392-1', retry: 'K392-1 done', causeKo: '원인', retryKo: '완료 후 재시도' });
    if (state === '[-]') setState(root, { id: 'T1', state, cause: 'unrelated to K392-2', causeKo: '원인' });
    rmSync(path.join(root, 'tests/archived.test.mts'));
    stage(root, '-A');
    return { root, archive };
  };
  const message = (archive: string) => `refactor(archive): Remove the test fixture (#T1)\n\nPreserve the source for the held task.\nArchived-To: ${archive}\n`;

  const held = deletion('[!]');
  assert.deepEqual(indexItemFindings(held.root, COMMIT_RULES, message(held.archive)), [], 'a held item can archive an identical test from an ancestor commit');

  const impossible = deletion('[-]');
  assert.deepEqual(indexItemFindings(impossible.root, COMMIT_RULES, message(impossible.archive)), [], 'an explicitly impossible item can archive the identical test');

  const active = deletion('[~]');
  assert.deepEqual(indexItemFindings(active.root, COMMIT_RULES, message(active.archive)).map(found => found.rule), ['commit-deleted-test'], 'an active item cannot authorize archive deletion');

  const missing = deletion('[!]', 'archived test\n', 'archived test\n', true);
  assert.deepEqual(indexItemFindings(missing.root, COMMIT_RULES, message(missing.archive)).map(found => found.rule), ['commit-deleted-test'], 'an archive without the deleted file is rejected');

  const mismatch = deletion('[!]', 'old test\n', 'new test\n');
  assert.deepEqual(indexItemFindings(mismatch.root, COMMIT_RULES, message(mismatch.archive)).map(found => found.rule), ['commit-deleted-test'], 'different archived contents are rejected');

  const detached = committed(t, 'T1', 'T2');
  const runGit = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: detached, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const branch = runGit('branch', '--show-current');
  runGit('branch', 'archive-side');
  put(detached, { 'tests/archived.test.mts': 'archived test\n' });
  runGit('add', '-A');
  runGit('commit', '--quiet', '--no-verify', '-m', 'Add current test');
  runGit('checkout', 'archive-side');
  put(detached, { 'tests/archived.test.mts': 'archived test\n' });
  runGit('add', '-A');
  runGit('commit', '--quiet', '--no-verify', '-m', 'Add detached archive');
  const detachedArchive = runGit('rev-parse', 'HEAD');
  runGit('checkout', branch);
  setState(detached, { id: 'T1', state: '[~]' });
  setState(detached, { id: 'T1', state: '[!]', cause: 'waits for the next release of K392-1', retry: 'K392-1 done', causeKo: '원인', retryKo: '완료 후 재시도' });
  rmSync(path.join(detached, 'tests/archived.test.mts'));
  stage(detached, '-A');
  assert.deepEqual(indexItemFindings(detached, COMMIT_RULES, message(detachedArchive)).map(found => found.rule), ['commit-deleted-test'], 'an existing archive that is not reachable from the deletion parent is rejected');

  const absent = deletion('[!]', undefined);
  assert.deepEqual(indexItemFindings(absent.root, COMMIT_RULES, message('0'.repeat(40))).map(found => found.rule), ['commit-deleted-test'], 'a nonexistent archive commit is rejected');
});

// K373: no utility writes what docs-check refuses, such as a path into a home directory, and the Task of a row is corrected by item-edit.
test('item-new refuses a private path, and item-edit replaces the Task cells of a row in any state (K373)', (t) => {
  const root = committed(t, 'T1');
  const english = 'docs/plans/parser/checklist.md';
  const korean = 'docs/plans/parser/checklist.ko.md';
  const kept = rows(root, english);
  assert.throws(() => newItem(root, item('parser', 'T2', { task: 'Read /Users/someone/x.txt' })), /the path \/Users\/someone\/ into a home directory/);
  assert.deepEqual(rows(root, english), kept, 'nothing is written');
  assert.throws(() => editItem(root, { id: 'T1', task: 'New task' }), /TASK and TASK_KO together/);
  editItem(root, { id: 'T1', task: 'New task', taskKo: '새 작업' });
  assert.deepEqual([rows(root, english)[0], rows(root, korean)[0]], ['| T1 | New task | `a.mts` | `node --test a.test.mts` | [ ] |', '| T1 | 새 작업 | `a.mts` | `node --test a.test.mts` | [ ] |']);
  assert.throws(() => editItem(root, { id: 'T1', task: 'See /home/someone/y', taskKo: '보기' }), /the path \/home\/someone\/ into a home directory/);
  setState(root, { id: 'T1', state: '[~]' });
  commitState(root, 'start');
  setState(root, { id: 'T1', state: '[v]' });
  commitState(root, 'verification');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Task (T1).\n`);
  setState(root, { id: 'T1', state: '[o]' });
  editItem(root, { id: 'T1', task: 'Done task', taskKo: '끝난 작업' });
  assert.equal(rows(root, english)[0], '| T1 | Done task | `a.mts` | `node --test a.test.mts` | [o] |', 'the Task of a done item is corrected');
  assert.throws(() => editItem(root, { id: 'T1', verification: '`node -e "1"`' }), /T1 is \[o\]/, 'the Verification of a done item stays');
});

test('item-edit replaces the Deliverables cell in both languages, and not of a done item (K388)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1'));
  editItem(root, { id: 'T1', deliverables: '`b.mts`' });
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.md'), ['| T1 | Task T1 | `b.mts` | `node --test a.test.mts` | [ ] |']);
  assert.deepEqual(rows(root, 'docs/plans/parser/checklist.ko.md'), ['| T1 | 작업 T1 | `b.mts` | `node --test a.test.mts` | [ ] |']);
  const done = committed(t, 'T2');
  setState(done, { id: 'T2', state: '[~]' });
  commitState(done, 'start');
  setState(done, { id: 'T2', state: '[v]' });
  commitState(done, 'verification');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(done, file), `${CHANGELOG}- Task (T2).\n`);
  setState(done, { id: 'T2', state: '[o]' });
  assert.throws(() => editItem(done, { id: 'T2', deliverables: '`b.mts`' }), /is \[o\]/);
});

// K442: item-edit rewrites the cause and the retry of a bypassed item, and the cause of an impossible one, through the checks of item-state.
test('item-edit rewrites the cause and the retry of a held item in both languages (K442)', (t) => {
  const root = committed(t, 'T1', 'T2', 'T3');
  const english = 'docs/plans/parser/checklist.md';
  const edit = (env: Record<string, string>) => spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url)), 'item-edit'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  // The checks of item-state refuse a second item that differs from HEAD, so each state change is committed before the next.
  const commitAll = (message: string) => {
    for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', message]]) assert.equal(spawnSync('git', args, { cwd: root, encoding: 'utf8' }).status, 0);
  };
  setState(root, { id: 'T2', state: '[-]', cause: 'the feature was dropped', causeKo: '기능을 버림' });
  commitAll('impossible');
  setState(root, { id: 'T1', state: '[~]' });
  commitAll('active');
  setState(root, { id: 'T1', state: '[!]', cause: 'no runner', retry: 'T2 done', causeKo: 'runner 없음', retryKo: 'T2 완료' });
  commitAll('bypassed');
  const before = rows(root, english);
  const bypassed = edit({ ID: 'T1', CAUSE: 'no CI runner', RETRY: 'T3 done', CAUSE_KO: 'CI 러너 없음', RETRY_KO: 'T3 완료' });
  assert.equal(bypassed.status, 0, bypassed.stderr);
  commitAll('edit bypassed');
  assert.equal(rows(root, english)[0], '| T1 | Task T1 | `a.mts` | `node --test a.test.mts` | [!] cause: no CI runner; retry: T3 done |');
  assert.equal(rows(root, 'docs/plans/parser/checklist.ko.md')[0], '| T1 | 작업 T1 | `a.mts` | `node --test a.test.mts` | [!] 원인: CI 러너 없음; 재시도: T3 완료 |');
  assert.deepEqual(rows(root, english).slice(1), before.slice(1), 'the other rows are unchanged');
  const impossible = edit({ ID: 'T2', CAUSE: 'the feature moved to K9', CAUSE_KO: '기능은 K9로 옮김' });
  assert.equal(impossible.status, 0, impossible.stderr);
  commitAll('edit impossible');
  assert.equal(rows(root, english)[1], '| T2 | Task T2 | `a.mts` | `node --test a.test.mts` | [-] cause: the feature moved to K9 |');
  const after = rows(root, english);
  const waiting = edit({ ID: 'T3', CAUSE: 'x', CAUSE_KO: 'y' });
  assert.notEqual(waiting.status, 0);
  assert.match(waiting.stderr, /T3 is \[ \]/);
  const missing = edit({ ID: 'T1', CAUSE: 'no CI runner', RETRY: 'T3 done', RETRY_KO: 'T3 완료' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /CAUSE_KO is empty/);
  const retry = edit({ ID: 'T2', CAUSE: 'the feature moved to K9', RETRY: 'T3 done', CAUSE_KO: '기능은 K9로 옮김' });
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /no retry condition/);
  assert.deepEqual(rows(root, english), after, 'a refused edit writes nothing');
});

// K499: registering an item never leaves main staged: a new checklist row staged on main is refused by make commit, which names the
// branch route, and the same row committed on a branch is accepted.
test('commit refuses a new checklist row staged on main and names the branch route, and accepts the same row on a branch (K499)', (t) => {
  const root = committed(t, 'T1');
  assert.equal(spawnSync('git', ['checkout', '-q', '-B', 'main'], { cwd: root }).status, 0);
  newItem(root, item('parser', 'T2'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  const body = path.join(root, 'body.txt');
  writeFileSync(body, 'Parse the input in the new item.\n');
  const commit = { id: 'T2', type: 'docs', scope: 'plan', subject: 'Register T2 as an item', bodyFile: body };
  assert.throws(() => commitItem(root, commit, identity), /new row of T2 is staged on main[\s\S]*git worktree add[\s\S]*make commit/);
  assert.throws(() => commitItem(root, commit, identity, { registration: 'T3' }), /new row of T2 is staged on main/, 'a registration of another id is no pass');
  assert.equal(spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root }).status, 1, 'the refused row stays staged, unchanged');
  assert.equal(spawnSync('git', ['checkout', '-q', '-B', 'register-T2'], { cwd: root }).status, 0);
  commitItem(root, commit, identity);
  assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), 'register-T2');
});

// K499-1: the rows of HEAD are read whatever the size of the checklist: orm's checklist is over 1 MB, the default buffer of a child
// process, so its rows looked new and a plain state change on main was refused as a new row.
test('a state change of a checklist over one megabyte stages no new row on main (K499-1)', (t) => {
  const root = committed(t, 'T1');
  assert.equal(spawnSync('git', ['checkout', '-q', '-B', 'main'], { cwd: root }).status, 0);
  const file = path.join(root, 'docs/plans/parser/checklist.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n${'A paragraph that makes the checklist large. '.repeat(30000)}\n`);
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'large']]) {
    assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  }
  assert.ok(statSync(file).size > 1024 * 1024, 'the checklist is over one megabyte');
  setState(root, { id: 'T1', state: '[~]' });
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(stagedNewRowIds(root), [], 'the row of T1 is no new row');
  // The commit of that state change on main goes through: make commit is not refused as staging a new row.
  const body = path.join(root, 'body.txt');
  writeFileSync(body, 'Start T1 on the large checklist.\n');
  assert.doesNotThrow(() => commitItem(root, { id: 'T1', type: 'docs', scope: 'plan', subject: 'Start T1', bodyFile: body }, identity));
});

// K499-2: on main, item-new commits the registration of its row in one docs(plan) commit with the body of BODY_FILE, so a session
// that works on main registers a row without a branch; it refuses without BODY_FILE or with another change staged, and changes
// nothing then.
test('item-new on main commits the registration of its row, and refuses without BODY_FILE or with another staged change (K499-2)', (t) => {
  const root = committed(t, 'T1');
  assert.equal(spawnSync('git', ['checkout', '-q', '-B', 'main'], { cwd: root }).status, 0);
  const T2 = item('parser', 'T2');
  const env = { ...process.env, ...identity, PLAN: 'parser', ID: 'T2', TASK: T2.task, TASK_KO: T2.taskKo, DELIVERABLES: T2.deliverables, VERIFICATION: T2.verification };
  const itemNew = (extra: Record<string, string>) => spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url)), 'item-new'], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const before = head();
  const missing = itemNew({});
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /BODY_FILE/);
  assert.equal(head(), before);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout, '', 'a refused registration changes nothing');
  const body = path.join(root, '..', 'register-T2.txt');
  writeFileSync(body, 'The parser needs its second item.\n');
  writeFileSync(path.join(root, 'other.txt'), 'staged\n');
  stage(root, 'other.txt');
  const staged = itemNew({ BODY_FILE: body });
  assert.notEqual(staged.status, 0);
  assert.match(staged.stderr, /other\.txt/);
  assert.equal(head(), before);
  assert.equal(spawnSync('git', ['reset', '-q', 'HEAD', 'other.txt'], { cwd: root }).status, 0);
  const done = itemNew({ BODY_FILE: body });
  assert.equal(done.status, 0, done.stderr);
  assert.match(log(root), /^docs\(plan\): Register T2 as an item \(#T2\)\n\nThe parser needs its second item\./);
  assert.equal(spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root }).status, 0, 'nothing stays staged');
  assert.ok(rows(root, 'docs/plans/parser/checklist.md').some(row => row.startsWith('| T2 ')));
});

// K524: a commit on main holds the lock of land while it stages and commits, so it and a land queue instead of one finding the change
// of the other; it waits for a land that holds the lock and releases the lock at its end.
test('a commit on main waits for the land that holds the lock and releases the lock (K524)', (t) => {
  const root = committed(t, 'T1');
  assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), 'main');
  writeFileSync(path.join(root, 'a.mts'), 'export {};\n');
  stage(root, 'a.mts');
  const body = path.join(root, 'body.txt');
  writeFileSync(body, 'Why.\n');
  // The land that holds the lock ends after three seconds, as a land does. It is no child of this process, as a land is not: init
  // reaps it at its end, while a child would stay a zombie that answers as running while the commit blocks this process.
  const holder = Number(execFileSync('sh', ['-c', 'sleep 3 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim());
  t.after(() => spawnSync('kill', [String(holder)]));
  const lock = path.join(root, '.git/kit-land.lock');
  writeFileSync(lock, JSON.stringify({ pid: holder, branch: 'feat/other' }));
  const started = Date.now();
  commitItem(root, { id: 'T1', type: 'feat', scope: 'parser', subject: 'Parse the input', bodyFile: body }, identity);
  assert.ok(Date.now() - started >= 2000, `the commit waited ${Date.now() - started} ms for the land`);
  assert.equal(existsSync(lock), false, 'the commit released the lock');
  assert.match(log(root), /^feat\(parser\): Parse the input \(#T1\)/);
});

// K583: a commit on main of another repository that changes a build input of an npm package with a built output rebuilds it when the
// output is stale, since other checkouts link that main live; a commit that changes no build input builds nothing.
test('a commit on main that makes a linked build stale rebuilds it (K583)', (t) => {
  const root = committed(t, 'T1');
  const built = path.join(root, 'packages/p/dist/index.js');
  put(root, {
    'packages/p/package.json': '{"name":"p","version":"0.0.0","main":"dist/index.js"}\n',
    'packages/p/src/index.ts': 'export const a = 0;\n',
    'Makefile': 'build:\n\t@mkdir -p packages/p/dist && cp packages/p/src/index.ts packages/p/dist/index.js\n',
    '.gitignore': '/var/\ndist/\n',
  });
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'package']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  const body = path.join(root, 'var/body.txt');
  mkdirSync(path.dirname(body), { recursive: true });
  writeFileSync(body, 'Why.\n');
  put(root, { 'packages/p/src/index.ts': 'export const a = 1;\n' });
  stage(root, 'packages/p/src/index.ts');
  commitItem(root, { id: 'T1', type: 'feat', scope: 'parser', subject: 'Change the package', bodyFile: body }, identity);
  assert.ok(existsSync(built), 'the commit of a build input rebuilds the stale output');
  assert.equal(readFileSync(built, 'utf8'), 'export const a = 1;\n');
  rmSync(path.join(root, 'packages/p/dist'), { recursive: true });
  put(root, { 'docs/note.md': '# Note\n' });
  stage(root, 'docs/note.md');
  commitItem(root, { id: 'T1', type: 'docs', scope: 'parser', subject: 'Note the package', bodyFile: body }, identity);
  assert.equal(existsSync(built), false, 'a commit of no build input builds nothing');
});

// K646: consumers run the sources of kit (K613) and npm's prepack builds dist at release, so a commit on main of the kit package builds
// nothing, whatever it changes.
test('a commit on main of the kit package builds no dist (K646)', (t) => {
  const root = committed(t, 'T1');
  const built = path.join(root, 'dist/built.txt');
  put(root, {
    'package.json': '{"name":"@polyspec/kit","version":"0.0.0"}\n',
    'Makefile': 'kit-build:\n\t@mkdir -p dist && echo built > dist/built.txt\n',
    '.gitignore': '/dist/\n',
    'scripts/kit/a.mts': 'export {};\n',
  });
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'kit']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  const body = path.join(root, 'var/body.txt');
  mkdirSync(path.dirname(body), { recursive: true });
  writeFileSync(body, 'Why.\n');
  put(root, { 'scripts/kit/a.mts': 'export const a = 1;\n' });
  stage(root, 'scripts/kit/a.mts');
  commitItem(root, { id: 'T1', type: 'feat', scope: 'parser', subject: 'Change the tool', bodyFile: body }, identity);
  assert.equal(existsSync(built), false, 'a commit of a source of kit builds nothing');
});

// K627: a Red or No-Red line that follows a sentence in the same paragraph stays a line of its own, so the commit-red rule finds it.
test('wrapBody keeps a Red or No-Red line as a line of its own wherever it stands (K627)', () => {
  assert.equal(wrapBody('The row deletes a script that nothing calls.\nNo-Red: a deletion has no behaviour a test shows', 72), 'The row deletes a script that nothing calls.\nNo-Red: a deletion has no behaviour a test shows');
  assert.equal(wrapBody('Fixes the parser.\nRed: node --test --test-name-pattern=K1 tests/kit/a-very-long-file-name.test.mts exit 1 at 0123abcd\nMore text after it.', 40), 'Fixes the parser.\nRed: node --test --test-name-pattern=K1 tests/kit/a-very-long-file-name.test.mts exit 1 at 0123abcd\nMore text after it.');
  assert.equal(wrapBody('one two three four five', 9), 'one two\nthree\nfour five', 'prose still wraps');
});
