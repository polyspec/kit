#!/usr/bin/env node
// Checks that every rule names the check that enforces it, and that the check runs where it cannot be skipped
// (`make rules-check`, K248):
//
//   node scripts/kit/check-rules.mts [<document>...]   the documents default to PRINCIPLES.md and AGENTS.md
//
// A rule is an item of a top-level list of a document. Its last line is `Enforced by: <check>, <check>...`, each check in
// backticks: `make <target>`, a test file, a Git hook of .githooks or `.claude/settings.json`; or `Enforced by: none, <reason>`
// for a rule that no tool can enforce, which the check lists; `planned <item>` names the open checklist item that builds the
// check of a rule, which the check lists until the item is done and then fails. A check is reached when a point that cannot be skipped runs it:
// a step of a workflow of .github/workflows or a Git hook of .githooks starts make with it, it is a prerequisite of a reached
// target, a reached recipe names it after the expansion of its variables, or a reached recipe names the test file or a folder
// of it. The Korean twin of a document (<name>.ko.md) names the same checks for each rule.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { lineBlocks } from './markdown.mts';
import { makeDatabase, type MakeDatabase } from './owner-check.mts';
import { commandParts, expandMake, makeArguments } from './recipe-tools.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { CONFIG, DONE, IMPOSSIBLE, loadConfig, readChecklist, trackersOf, workingPlanFiles } from './checklist.mts';

/** A rule of a document: its first line and the text of its `Enforced by:` line, or null. */
type Rule = { line: number; enforced: string | null };

/** A rule that no tool enforces, with the reason that its document gives. */
export type Unenforced = { file: string; line: number; reason: string };

/** A rule whose check an open checklist item builds. */
export type Planned = { file: string; line: number; item: string };

const ENFORCED = /^\s*Enforced by:\s*(.*)$/;
const DEFAULT_DOCUMENTS = ['PRINCIPLES.md', 'AGENTS.md'];
// The points that cannot be skipped: the folders whose files start make.
const ENTRY_FOLDERS = ['.github/workflows', '.githooks'];

/** The rules of the document `text`: the items of its top-level lists, each with its `Enforced by:` line. */
function rulesOf(text: string): Rule[] {
  const lines = text.split('\n');
  const blocks = lineBlocks(text);
  const rules: Rule[] = [];
  blocks.forEach((block, index) => {
    const line = lines[index] ?? '';
    if (block.kind !== 'listItem' || !/^[-*+] /.test(line)) return;
    let enforced: string | null = null;
    for (let next = index; next < lines.length; next += 1) {
      const kind = blocks[next]?.kind;
      if (next > index && kind !== 'listContinuation' && kind !== 'blank') break;
      const match = ENFORCED.exec(lines[next] ?? '');
      if (match) enforced = match[1] ?? '';
    }
    rules.push({ line: index + 1, enforced });
  });
  return rules;
}

/**
 * The lines of the paragraphs of the document `text` that state a rule outside a list (K243-1): after the first section
 * heading (##), a section opens with at most one paragraph, its introduction, and every other paragraph, a second one or one
 * after a list, fails, since a rule in prose escapes the check of its `Enforced by:` line.
 */
function proseLines(text: string): number[] {
  const lines = text.split('\n');
  const blocks = lineBlocks(text);
  const found: number[] = [];
  let inSection = false;
  let opened = false;
  blocks.forEach((block, index) => {
    if (block.kind === 'heading' && (lines[index] ?? '').startsWith('## ')) {
      inSection = true;
      opened = false;
      return;
    }
    if (!inSection || block.kind === 'blank' || block.kind === 'heading' || block.kind === 'html' || block.kind === 'listContinuation') return;
    const starts = block.kind !== 'other' || blocks[index - 1]?.kind !== 'other';
    if (block.kind === 'other' && starts && opened) found.push(index + 1);
    if (starts) opened = true;
  });
  return found;
}

