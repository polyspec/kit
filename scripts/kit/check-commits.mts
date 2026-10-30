#!/usr/bin/env node
// The commit rules of kit, which the commit-msg hook and make commit check on the message being committed (K264, K265, K624):
//
//   commit-ai-footer   the message holds no co-author or session trailer of an AI tool (K264)
//   commit-ai-identity no AI tool is the author or the committer (K265)
//   commit-red         a commit that moves a row to done states Red: <command> exit <n>, or No-Red: <reason> (K624, K875)
//   commit-fix-test    a fix commit changes a test file, or states its red (K257)
//
//   node scripts/kit/check-commits.mts --message <file>           the message rules of the message being committed (the commit-msg hook)
//   node scripts/kit/check-commits.mts --range <base>..<head>     the diff rules of each finished commit of the range (make land)
//
// The diff rules, commit-red and commit-fix-test, judge a finished commit against its parent (K892): an unfinished commit has no
// change that is known, since an amend replaces HEAD and git names no amend to a hook. make commit, which never amends, judges the
// index against HEAD. Each finding is one line `<rule>: <message>`; the command exits with status 1 when there is one.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isMain, repositoryRoot } from './paths.mts';
import { DONE, loadConfig, PLANS, readChecklist, trackersOf } from './checklist.mts';
import { fileAt, git, gitResult } from './git.mts';

/** The rules of a commit: the types of its subject, the width of its body, and the changelog that a done item changes. */
export type CommitRules = {
  types: string[];
  bodyMax: number;
  changelog?: { path: string; translation?: string };
};

/** The commit rules of every repository (K243): the types of PRINCIPLES.md, the width that make commit wraps the body to, and the changelog in both languages. */
export const COMMIT_RULES: CommitRules = {
  types: ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'],
  bodyMax: 72,
  changelog: { path: 'CHANGELOG.md', translation: 'CHANGELOG.ko.md' },
};

/** A finding of a commit message or change. */
export type CommitFinding = { rule: string; message: string };

