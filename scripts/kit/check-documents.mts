#!/usr/bin/env node
// Checks the documents of a checkout (`make docs-check`), as `config/documents.json` declares them; each English document and its
// Korean twin, where one exists, is read on its own (K809):
//
//   sections        an explicit anchor <a id="..."></a> appears once in its file
//   fences          every fenced code block closes
//   link            every relative link resolves to a file, a directory, an explicit anchor or a heading anchor
//   private-path    no document holds a path into a user's home directory
//   interpolation   no {{ outside a fenced code block in the documents that a site renderer evaluates
//   raw-tag         in the same documents, every raw HTML tag outside code is paired, unless it is void or self-closing (K895)
//   checklist-*     the checklists of the plan folders hold only tasks and their markers and states are valid (the strict reading
//                   of scripts/kit/checklist.mts), an item ID is unique among them and a sub-item has its parent in its checklist
//                   (checklist-cross), and no other document under docs/ holds checklist items (checklist-place)
//   checklist-kit   a task row names in its Task, Verification or state a kit item id (K<n> or K<n>-<m>) that the checklists of
//                   the kit hold none of (K374); the kit is this checkout, or else the item list dist/kit-items.json of the installed
//                   kit package, which a missing list fails (K957)
//   status-table    the status tables have the declared cells and values
//   changelog       the changelogs start with ## Unreleased, then the versions newest first
//   missing         a file that config/documents.json names exists
//
// Each finding is one line `<file>:<line>:<column>: <rule>: <message>` (line and column are left out where the finding
// has none). The command prints its findings and exits with status 1, or prints the count of what it checked.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { changelogFindings } from './changelog.mts';
import { makeDatabase, type MakeDatabase } from './owner-check.mts';
import { verificationFindings } from './verification.mts';
import { checklistsFindings, CHECKLIST_COLUMNS, CONFIG as CHECKLIST_CONFIG, loadConfig as loadChecklists, readChecklist, trackersOf, undeclaredChecklists, workingPlanFiles } from './checklist.mts';
import { KIT_ITEMS, kitItemIds } from './kit-items.mts';
import type { Tracker } from './checklist.mts';
import { matchesAny } from './glob.mts';
import { anchors, headingAnchors, lineBlocks, links, linkSpans, scanFences, unclosedTags } from './markdown.mts';
import { readStatusTable } from './status-table.mts';
import { trackedFiles } from './tracked-files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { readConfig } from './schema-validate.mts';
import { present } from './present.mts';
import { errorCode } from './process.mts';
import { compactSeconds } from './time.mts';

export const CONFIG = 'config/documents.json';
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

const koreanOf = (file: string) => file.replace(/\.md$/, '.ko.md');
const englishOf = (file: string) => file.replace(/\.ko\.md$/, '.md');
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
    try {
      absolute = path.resolve(absolute, decodeURIComponent(location));
    } catch (error) {
      // decodeURIComponent throws a URIError for a bad % escape, and nothing else.
      if (!(error instanceof URIError)) throw error;
      return [at(`the link ${target} is not a valid path (bad % escape)`)];
    }
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

