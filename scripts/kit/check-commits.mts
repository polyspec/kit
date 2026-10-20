#!/usr/bin/env node
// Checks commit messages against the commit rules of kit, COMMIT_RULES (`make commits-check`):
//
//   commit-subject   the first line is `type(scope): Subject (#id)` with a type of the rules, a scope of lower case
//                    letters, digits and hyphens, and an id of letters, digits, dots and hyphens
//   commit-subject-id the Subject holds no id ` (#…)` before the final id, which make commit adds (K380-1)
//   commit-capital   the Subject starts with a capital letter
//   commit-period    the Subject does not end with a period
//   commit-length    the Subject has at most `subjectMax` characters
//   commit-blank     a body follows the subject after a blank line
//   commit-width     a line of the body has at most `bodyMax` characters
//   commit-items     the commit changes the state of at most one item of the checklists of docs/plans; a row
//                    that the commit adds is not a change, so a commit may add items and sub-items
//   commit-changelog a commit that moves an item to the done state [o] also changes the changelog of the rules,
//                    CHANGELOG.md and its Korean twin
//
//   node scripts/kit/check-commits.mts [--range <base>..<head>]   the messages of the commits of the range (default: HEAD)
//   node scripts/kit/check-commits.mts --message <file>           the message being committed (the commit-msg hook)
//
// A commit of a range is compared with its parent; the message being committed, with the index against HEAD. The item rules
// read the checklists of the plan folders at each side of the change (checklist.mts). A merge commit keeps the message that Git writes and is not checked. Each finding is one line
// `<commit>: <rule>: <message>`; the command exits with status 1 when there is one. The pre-push hook (push-gate.mts) reads the
// same findings of the commits that a push sends, through `logMessages` and `findingLines`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isMain, repositoryRoot } from './paths.mts';
import { DONE, loadConfig, PLANS, readChecklist, trackersOf, workingPlanFiles } from './checklist.mts';
import { git, gitResult } from './git.mts';
import { HANGUL } from './language-check.mts';
import { gateCommands, kitGates, provesRed } from './gate-red.mts';
import { itemCommands } from './verification.mts';

/** The rules of a commit: the types of its subject, the limits of its lines, and the changelog that a done item changes. */
export type CommitRules = {
  types: string[];
  subjectMax: number;
  bodyMax: number;
  changelog?: { path: string; translation?: string };
};

/**
 * The commit rules of every repository (K243): one set, stated once, so no repository declares its own. The types are those
 * of PRINCIPLES.md, the Subject has at most 50 characters and a line of the body at most 72, and a done item changes the
 * changelog in both languages.
 */
export const COMMIT_RULES: CommitRules = {
  types: ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'],
  subjectMax: 50,
  bodyMax: 72,
  changelog: { path: 'CHANGELOG.md', translation: 'CHANGELOG.ko.md' },
};

/** A finding of a commit message or change. */
export type CommitFinding = { rule: string; message: string };

/** A commit as `logMessages` reads it. */
export type CommitMessage = { id: string; message: string; author?: string; committer?: string };

/**
 * The two sides of a change: a reader of a checklist file before and after it, the paths it touches and the paths of the plan
 * files at both sides.
 */
export type Change = { before: (file: string) => string; after: (file: string) => string; changed: string[]; plans: string[]; message?: string; parent?: string | undefined; changedLines?: (file: string) => number[] };


