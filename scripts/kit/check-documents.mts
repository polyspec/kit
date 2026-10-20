#!/usr/bin/env node
// Checks the documents of a checkout (`make docs-check`), as `config/documents.json` declares them:
//
//   pair-missing    every English document has a Korean twin .ko.md and the reverse
//   doc-id          both files hold the same <!-- doc-id: <id> --> once; an id belongs to one document
//   revision        the Korean file holds <!-- source-sha256: <sha256 of the English file> --> once
//   sections        the explicit anchors <a id="..."></a> are the same in both files and appear once
//   fences          the fenced code blocks (info string and content) are the same in both files and every fence closes
//   link            every relative link resolves to a file, a directory, an explicit anchor or a heading anchor
//   private-path    no document holds a path into a user's home directory
//   interpolation   no {{ outside a fenced code block in the documents that a site renderer evaluates
//   plan-folder     docs/plans holds plan folders only, each with plan.md, checklist.md and their Korean twins (K241)
//   checklist-*     the checklists of the plan folders hold only tasks, their markers and states are valid and equal in
//                   both languages (the strict reading of scripts/kit/checklist.mts), an item ID is unique among them and a
//                   sub-item has its parent in its checklist (checklist-cross), and no other document under docs/ holds
//                   checklist items (checklist-place)
//   checklist-kit   a task row names in its Task, Verification or state a kit item id (K<n> or K<n>-<m>) that the checklists of
//                   the kit the repository uses hold none of (K374); the kit is this checkout, or else ../kit beside it, and where
//                   neither exists the rule is skipped with a note
//   status-table    the status tables have the declared cells and values, equal in both languages
//   changelog       the changelogs start with ## Unreleased, then the versions newest first, equal in both languages
//
// Each finding is one line `<file>:<line>:<column>: <rule>: <message>` (line and column are left out where the finding
// has none). The command prints its findings and exits with status 1, or prints the count of what it checked.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { changelogFindings, changelogPairFindings } from './changelog.mts';
import { makeDatabase, type MakeDatabase } from './owner-check.mts';
import { verificationFindings } from './verification.mts';
import { checklistsFindings, CHECKLIST_COLUMNS, CONFIG as CHECKLIST_CONFIG, loadConfig as loadChecklists, planFindings, readChecklist, trackersOf, undeclaredChecklists, workingPlanFiles } from './checklist.mts';
import type { Tracker } from './checklist.mts';
import { matchesAny } from './glob.mts';
import { anchors, headingAnchors, lineBlocks, links, proseLines, scanFences } from './markdown.mts';
import { readStatusTable } from './status-table.mts';
import type { StatusRow } from './status-table.mts';
import { trackedFiles } from './tracked-files.mts';
import { fileAt, git } from './git.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { sha256 } from './bootstrap/digest.mts';
import { readConfig } from './schema-validate.mts';
import { present } from './present.mts';