// A footer that names an AI tool as a co-author or a session, or says that one generated the commit (K264).
const AI_FOOTER = /^(?:co-authored-by:.*\b(?:claude|anthropic|copilot|chatgpt|openai|gemini)\b|claude-session:|.*generated (?:with|by) \[?claude code)/i;

// An identity that names an AI tool, by its name or its address (K265).
const AI_IDENTITY = /\b(?:claude|anthropic|copilot|chatgpt|openai|gemini)\b/i;

/** The finding of the identity `ident` (`Name <address>`) of the `role` of a commit that names an AI tool (K265). */
export function identityFindings(ident: string, role: 'author' | 'committer'): CommitFinding[] {
  return AI_IDENTITY.test(ident) ? [{ rule: 'commit-ai-identity', message: `the ${role} ${ident} is an AI tool; the account of a commit is a person (K265). Fix: set user.name and user.email of the clone` }] : [];
}

/** The red that `message` states (K624): `red` for a Red line (Red-Gate and Red-Test of earlier commits included), `no-red` for a
 * No-Red line with a reason, or undefined. The command and its exit status stay true after land rebases the branch, so a sha of the
 * red is optional (K875). */
export function statedRed(message: string): 'red' | 'no-red' | undefined {
  const continued = message.replace(/\\\r?\n[ \t]*/g, ' ');
  if (/^Red(?:-Gate|-Test)?: \S.* exit [1-9]\d*(?: at [0-9a-f]{7,40})?$/m.test(continued)) return 'red';
  if (/^No-Red: \S/m.test(message)) return 'no-red';
  return undefined;
}

/** The findings of the author and the committer that git gives the next commit of `root` (`git var`). */
export function nextIdentityFindings(root: string): CommitFinding[] {
  const ident = (name: string) => git(root, 'var', name).replace(/ [0-9]+ [+-][0-9]{4}\n?$/, '').trim();
  return [...identityFindings(ident('GIT_AUTHOR_IDENT'), 'author'), ...identityFindings(ident('GIT_COMMITTER_IDENT'), 'committer')];
}

/** The finding of a commit `message` that holds the footer of an AI tool (K264). */
export function messageFindings(message: string): CommitFinding[] {
  const footer = message.split('\n').findIndex(line => AI_FOOTER.test(line));
  return footer === -1 ? [] : [{ rule: 'commit-ai-footer', message: `line ${footer + 1} of the message is the footer of an AI tool; git holds no co-author or session trailer of one (K264). Fix: remove the line` }];
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

// The empty tree of git, the parent of a root commit (K370).
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The sha of the commit that `rev` names in `root`; undefined when it names none, as an unborn HEAD or the parent of a root commit. */
const commitOf = (root: string, rev: string) => {
  const run = gitResult(root, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  return run.status === 0 ? run.stdout.trim() : undefined;
};

/**
 * The findings of the diff rules (K624, K257) of the change from the commit `base` (undefined: the empty tree of a root commit) to
 * `side`, a commit or `''` for the index, made with `message`.
 */
function changeFindings(root: string, message: string, base: string | undefined, side: string) {
  const against = base ?? EMPTY_TREE;
  const sides = side === '' ? ['--cached', against] : [against, side];
  const changed = git(root, 'diff', '--name-only', ...sides).split('\n').filter(Boolean);
  const plans = new Set([...(base ? plansAt(root, base) : []), ...plansAt(root, side)]);
  const done: string[] = [];
  for (const tracker of trackersOf(loadConfig(root), plans)) {
    const states = (text: string) => new Map(readChecklist(text, tracker).items.map(item => [item.id, item.state]));
    const old = states(base ? fileAt(root, base, tracker.path) : '');
    for (const [id, state] of states(fileAt(root, side, tracker.path))) if (old.has(id) && old.get(id) !== state && state === DONE) done.push(id);
  }
  const stated = statedRed(message);
  if (stated !== undefined) return [];
  // The commit that moves a row to done states its red in its body (K624). Only the line is checked.
  const found: CommitFinding[] = done.map(id => ({ rule: 'commit-red', message: `the commit moves ${id} to done and its body states no red; add a line Red: <command> exit <n>, the failing run of its Verification before the change, or No-Red: <reason> for a change that no test can show` }));
  // A fix starts with a test that reproduces the defect, unless its body states why none can (K624).
  const changedLines = (file: string) => changedLineNumbers(git(root, 'diff', '-U0', ...sides, '--', file));
  if (message.startsWith('fix(') && done.length === 0 && !changed.some(file => changesATest(file, name => fileAt(root, side, name), changedLines))) {
    found.push({ rule: 'commit-fix-test', message: `the fix commit changes no test file (${TEST_FILES}); a fix starts with a test that reproduces the defect, or states No-Red: <reason> when no test can show it` });
  }
  return found;
}

/** The findings of the diff rules of the index of `root` against HEAD, committed with `message` by make commit, which never amends. */
export const indexItemFindings = (root: string, message: string) => changeFindings(root, message, commitOf(root, 'HEAD'), '');

/**
 * The findings of the diff rules of each commit of `range` (`<base>..<head>`) in `root`, oldest first, each judged against its parent
 * (K892) and named by its short sha; a merge commit is left out.
 */
export function rangeFindings(root: string, range: string): CommitFinding[] {
  if (!range.includes('..') || range.includes('...')) throw new Error(`the range ${range} is not <base>..<head>`);
  return git(root, 'rev-list', '--reverse', '--no-merges', range).split('\n').filter(Boolean).flatMap(sha => {
    const message = git(root, 'log', '-1', '--format=%B', sha);
    const short = sha.slice(0, 8);
    return changeFindings(root, message, commitOf(root, `${sha}^`), sha).map(found => ({ rule: found.rule, message: `${short} ${message.split('\n')[0]}: ${found.message}` }));
  });
}

/** The message of a commit-msg file: without the comment lines that Git removes; null for a merge commit. */
export function fileMessage(text: string) {
  const message = text.split('\n').filter(line => !line.startsWith('#')).join('\n').replace(/^\n+/, '');
  return message.startsWith('Merge ') ? null : message;
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const { values } = parseArgs({ options: { message: { type: 'string' }, range: { type: 'string' } } });
  let findings: string[] = [];
  let subject = 'the message being committed';
  try {
    if (values.range !== undefined) {
      subject = `the commits of ${values.range}`;
      findings = rangeFindings(root, values.range).map(found => `${found.rule}: ${found.message}`);
    } else {
      if (values.message === undefined) throw new Error('Usage: node scripts/kit/check-commits.mts --message <file> | --range <base>..<head>');
      const message = fileMessage(readFileSync(values.message, 'utf8'));
      findings = message === null ? [] : [...messageFindings(message), ...nextIdentityFindings(root)].map(found => `${found.rule}: ${found.message}`);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // The files and git fail with an Error.
    console.error(`[check-commits] ${error.message}`);
    process.exit(1);
  }
  for (const line of findings) console.error(`[check-commits] ${line}`);
  if (findings.length) {
    console.error(`[check-commits] ${findings.length} findings in ${subject} (the commit rules of kit)`);
    process.exit(1);
  }
}
