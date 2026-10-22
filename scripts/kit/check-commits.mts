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
//   commit-deleted-test a commit that deletes a test file has a line `Replaced-By: <path>` that names a tracked test file
//                    of its tree, the test that covers the same requirement (K339)
//   commit-row       the id of the subject is an item of a checklist of docs/plans in the tree of the commit (the index for the hook);
//                    the first commit of a repository passes
//   row-id           on a branch, no row of the index holds an ID that main holds with another task, unless the ID is the row
//                    of the branch itself; the finding names the next free ID (K497)
//   commit-identity  when config/commit-identity.json exists, the author and the committer are the identity that it
//                    declares (K405)
//   commit-generated the paths that a commit adds, copies, modifies or renames have no generated segment that the
//                    config/generated.json of its tree does not declare: the staged check of generated-files.mts, read per commit
//   commit-twin      a Korean twin that a commit changes or leaves stale holds the source-sha256 of its English file in the
//                    tree of the commit: the staged check of check-documents.mts (K382), read per commit
//
//   node scripts/kit/check-commits.mts [--range <base>..<head>]   the messages of the commits of the range (default: HEAD)
//   node scripts/kit/check-commits.mts --message <file>           the message being committed (the commit-msg hook)
//   node scripts/kit/check-commits.mts --prepare --source=<s> --sha=<sha>   the record of an amend, from the prepare-commit-msg hook (K380-2)
//   node scripts/kit/check-commits.mts --commit-gates   the gates of land on the staged tree of a commit on main, from the pre-commit hook (K404-1)
//   node scripts/kit/check-commits.mts --merge-commit   refuses a merge commit on main, from the pre-merge-commit hook (K404-1)
//
// A commit of a range is compared with its parent; the message being committed, with the index against HEAD, or against the parent
// of HEAD when the commit amends it (K380-2). The item rules
// read the checklists of the plan folders at each side of the change (checklist.mts). A merge commit keeps the message that Git writes and is not checked. Each finding is one line
// `<commit>: <rule>: <message>`; the command exits with status 1 when there is one. The pre-push hook (push-gate.mts) reads the
// message and identity findings of the commits that a push sends, through `logMessages` and `messageLines` (K510).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isMain, repositoryRoot } from './paths.mts';
import { DONE, loadConfig, PLANS, readChecklist, trackersOf, workingPlanFiles } from './checklist.mts';
import { fileAt, git, gitResult } from './git.mts';
import { HANGUL } from './language-check.mts';
import { gitIsAncestor, provesRed } from './gate-red.mts';
import { runCommitGates } from './land.mts';
import { clashMessage, rowClashes } from './row-ids.mts';
import { blobContent, CONFIG as GENERATED_CONFIG, generatedFindings } from './generated-files.mts';
import type { GeneratedConfig } from './generated-files.mts';
import { CONFIG as DOCUMENTS_CONFIG, twinFindings } from './check-documents.mts';
import type { DocumentsConfig } from './check-documents.mts';
import { parseJson, readConfig } from './schema-validate.mts';
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
export type Change = { before: (file: string) => string; after: (file: string) => string; changed: string[]; plans: string[]; message?: string; parent?: string | undefined; changedLines?: (file: string) => number[]; deleted?: string[]; tracked?: (file: string) => boolean };