/** The findings of the document `file` as `[file, finding]` entries; `english` is the English document whose pattern selected it. */
function documentFindings(root: string, config: DocumentsConfig, file: string, english: string, read: Read) {
  const found: [string, DocumentFinding][] = [];
  const add = (entry: DocumentFinding) => found.push([file, entry]);
  const text = read(file);
  const list = anchors(text);
  const repeated = list.find((anchor: string, at: number) => list.indexOf(anchor) !== at);
  if (repeated) add({ rule: 'sections', message: `the section anchor ${repeated} appears more than once` });
  const fences = scanFences(text);
  if (fences.unclosed) add({ line: fences.unclosed, column: 1, rule: 'fences', message: 'the fenced code block opened here never closes' });
  const read1 = links(text);
  for (const problem of read1.problems) add({ ...problem, rule: 'link' });
  for (const link of read1.links) for (const entry of linkFindings(root, config, file, link, read)) add(entry);
  for (const finding of privatePaths(text)) add(finding);
  if (matchesAny(config.interpolation ?? [], english)) {
    text.split('\n').forEach((line, index) => {
      if (fences.fenced[index]) return;
      const prose = line.replace(/<(code|span)\s+v-pre>[\s\S]*?<\/\1>/g, match => ' '.repeat(match.length));
      const at = prose.indexOf('{{');
      if (at !== -1) add({ line: index + 1, column: at + 1, rule: 'interpolation', message: '{{ outside a fenced code block is evaluated by the site renderer; write it in <code v-pre>...</code>' });
    });
  }
  // The site renderer compiles the raw HTML of a page as a Vue template, which fails on an element without its end tag (K895).
  if (matchesAny(config.interpolation ?? [], english)) {
    for (const tag of unclosedTags(text)) add({ line: tag.line, column: tag.column, rule: 'raw-tag', message: `${tag.tag} is not paired, so the site renderer fails on it as a Vue template; write it as code: \`${tag.tag}\`` });
  }
  return found;
}

// A kit item id named in a row: K<digits> with its -<digits> or .<digits> parts (the idPattern of kit's config/checklist.json,
// which kit's items use as K2.1), standing alone, so BK12 and K12x are no id.
const KIT_ID = /(?<![A-Za-z0-9_])K[0-9]+(?:[.-][0-9]+)*(?![A-Za-z0-9_])/g;
const KIT_PACKAGE = '@polyspec/kit';

/** The name of the package.json of `root`, or undefined when it has none; a package.json that cannot be read is an error (K559). */
const packageName = (root: string): unknown => {
  let text: string;
  try {
    text = readFileSync(path.join(root, 'package.json'), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`${path.join(root, 'package.json')} holds no valid JSON: ${error.message}`, { cause: error });
  }
  return typeof parsed === 'object' && parsed !== null && 'name' in parsed ? parsed.name : undefined;
};

/** The item list of the installed kit package that `root` installs, relative to `root` (K957). */
const KIT_LIST = path.posix.join('node_modules', KIT_PACKAGE, KIT_ITEMS);

/**
 * The item IDs of the kit whose items the rows of `root` name (K957): the checklists of `root` itself in kit, else the list that the
 * installed kit package ships, since CI has no kit checkout beside the repository (K348-1). Undefined when the list is missing; a
 * list that is no array of IDs is an error.
 */
function kitItemsOf(root: string, isKit: boolean): string[] | undefined {
  if (isKit) return kitItemIds(root);
  const file = path.join(root, KIT_LIST);
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every(id => typeof id === 'string')) throw new Error(`${file} is no array of kit item IDs; make kit-build writes it`);
  return parsed;
}

/** The word right before `index` of `text`, as the name of a repository stands before its item: template-benchmark K79-3. */
const wordBefore = (text: string, index: number): string | undefined => /([A-Za-z0-9][A-Za-z0-9._-]*)\s+$/.exec(text.slice(0, index))?.[1];

/** The folders beside `root` that hold a Git checkout, the repositories whose name may stand before their own items (K374-1). */
function siblingRepositories(root: string): Set<string> {
  const parent = path.dirname(path.resolve(root));
  return new Set(readdirSync(parent).filter(name => existsSync(path.join(parent, name, '.git'))));
}

/**
 * Which K-ids of a row are kit items (K374-1): a K-id right after the name of a sibling repository other than kit is the item of
 * that repository; in a repository whose own ids are K-ids, a K-id is its own unless kit stands right before it.
 */
type KitIdReader = { siblings: ReadonlySet<string>; ownKitIds: boolean };

/**
 * The findings of the task rows of the checklists that name a kit item id which `ids` does not hold: the Task, the
 * Verification and the state cell of each row, English and Korean alike, each with its line and column.
 */