// A footer that names an AI tool as a co-author or a session, or says that one generated the commit (K264).
const AI_FOOTER = /^(?:co-authored-by:.*\b(?:claude|anthropic|copilot|chatgpt|openai|gemini)\b|claude-session:|.*generated (?:with|by) \[?claude code)/i;

// An identity that names an AI tool, by its name or its address (K265).
const AI_IDENTITY = /\b(?:claude|anthropic|copilot|chatgpt|openai|gemini)\b/i;

/** The finding of the identity `ident` (`Name <address>`) of the `role` of a commit when it is an AI tool (K265). */
export function identityFindings(ident: string, role: 'author' | 'committer'): CommitFinding[] {
  return AI_IDENTITY.test(ident) ? [{ rule: 'commit-ai-identity', message: `the ${role} ${ident} is an AI tool; the account of a commit is a person (K265). Fix: set user.name and user.email of the clone` }] : [];
}

/** The findings of the author and the committer that git gives the next commit of `root` (`git var`). */
export function nextIdentityFindings(root: string): CommitFinding[] {
  const ident = (name: string) => git(root, 'var', name).replace(/ [0-9]+ [+-][0-9]{4}\n?$/, '').trim();
  return [...identityFindings(ident('GIT_AUTHOR_IDENT'), 'author'), ...identityFindings(ident('GIT_COMMITTER_IDENT'), 'committer')];
}

/** The findings of a commit `message` as `{ rule, message }`. */
export function messageFindings(message: string, config: CommitRules) {
  const lines = message.replace(/\s+$/, '').split('\n');
  const subject = lines[0] ?? '';
  const found: CommitFinding[] = [];
  const pattern = new RegExp(`^(?:${config.types.join('|')})\\([a-z0-9-]+\\): (\\S.*) \\(#[A-Za-z0-9][A-Za-z0-9.-]*\\)$`);
  const description = pattern.exec(subject)?.[1];
  if (description === undefined) {
    found.push({ rule: 'commit-subject', message: `the subject is ${JSON.stringify(subject)}; expected "type(scope): Subject (#id)" with a type of ${config.types.join(', ')}` });
  } else {
    // make commit adds the id after the Subject, so a Subject that holds an id before it doubles the id (K380-1).
    if (/ \(#[^)]+\)/.test(description)) found.push({ rule: 'commit-subject-id', message: `the Subject ${JSON.stringify(description)} holds an id (#…); make commit adds the id of the item after the Subject, so remove the id from the Subject` });
    if (!/^[A-Z]/.test(description)) found.push({ rule: 'commit-capital', message: `the Subject ${JSON.stringify(description)} does not start with a capital letter` });
    if (description.endsWith('.')) found.push({ rule: 'commit-period', message: `the Subject ${JSON.stringify(description)} ends with a period; remove it` });
    if (description.length > config.subjectMax) found.push({ rule: 'commit-length', message: `the Subject has ${description.length} characters; expected at most ${config.subjectMax}` });
  }
  if (lines.length > 1 && lines[1] !== '') found.push({ rule: 'commit-blank', message: 'the line after the subject is not blank; leave a blank line before the body' });
  const korean = lines.findIndex(line => HANGUL.test(line));
  if (korean !== -1) found.push({ rule: 'commit-language', message: `line ${korean + 1} of the message holds Hangul; a commit message is English (K252)` });
  const footer = lines.findIndex(line => AI_FOOTER.test(line));
  if (footer !== -1) found.push({ rule: 'commit-ai-footer', message: `line ${footer + 1} of the message is the footer of an AI tool; git holds no co-author or session trailer of one (K264). Fix: remove the line` });
  lines.slice(2).forEach((line, index) => {
    if (line.length > config.bodyMax && /\s/.test(line.trim())) {
      found.push({ rule: 'commit-width', message: `line ${index + 3} of the message has ${line.length} characters; expected at most ${config.bodyMax}; wrap the body` });
    }
  });
  return found;
}

// The paths of the plan files at the revision `rev` (`''` is the index), from which trackersOf finds the checklists.
const plansAt = (root: string, rev: string) => (rev === '' ? git(root, 'ls-files', '--cached', '--', PLANS) : git(root, 'ls-tree', '-r', '--name-only', rev, '--', PLANS)).split('\n').filter(Boolean);

// The text of `file` at the revision `rev` (`:` alone is the index); empty when the revision has no such file. Whether it
// has the file is read from git ls-tree (ls-files for the index); any failure of git show then throws.
export const fileAt = (root: string, rev: string, file: string) => {
  const listed = rev === '' ? git(root, 'ls-files', '--cached', '--', file) : git(root, 'ls-tree', '--name-only', rev, '--', file);
  if (listed.trim() === '') return '';
  const shown = gitResult(root, 'show', `${rev}:${file}`);
  if (shown.error || shown.status !== 0) throw new Error(`git show ${rev}:${file} failed: ${shown.error?.message ?? shown.stderr.trim()}`);
  return shown.stdout;
};

// A test file of a runner that kit fixes (S3): a file below a tests/ folder, a *.test.* or *.spec.* file of node and
// vitest, a *_test.go file, a test_*.py or *_test.py file and a *Test.php file. The Rust unit tests are read by changesATest (K370).
const TEST_FILE = /(?:^|\/)tests?\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.go$|(?:^|\/)test_[^/]*\.py$|_test\.py$|Test\.php$/;
const TEST_FILES = 'tests/, *.test.*, *_test.go, test_*.py, *Test.php, tests.rs, #[cfg(test)] or #[test] code of *.rs';

/** Whether `file` is a test file of a runner that kit fixes. */
export const isTestFile = (file: string) => TEST_FILE.test(file);

/**
 * The 1-based line numbers of the Rust test code of `text` (K370): the lines from one that starts with `#[cfg(test)]` or
 * `#[test]` through the line where the brace depth comes back to its level before the first `{` after the attribute. Braces
 * of string literals, char literals and comments do not count. Not read: raw strings (r#"…"#), whose quotes are taken as the
 * quotes of a plain string, and an attribute on an item without braces (`mod tests;`), which lasts to the next block.
 */
export function rustTestLines(text: string): Set<number> {
  const lines = new Set<number>();
  let depth = 0;
  let region: { base?: number } | undefined;
  let block = false;
  let quote: '"' | "'" | undefined;
  text.split('\n').forEach((line, index) => {
    if (region === undefined && /^\s*#\[(?:cfg\(test\)|test)\]/.test(line)) region = {};
    let ended = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];
      if (block) {
        if (char === '*' && next === '/') {
          block = false;
          i++;
        }
      } else if (quote !== undefined) {
        if (char === '\\') i++;
        else if (char === quote) quote = undefined;
      } else if (char === '/' && next === '/') {
        break;
      } else if (char === '/' && next === '*') {
        block = true;
        i++;
      } else if (char === '"') {
        quote = '"';
      } else if (char === "'") {
        if (next === '\\') quote = "'";
        else if (line[i + 2] === "'") i += 2;
      } else if (char === '{') {
        if (region && region.base === undefined) region.base = depth;
        depth++;
      } else if (char === '}') {
        depth--;
        if (region?.base === depth) ended = true;
      }
    }
    if (region !== undefined) lines.add(index + 1);
    if (ended) region = undefined;
    if (quote === "'") quote = undefined;
  });
  return lines;
}

/**
 * The 1-based line numbers that a `git diff -U0` text of one file adds or changes on its new side (K370): a hunk header
 * `@@ -a,b +c,d @@` names the lines c..c+d-1, d being 1 when it is left out; a hunk that only deletes lines (d is 0) names the line c.
 */
export function changedLineNumbers(diff: string): number[] {
  return [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].flatMap(([, start = '1', count = '1']) => {
    const first = Number(start);
    return Array.from({ length: Math.max(Number(count), 1) }, (_, offset) => first + offset);
  });
}

/**
 * Whether the change of `file` is a test (K370): a test file of isTestFile, a tests.rs file, or a .rs file with a changed line
 * inside its Rust test code (rustTestLines). `after` reads the file at the side of the commit and `changedLines` its changed lines.
 */
export function changesATest(file: string, after: (file: string) => string, changedLines: (file: string) => number[]): boolean {
  if (isTestFile(file)) return true;
  if (!file.endsWith('.rs')) return false;
  if (path.posix.basename(file) === 'tests.rs') return true;
  const regions = rustTestLines(after(file));
  return changedLines(file).some(line => regions.has(line));
}

/**
 * The item findings of one change as `{ rule, message }`: `before` and `after` read a checklist file at the two sides of the
 * change, `changed` holds the paths that the change touches, and `message`, when given, is the message of the commit, whose
 * type fix needs a changed test file (K257).
 */
export function itemFindings(root: string, config: CommitRules, { before, after, changed, plans, message, parent, changedLines = () => [] }: Change) {
  const changes = [];
  for (const tracker of trackersOf(loadConfig(root), new Set(plans))) {
    const states = (text: string) => new Map(readChecklist(text, tracker).items.map(item => [item.id, item.state]));
    const old = states(before(tracker.path));
    for (const [id, state] of states(after(tracker.path))) {
      if (old.has(id) && old.get(id) !== state) changes.push({ id, from: old.get(id), to: state, tracker });
    }
  }
  const found: CommitFinding[] = [];
  if (changes.length > 1) {
    const listed = changes.map(change => `${change.id} ${change.from} → ${change.to}`).join(', ');
    found.push({ rule: 'commit-items', message: `the commit changes the state of ${changes.length} items (${listed}); change one item per commit` });
  }
  const changelog = config.changelog ? [config.changelog.path, ...(config.changelog.translation ? [config.changelog.translation] : [])] : [];
  for (const change of changes.filter(entry => entry.to === DONE)) {
    for (const file of changelog.filter(entry => !changed.includes(entry))) {
      found.push({ rule: 'commit-changelog', message: `the commit moves ${change.id} to ${change.to} in ${change.tracker.path} but does not change ${file}; record the item in the changelog of both languages` });
    }
  }
  if (message !== undefined && message.startsWith('fix(') && !changed.some(file => changesATest(file, after, changedLines))) {
    // A defect that a gate of kit-gates finds has the gate as its test: the red of the gate on the parent proves it (K357).
    const id = /\(#([A-Za-z0-9][A-Za-z0-9.-]*)\)$/.exec(message.split('\n')[0] ?? '')?.[1];
    const done = changes.find(change => change.id === id && change.to === DONE);
    const gates = () => (done ? gateCommands(itemCommands(after(done.tracker.path), done.tracker, done.id), kitGates(root)) : []);
    if (parent === undefined || !provesRed(message, gates, parent)) {
      found.push({ rule: 'commit-fix-test', message: `the fix commit changes no test file (${TEST_FILES}); a fix starts with a test that reproduces the defect, or, for a finding of a gate of kit-gates that the Verification of its row runs, with the red of the gate on the parent: make item-state records it as the item becomes active on a clean tree, and make commit writes it as a Red-Gate line of the commit that moves the item to done (K357)` });
    }
  }
  return found;
}

// The empty tree of git, the parent of a root commit (K370).
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The item findings of the commit `id` against its parent; a root commit is compared with an empty tree. */
const commitItemFindings = (root: string, config: CommitRules, id: string, message: string) => {
  const parent = gitResult(root, 'rev-parse', '--verify', '--quiet', `${id}^`).status === 0 ? `${id}^` : null;
  return itemFindings(root, config, {
    before: file => (parent ? fileAt(root, parent, file) : ''),
    after: file => fileAt(root, id, file),
    changed: git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', id).split('\n').filter(Boolean),
    plans: [...(parent ? plansAt(root, parent) : []), ...plansAt(root, id)],
    message,
    parent: parent ? git(root, 'rev-parse', parent).trim() : undefined,
    changedLines: file => changedLineNumbers(git(root, 'diff', '-U0', parent ?? EMPTY_TREE, id, '--', file)),
  });
};

/** The item findings of the change being committed with `message`: the index against HEAD. */
export function indexItemFindings(root: string, config: CommitRules, message: string) {
  const head = gitResult(root, 'rev-parse', '--verify', '--quiet', 'HEAD').status === 0;
  return itemFindings(root, config, {
    before: file => (head ? fileAt(root, 'HEAD', file) : ''),
    after: file => fileAt(root, '', file),
    changed: git(root, 'diff', '--cached', '--name-only').split('\n').filter(Boolean),
    plans: [...(head ? plansAt(root, 'HEAD') : []), ...plansAt(root, '')],
    message,
    parent: head ? git(root, 'rev-parse', 'HEAD').trim() : undefined,
    changedLines: file => changedLineNumbers(git(root, 'diff', '--cached', '-U0', '--', file)),
  });
}

/**
 * The item findings of a commit of the working tree with `files` ({ path: text }) written over it, against HEAD: what the
 * commit-msg hook would refuse once these files and the other changes of the working tree are committed (K249-2).
 */
export function workingItemFindings(root: string, config: CommitRules, files: Record<string, string>) {
  const head = gitResult(root, 'rev-parse', '--verify', '--quiet', 'HEAD').status === 0;
  const lines = (text: string) => text.split('\n').filter(Boolean);
  const changed = new Set([...(head ? lines(git(root, 'diff', '--name-only', 'HEAD')) : []), ...lines(git(root, 'ls-files', '--others', '--exclude-standard')), ...Object.keys(files)]);
  return itemFindings(root, config, {
    before: file => (head ? fileAt(root, 'HEAD', file) : ''),
    after: file => files[file] ?? (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : ''),
    changed: [...changed],
    plans: [...(head ? plansAt(root, 'HEAD') : []), ...workingPlanFiles(root)],
  });
}

/** The message of a commit-msg file: without the comment lines that Git removes; null for a merge commit. */
export function fileMessage(text: string) {
  const message = text.split('\n').filter(line => !line.startsWith('#')).join('\n').replace(/^\n+/, '');
  return message.startsWith('Merge ') ? null : message;
}

/**
 * The commits that `git log` selects with `args` in `root`, without merge commits, as `{ id, message }`; `label` names the
 * selection in the failure.
 */
export function logMessages(root: string, args: string[], label: string): CommitMessage[] {
  let output: string;
  try {
    output = git(root, 'log', '--no-merges', '--format=%h%x1f%an <%ae>%x1f%cn <%ce>%x1f%B%x1e', ...args);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // git fails with a Stop, which is an Error.
    throw new Error(`the range ${label} does not resolve in this checkout: ${error.message.split('\n')[0]}; fetch its commits or give a range of commits that this checkout holds`);
  }
  return output.split('\x1e').map(entry => entry.replace(/^\n/, '')).filter(Boolean).map((entry) => {
    const [id = '', author = '', committer = '', ...message] = entry.split('\x1f');
    return { id, author, committer, message: message.join('\x1f') };
  });
}

// A side of a range is a ref: no space, no '..', and no dot at its start or its end, as git check-ref-format holds; a dot inside
// it belongs to the ref, as in the branch fix/name-T2.60 of a row id (K402).
const RANGE_SIDE = /^(?!\.)(?!.*\.\.)\S*[^\s.]$/;

/** The commits of `range` (`<base>..<head>`, or `HEAD` alone) in `root`, without merge commits, as `{ id, message }`. */
export function rangeMessages(root: string, range: string) {
  const sides = range.split('..');
  if (range !== 'HEAD' && !(sides.length === 2 && sides.every(side => RANGE_SIDE.test(side)))) {
    throw new Error(`the range "${range}" is not <base>..<head>; give the two commits of the range, such as origin/main..HEAD`);
  }
  return logMessages(root, range === 'HEAD' ? ['--max-count=1', 'HEAD'] : [range], range);
}

/** The findings of the commits `commits` (from `logMessages`) as lines `<commit>: <rule>: <message>`. */
export function findingLines(root: string, commits: CommitMessage[], config: CommitRules) {
  return commits.flatMap(({ id, message, author, committer }) => [
    ...messageFindings(message, config),
    ...(author === undefined ? [] : identityFindings(author, 'author')),
    ...(committer === undefined ? [] : identityFindings(committer, 'committer')),
    ...commitItemFindings(root, config, id, message),
  ].map(found => `${id}: ${found.rule}: ${found.message}`));
}

/** The findings of the commits of `range` as lines `<commit>: <rule>: <message>`. */
export function rangeFindings(root: string, range: string, config: CommitRules) {
  return findingLines(root, rangeMessages(root, range), config);
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const { values } = parseArgs({ options: { range: { type: 'string' }, message: { type: 'string' } } });
  let findings: string[];
  let label: string;
  try {
    const config = COMMIT_RULES;
    if (values.message !== undefined) {
      const message = fileMessage(readFileSync(values.message, 'utf8'));
      label = 'the message being committed';
      findings = message === null ? [] : [...messageFindings(message, config), ...nextIdentityFindings(root), ...indexItemFindings(root, config, message)].map(found => `${found.rule}: ${found.message}`);
    } else {
      label = `the commits of ${values.range ?? 'HEAD'}`;
      console.log(`[check-commits] reading ${label}`);
      findings = rangeFindings(root, values.range ?? 'HEAD', config);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // The rules, the files and git fail with an Error.
    console.error(`[check-commits] ${error.message}`);
    process.exit(1);
  }
  for (const line of findings) console.error(`[check-commits] ${line}`);
  if (findings.length) {
    console.error(`[check-commits] ${findings.length} findings in ${label} (the commit rules of kit)`);
    process.exit(1);
  }
  console.log(`[check-commits] ${label} passed`);
}
