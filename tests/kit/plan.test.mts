// Tests of the plan utilities (scripts/kit/plan.mts): each writes the files of a plan or a row of a checklist only when the
// result passes the checks that the hooks and docs-check run on it (K249).
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { commitItem, editItem, newItem, newPlan, setState, splitPlan, testItem, verifyDone } from '../../scripts/kit/plan.mts';
import { readChecklist, trackersOf } from '../../scripts/kit/checklist.mts';
import { readRecord } from '../../scripts/kit/gate-red.mts';
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

/**
 * Writes the record that item-red writes for the item `id` whose command `command` fails on HEAD, for a fixture whose command
 * the Claude Code hook refuses to run, such as a whole `node --test` run, so item-red cannot run it.
 */
function redRecord(root: string, id: string, command = 'node --test a.test.mts') {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  mkdirSync(path.join(root, 'var/plan'), { recursive: true });
  writeFileSync(path.join(root, 'var/plan', `${id}.json`), JSON.stringify({ head, gates: [], tests: { tree: sha256(''), commands: [{ command, status: 1 }] } }));
}

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
  // The red of the Verification is recorded before the done state.
  redRecord(root, 'T1');
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

test('a commit and an item test refuse a changed TypeScript file with a type error, and accept it once fixed (K309)', (t) => {
  const root = typed(t);
  writeFileSync(path.join(root, 'a.mts'), "export const n: number = 'text';\n");
  stage(root, 'a.mts', 'tsconfig.json');
  const body = path.join(root, 'body.txt');
  writeFileSync(body, 'Why.\n');
  const commit = { id: 'T1', type: 'feat', scope: 'parser', subject: 'Parse the input', bodyFile: body };
  assert.throws(() => commitItem(root, commit, identity), /the type check of \. failed:[\s\S]*TS2322/);
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
    writeFileSync(path.join(root, file), readFileSync(path.join(root, file), 'utf8').replaceAll(' | [ ] |', ' | [~] |'));
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
  assert.throws(() => verifyDone(root, 'T1', () => {}), /T1 is \[ \]; from \[ \] an item moves to \[~\]/);
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

// The kit.mk of the installed kit in a consumer, which its Makefile includes (K357-1).
const KIT_MK = 'node_modules/@polyspec/kit/dist/kit.mk';

// K357: a fix whose defect is a finding of a gate of kit-gates has the gate as its test; the red of the gate on the parent proves it.
test('a fix commit without a test file is accepted with the red of the gate of its row that item-state recorded on its parent (K357)', (t) => {
  const root = plans(t, 'parser');
  // A consumer includes the kit.mk of the installed kit, which declares kit-gates (K357-1).
  put(root, {
    '.gitignore': 'var/\nnode_modules/\n',
    'Makefile': `include ${KIT_MK}\n`,
    [KIT_MK]: 'kit-gates: lint-x\nlint-x:\n\tgrep -q good a.txt\n',
    'a.txt': 'bad\n',
    'CHANGELOG.md': CHANGELOG,
    'CHANGELOG.ko.md': CHANGELOG,
  });
  newItem(root, item('parser', 'T1', { deliverables: '`a.txt`', verification: '`make lint-x`' }));
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'base']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  const quiet = () => {};
  writeFileSync(path.join(root, 'a.txt'), 'good\n');
  setState(root, { id: 'T1', state: '[~]' }, quiet);
  assert.ok(!existsSync(path.join(root, 'var/plan/T1.json')), 'a tree that differs from HEAD is no parent, so no red is recorded');
  setState(root, { id: 'T1', state: '[ ]' }, quiet);
  writeFileSync(path.join(root, 'a.txt'), 'bad\n');
  setState(root, { id: 'T1', state: '[~]' }, quiet);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'var/plan/T1.json'), 'utf8')), { head, gates: [{ command: 'make lint-x', status: 2 }] });
  writeFileSync(path.join(root, 'a.txt'), 'good\n');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Fix the finding (T1).\n`);
  stage(root, 'a.txt', 'CHANGELOG.md', 'CHANGELOG.ko.md');
  verifyDone(root, 'T1', quiet);
  setState(root, { id: 'T1', state: '[o]' }, quiet);
  stage(root, 'docs/plans');
  const body = path.join(root, 'var/body.txt');
  writeFileSync(body, 'The gate found it.\n');
  const message = commitItem(root, { id: 'T1', type: 'fix', scope: 'lint', subject: 'Fix the finding', bodyFile: body }, identity);
  assert.equal(message, `fix(lint): Fix the finding (#T1)\n\nThe gate found it.\n\nRed-Gate: make lint-x exit 2 at ${head.slice(0, 12)}\n`);
  assert.deepEqual(rangeFindings(root, 'HEAD~1..HEAD', COMMIT_RULES), [], 'commits-check reads the red from the message');
  assert.equal(log(root).trimEnd(), message.trimEnd());
});