// A footer that names an AI tool as a co-author or a session, or says that one generated the commit (K264).
const AI_FOOTER = /^(?:co-authored-by:.*\b(?:claude|anthropic|copilot|chatgpt|openai|gemini)\b|claude-session:|.*generated (?:with|by) \[?claude code)/i;

// An identity that names an AI tool, by its name or its address (K265).
const AI_IDENTITY = /\b(?:claude|anthropic|copilot|chatgpt|openai|gemini)\b/i;

/** The identity that config/commit-identity.json declares for the commits of the repository. */
export type CommitIdentity = { name: string; email: string };

const COMMIT_IDENTITY = 'config/commit-identity.json';

/** The identity of config/commit-identity.json of `root`; undefined when the repository declares none. */
export function declaredIdentity(root: string): CommitIdentity | undefined {
  return existsSync(path.join(root, COMMIT_IDENTITY)) ? readConfig<CommitIdentity>(root, COMMIT_IDENTITY, 'commit-identity.schema.json') : undefined;
}

/**
 * The findings of the identity `ident` (`Name <address>`) of the `role` of a commit: an AI tool (K265), and, when the repository
 * declares an identity, any other identity than `declared`.
 */
export function identityFindings(ident: string, role: 'author' | 'committer', declared?: CommitIdentity): CommitFinding[] {
  const found: CommitFinding[] = [];
  if (AI_IDENTITY.test(ident)) found.push({ rule: 'commit-ai-identity', message: `the ${role} ${ident} is an AI tool; the account of a commit is a person (K265). Fix: set user.name and user.email of the clone` });
  if (declared !== undefined && ident !== `${declared.name} <${declared.email}>`) {
    found.push({ rule: 'commit-identity', message: `the ${role} ${ident} is not the identity that config/commit-identity.json declares, ${declared.name} <${declared.email}> (K405). Fix: git config user.name "${declared.name}" and git config user.email "${declared.email}" of the clone` });
  }
  return found;
}

/** The findings of the author and the committer that git gives the next commit of `root` (`git var`). */
export function nextIdentityFindings(root: string): CommitFinding[] {
  const ident = (name: string) => git(root, 'var', name).replace(/ [0-9]+ [+-][0-9]{4}\n?$/, '').trim();
  const declared = declaredIdentity(root);
  return [...identityFindings(ident('GIT_AUTHOR_IDENT'), 'author', declared), ...identityFindings(ident('GIT_COMMITTER_IDENT'), 'committer', declared)];
}

/**
 * Whether a commit that `root` makes now lands on main, which holds a commit (K404-1): HEAD names main and main resolves. The first commit
 * of a repository creates main, which has no commit to compare the gates with, so it is not one (K404).
 */
export function isCommitOnMain(root: string): boolean {
  return gitResult(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').stdout.trim() === 'main' && gitResult(root, 'rev-parse', '--verify', '--quiet', 'refs/heads/main').status === 0;
}

/** The message of a merge commit on main that the pre-merge-commit hook refuses (K404-1, P38). */
export const MERGE_ON_MAIN = 'a merge commit on main is refused: main moves by commits and fast-forwards only (P38, K404-1). Land the branch with make land, or rebase it on main.';

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
  // A Red-Gate or Red-Test line holds a whole command of the Verification, which no wrap may split (K389).
  lines.slice(2).forEach((line, index) => {
    if (line.length > config.bodyMax && /\s/.test(line.trim()) && !/^Red-(?:Gate|Test): /.test(line)) {
      found.push({ rule: 'commit-width', message: `line ${index + 3} of the message has ${line.length} characters; expected at most ${config.bodyMax}; wrap the body` });
    }
  });
  return found;
}

// The paths of the plan files at the revision `rev` (`''` is the index), from which trackersOf finds the checklists.
const plansAt = (root: string, rev: string) => (rev === '' ? git(root, 'ls-files', '--cached', '--', PLANS) : git(root, 'ls-tree', '-r', '--name-only', rev, '--', PLANS)).split('\n').filter(Boolean);

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
export function itemFindings(root: string, config: CommitRules, { before, after, changed, plans, message, parent, changedLines = () => [], deleted = [], tracked = () => false }: Change) {
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
  if (message !== undefined && message.startsWith('fix(')) {
    // A fix that moves its item to done proves its red with a Red-Gate or Red-Test line: the command of the Verification of the row
    // failed on the parent, which item-state (a gate, K357) or item-red (a test, K389) recorded. Without such a fix's item, a fix
    // needs no proof when a test file changes.
    const id = /\(#([A-Za-z0-9][A-Za-z0-9.-]*)\)$/.exec(message.split('\n')[0] ?? '')?.[1];
    const done = changes.find(change => change.id === id && change.to === DONE);
    const commands = () => (done ? itemCommands(after(done.tracker.path), done.tracker, done.id) : []);
    const proven = parent !== undefined && provesRed(message, commands, parent, gitIsAncestor(root));
    if (done !== undefined && !proven) {
      found.push({ rule: 'commit-fix-test', message: `the fix commit moves ${done.id} to done without a Red-Gate or Red-Test line of a command of its Verification on the parent; the red is the failing run of the Verification before the fix: make item-red ID=${done.id} records it after the test is written, and make commit writes it` });
    } else if (done === undefined && !changed.some(file => changesATest(file, after, changedLines))) {
      found.push({ rule: 'commit-fix-test', message: `the fix commit changes no test file (${TEST_FILES}); a fix starts with a test that reproduces the defect, or, for a finding of a gate of kit-gates that the Verification of its row runs, with the red of the gate on the parent: make item-state records it as the item becomes active on a clean tree, and make commit writes it as a Red-Gate line of the commit that moves the item to done (K357)` });
    }
  }
  // A commit that deletes a test file names the test that replaces it, one that covers the same requirement (K339).
  if (message !== undefined && deleted.length > 0 && ![...message.matchAll(/^Replaced-By: (\S+)$/gm)].some(([, file = '']) => isTestFile(file) && tracked(file))) {
    found.push({ rule: 'commit-deleted-test', message: `the commit deletes the test file ${deleted.join(', ')} and its body names no replacement; add a line Replaced-By: <path of a tracked test file that covers the same requirement> (${TEST_FILES})` });
  }
  return found;
}

// Whether `file` is a tracked file of the revision `rev` (`''` is the index): the exact path, not a pattern that the path names.
const trackedAt = (root: string, rev: string, file: string) => (rev === '' ? git(root, 'ls-files', '--cached') : git(root, 'ls-tree', '-r', '--name-only', rev)).split('\n').includes(file);

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
    deleted: git(root, 'diff-tree', '--no-commit-id', '--name-only', '--no-renames', '--diff-filter=D', '-r', id).split('\n').filter(isTestFile),
    tracked: file => trackedAt(root, id, file),
  });
};