export const CONFIG = 'config/documents.json';
const DOC_ID = /<!-- doc-id: ([^>]*?) -->/g;
const REVISION = /<!-- source-sha256: ([^>]*?) -->/g;
const PRIVATE_PATH = /(?:\/(?:Users|home)\/[^/\s"'<>`)]+\/|[A-Za-z]:\\Users\\[^\\\s"'<>`)]+\\)/g;

/** The configuration of config/documents.json (scripts/kit/schema/documents.schema.json). */
export type DocumentsConfig = {
  schema?: number;
  include: string[];
  exclude?: string[];
  siteLinks?: boolean;
  interpolation?: string[];
  statusTables?: { path: string; idPattern: string; cells: number; columns: { index: number; enum?: string[]; pattern?: string }[] }[];
  changelogs?: string[];
};

/** A finding of a file, with the line and column it names when it names them. */
export type DocumentFinding = { rule: string; message: string; line?: number | undefined; column?: number | undefined };

/** A reader of the text of a file of the checkout. */
type Read = (file: string) => string;

/** The English file and its Korean twin, in that order. */
type Pair<T> = [T, T];

const koreanOf = (file: string) => file.replace(/\.md$/, '.ko.md');
const englishOf = (file: string) => file.replace(/\.ko\.md$/, '.md');
// The text of a document with its code and its comments left out, one line per line of the document (K382 reads its markers here).
const proseOf = (text: string) => proseLines(text).map((entry: { text: string }) => entry.text).join('\n');
// The values of the source-sha256 markers of the Korean text, which a marker written in code or in a comment does not give (K382).
const revisionsOf = (text: string) => [...proseOf(text).matchAll(REVISION)].map(match => match[1]);
const position = (text: string, offset: number) => {
  const before = text.slice(0, offset).split('\n');
  // split returns at least one string.
  return { line: before.length, column: present(before[before.length - 1], 'before[before.length - 1]').length + 1 };
};

/** The private-path findings of the document `text`: each path into a home directory, which the plan utilities refuse too (K373). */
export function privatePaths(text: string): { line: number; column: number; rule: string; message: string }[] {
  return [...text.matchAll(PRIVATE_PATH)].map(match => ({ ...position(text, match.index), rule: 'private-path', message: `the document holds the path ${match[0]} into a home directory; write a repository-relative path` }));
}

/** A finding of `file` as the line the command prints. */
export const format = (file: string, found: DocumentFinding) => `${file}${found.line ? `:${found.line}${found.column ? `:${found.column}` : ''}` : ''}: ${found.rule}: ${found.message}`;

/** The English documents of the checkout: tracked Markdown files that `include` selects and `exclude` does not. */
export function documentsOf(root: string, config: DocumentsConfig): string[] {
  const excluded = config.exclude ?? [];
  const documents = new Set<string>();
  for (const file of trackedFiles(root)) {
    if (file.endsWith('.md') && matchesAny(config.include, file) && !matchesAny(excluded, file)) documents.add(englishOf(file));
  }
  return [...documents].sort();
}

/** The findings of the link `target` written in `file`: an empty list when it resolves. */
function linkFindings(root: string, config: DocumentsConfig, file: string, link: { target: string; line: number; column: number }, read: Read): DocumentFinding[] {
  const { target } = link;
  const at = (message: string) => ({ line: link.line, column: link.column, rule: 'link', message });
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return [];
  // split returns at least one string.
  const [location, fragment] = [present(target.split('#')[0], 'target.split(\'#\')[0]'), target.includes('#') ? decodeURIComponent(target.slice(target.indexOf('#') + 1)) : ''];
  if (location.startsWith('/')) return config.siteLinks ? [] : [at(`the link ${target} starts with /; write a link relative to the file`)];
  if (location.includes('?')) return [at(`the link ${target} has a query; a link to a file has none`)];
  let absolute = path.resolve(root, path.dirname(file));
  if (location) {
    try { absolute = path.resolve(absolute, decodeURIComponent(location)); } catch { return [at(`the link ${target} is not a valid path (bad % escape)`)]; }
  } else absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return [at(`the link ${target} leaves the repository`)];
  let resolved = absolute;
  if (!existsSync(resolved) && config.siteLinks) {
    resolved = [`${absolute}.md`, `${absolute}.ko.md`, path.join(absolute, 'index.md')].find(existsSync) ?? absolute;
  }
  if (!existsSync(resolved)) return [at(`the link ${target} names ${relative}, which does not exist`)];
  if (!fragment) return [];
  if (statSync(resolved).isDirectory() || !resolved.endsWith('.md')) return [at(`the link ${target} has an anchor, but ${path.relative(root, resolved)} is not a Markdown file`)];
  const text = read(path.relative(root, resolved));
  if (anchors(text).includes(fragment) || headingAnchors(text, { site: Boolean(config.siteLinks) }).includes(fragment.toLowerCase())) return [];
  return [at(`the link ${target} names the anchor #${fragment}, which ${path.relative(root, resolved)} does not define`)];
}

/** The findings of one pair as `[file, finding]` entries. */
function pairFindings(root: string, config: DocumentsConfig, english: string, ids: Map<string, string>, read: Read) {
  const korean = koreanOf(english);
  const found: [string, DocumentFinding][] = [];
  const add = (file: string, entry: DocumentFinding) => found.push([file, entry]);
  const exists = { [english]: existsSync(path.join(root, english)), [korean]: existsSync(path.join(root, korean)) };
  if (!exists[english]) add(korean, { rule: 'pair-missing', message: `the English file ${english} does not exist; every Korean document has an English original` });
  if (!exists[korean]) add(english, { rule: 'pair-missing', message: `the Korean twin ${korean} does not exist; every English document has one` });
  if (!exists[english] || !exists[korean]) return found;
  const bytes = readFileSync(path.join(root, english));
  const texts: Record<string, string> = { [english]: bytes.toString('utf8'), [korean]: read(korean) };
  const files: Pair<string> = [english, korean];
  // texts and prose hold each file of files, and identifiers, anchorLists and fences hold one entry per file of files at
  // its index; present below reads them by a file or an index of files.

  // A marker written inside inline code or a fenced block describes the marker and is not one.
  const prose = Object.fromEntries(files.map(file => [file, proseOf(present(texts[file], 'texts[file]'))]));
  // DOC_ID has one group that is not optional, so every match holds it.
  const identifiers = files.map(file => [...present(prose[file], 'prose[file]').matchAll(DOC_ID)].map(match => present(match[1], 'match[1]')));
  files.forEach((file, index) => {
    if (present(identifiers[index], 'identifiers[index]').length !== 1) add(file, { rule: 'doc-id', message: `the file has ${present(identifiers[index], 'identifiers[index]').length} doc-id markers; expected exactly 1 <!-- doc-id: <id> -->` }); // The texts and the lists hold each file of the pair.
    // The list holds exactly one id here.
    else if (!/^[a-z][a-z0-9-]*$/.test(present(present(identifiers[index], 'identifiers[index]')[0], 'identifiers[index][0]'))) add(file, { rule: 'doc-id', message: `the doc-id ${JSON.stringify(present(identifiers[index], 'identifiers[index]')[0])} does not match [a-z][a-z0-9-]*` });
  });
  if (identifiers.every(list => list.length === 1)) {
    // Both lists hold exactly one id here.
    if (present(identifiers[0], 'identifiers[0]')[0] !== present(identifiers[1], 'identifiers[1]')[0]) add(korean, { rule: 'doc-id', message: `the doc-id is ${present(identifiers[1], 'identifiers[1]')[0]}; the English file ${english} has ${present(identifiers[0], 'identifiers[0]')[0]}` });
    else if (ids.has(present(present(identifiers[0], 'identifiers[0]')[0], 'identifiers[0][0]'))) add(english, { rule: 'doc-id', message: `the doc-id ${present(identifiers[0], 'identifiers[0]')[0]} is also the doc-id of ${ids.get(present(present(identifiers[0], 'identifiers[0]')[0], 'identifiers[0][0]'))}; an id names one document` }); // The texts and the lists hold each file of the pair.
    else ids.set(present(present(identifiers[0], 'identifiers[0]')[0], 'identifiers[0][0]'), english); // The texts and the lists hold each file of the pair.
  }

  const revisions = revisionsOf(present(texts[korean], 'texts[korean]'));
  const expected = sha256(bytes);
  if (revisions.length !== 1) add(korean, { rule: 'revision', message: `the file has ${revisions.length} source-sha256 markers; expected exactly 1 <!-- source-sha256: ${expected} -->` });
  else if (revisions[0] !== expected) add(korean, { rule: 'revision', message: `the source-sha256 is ${revisions[0]}; the sha256 of ${english} is ${expected}; review the translation and update the marker` });

  const anchorLists = files.map(file => anchors(present(texts[file], 'texts[file]'))); // The texts and the lists hold each file of the pair.
  files.forEach((file, index) => {
    const repeated = present(anchorLists[index], 'anchorLists[index]').find((anchor: string, at: number) => present(anchorLists[index], 'anchorLists[index]').indexOf(anchor) !== at); // The texts and the lists hold each file of the pair.
    if (repeated) add(file, { rule: 'sections', message: `the section anchor ${repeated} appears more than once` });
  });
  if (present(anchorLists[0], 'anchorLists[0]').join('\n') !== present(anchorLists[1], 'anchorLists[1]').join('\n')) add(korean, { rule: 'sections', message: `the section anchors are [${present(anchorLists[1], 'anchorLists[1]').join(', ')}]; ${english} has [${present(anchorLists[0], 'anchorLists[0]').join(', ')}]` }); // The texts and the lists hold each file of the pair.

  const fences = files.map(file => scanFences(present(texts[file], 'texts[file]'))); // The texts and the lists hold each file of the pair.
  files.forEach((file, index) => {
    const { unclosed } = present(fences[index], 'fences[index]');
    if (unclosed) add(file, { line: unclosed, column: 1, rule: 'fences', message: 'the fenced code block opened here never closes' }); // The texts and the lists hold each file of the pair.
  });
  const [a, b] = [present(fences[0], 'fences[0]').blocks, present(fences[1], 'fences[1]').blocks]; // The texts and the lists hold each file of the pair.
  const differing = a.findIndex((block, at) => !b[at] || block.info !== b[at].info || block.body !== b[at].body);
  if (differing !== -1 || a.length !== b.length) {
    const at = differing === -1 ? a.length : differing;
    add(korean, { line: b[at]?.line, column: b[at] ? 1 : undefined, rule: 'fences', message: `the fenced code block ${at + 1} differs from ${english}${a[at] ? ` (line ${a[at].line})` : ''}; the files have ${b.length} and ${a.length} blocks` });
  }

  for (const file of files) {
    const read1 = links(present(texts[file], 'texts[file]')); // The texts and the lists hold each file of the pair.
    for (const problem of read1.problems) add(file, { ...problem, rule: 'link' });
    for (const link of read1.links) for (const entry of linkFindings(root, config, file, link, read)) add(file, entry);
    for (const finding of privatePaths(present(texts[file], 'texts[file]'))) add(file, finding); // The texts and the lists hold each file of the pair.
    if (matchesAny(config.interpolation ?? [], english)) {
      const { fenced } = present(fences[files.indexOf(file)], 'fences[files.indexOf(file)]'); // The texts and the lists hold each file of the pair.
      present(texts[file], 'texts[file]').split('\n').forEach((line, index) => { // The texts and the lists hold each file of the pair.
        if (fenced[index]) return;
        const prose = line.replace(/<(code|span)\s+v-pre>[\s\S]*?<\/\1>/g, match => ' '.repeat(match.length));
        const at = prose.indexOf('{{');
        if (at !== -1) add(file, { line: index + 1, column: at + 1, rule: 'interpolation', message: '{{ outside a fenced code block is evaluated by the site renderer; write it in <code v-pre>...</code>' });
      });
    }
  }
  return found;
}

// A kit item id named in a row: K<digits> with its -<digits> or .<digits> parts (the idPattern of kit's config/checklist.json,
// which kit's items use as K2.1), standing alone, so BK12 and K12x are no id.
const KIT_ID = /(?<![A-Za-z0-9_])K[0-9]+(?:[.-][0-9]+)*(?![A-Za-z0-9_])/g;
const KIT_PACKAGE = '@polyspec/kit';

/** The name of the package.json of `root`, or undefined when it has none or cannot be read. */
const packageName = (root: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && 'name' in parsed ? parsed.name : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The checkout of the kit whose checklists the rows of `root` name: `root` itself in kit, else the kit checkout ../kit
 * beside the repository (K348-1), since the kit package ships no plan. Undefined when neither exists.
 */
export function kitCheckoutOf(root: string): string | undefined {
  if (packageName(root) === KIT_PACKAGE) return root;
  const sibling = path.resolve(root, '..', 'kit');
  return existsSync(path.join(sibling, CHECKLIST_CONFIG)) ? sibling : undefined;
}

/** The item IDs of the checklists of the kit checkout `kit`: every task of every plan folder. Throws when one cannot be read. */
function kitItemIds(kit: string): Set<string> {
  const ids = new Set<string>();
  for (const tracker of trackersOf(loadChecklists(kit), workingPlanFiles(kit))) {
    for (const item of readChecklist(readFileSync(path.join(kit, tracker.path), 'utf8'), tracker).items) ids.add(item.id);
  }
  return ids;
}

/**
 * The findings of the task rows of the checklists that name a kit item id which `ids` does not hold: the Task, the
 * Verification and the state cell of each row, English and Korean alike, each with its line and column.
 */
function kitRowFindings(checklists: readonly Tracker[], available: (file: string) => string | undefined, ids: Set<string>): [string, DocumentFinding][] {
  const found: [string, DocumentFinding][] = [];
  const task = CHECKLIST_COLUMNS.indexOf('Task');
  const verification = CHECKLIST_COLUMNS.indexOf('Verification');
  for (const tracker of checklists) {
    for (const file of [tracker.path, tracker.translation]) {
      const text = available(file);
      if (text === undefined) continue;
      const blocks = lineBlocks(text);
      for (const item of readChecklist(text, tracker).items) {
        const block = blocks[item.line - 1];
        if (block?.kind !== 'tableRow') continue;
        // The state is the last cell; a row too short for the columns of a checklist names what its cells hold.
        const named = [[task, 'Task'], [verification, 'Verification'], [block.cells.length - 1, 'state']] as const;
        for (const [index, label] of named.filter(([column], at, all) => all.findIndex(([other]) => other === column) === at)) {
          const cell = block.cells[index];
          if (cell === undefined) continue;
          for (const match of cell.text.matchAll(KIT_ID)) {
            if (ids.has(match[0])) continue;
            found.push([file, { line: item.line, column: cell.start + match.index + 1, rule: 'checklist-kit', message: `the row of ${item.id} names the kit item ${match[0]} in its ${label}, which no checklist of kit holds; a row waits only on a kit item that a kit checklist holds` }]);
          }
        }
      }
    }
  }
  return found;
}

/** The findings of the checkout at `root` under `config`, as printed lines, sorted; `kitRoot` is the kit checkout the rows name. */
export function check(root: string, config: DocumentsConfig, kitRoot: string | undefined = kitCheckoutOf(root)) {
  const notes: string[] = [];
  const cache = new Map<string, string>();
  const read = (file: string) => {
    if (!cache.has(file)) cache.set(file, readFileSync(path.join(root, file), 'utf8'));
    // The line above sets every missing file.
    return present(cache.get(file), 'cache.get(file)');
  };
  const found: [string, DocumentFinding][] = [];
  const add = (file: string, entry: DocumentFinding) => found.push([file, entry]);
  const documents = documentsOf(root, config);
  const ids = new Map<string, string>();
  for (const english of documents) found.push(...pairFindings(root, config, english, ids, read));

  const both = (files: string[], source: string, run: (name: string, text: string) => void) => {
    for (const name of files) {
      if (!existsSync(path.join(root, name))) add(name, { rule: 'pair-missing', message: `the file named in ${source} does not exist` });
      else run(name, read(name));
    }
  };
  let checklists: Tracker[] = [];
  if (existsSync(path.join(root, CHECKLIST_CONFIG))) {
    try {
      const plans = workingPlanFiles(root);
      for (const entry of planFindings(plans)) add(entry.file, { rule: 'plan-folder', message: entry.message });
      checklists = trackersOf(loadChecklists(root), plans);
      if (checklists.length === 0) add(CHECKLIST_CONFIG, { rule: 'plan-folder', message: 'the repository holds no plan; a plan is docs/plans/<plan>/ with plan.md, checklist.md and their Korean twins' });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // loadConfig fails with an Error.
      add(CHECKLIST_CONFIG, { rule: 'config', message: error.message });
    }
  }
  const missing = checklists.flatMap(list => [list.path, list.translation]).filter(file => !existsSync(path.join(root, file)));
  for (const file of missing) add(file, { rule: 'pair-missing', message: 'the file named in docs/plans does not exist' });
  const available = (file: string) => (missing.includes(file) ? undefined : read(file));
  let database: MakeDatabase | undefined;
  for (const { file, finding } of [...checklistsFindings(checklists, available), ...verificationFindings(checklists, available, () => (database ??= makeDatabase(root)))]) add(file, finding);
  // A row that names a kit item waits on the checklists of the kit that the repository uses; without a kit the rule is skipped.
  if (checklists.length > 0) {
    if (kitRoot === undefined) notes.push(`no checkout of the kit at ${path.resolve(root, '..', 'kit')}: the rows that name kit items are not checked`);
    else {
      try {
        for (const [file, entry] of kitRowFindings(checklists, available, kitItemIds(kitRoot))) add(file, entry);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        notes.push(`the checklists of the kit at ${kitRoot} cannot be read (${error.message}): the rows that name kit items are not checked`);
      }
    }
  }
  // A document under docs/ that holds checklist items but is no checklist of a plan folder is read by no gate (K235).
  const prose = documents.filter(name => name.startsWith('docs/'));
  for (const name of undeclaredChecklists(checklists, prose.flatMap(english => [english, koreanOf(english)]).filter(file => existsSync(path.join(root, file))).map(file => ({ path: file, text: read(file) })))) {
    add(name, { rule: 'checklist-place', message: 'the document holds checklist items but is no checklist of a plan folder; move the items into docs/plans/<plan>/checklist.md' });
  }
  for (const table of config.statusTables ?? []) {
    const results: [string, ReturnType<typeof readStatusTable>['rows']][] = [];
    both([table.path, koreanOf(table.path)], CONFIG, (name, text) => {
      const result = readStatusTable(text, table);
      for (const entry of result.findings) add(name, entry);
      results.push([name, result.rows]);
    });
    const [english, korean] = results;
    if (english && korean) {
      const [, en] = english;
      const [ko, kor] = korean;
      const show = (rows: StatusRow[]) => rows.map(row => [row.id, ...row.values].join('/')).join(' ');
      if (show(en) !== show(kor)) add(ko, { rule: 'status-table', message: `the rows differ from ${table.path}: [${show(kor)}] and [${show(en)}]` });
    }
  }
  for (const changelog of config.changelogs ?? []) {
    const texts: string[] = [];
    both([changelog, koreanOf(changelog)], CONFIG, (name, text) => {
      for (const entry of changelogFindings(text)) add(name, entry);
      texts.push(text);
    });
    // The length check holds both texts.
    if (texts.length === 2) for (const entry of changelogPairFindings(present(texts[0], 'texts[0]'), present(texts[1], 'texts[1]'))) add(koreanOf(changelog), entry);
  }
  const lines = found.map(([file, entry]): [string, number, number, string] => [file, entry.line ?? 0, entry.column ?? 0, format(file, entry)]);
  lines.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || x[2] - y[2] || (x[3] < y[3] ? -1 : 1)));
  return { findings: [...new Set(lines.map(line => line[3]))], documents: documents.length, checklists: checklists.length, notes };
}

/** Whether the index holds `file` (K382: a staged check reads the index, not the working tree). */
const indexed = (root: string, file: string) => git(root, 'ls-files', '--cached', '--', file).split('\n').includes(file);

/**
 * The twin findings of a change (K382, K351), as lines `<korean>: revision: <message>`: for each English document of `changed` whose
 * pair the side holds (`tracked`), the Korean twin must hold the sha256 of the English text that `read` gives at that side. A pair
 * that the change does not touch is not read; its stale marker is the finding of docs-check. `config` is the config of that side.
 */
export function twinFindings(config: DocumentsConfig, changed: string[], read: Read, tracked: (file: string) => boolean): string[] {
  const englishes = new Set(changed.filter(file => file.endsWith('.md')).map(englishOf));
  const found: string[] = [];
  for (const english of [...englishes].sort()) {
    if (!matchesAny(config.include, english) || matchesAny(config.exclude ?? [], english)) continue;
    const korean = koreanOf(english);
    // A side the tree does not hold is the pair-missing finding of docs-check.
    if (!tracked(english) || !tracked(korean)) continue;
    const expected = sha256(read(english));
    const revisions = revisionsOf(read(korean));
    if (revisions.length === 1 && revisions[0] === expected) continue;
    const message = revisions.length === 1
      ? `the source-sha256 is ${revisions[0]}; the sha256 of ${english} is ${expected}; review the translation, then run make documents-stamp`
      : `the file has ${revisions.length} source-sha256 markers; expected exactly 1 <!-- source-sha256: ${expected} -->, the sha256 of ${english}; review the translation, then run make documents-stamp`;
    found.push(format(korean, { rule: 'revision', message }));
  }
  return found;
}

/** The findings of the staged twins (K382): the twin findings of the staged paths, read from the index. */
export function stagedTwinFindings(root: string): string[] {
  // Without config/documents.json docs-check selects no document, so no twin is read here either.
  if (!existsSync(path.join(root, CONFIG))) return [];
  const config = readConfig<DocumentsConfig>(root, CONFIG, 'documents.schema.json');
  const staged = git(root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);
  return twinFindings(config, staged, file => fileAt(root, '', file), file => indexed(root, file));
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  if (!existsSync(path.join(root, CONFIG))) {
    console.error(`[check-documents] ${CONFIG} does not exist; declare the documents of the repository there (scripts/kit/schema/documents.schema.json)`);
    process.exit(1);
  }
  const config = readConfig<DocumentsConfig>(root, CONFIG, 'documents.schema.json');
  console.log(`[check-documents] reading the documents selected by ${CONFIG}`);
  const { findings, documents, checklists, notes } = check(root, config);
  for (const note of notes) console.log(`[check-documents] note: ${note}`);
  for (const line of findings) console.error(`[check-documents] ${line}`);
  if (findings.length) {
    console.error(`[check-documents] ${findings.length} findings in ${documents} document pairs`);
    process.exit(1);
  }
  console.log(`[check-documents] ${documents} document pairs, ${checklists} checklists, ${(config.statusTables ?? []).length} status tables and ${(config.changelogs ?? []).length} changelogs passed`);
}