test('a fix commit without a test file is refused without a red of its gate, with the red of another parent, and without moving its item to done (K357)', (t) => {
  const root = plans(t, 'parser');
  put(root, { '.gitignore': 'var/\nnode_modules/\n', 'Makefile': `include ${KIT_MK}\n`, [KIT_MK]: 'kit-gates: lint-x\nlint-x:\n\ttrue\n', 'a.txt': 'bad\n', 'CHANGELOG.md': CHANGELOG, 'CHANGELOG.ko.md': CHANGELOG });
  newItem(root, item('parser', 'T1', { deliverables: '`a.txt`', verification: '`make lint-x`' }));
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'base']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const findings = (red: string) => indexItemFindings(root, COMMIT_RULES, `fix(lint): Fix the finding (#T1)\n\nWhy.\n${red}`).map(found => found.rule);
  const red = `\nRed-Gate: make lint-x exit 2 at ${head.slice(0, 12)}\n`;
  setState(root, { id: 'T1', state: '[~]' }, () => {});
  // The gate of the row is red on the parent: the record that item-state wrote for it (K357), which the done state needs.
  mkdirSync(path.join(root, 'var/plan'), { recursive: true });
  writeFileSync(path.join(root, 'var/plan/T1.json'), JSON.stringify({ head, gates: [{ command: 'make lint-x', status: 2 }] }));
  writeFileSync(path.join(root, 'a.txt'), 'good\n');
  stage(root, 'a.txt', 'docs/plans');
  assert.deepEqual(findings(red), ['commit-fix-test'], 'a commit that does not move its item to done');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Fix the finding (T1).\n`);
  setState(root, { id: 'T1', state: '[o]' }, () => {});
  stage(root, 'CHANGELOG.md', 'CHANGELOG.ko.md', 'docs/plans');
  assert.deepEqual(findings(''), ['commit-fix-test'], 'no red');
  assert.deepEqual(findings('\nRed-Gate: make lint-x exit 2 at 0000000000\n'), ['commit-fix-test'], 'the red of another parent');
  assert.deepEqual(findings(red.replace('lint-x', 'lint-y')), ['commit-fix-test'], 'a command that the row does not run');
  assert.deepEqual(findings(red.replace('exit 2', 'exit 0')), ['commit-fix-test'], 'a gate that passed on the parent');
  assert.deepEqual(findings(red), [], 'the red of the gate of the row on the parent');
});

// K357-1: the gates are those of the kit-gates of the Makefile of the repository; a Makefile without kit-gates cannot tell a gate.
test('item-state fails naming kit-gates when a Verification runs make <target> and the Makefile declares no kit-gates (K357-1)', (t) => {
  const root = plans(t, 'parser');
  put(root, { 'Makefile': 'lint-x:\n\ttrue\n' });
  newItem(root, item('parser', 'T1', { verification: '`make lint-x`' }));
  newItem(root, item('parser', 'T2', { verification: '`node --test a.test.mts`' }));
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'base']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  assert.throws(() => setState(root, { id: 'T1', state: '[~]' }, () => {}), /declares no kit-gates/);
  setState(root, { id: 'T2', state: '[~]' }, () => {});
});

// A test in a fix commit is no proof of its red unless item-red ran the Verification before the fix: the red is recorded, and done needs it.
test('make item-red records a failing Verification, and done requires the record (K389)', (t) => {
  const root = plans(t, 'parser');
  newItem(root, item('parser', 'T1', { verification: '`node -e "process.exit(1)"`' }));
  newItem(root, item('parser', 'T2', { verification: '`node -e "process.exit(0)"`' }));
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), CHANGELOG);
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'base']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  const quiet = () => {};
  setState(root, { id: 'T1', state: '[~]' }, quiet);
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'start T1']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  setState(root, { id: 'T2', state: '[~]' }, quiet);
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'start T2']]) assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  const itemRed = (id: string) => spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url)), 'item-red'], { cwd: root, env: { ...process.env, ID: id }, encoding: 'utf8' });
  const passes = itemRed('T2');
  assert.notEqual(passes.status, 0);
  assert.match(passes.stderr, /T2: the Verification passes before the fix, so it proves no red/);
  for (const id of ['T1', 'T2']) {
    for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Fix (${id}).\n`);
    assert.throws(() => setState(root, { id, state: '[o]' }, quiet), new RegExp(`make item-red ID=${id}`), 'done without a record');
  }
  const fails = itemRed('T1');
  assert.equal(fails.status, 0, fails.stderr);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const record = readRecord(root, 'T1');
  assert.equal(record?.head, head);
  assert.deepEqual(record?.tests?.commands, [{ command: 'node -e "process.exit(1)"', status: 1 }]);
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Fix (T1).\n`);
  setState(root, { id: 'T1', state: '[o]' }, quiet);
  assert.equal(rows(root, 'docs/plans/parser/checklist.md')[0]?.endsWith('[o] |'), true, 'done with the record');
  // The fix commit writes the red as a Red-Test line, and check-commits accepts it for the item that it moves to done.
  writeFileSync(path.join(root, 'a.mts'), 'export {};\n');
  stage(root, 'a.mts', 'CHANGELOG.md', 'CHANGELOG.ko.md', 'docs/plans');
  const body = path.join(root, 'var/body.txt');
  writeFileSync(body, 'The test reproduces it.\n');
  const message = commitItem(root, { id: 'T1', type: 'fix', scope: 'parser', subject: 'Fix it', bodyFile: body }, identity);
  assert.equal(message, `fix(parser): Fix it (#T1)\n\nThe test reproduces it.\n\nRed-Test: node -e "process.exit(1)" exit 1 at ${head.slice(0, 12)}\n`);
  assert.deepEqual(rangeFindings(root, 'HEAD~1..HEAD', COMMIT_RULES), [], 'the Red-Test line proves the red of the fix');

  // A close in a later commit reads the red from the fix commit in the history of HEAD, and a fix without a Red line closes nothing.
  const later = plans(t, 'parser');
  newItem(later, item('parser', 'T3', { verification: '`node -e "process.exit(1)"`' }));
  newItem(later, item('parser', 'T4', { verification: '`node -e "process.exit(1)"`' }));
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(later, file), CHANGELOG);
  const runGit = (...args: string[]) => {
    const run = spawnSync('git', args, { cwd: later, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  const commitAll = (message: string) => {
    runGit('add', '-A');
    runGit('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', message);
  };
  commitAll('base');
  setState(later, { id: 'T3', state: '[~]' }, quiet);
  commitAll('start T3');
  const redOfT3 = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url)), 'item-red'], { cwd: later, env: { ...process.env, ID: 'T3' }, encoding: 'utf8' });
  assert.equal(redOfT3.status, 0, redOfT3.stderr);
  put(later, { 'tests/a.test.mts': 'red\n', 'a.mts': 'export {};\n' });
  runGit('add', 'a.mts', 'tests/a.test.mts');
  const body3 = path.join(later, 'var/body.txt');
  writeFileSync(body3, 'The test reproduces it.\n');
  const fix3 = commitItem(later, { id: 'T3', type: 'fix', scope: 'parser', subject: 'Fix it', bodyFile: body3 }, identity);
  assert.match(fix3, /^Red-Test: node -e "process.exit\(1\)" exit 1 at [0-9a-f]{12}$/m, 'the fix commit carries its red');
  // The item is closed in a later commit: its record is no longer on HEAD, so the done state reads the fix commit.
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(later, file), `${CHANGELOG}- Fix (T3).\n`);
  setState(later, { id: 'T3', state: '[o]' }, quiet);
  assert.equal(rows(later, 'docs/plans/parser/checklist.md')[0]?.endsWith('[o] |'), true, 'closed in a later commit');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(later, file), `${CHANGELOG}- Fix (T3).\n`);
  runGit('add', '-A');
  runGit('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', 'docs(plan): Close T3 (#T3)');

  // A fix commit of T4 without a Red line proves nothing, and its item cannot be closed.
  setState(later, { id: 'T4', state: '[~]' }, quiet);
  commitAll('start T4');
  put(later, { 'tests/b.test.mts': 'green\n', 'b.mts': 'export {};\n' });
  runGit('add', 'b.mts', 'tests/b.test.mts');
  const body4 = path.join(later, 'var/body4.txt');
  writeFileSync(body4, 'The test names it.\n');
  const fix4 = commitItem(later, { id: 'T4', type: 'fix', scope: 'parser', subject: 'Fix it', bodyFile: body4 }, identity);
  assert.doesNotMatch(fix4, /^Red-(?:Gate|Test): /m, 'no red was recorded for T4');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(later, file), `${CHANGELOG}- Fix (T4).\n`);
  assert.throws(() => setState(later, { id: 'T4', state: '[o]' }, quiet), /make item-red ID=T4/, 'a fix without a Red line does not close');

  // Each row below has its own repository: its commit history is the one that the case names.
  const PLAN_SCRIPT = fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url));
  const FAILS = 'node -e "process.exit(1)"';
  const PASSES = 'node -e "process.exit(0)"';
  const LACKS_B = 'node -e "process.exit(require(\'fs\').existsSync(\'b.mts\') ? 0 : 1)"';
  const repo = (rows: Record<string, string>) => {
    const root = plans(t, 'parser');
    put(root, { '.gitignore': 'var/\n' });
    for (const [id, verification] of Object.entries(rows)) newItem(root, item('parser', id, { verification: `\`${verification}\`` }));
    for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), CHANGELOG);
    gitCommit(root, 'base');
    return root;
  };
  const gitCommit = (root: string, message: string) => {
    for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', message]]) {
      const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
    }
  };
  const revParse = (root: string, rev: string) => spawnSync('git', ['rev-parse', rev], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const redCli = (root: string, id: string, before?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ID: id };
    delete env.BEFORE;
    if (before !== undefined) env.BEFORE = before;
    return spawnSync(process.execPath, [PLAN_SCRIPT, 'item-red'], { cwd: root, env, encoding: 'utf8' });
  };

  // A feat commit made with make commit carries the red of its row, and its later close reads it.
  const feat = repo({ T8: FAILS });
  setState(feat, { id: 'T8', state: '[~]' }, quiet);
  gitCommit(feat, 'start T8');
  assert.equal(redCli(feat, 'T8').status, 0, 'item-red on the active row');
  put(feat, { 'c.mts': 'export {};\n' });
  stage(feat, 'c.mts');
  const bodyFeat = path.join(feat, 'var/body.txt');
  writeFileSync(bodyFeat, 'The feature is recorded.\n');
  const featMessage = commitItem(feat, { id: 'T8', type: 'feat', scope: 'parser', subject: 'Add the feature', bodyFile: bodyFeat }, identity);
  assert.match(featMessage, /^Red-Test: node -e "process\.exit\(1\)" exit 1 at [0-9a-f]{12}$/m, 'a feat commit carries the red of its row');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(feat, file), `${CHANGELOG}- Add (T8).\n`);
  setState(feat, { id: 'T8', state: '[o]' }, quiet);
  assert.equal(rows(feat, 'docs/plans/parser/checklist.md').find(row => row.startsWith('| T8 |'))?.endsWith('[o] |'), true, 'the later close reads the feat commit');

  // After a rebase the red may name an ancestor of the parent, which proves it; a commit that is no ancestor proves nothing.
  const closed = (redOf: (root: string) => string) => {
    const root = repo({ T9: FAILS });
    setState(root, { id: 'T9', state: '[~]' }, quiet);
    gitCommit(root, 'start T9');
    assert.equal(redCli(root, 'T9').status, 0, 'item-red on the branch');
    const sha = redOf(root);
    for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Fix (T9).\n`);
    setState(root, { id: 'T9', state: '[o]' }, quiet);
    gitCommit(root, `fix(parser): Fix it (#T9)\n\nThe test reproduces it.\n\nRed-Test: ${FAILS} exit 1 at ${sha.slice(0, 12)}`);
    return root;
  };
  const rebased = closed(root => revParse(root, 'HEAD~1'));
  assert.deepEqual(rangeFindings(rebased, 'HEAD~1..HEAD', COMMIT_RULES), [], 'a Red line on an ancestor of the parent proves the red');
  const unrelated = closed(root => {
    const empty = spawnSync('git', ['mktree'], { cwd: root, input: '', encoding: 'utf8' }).stdout.trim();
    return spawnSync('git', ['commit-tree', empty, '-m', 'unrelated'], { cwd: root, encoding: 'utf8', env: { ...process.env, ...identity } }).stdout.trim();
  });
  assert.match(rangeFindings(unrelated, 'HEAD~1..HEAD', COMMIT_RULES).join('\n'), /commit-fix-test/, 'a Red line on an unrelated commit proves nothing');

  // A row committed with its fix and no record: its row moves to [~] uncommitted, BEFORE= records the red, and the state stays.
  const before = repo({ T10: LACKS_B });
  put(before, { 'b.mts': 'export {};\n', 'tests/c.test.mts': 'test\n' });
  gitCommit(before, 'fix(parser): Fix it (#T10)\n\nThe test names it.');
  setState(before, { id: 'T10', state: '[~]' }, quiet);
  // A tracked change outside docs/plans is refused, and the tree is left as it was.
  writeFileSync(path.join(before, '.gitignore'), 'var/\nnode_modules/\n');
  const outsideRefused = redCli(before, 'T10', 'HEAD~1');
  assert.notEqual(outsideRefused.status, 0);
  assert.match(outsideRefused.stderr, /changes to tracked files outside docs\/plans and the changelogs, \.gitignore/);
  writeFileSync(path.join(before, '.gitignore'), 'var/\n');
  assert.equal(redCli(before, 'T10', 'HEAD~1').status, 0, 'the Verification fails before the fix');
  assert.equal(readRecord(before, 'T10')?.head, revParse(before, 'HEAD'), 'the record has HEAD');
  assert.deepEqual(readRecord(before, 'T10')?.tests?.commands, [{ command: LACKS_B, status: 1 }]);
  assert.equal(readFileSync(path.join(before, 'b.mts'), 'utf8'), 'export {};\n', 'the file is restored');
  assert.deepEqual(rows(before, 'docs/plans/parser/checklist.md').map(row => row.endsWith('[~] |')), [true], 'the [~] state stays in the tree');
  assert.deepEqual(rows(before, 'docs/plans/parser/checklist.ko.md').map(row => row.endsWith('[~] |')), [true], 'the [~] state of the twin stays in the tree');
  // The record of the row stays when the row is activated again on the same HEAD (K357).
  setState(before, { id: 'T10', state: '[ ]' }, quiet);
  setState(before, { id: 'T10', state: '[~]' }, quiet);
  assert.ok(readRecord(before, 'T10')?.tests, 'the test record stays');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(before, file), `${CHANGELOG}- Fix (T10).\n`);
  setState(before, { id: 'T10', state: '[o]' }, quiet);

  // A Verification that passes before the fix is refused, and the tree is restored exactly.
  const passing = repo({ T11: PASSES });
  setState(passing, { id: 'T11', state: '[~]' }, quiet);
  gitCommit(passing, 'start T11');
  put(passing, { 'b.mts': 'export {};\n', 'tests/d.test.mts': 'test\n' });
  gitCommit(passing, 'fix(parser): Fix it (#T11)\n\nThe test names it.');
  const snapshot = readFileSync(path.join(passing, 'b.mts'), 'utf8');
  const refused = redCli(passing, 'T11', 'HEAD~1');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /T11: the Verification passes before the fix, so it proves no red/);
  assert.equal(spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: passing, encoding: 'utf8' }).stdout, '', 'git status is clean');
  assert.equal(readFileSync(path.join(passing, 'b.mts'), 'utf8'), snapshot, 'the file content is the same');

  // A Red-Test line holds the whole command, wider than the body, and the width of the body does not apply to it.
  const LONG = `node -e "process.exit(1)" ${'--test-name-pattern=a-long-pattern '.repeat(2).trim()}`;
  const wide = repo({ T12: LONG });
  setState(wide, { id: 'T12', state: '[~]' }, quiet);
  gitCommit(wide, 'start T12');
  assert.equal(redCli(wide, 'T12').status, 0, 'item-red on the active row');
  put(wide, { 'e.mts': 'export {};\n', 'tests/e.test.mts': 'test\n' });
  stage(wide, 'e.mts', 'tests/e.test.mts');
  const bodyWide = path.join(wide, 'var/body.txt');
  writeFileSync(bodyWide, 'The test reproduces it.\n');
  const wideMessage = commitItem(wide, { id: 'T12', type: 'fix', scope: 'parser', subject: 'Fix it', bodyFile: bodyWide }, identity);
  assert.ok((wideMessage.split('\n').find(line => line.startsWith('Red-Test: ')) ?? '').length > COMMIT_RULES.bodyMax, 'the Red-Test line is wider than the body');
  assert.deepEqual(rangeFindings(wide, 'HEAD~1..HEAD', COMMIT_RULES), [], 'the commit check takes the wide Red-Test line');
});

