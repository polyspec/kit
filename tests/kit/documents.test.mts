// Tests of scripts/kit/check-documents.mts: each rule has a passing and a failing case, and a finding names the file, the
// line and the rule.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check } from '../../scripts/kit/check-documents.mts';
import { checkConfig } from '../../scripts/kit/kit-check.mts';
import { readStatusTable } from '../../scripts/kit/status-table.mts';
import { changelogFindings, sections } from '../../scripts/kit/changelog.mts';
import { pair, put, tree } from './tree.mts';
import { tool } from './kit-tools.mts';

const CONFIG = { schema: 1, include: ['**/*.md'] };
const run = (root: string, config: Parameters<typeof check>[1] = CONFIG): string[] => check(root, config).findings;
const has = (findings: string[], text: string) => assert.ok(findings.some(line => line === text), `expected ${text}\nin\n${findings.join('\n')}`);
const hasPart = (findings: string[], ...parts: string[]) => assert.ok(findings.some(line => parts.every(part => line.includes(part))), `expected ${parts.join(' ... ')}\nin\n${findings.join('\n')}`);

test('a document with anchors, fences and links passes', (t) => {
  const body = '<a id="intro"></a>\nSee [other](other.md#title) and [site](https://example.org).\n\n```sh\nmake check\n```\n';
  const root = tree(t, { ...pair('a.md', 'alpha', body), ...pair('other.md', 'other') });
  assert.deepEqual(run(root), []);
});

test('exclude and include select the documents', (t) => {
  const root = tree(t, { 'docs/a.md': '[x](missing.md)\n', 'fixtures/b.md': '[x](missing.md)\n' });
  assert.deepEqual(run(root, { schema: 1, include: ['docs/**'], exclude: ['docs/a.md'] }), []);
  assert.equal(run(root, { schema: 1, include: ['docs/**'] }).length, 1);
});

test('sections: an explicit anchor appears once in its file; a twin may have other anchors (K809)', (t) => {
  const root = tree(t, pair('a.md', 'alpha', '<a id="one"></a>\n<a id="two"></a>\n', '<a id="one"></a>\n'));
  assert.deepEqual(run(root), []);
  put(root, pair('a.md', 'alpha', '<a id="one"></a>\n<a id="one"></a>\n'));
  hasPart(run(root), 'a.md: sections: the section anchor one appears more than once');
});

test('fences: every block closes; a twin may hold other blocks (K809)', (t) => {
  const en = '```sh\nmake check\n```\n\n~~~\nplain\n~~~\n';
  assert.deepEqual(run(tree(t, pair('a.md', 'alpha', en))), []);
  const body = (text: string) => tree(t, pair('a.md', 'alpha', en, text));
  assert.deepEqual(run(body('```sh\nmake test\n```\n')), []);
  hasPart(run(body('```sh\nmake check\n')), 'a.ko.md:', 'fences: the fenced code block opened here never closes');
});

test('link: a relative link must resolve, inside the repository', (t) => {
  const root = tree(t, { ...pair('docs/a.md', 'alpha', 'See [x](missing.md), [y](../../outside.md), [z](a.md?x=1), [ok](../b.md).\n'), ...pair('b.md', 'bee') });
  const found = run(root);
  has(found, 'docs/a.md:4:5: link: the link missing.md names docs/missing.md, which does not exist');
  hasPart(found, 'docs/a.md:4:', 'link: the link ../../outside.md leaves the repository');
  hasPart(found, 'link: the link a.md?x=1 has a query');
  assert.equal(found.filter(line => line.startsWith('docs/a.md') && line.includes('b.md')).length, 0, found.join('\n'));
});

test('link: an anchor must be an explicit anchor or a heading', (t) => {
  const root = tree(t, { ...pair('a.md', 'alpha', '[a](b.md#target) [h](b.md#the-heading) [bad](b.md#nope) [file](b.md.txt#x)\n'), ...pair('b.md', 'bee', '<a id="target"></a>\n## The heading\n') });
  const found = run(root);
  hasPart(found, 'link: the link b.md#nope names the anchor #nope, which b.md does not define');
  assert.equal(found.filter(line => line.includes('#target') || line.includes('#the-heading')).length, 0, found.join('\n'));
});