function kitRowFindings(checklists: readonly Tracker[], available: (file: string) => string | undefined, ids: Set<string>, reader: KitIdReader): [string, DocumentFinding][] {
  const found: [string, DocumentFinding][] = [];
  const task = CHECKLIST_COLUMNS.indexOf('Task');
  const verification = CHECKLIST_COLUMNS.indexOf('Verification');
  for (const tracker of checklists) {
    for (const file of [tracker.path, tracker.translation]) {
      const text = available(file);
      if (text === undefined) continue;
      const blocks = lineBlocks(text);
      const external = linkSpans(text).filter(link => {
        if (!URL.canParse(link.target)) return false;
        const url = new URL(link.target);
        return ['http:', 'https:'].includes(url.protocol) && !(url.hostname === 'github.com' && /^\/polyspec\/kit(?:\/|$)/i.test(url.pathname));
      });
      let offset = 0;
      const lineOffsets = text.split('\n').map(line => { const start = offset; offset += line.length + 1; return start; });
      for (const item of readChecklist(text, tracker).items) {
        const block = blocks[item.line - 1];
        if (block?.kind !== 'tableRow') continue;
        // The state is the last cell; a row too short for the columns of a checklist names what its cells hold.
        const named = [[task, 'Task'], [verification, 'Verification'], [block.cells.length - 1, 'state']] as const;
        for (const [index, label] of named.filter(([column], at, all) => all.findIndex(([other]) => other === column) === at)) {
          const cell = block.cells[index];
          if (cell === undefined) continue;
          for (const match of cell.text.matchAll(KIT_ID)) {
            const before = wordBefore(cell.text, match.index);
            const at = present(lineOffsets[item.line - 1], 'the checklist row line offset') + cell.start + match.index;
            if (before !== 'kit' && external.some(link => at >= link.start && at < link.end)) continue;
            if (before !== undefined && before !== 'kit' && reader.siblings.has(before)) continue;
            if (reader.ownKitIds && before !== 'kit') continue;
            if (ids.has(match[0])) continue;
            found.push([file, { line: item.line, column: cell.start + match.index + 1, rule: 'checklist-kit', message: `the row of ${item.id} names the kit item ${match[0]} in its ${label}, which no checklist of kit holds; a row waits only on a kit item that a kit checklist holds` }]);
          }
        }
      }
    }
  }
  return found;
}