// K389-1: item-red BEFORE= leaves the tree exactly as it was, modes included: an executable file that BEFORE lacks is removed
// while the Verification runs and comes back executable.
test('make item-red BEFORE= restores the mode of each file that it swaps (K389-1)', (t) => {
  const root = plans(t, 'parser');
  put(root, { '.gitignore': 'var/\n' });
  newItem(root, item('parser', 'T1', { verification: '`node -e "process.exit(require(\'fs\').existsSync(\'hook.sh\') ? 0 : 1)"`' }));
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), CHANGELOG);
  const gitCommit = (message: string) => {
    for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', message]]) {
      const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
    }
  };
  gitCommit('base');
  put(root, { 'hook.sh': '#!/bin/sh\n', 'tests/hook.test.mts': 'test\n' });
  chmodSync(path.join(root, 'hook.sh'), 0o755);
  gitCommit('fix(parser): Add the hook (#T1)\n\nThe hook is added.');
  setState(root, { id: 'T1', state: '[~]' }, () => {});
  const env: NodeJS.ProcessEnv = { ...process.env, ID: 'T1', BEFORE: 'HEAD~1' };
  const red = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url)), 'item-red'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(red.status, 0, red.stderr);
  assert.equal(statSync(path.join(root, 'hook.sh')).mode & 0o777, 0o755, 'the executable file comes back executable');
  assert.equal(spawnSync('git', ['diff', '--summary', '--', 'hook.sh'], { cwd: root, encoding: 'utf8' }).stdout, '', 'git sees no mode change');
});