test('link: code is not read, a reference needs its definition, an absolute link depends on siteLinks', (t) => {
  const body = '`[x](missing.md)`\n\n```\n[y](missing.md)\n```\n\n[ref][one] and [other][two]\n\n[one]: b.md\n\n[abs](/guide/start)\n';
  const files = { ...pair('a.md', 'alpha', body), ...pair('b.md', 'bee') };
  const root = tree(t, files);
  const found = run(root);
  assert.equal(found.filter(line => line.includes('missing.md')).length, 0, found.join('\n'));
  hasPart(found, 'a.md:', 'link: the reference link [other][two] has no definition [two]');
  hasPart(found, 'link: the link /guide/start starts with /');
  assert.equal(run(root, { ...CONFIG, siteLinks: true }).filter(line => line.includes('/guide/start')).length, 0);
  const { 'a.md': en, 'a.ko.md': ko } = files;
  assert.ok(en !== undefined && ko !== undefined);
  put(root, { 'a.md': en.replace('[abs](/guide/start)', '[site](b)'), 'a.ko.md': ko.replace('[abs](/guide/start)', '[site](b)') });
  hasPart(run(root), 'link: the link b names b, which does not exist');
  assert.equal(run(root, { ...CONFIG, siteLinks: true }).filter(line => line.includes('names b,')).length, 0);
});

test('private-path: a home directory path fails', (t) => {
  const root = tree(t, pair('a.md', 'alpha', 'Run /Users/someone/work/run.sh now.\n'));
  hasPart(run(root), 'a.md:4:5: private-path: the document holds the path /Users/someone/ into a home directory');
  assert.deepEqual(run(tree(t, pair('a.md', 'alpha', 'Run scripts/run.sh now.\n'))), []);
});

test('interpolation: {{ outside a code block fails in the selected documents', (t) => {
  const files = pair('docs/a.md', 'alpha', 'Write `{{ x }}` or <code v-pre>{{ y }}</code>.\n\n```\n{{ z }}\n```\n', 'Write `{{ x }}` or <code v-pre>{{ y }}</code>.\n\n```\n{{ z }}\n```\n');
  const root = tree(t, files);
  assert.equal(run(root).length, 0, 'unselected documents are not read');
  const found = run(root, { ...CONFIG, interpolation: ['docs/**'] });
  hasPart(found, 'docs/a.md:4:8: interpolation: {{ outside a fenced code block');
  assert.equal(found.filter(line => line.startsWith('docs/a.md')).length, 1, 'the v-pre element and the fenced block are not read');
});