/** The findings of the checkout at `root` under `config`, as printed lines, sorted. */
export function check(root: string, config: DocumentsConfig, progress?: (line: string) => void) {
  const cache = new Map<string, string>();
  const read = (file: string) => {
    if (!cache.has(file)) cache.set(file, readFileSync(path.join(root, file), 'utf8'));
    // The line above sets every missing file.
    return present(cache.get(file), 'cache.get(file)');
  };
  const found: [string, DocumentFinding][] = [];
  const add = (file: string, entry: DocumentFinding) => found.push([file, entry]);
  const documentsStarted = performance.now();
  progress?.('step document pairs: started');
  const documents = documentsOf(root, config);
  for (const english of documents) {
    for (const file of [english, koreanOf(english)]) if (existsSync(path.join(root, file))) found.push(...documentFindings(root, config, file, english, read));
  }
  progress?.(`step document pairs: ${found.length ? `${found.length} findings` : 'passed'} (${compactSeconds(performance.now() - documentsStarted)})`);

  const both = (files: string[], source: string, run: (name: string, text: string) => void) => {
    for (const name of files) {
      if (!existsSync(path.join(root, name))) add(name, { rule: 'missing', message: `the file named in ${source} does not exist` });
      else run(name, read(name));
    }
  };
  const checklistStarted = performance.now(), beforeChecklists = found.length;
  progress?.('step checklists: started');
  let checklists: Tracker[] = [];
  if (existsSync(path.join(root, CHECKLIST_CONFIG))) {
    try {
      checklists = trackersOf(loadChecklists(root), workingPlanFiles(root));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // loadConfig fails with an Error.
      add(CHECKLIST_CONFIG, { rule: 'config', message: error.message });
    }
  }
  const missing = checklists.flatMap(list => [list.path, list.translation]).filter(file => !existsSync(path.join(root, file)));
  const available = (file: string) => (missing.includes(file) ? undefined : read(file));
  let database: MakeDatabase | undefined;
  for (const { file, finding } of [...checklistsFindings(checklists, available), ...verificationFindings(checklists, available, () => (database ??= makeDatabase(root)))]) add(file, finding);
  // A row that names a kit item waits on the checklists of the kit (K374); a missing item list of the installed kit package is a finding (K957).
  if (checklists.length > 0) {
    const isKit = packageName(root) === KIT_PACKAGE;
    const ids = kitItemsOf(root, isKit);
    if (ids === undefined) add(KIT_LIST, { rule: 'checklist-kit', message: `${KIT_LIST} is missing; make kit-build writes the item IDs of kit into the package, and the rows that name kit items cannot be checked without them` });
    else {
      // K559: a kit whose checklists cannot be read fails the check, never a note.
      // A repository other than kit whose ids are K-ids names kit as kit K<n>; a sibling repository names its own items (K374-1).
      const ownKitIds = !isKit && checklists.some(tracker => new RegExp(`^(?:${tracker.idPattern})$`).test('K1'));
      const reader = { siblings: siblingRepositories(root), ownKitIds };
      for (const [file, entry] of kitRowFindings(checklists, available, new Set(ids), reader)) add(file, entry);
    }
  }
  // A document under docs/ that holds checklist items but is no checklist of a plan folder is read by no gate (K235).
  const prose = documents.filter(name => name.startsWith('docs/'));
  for (const name of undeclaredChecklists(checklists, prose.flatMap(english => [english, koreanOf(english)]).filter(file => existsSync(path.join(root, file))).map(file => ({ path: file, text: read(file) })))) {
    add(name, { rule: 'checklist-place', message: 'the document holds checklist items but is no checklist of a plan folder; move the items into docs/plans/<plan>/checklist.md' });
  }
  progress?.(`step checklists: ${found.length === beforeChecklists ? 'passed' : `${found.length - beforeChecklists} findings`} (${compactSeconds(performance.now() - checklistStarted)})`);
  const statusStarted = performance.now(), beforeStatus = found.length;
  progress?.('step status tables and changelogs: started');
  for (const table of config.statusTables ?? []) {
    const results: [string, ReturnType<typeof readStatusTable>['rows']][] = [];
    both([table.path, koreanOf(table.path)], CONFIG, (name, text) => {
      const result = readStatusTable(text, table);
      for (const entry of result.findings) add(name, entry);
      results.push([name, result.rows]);
    });
  }
  for (const changelog of config.changelogs ?? []) {
    both([changelog, koreanOf(changelog)], CONFIG, (name, text) => {
      for (const entry of changelogFindings(text)) add(name, entry);
    });
  }
  progress?.(`step status tables and changelogs: ${found.length === beforeStatus ? 'passed' : `${found.length - beforeStatus} findings`} (${compactSeconds(performance.now() - statusStarted)})`);
  const lines = found.map(([file, entry]): [string, number, number, string] => [file, entry.line ?? 0, entry.column ?? 0, format(file, entry)]);
  lines.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || x[2] - y[2] || (x[3] < y[3] ? -1 : 1)));
  return { findings: [...new Set(lines.map(line => line[3]))], documents: documents.length, checklists: checklists.length };
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  if (!existsSync(path.join(root, CONFIG))) {
    console.error(`[check-documents] ${CONFIG} does not exist; declare the documents of the repository there (scripts/kit/schema/documents.schema.json)`);
    process.exit(1);
  }
  const config = readConfig<DocumentsConfig>(root, CONFIG, 'documents.schema.json');
  console.log(`[check-documents] reading the documents selected by ${CONFIG}`);
  const { findings, documents, checklists } = check(root, config, line => console.log(`[check-documents] ${line}`));
  for (const line of findings) console.error(`[check-documents] ${line}`);
  if (findings.length) {
    console.error(`[check-documents] ${findings.length} findings in ${documents} document pairs`);
    process.exit(1);
  }
  console.log(`[check-documents] ${documents} document pairs, ${checklists} checklists, ${(config.statusTables ?? []).length} status tables and ${(config.changelogs ?? []).length} changelogs passed`);
}