/** The checks of an `Enforced by:` text: the text of each backtick span. */
const checksOf = (enforced: string) => [...enforced.matchAll(/`([^`]+)`/g)].map(match => match[1] ?? '');

/** The planned items of an `Enforced by:` text: the ID after each `planned`. */
const plannedOf = (enforced: string) => [...enforced.matchAll(/\bplanned (\S+?)(?=[,.;]|\s|$)/g)].map(match => match[1] ?? '');

/** The words of the commands of `text`, a recipe or a script, line by line. */
const commandsOf = (text: string) => text.split('\n').flatMap(line => commandParts(line)).filter(words => words.length > 0);

/**
 * The shell lines of the steps of the workflow `text`: the value of each `run:`, on its line or in the block below it. An
 * expression `${{ … }}`, which GitHub replaces before the shell reads the line, is one word.
 */
function workflowLines(text: string): string[] {
  const lines = text.split('\n');
  const result: string[] = [];
  lines.forEach((line, index) => {
    const run = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!run) return;
    const [, indent = '', value = ''] = run;
    if (!/^[|>][-+]?$/.test(value)) {
      result.push(value);
      return;
    }
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && next.length - next.trimStart().length <= indent.length) break;
      result.push(next.trim());
    }
  });
  return result.map(line => line.replace(/\$\{\{[^}]*\}\}/g, 'GITHUB_EXPRESSION'));
}

/** The make targets and the paths that the points that cannot be skipped reach in `root`. */
export function reached(root: string, make: MakeDatabase): { targets: Set<string>; paths: Set<string> } {
  const targets = new Set<string>();
  const paths = new Set<string>();
  const queue: Array<{ target: string; variables: Map<string, string> }> = [];
  const enter = (words: readonly string[], variables: ReadonlyMap<string, string>) => {
    for (const word of words) if (word.includes('/') || /\.[a-z]+$/.test(word)) paths.add(word.replace(/^\.\//, '').replace(/\/$/, ''));
    const [command, ...args] = words;
    if (command === undefined || path.basename(command) !== 'make') {
      for (const word of words) if (make.targets.has(word)) queue.push({ target: word, variables: new Map(variables) });
      return;
    }
    const { targets: named, assignments } = makeArguments(args);
    for (const target of named) queue.push({ target, variables: new Map([...variables, ...assignments]) });
  };
  for (const folder of ENTRY_FOLDERS) {
    const directory = path.join(root, folder);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory).sort()) {
      const text = readFileSync(path.join(directory, entry), 'utf8');
      const script = folder === '.github/workflows' ? workflowLines(text).join('\n') : text;
      for (const words of commandsOf(script)) enter(words, new Map());
    }
  }
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    const rule = make.targets.get(item.target);
    if (rule === undefined || targets.has(item.target)) continue;
    targets.add(item.target);
    const variables = new Map([...make.variables, ...item.variables]);
    for (const prerequisite of rule.prerequisites) queue.push({ target: prerequisite, variables: item.variables });
    for (const words of commandsOf(expandMake(rule.recipe, variables))) enter(words.flatMap(word => word.split(/\s+/)).filter(Boolean), item.variables);
  }
  return { targets, paths };
}

/** The state of each item of the checklists of `root`, by ID; none without config/checklist.json. */
function itemStates(root: string): Map<string, { state: string; done: boolean }> {
  const states = new Map<string, { state: string; done: boolean }>();
  if (!existsSync(path.join(root, CONFIG))) return states;
  for (const tracker of trackersOf(loadConfig(root), workingPlanFiles(root))) {
    const { items } = readChecklist(readFileSync(path.join(root, tracker.path), 'utf8'), tracker);
    for (const item of items) states.set(item.id, { state: item.state, done: item.state === DONE || item.state === IMPOSSIBLE });
  }
  return states;
}

/** The finding of the check `check` of a rule at `where`, or null when a point that cannot be skipped runs it. */
function checkFinding(root: string, check: string, make: MakeDatabase, reach: ReturnType<typeof reached>, where: string): string | null {
  const target = /^make (\S+)$/.exec(check)?.[1];
  if (target !== undefined) {
    if (!make.targets.has(target)) return `${where}: make ${target} is no target of the Makefile`;
    if (!reach.targets.has(target)) return `${where}: make ${target} runs at no point that cannot be skipped: no CI workflow, Git hook or Claude Code hook reaches it`;
    return null;
  }
  if (!existsSync(path.join(root, check))) return `${where}: ${check} does not exist`;
  if (check === '.claude/settings.json' || check.startsWith('.githooks/')) return null;
  const covered = [...reach.paths].some(reachedPath => check === reachedPath || check.startsWith(`${reachedPath}/`));
  return covered ? null : `${where}: ${check} runs at no point that cannot be skipped: no recipe of a reached target names it`;
}

/** The findings of the documents `documents` of `root` and the rules that no tool enforces. */
export function checkRules(root: string, documents: readonly string[] = DEFAULT_DOCUMENTS, make: MakeDatabase = makeDatabase(root)): { findings: string[]; unenforced: Unenforced[]; planned: Planned[] } {
  const findings: string[] = [];
  const unenforced: Unenforced[] = [];
  const planned: Planned[] = [];
  const reach = reached(root, make);
  const states = itemStates(root);
  for (const document of documents) {
    const text = readFileSync(path.join(root, document), 'utf8');
    for (const line of proseLines(text)) findings.push(`${document}:${line}: a paragraph that introduces no section; a rule is an item of a top-level list with its Enforced by line, and a section opens with at most one paragraph`);
    const rules = rulesOf(text);
    if (rules.length === 0) findings.push(`${document}: the document holds no rule; a rule is an item of a top-level list`);
    for (const rule of rules) {
      const where = `${document}:${rule.line}`;
      if (rule.enforced === null) {
        findings.push(`${where}: the rule names no check; end it with \`Enforced by: <check>\` or \`Enforced by: none, <reason>\``);
        continue;
      }
      const none = /^none\b[,:]?\s*(.*)$/.exec(rule.enforced);
      if (none) {
        const reason = (none[1] ?? '').trim();
        if (reason === '') findings.push(`${where}: \`Enforced by: none\` needs the reason that no tool can enforce the rule: \`Enforced by: none, <reason>\``);
        else unenforced.push({ file: document, line: rule.line, reason });
        continue;
      }
      const checks = checksOf(rule.enforced);
      const items = plannedOf(rule.enforced);
      if (checks.length === 0 && items.length === 0) findings.push(`${where}: \`Enforced by:\` names no check in backticks and no planned item`);
      for (const item of items) {
        const state = states.get(item);
        if (state === undefined) findings.push(`${where}: planned ${item} names no item of a checklist of docs/plans`);
        else if (state.done) findings.push(`${where}: planned ${item} is done; name the check that ${item} built`);
        else planned.push({ file: document, line: rule.line, item });
      }
      for (const check of checks) {
        const finding = checkFinding(root, check, make, reach, where);
        if (finding) findings.push(finding);
      }
    }
    const twin = document.replace(/\.md$/, '.ko.md');
    if (!existsSync(path.join(root, twin))) continue;
    const twinRules = rulesOf(readFileSync(path.join(root, twin), 'utf8'));
    if (twinRules.length !== rules.length) {
      findings.push(`${twin}: the document holds ${twinRules.length} rules, and ${document} holds ${rules.length}; a twin holds the same rules`);
      continue;
    }
    rules.forEach((rule, index) => {
      const other = twinRules[index];
      if (other === undefined) return;
      const names = (enforced: string | null) => (enforced === null || /^none\b/.test(enforced) ? 'none' : [...checksOf(enforced).map(check => `\`${check}\``), ...plannedOf(enforced).map(item => `planned ${item}`)].join(', '));
      if (names(other.enforced) !== names(rule.enforced)) findings.push(`${twin}:${other.line}: the rule names ${names(other.enforced)}, and ${document}:${rule.line} names ${names(rule.enforced)}; a twin names the same checks`);
    });
  }
  return { findings, unenforced, planned };
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const documents = process.argv.slice(2);
  const { findings, unenforced, planned } = checkRules(root, documents.length ? documents : DEFAULT_DOCUMENTS);
  for (const rule of unenforced) console.log(`[rules-check] not enforced by a tool: ${rule.file}:${rule.line}: ${rule.reason}`);
  for (const rule of planned) console.log(`[rules-check] enforced once ${rule.item} is done: ${rule.file}:${rule.line}`);
  for (const finding of findings) console.error(`[rules-check] ${finding}`);
  if (findings.length) {
    console.error(`[rules-check] ${findings.length} findings`);
    process.exit(1);
  }
  console.log(`[rules-check] every rule names its check; ${unenforced.length} rules are enforced by no tool, ${planned.length} by planned items`);
}