// The checklist of the plan p, which kit finds by its folder (K241), and config/checklist.json with its ID pattern.
const PLAN = 'docs/plans/p';
const CHECKLIST = `${PLAN}/checklist.md`;
const ID_PATTERN = 'T[0-9]+(?:\\.[0-9]+)*(?:-[0-9]+)*';
// Each row is written with its ID, task and state; the helper gives it the deliverables and the verification of kit's header.
const widen = (row: string) => row.replace(/^(\|[^|]*\|[^|]*\|)/, '$1 `a.mts` | `node --test a.test.mts` |');
const checklist = (rows: string, extra = '') => `# Plan\n\n${extra}| ID | Task | Deliverables | Verification | State |\n| --- | --- | --- | --- | --- |\n${rows.split('\n').map(widen).join('\n')}\n`;
const withChecklist = (t: TestContext, en: string, ko = en) => tree(t, {
  ...pair(CHECKLIST, 'checklist', en.replace(/^# Plan\n/, '').trimStart(), ko.replace(/^# Plan\n/, '').trimStart()),
  ...pair(`${PLAN}/plan.md`, 'plan', 'The plan.\n'),
});
const run2 = (root: string) => {
  put(root, { 'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: ID_PATTERN }) });
  return run(root);
};

test('checklist table: the five states pass, derived sub-items included', (t) => {
  const rows = '| T1 | a | [o] |\n| T1.2 | b | [ ] |\n| T1.2-1 | c | [~] |\n| T1.3 `parallel` | d | [!] cause: blocked by T1.2; retry: T1.2 done |\n| T1.4 | e | [-] cause: no form fits |';
  assert.deepEqual(run2(withChecklist(t, checklist(rows))), []);
});

test('checklist table: an invalid state, a duplicate task and a missing state cell fail', (t) => {
  const root = withChecklist(t, checklist('| T1.1 | a | done |\n| T1.2 | b | [!] cause: x |\n| T1.3 | c | [o] |\n| T1.3 | d | [o] |\n| T1.4 | no end | [o]'));
  const found = run2(root);
  hasPart(found, `${CHECKLIST}:`, ': checklist-state: the state of T1.1 is "done"');
  hasPart(found, 'checklist-state: the state of T1.2 is "[!] cause: x"');
  hasPart(found, 'checklist-duplicate: the task T1.3 has a second row');
  hasPart(found, 'checklist-state: the row of T1.4 does not end with a state cell');
});

test('checklist table: a marker outside the state and a line that is not a task fail with line and column', (t) => {
  const stray = checklist('| T1.1 | print [~] | [o] |\n| T1.2 | b | [x] |', 'Legend: [ ] waiting.\n\n');
  const found = run2(withChecklist(t, stray));
  hasPart(found, `${CHECKLIST}:`, ':1: checklist-line: the line is not a heading or a task table row');
  for (const marker of ['[ ]', '[~]']) hasPart(found, 'checklist-marker: the state marker ' + marker + ' is not the state of a task');
  hasPart(found, 'checklist-state: the state of T1.2 is "[x]"');
  const cell = found.find(line => line.startsWith(`${CHECKLIST}:`) && line.includes('marker [~]'));
  assert.ok(cell, `no finding of the checklist names the marker [~]:\n${found.join('\n')}`);
  assert.match(cell, /^docs\/plans\/p\/checklist\.md:8:16: checklist-marker/, cell);
});

test('checklist table: a row whose first cell is not a task ID is not allowed', (t) => {
  const found = run2(withChecklist(t, checklist('| T1.1 | a | [o] |\n| Notes | b | [o] |')));
  hasPart(found, 'checklist-line: the first cell "Notes" is not a task ID matching');
});

test('checklist table: a document without task rows fails', (t) => {
  hasPart(run2(withChecklist(t, checklist(''))), 'checklist-empty: the checklist has no task whose ID matches');
});

test('checklist: a task ID may be followed by a code span', (t) => {
  const rows = '| T1.1 `parallel` | a | [o] |\n| T1.2 | b | [~] |';
  assert.deepEqual(run2(withChecklist(t, checklist(rows))).filter(line => line.includes('checklist-')), []);
});

test('checklist-cross and checklist-place: an ID of two checklists, an orphan sub-item and items outside a plan fail (K241)', (t) => {
  const root = withChecklist(t, checklist('| T1 | a | [o] |\n| T2-1 | b | [o] |'));
  put(root, { ...pair('docs/plans/q/checklist.md', 'checklist-q', checklist('| T1 | again | [o] |').replace(/^# Plan\n/, '').trimStart()), ...pair('docs/plans/q/plan.md', 'plan-q', 'The plan.\n'), ...pair('docs/notes.md', 'notes', '| T9 | x | [ ] |\n') });
  const found = run2(root);
  hasPart(found, `${CHECKLIST}:`, 'checklist-cross: the sub-item T2-1 has no parent T2 in its checklist');
  hasPart(found, 'docs/plans/q/checklist.md:', 'checklist-cross: the item T1 is also an item of docs/plans/p/checklist.md');
  hasPart(found, 'docs/notes.md: checklist-place: the document holds checklist items but is no checklist of a plan folder');
});

test('checklist: an invalid config/checklist.json is a finding of the document check', (t) => {
  const root = tree(t, pair('plan.md', 'plan'));
  put(root, { 'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: 5 }) });
  hasPart(run(root), 'config/checklist.json: config: ', '/idPattern must be string');
});

test('a checklist row that names an unregistered kit item is a finding with its file and line (K374)', (t) => {
  // The checklist of kit holds K365 and K369; the consumer names K365 (registered), BK12 (no id) and K99999 and K12345 (unregistered).
  const kit = tree(t, {
    'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: 'K[0-9]+(?:[.-][0-9]+)*' }),
    'docs/plans/kit/checklist.md': '# Kit\n\n| ID | Task | Deliverables | Verification | State |\n| --- | --- | --- | --- | --- |\n| K365 | a | `a.mts` | `node --test a.test.mts` | [o] |\n| K369 | b | `b.mts` | `node --test b.test.mts` | [o] |\n',
  });
  const rows = [
    '| ID | Task | Deliverables | Verification | State |',
    '| --- | --- | --- | --- | --- |',
    '| T1 | a | `a.mts` | `node --test a.test.mts` for K99999 | [ ] |',
    '| T2 | waits on K365 | `b.mts` | `node --test b.test.mts` | [ ] |',
    '| T3 | BK12 is no id | `c.mts` | `node --test c.test.mts` | [ ] |',
    '| T4 | d | `d.mts` | `node --test d.test.mts` | [!] cause: waits on K12345; retry: K365 done |',
  ].join('\n');
  const consumer = pair(CHECKLIST, 'checklist', `${rows}\n`);
  const en = consumer[CHECKLIST];
  assert.ok(en !== undefined);
  const root = tree(t, { ...consumer, ...pair(`${PLAN}/plan.md`, 'plan', 'The plan.\n'), 'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: ID_PATTERN }) });
  const found = check(root, CONFIG, kit).findings;
  const lineOf = (needle: string) => en.split('\n').findIndex(entry => entry.includes(needle)) + 1;
  hasPart(found, `${CHECKLIST}:${lineOf('| T1 |')}:`, 'checklist-kit', 'K99999');
  hasPart(found, `${CHECKLIST}:${lineOf('| T4 |')}:`, 'checklist-kit', 'K12345');
  assert.deepEqual(found.filter(line => line.includes('checklist-kit') && !/K99999|K12345/.test(line)), [], found.join('\n'));
});

// K374-1: a row names the item of a sibling repository with its name, and a repository whose own ids are K-ids names kit with kit.
test('a K-id after the name of a sibling repository, or the own K-id of a repository, is no kit item (K374-1)', (t) => {
  const kit = tree(t, {
    'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: 'K[0-9]+(?:[.-][0-9]+)*' }),
    'docs/plans/kit/checklist.md': '# Kit\n\n| ID | Task | Deliverables | Verification | State |\n| --- | --- | --- | --- | --- |\n| K365 | a | `a.mts` | `node --test a.test.mts` | [o] |\n',
  });
  const header = ['| ID | Task | Deliverables | Verification | State |', '| --- | --- | --- | --- | --- |'];
  const consumer = (rows: string[], idPattern: string, siblingPresent = true, definitions = '') => {
    const files = pair(CHECKLIST, 'checklist', `${[...header, ...rows].join('\n')}\n${definitions}`);
    const parent = tree(t, siblingPresent ? { 'demo-benchmark/.git/HEAD': 'ref: refs/heads/main\n' } : {});
    const root = path.join(parent, 'repo');
    put(root, { ...files, ...pair(`${PLAN}/plan.md`, 'plan', 'The plan.\n'), 'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern }) });
    return check(root, CONFIG, kit).findings.filter(line => line.includes('checklist-kit') && line.startsWith(`${CHECKLIST}:`));
  };
  // A repository of T-ids: the item of the sibling demo-benchmark is its own; a bare unregistered K-id is a kit item.
  const sibling = consumer(['| T1 | as demo-benchmark K79-3 does | `a.mts` | `node --test a.test.mts` | [ ] |', '| T2 | waits on K99999 | `b.mts` | `node --test b.test.mts` | [ ] |', '| T3 | [demo-benchmark K79-3](https://github.com/polyspec/demo-benchmark) and [demo-library K80](https://github.com/polyspec/demo-library) | `c.mts` | `node --test c.test.mts` | [ ] |', '| T4 | waits on kit K77777 | `d.mts` | `node --test d.test.mts` | [ ] |'], ID_PATTERN);
  assert.equal(sibling.length, 2, sibling.join('\n'));
  assert.ok(sibling.some(line => line.includes('K77777')), 'an explicitly qualified kit item is still checked');
  assert.match(sibling[0] ?? '', /K99999/);
  const linked = consumer(['| T1 | [demo-benchmark K79-3](https://github.com/polyspec/demo-benchmark) | `a.mts` | `node --test a.test.mts` | [ ] |', '| T2 | [K99999](https://github.com/polyspec/kit) | `b.mts` | `node --test b.test.mts` | [ ] |', '| T3 | [demo-benchmark K80][benchmark] | `c.mts` | `node --test c.test.mts` | [ ] |'], ID_PATTERN, false, '\n[benchmark]: https://github.com/polyspec/demo-benchmark\n');
  assert.equal(linked.length, 1, linked.join('\n'));
  assert.match(linked[0] ?? '', /K99999/, 'a link to the kit repository is still checked');
  // A repository of K-ids: its own K-id is no kit item, and kit K99999 is one.
  const own = consumer(['| K1 | follows K2 and kit K365 | `a.mts` | `node --test a.test.mts` | [ ] |', '| K2 | waits on kit K99999 | `b.mts` | `node --test b.test.mts` | [ ] |'], 'K[0-9]+(?:[.-][0-9]+)*');
  assert.equal(own.length, 1, own.join('\n'));
  assert.match(own[0] ?? '', /kit item K99999/);
});

const FEATURES = { path: 'features.md', idPattern: '[a-z][a-z0-9-]*', cells: 4, columns: [{ index: 1, enum: ['planned', 'implemented'] }, { index: 3, pattern: '\\]\\([^)]+\\)' }] };
const table = (rows: string) => `| ID | Status | Note | Evidence |\n| --- | --- | --- | --- |\n${rows}\n`;
const withTable = (t: TestContext, en: string, ko = en) => tree(t, pair('features.md', 'features', en, ko));

test('status-table: declared cells and values pass', (t) => {
  const rows = '| parse | implemented | Parse | [g](g.md) |\n| print | planned | Print | [g](g.md) |';
  const root = tree(t, { ...pair('features.md', 'features', table(rows), table(rows.replaceAll('Parse', '파싱'))), ...pair('g.md', 'guide') });
  assert.deepEqual(run(root, { ...CONFIG, statusTables: [FEATURES] }), []);
});

test('status-table: the rows are the rows of the GFM tables: an indented row counts, a row in a fenced example does not (K130)', () => {
  const text = `${table('  | parse | planned | x | [e](e.md) |')}\n\`\`\`md\n| print | planned | x | [e](e.md) |\n\`\`\`\n`;
  const { findings, rows } = readStatusTable(text, FEATURES);
  assert.deepEqual(findings, []);
  assert.deepEqual(rows, [{ id: 'parse', values: ['planned'], line: 3 }]);
});

test('status-table: a line that is only | has no first cell, so it is skipped as a line whose first cell is no ID (K103)', () => {
  // The ID pattern of FEATURES matches the text "undefined", which a line without cells was tested as.
  const { findings, rows } = readStatusTable(table('| parse | planned | x | [e](e.md) |\n|'), FEATURES);
  assert.deepEqual(findings, []);
  assert.deepEqual(rows.map(row => row.id), ['parse']);
});

test('status-table: a bad value, a missing evidence link, a wrong cell count, and a repeated ID fail', (t) => {
  const en = table('| parse | done | Parse | [g](g.md) |\n| print | planned | Print | none |\n| odd | planned | [g](g.md) |\n| parse | planned | Parse | [g](g.md) |');
  const root = tree(t, { ...pair('features.md', 'features', en), ...pair('g.md', 'guide') });
  const found = run(root, { ...CONFIG, statusTables: [FEATURES] });
  hasPart(found, 'features.md:', ': status-table: the row parse has "done" in cell 2; expected planned, implemented');
  hasPart(found, 'status-table: the row print has "none" in cell 4; expected a match of');
  hasPart(found, 'status-table: the row odd has 3 cells; expected 4');
  hasPart(found, 'status-table: the row parse repeats the ID of line');
  hasPart(run(withTable(t, 'no table here\n'), { ...CONFIG, statusTables: [FEATURES] }), 'status-table: the table has no row');
});

test('changelog: Unreleased first, versions newest first', (t) => {
  const log = '# Changes\n\n## Unreleased\n\n## 1.2.0\n\n- x\n\n## 1.1.0\n';
  const config = { ...CONFIG, changelogs: ['CHANGELOG.md'] };
  assert.deepEqual(run(tree(t, pair('CHANGELOG.md', 'changelog', log.replace('# Changes\n\n', ''))), config), []);
  const bad = '## 1.1.0\n\n## 1.2.0\n\n## Unreleased\n\n## Unreleased\n\n## next\n';
  const found = run(tree(t, pair('CHANGELOG.md', 'changelog', bad)), config);
  hasPart(found, 'changelog: the first section is ## 1.1.0');
  hasPart(found, 'changelog: the section ## 1.2.0 follows ## 1.1.0');
  hasPart(found, 'changelog: ## Unreleased appears 2 times');
  hasPart(found, 'changelog: the section ## next is neither ## Unreleased nor a released version');
});

test('changelog: the sections are the level-2 headings of the Markdown tree, not ## lines of comments or closing hashes (K130)', () => {
  // A heading in an HTML comment is no heading, a closing sequence of # is no part of the title, and a setext heading of level 2 is one.
  const text = '## Unreleased\n\n<!--\n## 9.9.9\n-->\n\n## 1.2.0 ##\n\n- x\n\n1.1.0\n-----\n';
  assert.deepEqual(sections(text), [{ title: 'Unreleased', line: 1 }, { title: '1.2.0', line: 7 }, { title: '1.1.0', line: 11 }]);
  assert.deepEqual(changelogFindings(text), []);
});

test('the command reads config/documents.json and exits with the findings', (t) => {
  const root = tree(t, { ...pair('a.md', 'alpha'), 'b.md': '[x](missing.md)\n', 'config/documents.json': JSON.stringify(CONFIG) });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const failed = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-documents.mts'))], { cwd: root, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /\[check-documents\] b\.md:1:1: link: /);
  put(root, { 'b.md': null });
  const passed = spawnSync(process.execPath, [tool(import.meta.resolve('../../scripts/kit/check-documents.mts'))], { cwd: root, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /1 document pairs/);
});

test('config/documents.json is validated against its schema', (t) => {
  const root = tree(t, { 'config/documents.json': JSON.stringify({ schema: 1, include: ['docs/**'], checklists: [{ path: 'a.md', style: 'grid', idPattern: 'T' }], statusTables: [{ path: 'f.md', idPattern: 'x', cells: 0, columns: [] }], extra: true }) });
  mkdirSync(path.join(root, 'scripts/kit'), { recursive: true });
  cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/kit/schema'), path.join(root, 'scripts/kit/schema'), { recursive: true });
  const found = checkConfig(root);
  hasPart(found, 'config/documents.json: / must NOT have additional properties {"additionalProperty":"checklists"}');
  hasPart(found, '/statusTables/0/cells must be >= 1 {"comparison":">=","limit":1}, value 0');
  hasPart(found, '/ must NOT have additional properties {"additionalProperty":"extra"}');
});

test('link: a site reads the VitePress slug and the {#id} of a heading, a repository only the GitHub slug', (t) => {
  const target = '## 1.5 Restore\n\n## External documents {#external-docs}\n\n## Query, `Plan` & more\n';
  const links = '[a](b.md#_1-5-restore) [b](b.md#external-docs) [c](b.md#query-plan-more) [d](b.md#15-restore)\n';
  const root = tree(t, { ...pair('a.md', 'alpha', links), ...pair('b.md', 'bee', target) });
  const plain = run(root).filter(line => line.includes('does not define'));
  assert.deepEqual([...new Set(plain.map(line => {
    const anchor = /#[\w-]+/.exec(line);
    if (!anchor) throw new Error(`the finding names no anchor: ${line}`);
    return anchor[0];
  }))], ['#_1-5-restore', '#external-docs', '#query-plan-more']);
  const site = run(root, { ...CONFIG, siteLinks: true }).filter(line => line.includes('does not define'));
  assert.deepEqual(site, [], site.join('\n'));
});

test('document checks report step starts, results and elapsed time without changing findings (K685)', (t) => {
  const root = tree(t, pair('a.md', 'alpha'));
  const messages: string[] = [];
  const actual = check(root, CONFIG, undefined, line => messages.push(line));
  assert.deepEqual(actual, check(root, CONFIG));
  for (const name of ['document pairs', 'checklists', 'status tables and changelogs']) {
    assert.ok(messages.includes(`step ${name}: started`), messages.join('\n'));
    assert.ok(messages.some(line => line.startsWith(`step ${name}: passed (`) && line.endsWith(')')), messages.join('\n'));
  }
});

// K895: the site renderer compiles the raw HTML of a page as a Vue template, which fails on an element without its end tag.
test('raw-tag: an element without its end tag outside code fails in the documents that a site renderer evaluates, and code passes (K895)', (t) => {
  const raw = '| KSTD-5-120 | Define the deps-<runtime> targets that ci-setup calls. |\n';
  const code = '| KSTD-5-120 | Define the `deps-<runtime>` targets that ci-setup calls. |\n\n<a id="x"></a> <br> <code v-pre>{{ y }}</code> <https://example.org>\n\n```\n<tag>\n```\n';
  const script = '<script setup>\nconst s = "<T>";\n</script>\n\n<MyComp>x</mycomp>\n';
  const quoted = '> a <x>\n\nb </y> <BR>\n';
  const root = tree(t, { 'docs/raw.md': raw, 'docs/code.md': code, 'docs/script.md': script, 'docs/quoted.md': quoted, 'notes/raw.md': raw });
  const found = run(root, { ...CONFIG, interpolation: ['docs/**'] });
  has(found, 'docs/raw.md:1:32: raw-tag: <runtime> is not paired, so the site renderer fails on it as a Vue template; write it as code: `<runtime>`');
  assert.deepEqual(found.filter(line => line.startsWith('docs/quoted.md')).map(line => line.split(': raw-tag: ')[0] ?? line).sort((a, b) => a.localeCompare(b)), ['docs/quoted.md:1:5', 'docs/quoted.md:3:3', 'docs/quoted.md:3:8'], 'a tag in a quote, an end tag without its element and an upper-case void element, which Vue does not know');
  assert.deepEqual(found.filter(line => !/^docs\/(raw|quoted)\.md/.test(line)), [], 'code spans, fenced blocks, script content, closed and void elements and autolinks pass, and a document that the site does not render is not read');
});

// K957: CI has no kit checkout beside the repository, so the consumer check reads the item ids that the installed kit package ships in
// dist/kit-items.json; a missing list is a finding, never a note.
test('checklist-kit reads the kit item list of the installed kit package, and a missing list is a finding (K957)', (t) => {
  const rows = ['| ID | Task | Deliverables | Verification | State |', '| --- | --- | --- | --- | --- |', '| T1 | waits on K365 | `a.mts` | `node --test a.test.mts` | [ ] |', '| T2 | waits on K99999 | `b.mts` | `node --test b.test.mts` | [ ] |'];
  const root = tree(t, { ...pair(CHECKLIST, 'checklist', `${rows.join('\n')}\n`), ...pair(`${PLAN}/plan.md`, 'plan', 'The plan.\n'), 'config/checklist.json': JSON.stringify({ schema: 1, hooks: ['pre-push'], idPattern: ID_PATTERN }) });
  // Without the list the check fails on the list, and no note stands in for the rule.
  const missing = check(root, CONFIG);
  hasPart(missing.findings, 'node_modules/@polyspec/kit/dist/kit-items.json: checklist-kit');
  assert.deepEqual(missing.notes, [], missing.notes.join('\n'));
  put(root, { 'node_modules/@polyspec/kit/dist/kit-items.json': JSON.stringify(['K365', 'K369']) });
  const found = check(root, CONFIG).findings.filter(line => line.includes('checklist-kit'));
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', /K99999/);
});