// K389-2: the red of a row is recorded on a commit of its branch, which the rebase before make land rewrites; the Red-Test line
// names the merge-base of HEAD and main, which the rebase keeps as an ancestor, so the row closes after the rebase. BEFORE= takes
// a tree whose changelogs the close has changed.
test('the red of a row survives the rebase of its branch on a newer main (K389-2)', (t) => {
  const root = plans(t, 'parser');
  put(root, { '.gitignore': 'var/\n' });
  newItem(root, item('parser', 'T1', { verification: '`node -e "process.exit(require(\'fs\').existsSync(\'b.mts\') ? 0 : 1)"`' }));
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), CHANGELOG);
  const run = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commitAll = (message: string) => { run('add', '-A'); run('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', message); };
  const cli = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url)), 'item-red'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  commitAll('base');
  run('branch', '-M', 'main');
  const base = run('rev-parse', 'HEAD');
  run('switch', '--quiet', '-c', 'fix/parser-T1');
  put(root, { 'notes.md': 'a commit of the branch\n' });
  commitAll('docs(plan): Register T1 (#T1)');
  setState(root, { id: 'T1', state: '[~]' }, () => {});
  const red = cli({ ID: 'T1' });
  assert.equal(red.status, 0, red.stderr);
  put(root, { 'b.mts': 'export {};\n', 'tests/b.test.mts': 'test\n' });
  stage(root, 'b.mts', 'tests/b.test.mts');
  const body = path.join(root, 'var/body.txt');
  writeFileSync(body, 'The test reproduces it.\n');
  const message = commitItem(root, { id: 'T1', type: 'fix', scope: 'parser', subject: 'Fix it', bodyFile: body }, identity);
  assert.match(message, new RegExp(`^Red-Test: .* exit 1 at ${base.slice(0, 12)}$`, 'm'), 'the line names the merge-base with main');
  run('checkout', '--', 'docs/plans');
  // main moves on, and the branch is rebased on it, as make land needs.
  run('switch', '--quiet', 'main');
  put(root, { 'other.md': 'another row\n' });
  commitAll('docs(plan): Another row (#T1)');
  run('switch', '--quiet', 'fix/parser-T1');
  run('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'rebase', '--quiet', 'main');
  setState(root, { id: 'T1', state: '[~]' }, () => {});
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Fix (T1).\n`);
  // BEFORE= runs on a tree whose changelogs the close has changed, and leaves them as the close wrote them.
  const before = cli({ ID: 'T1', BEFORE: 'main' });
  assert.equal(before.status, 0, before.stderr);
  assert.equal(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), `${CHANGELOG}- Fix (T1).\n`, 'the changelog stays as the close wrote it');
  rmSync(path.join(root, 'var/plan/T1.json'));
  setState(root, { id: 'T1', state: '[o]' }, () => {});
  assert.equal(rows(root, 'docs/plans/parser/checklist.md')[0]?.endsWith('[o] |'), true, 'the row closes after the rebase, from the line of its fix commit');
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
  setState(root, { id: 'T1', state: '[~]' }, () => {});
  redRecord(root, 'T1');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), `${CHANGELOG}- Task (T1).\n`);
  setState(root, { id: 'T1', state: '[o]' }, () => {});
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
  setState(done, { id: 'T2', state: '[~]' }, () => {});
  redRecord(done, 'T2');
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(done, file), `${CHANGELOG}- Task (T2).\n`);
  setState(done, { id: 'T2', state: '[o]' }, () => {});
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
  setState(root, { id: 'T1', state: '[~]' }, () => {});
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

// K389-3: item-red BEFORE= refuses a red that only a missing new module makes, since the test imports a file that the change adds and
// BEFORE lacks. A genuine assertion failure of the old behaviour is still accepted.
test('make item-red BEFORE= refuses a red that only a missing new module makes (K389-3)', (t) => {
  const root = plans(t, 'parser');
  put(root, { '.gitignore': 'var/\n', 'value.mjs': 'export const value = 1;\n' });
  newItem(root, item('parser', 'T1', { verification: '`node --input-type=module -e "await import(\'./mod.mjs\')"`' }));
  newItem(root, item('parser', 'T2', { verification: '`node --input-type=module -e "import(\'./value.mjs\').then(m => process.exit(m.value === 2 ? 0 : 1))"`' }));
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(path.join(root, file), CHANGELOG);
  const run = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commitAll = (message: string) => { run('add', '-A'); run('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '--no-verify', '-m', message); };
  const cli = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/plan.mts', import.meta.url)), 'item-red'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  commitAll('base');
  const before = run('rev-parse', 'HEAD');
  put(root, { 'mod.mjs': 'export const added = true;\n', 'tests/mod.test.mts': 'test\n', 'value.mjs': 'export const value = 2;\n' });
  commitAll('fix(parser): Add the module (#T1)\n\nThe module is added.');
  setState(root, { id: 'T1', state: '[~]' }, () => {});
  commitAll('activate T1');
  setState(root, { id: 'T2', state: '[~]' }, () => {});
  commitAll('activate T2');
  // The missing module of T1 is the file the fix adds, so the red is refused and names it.
  const missing = cli({ ID: 'T1', BEFORE: before });
  assert.notEqual(missing.status, 0, 'a red that only a missing new module makes is refused');
  assert.match(missing.stderr, /imports mod\.mjs, a file that the change adds/, missing.stderr);
  assert.match(missing.stderr, /test through an entry that exists on both sides/, missing.stderr);
  // T2 fails on the value of the old behaviour, which is a genuine red, so it is accepted.
  const genuine = cli({ ID: 'T2', BEFORE: before });
  assert.equal(genuine.status, 0, genuine.stderr);
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
  assert.equal(spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root }).status, 1, 'the refused row stays staged, unchanged');
  assert.equal(spawnSync('git', ['checkout', '-q', '-B', 'register-T2'], { cwd: root }).status, 0);
  commitItem(root, commit, identity);
  assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), 'register-T2');
});