/**
 * The finding of the row that the subject of `message` names (K424): the id of the subject is an item of a checklist of docs/plans
 * in the tree `rev` (`''` is the index). A subject without an id is a commit-subject finding, so it has none here.
 */
const rowFindings = (root: string, message: string, rev: string): CommitFinding[] => {
  const id = /\(#([A-Za-z0-9][A-Za-z0-9.-]*)\)$/.exec((message.split('\n')[0] ?? '').trimEnd())?.[1];
  if (id === undefined) return [];
  const known = new Set(trackersOf(loadConfig(root), plansAt(root, rev)).flatMap(tracker => readChecklist(fileAt(root, rev, tracker.path), tracker).items.map(item => item.id)));
  return known.has(id) ? [] : [{ rule: 'commit-row', message: `the subject names ${id}, which is no item of a checklist of docs/plans in the tree of the commit; register the row first with make item-new` }];
};

/** The row finding of the commit `id`; a root commit is the first commit of a repository, which has no parent and passes. */
const commitRowFindings = (root: string, id: string, message: string) => (gitResult(root, 'rev-parse', '--verify', '--quiet', `${id}^`).status === 0 ? rowFindings(root, message, id) : []);

/** The sha of the commit that `rev` names in `root`; undefined when it names none, as an unborn HEAD or the parent of a root commit. */
const commitOf = (root: string, rev: string) => {
  const run = gitResult(root, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  return run.status === 0 ? run.stdout.trim() : undefined;
};

/**
 * The item findings of the change being committed with `message`: the index against HEAD, or, for an amend (K380-2), against the
 * parent of HEAD, since the commit that the amend makes replaces HEAD. A root commit has no parent, so the empty tree.
 */
/**
 * The commit-type finding of a docs or chore commit that stages code, a test, a recipe or a script (K449): such a change is a fix or
 * a feat with its own type, staged alone, so a documents commit names only documents.
 */
const CODE_PATH = /^(?:scripts|src|tests|packages)\/|\.(?:mts|ts|go|php|py|rs)$|(?:^|\/)Makefile$|\.mk$/;
export function typeFindings(message: string, staged: readonly string[]): CommitFinding[] {
  const type = /^(docs|chore)\(/.exec(message.split('\n')[0] ?? '')?.[1];
  const code = staged.filter(file => CODE_PATH.test(file));
  if (type === undefined || code.length === 0) return [];
  return [{ rule: 'commit-type', message: `a ${type} commit stages code, a test or a recipe (${code.join(', ')}); stage the fix alone and commit it with its own type, such as fix or feat (K449)` }];
}

export function indexItemFindings(root: string, config: CommitRules, message: string, amend = false) {
  const base = commitOf(root, amend ? 'HEAD^' : 'HEAD');
  const against = base ?? EMPTY_TREE;
  const staged = git(root, 'diff', '--cached', '--name-only', against).split('\n').filter(Boolean);
  const found = [...typeFindings(message, staged), ...itemFindings(root, config, {
    before: file => (base ? fileAt(root, base, file) : ''),
    after: file => fileAt(root, '', file),
    changed: git(root, 'diff', '--cached', '--name-only', against).split('\n').filter(Boolean),
    plans: [...(base ? plansAt(root, base) : []), ...plansAt(root, '')],
    message,
    parent: base,
    changedLines: file => changedLineNumbers(git(root, 'diff', '--cached', '-U0', against, '--', file)),
    deleted: git(root, 'diff', '--cached', '--name-only', '--no-renames', '--diff-filter=D', against).split('\n').filter(isTestFile),
    tracked: file => trackedAt(root, '', file),
  })];
  // The first commit of a repository has no HEAD, so it has no base and passes.
  if (base === undefined) return found;
  // K497: on a branch, a row of the index whose ID main holds with another task is refused.
  const branch = gitResult(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').stdout.trim();
  const ids: CommitFinding[] = branch === '' ? [] : rowClashes(root, '', branch).map(clash => ({ rule: 'row-id', message: clashMessage(clash) }));
  return [...found, ...rowFindings(root, message, ''), ...ids];
}

/** The file of the amend record of `root`, which the git directory of its worktree holds (K380-2). */
const amendRecord = (root: string) => path.resolve(root, gitResult(root, 'rev-parse', '--git-path', 'kit-amend').stdout.trim());

/**
 * Records an amend for the commit-msg check (K380-2), from the arguments that git gives the prepare-commit-msg hook: an amend gives the
 * commit `source` `commit` and the sha `HEAD`, and the record holds the sha that HEAD names. Any other commit removes the record.
 */
export function recordAmend(root: string, source: string, sha: string) {
  const file = amendRecord(root);
  const head = commitOf(root, 'HEAD');
  if (source === 'commit' && sha !== '' && head !== undefined && commitOf(root, sha) === head) writeFileSync(file, `${head}\n`);
  else rmSync(file, { force: true });
}

/**
 * Whether the commit being made replaces HEAD (K380-2): the record that recordAmend wrote names the current HEAD. The record is removed
 * either way, so a record that names another HEAD is stale and ignored.
 */
export function takeAmend(root: string) {
  const file = amendRecord(root);
  if (!existsSync(file)) return false;
  const named = readFileSync(file, 'utf8').trim();
  rmSync(file, { force: true });
  return named !== '' && named === commitOf(root, 'HEAD');
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
    throw new Error(`the range ${label} does not resolve in this checkout: ${error.message.split('\n')[0]}; fetch its commits or give a range of commits that this checkout holds`, { cause: error });
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

/**
 * The findings of the commit `id` that the staged checks of the pre-commit hook make of the index (K351): the paths that the commit
 * adds, copies, modifies or renames, read against config/generated.json and config/documents.json of its tree; a tree without one of
 * the two configs has no check of it.
 */
const commitStateFindings = (root: string, id: string): CommitFinding[] => {
  const changed = git(root, 'diff-tree', '--no-commit-id', '--name-only', '--diff-filter=ACMR', '-r', '-z', '--root', id).split('\0').filter(Boolean);
  const tracked = new Set(git(root, 'ls-tree', '-r', '--name-only', id).split('\n'));
  const found: CommitFinding[] = [];
  if (tracked.has(GENERATED_CONFIG)) {
    const config = parseJson<GeneratedConfig>(fileAt(root, id, GENERATED_CONFIG), 'generated.schema.json', `${GENERATED_CONFIG} at ${id}`);
    found.push(...generatedFindings(changed, config, 'remove it from the commit', file => blobContent(root, id, file)).map(message => ({ rule: 'commit-generated', message })));
  }
  if (tracked.has(DOCUMENTS_CONFIG)) {
    const config = parseJson<DocumentsConfig>(fileAt(root, id, DOCUMENTS_CONFIG), 'documents.schema.json', `${DOCUMENTS_CONFIG} at ${id}`);
    found.push(...twinFindings(config, changed, file => fileAt(root, id, file), file => tracked.has(file)).map(message => ({ rule: 'commit-twin', message })));
  }
  return found;
};

/** The findings of the commits `commits` (from `logMessages`) as lines `<commit>: <rule>: <message>`. */
export function findingLines(root: string, commits: CommitMessage[], config: CommitRules) {
  const declared = declaredIdentity(root);
  return commits.flatMap(({ id, message, author, committer }) => [
    ...messageFindings(message, config),
    ...(author === undefined ? [] : identityFindings(author, 'author', declared)),
    ...(committer === undefined ? [] : identityFindings(committer, 'committer', declared)),
    ...commitItemFindings(root, config, id, message),
    ...commitRowFindings(root, id, message),
    ...commitStateFindings(root, id),
  ].map(found => `${id}: ${found.rule}: ${found.message}`));
}

/**
 * The message and identity findings of the commits `commits` as lines `<commit>: <rule>: <message>` (K510): what the push gate checks of
 * each pushed commit. The item, row and twin rules of a commit are the commit-msg hook's and land's commits-check, which ran on it.
 */
export function messageLines(root: string, commits: CommitMessage[], config: CommitRules) {
  const declared = declaredIdentity(root);
  return commits.flatMap(({ id, message, author, committer }) => [
    ...messageFindings(message, config),
    ...(author === undefined ? [] : identityFindings(author, 'author', declared)),
    ...(committer === undefined ? [] : identityFindings(committer, 'committer', declared)),
  ].map(found => `${id}: ${found.rule}: ${found.message}`));
}

/** The findings of the commits of `range` as lines `<commit>: <rule>: <message>`. */
export function rangeFindings(root: string, range: string, config: CommitRules) {
  return findingLines(root, rangeMessages(root, range), config);
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const { values } = parseArgs({ options: { range: { type: 'string' }, message: { type: 'string' }, prepare: { type: 'boolean' }, source: { type: 'string' }, sha: { type: 'string' }, 'commit-gates': { type: 'boolean' }, 'merge-commit': { type: 'boolean' } } });
  let findings: string[];
  let label: string;
  try {
    const config = COMMIT_RULES;
    if (values.prepare) {
      recordAmend(root, values.source ?? '', values.sha ?? '');
      process.exit(0);
    }
    if (values['commit-gates']) {
      if (isCommitOnMain(root)) {
        runCommitGates(root, git(root, 'diff', '--cached', '--name-only').split('\n').filter(file => file !== ''), text => console.log(`[check-commits] ${text}`));
      }
      process.exit(0);
    }
    if (values['merge-commit']) {
      if (gitResult(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').stdout.trim() === 'main') throw new Error(MERGE_ON_MAIN);
      process.exit(0);
    }
    if (values.message !== undefined) {
      const amend = takeAmend(root);
      const message = fileMessage(readFileSync(values.message, 'utf8'));
      label = 'the message being committed';
      findings = message === null ? [] : [...messageFindings(message, config), ...nextIdentityFindings(root), ...indexItemFindings(root, config, message, amend)].map(found => `${found.rule}: ${found.message}`);
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
