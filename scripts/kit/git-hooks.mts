#!/usr/bin/env node
// The tracked Git hooks of a checkout. Git runs the hooks of `core.hooksPath`; a checkout sets it to `.githooks`, which
// holds the hooks that config/checklist.json lists. The hooks `pre-commit`, `pre-merge-commit`, `pre-push`, `commit-msg` and
// `prepare-commit-msg` belong to kit: `pre-commit` refuses a staged generated path through `make staged-generated-hook`, then runs
// the gates of land on the staged tree of a commit on main through `make commit-gates-hook` (K404-1); `pre-merge-commit` refuses a
// merge commit on main through `make merge-commit-hook` (K404-1); `pre-push` runs the push gate through
// `make push-gate-hook`, `commit-msg` runs the message checks of make commit on every commit, an amend included, through
// `make commit-msg-hook`, and `prepare-commit-msg` records an amend for that check through `make prepare-commit-msg-hook` (K380-2);
// each has the content of its constant, so every checkout holds the same file. The other hooks belong to the repository. make hooks
// also declares the merges of the changelogs and checklists (K354): a union, and the driver kit-twin for their Korean twins.
//
//   node scripts/kit/git-hooks.mts install   set core.hooksPath, write pre-push when it differs, make each listed hook
//                                            executable, then check; a second run changes nothing
//   node scripts/kit/git-hooks.mts check     fail while a hook is not installed
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, PRE_PUSH_HOOK } from './checklist.mts';
import { CONFIG } from './generated-files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { gitResult } from './git.mts';

export const HOOKS_PATH = '.githooks';
export const PRE_PUSH = `${HOOKS_PATH}/${PRE_PUSH_HOOK}`;
export const PRE_MERGE_COMMIT = `${HOOKS_PATH}/pre-merge-commit`;
export const PRE_COMMIT = `${HOOKS_PATH}/pre-commit`;
export const COMMIT_MSG = `${HOOKS_PATH}/commit-msg`;
export const PREPARE_COMMIT_MSG = `${HOOKS_PATH}/prepare-commit-msg`;
export const PRE_COMMIT_CONTENT = `#!/bin/sh
# The pre-commit hook. Git runs it before each commit. The generated-file check refuses a staged path with a generated segment
# (AGENTS.md "Generated files") that config/generated.json does not declare an exception, and names the path. On main the gates of
# land run on the staged tree and refuse a finding that HEAD lacks (K404-1). Written by \`make hooks\`; do not edit it. It calls the
# make targets of the checks, which stay across the versions of kit.
cd "$(git rev-parse --show-toplevel)" || exit 1
make --no-print-directory staged-generated-hook || exit 1
exec make --no-print-directory commit-gates-hook
`;
export const PRE_MERGE_COMMIT_CONTENT = `#!/bin/sh
# The pre-merge-commit hook. Git runs it before it creates a merge commit. It refuses a merge commit on main, since main moves only by
# commits and fast-forwards (P38, K404-1). Written by \`make hooks\`; do not edit it. It calls the make target of the check, which
# stays across the versions of kit.
cd "$(git rev-parse --show-toplevel)" || exit 1
exec make --no-print-directory merge-commit-hook
`;
export const PRE_PUSH_CONTENT = `#!/bin/sh
# The pre-push hook. Git starts it with the pushed refs on standard input. The push gate refuses the push while an item of
# a tracker of config/checklist.json is in its active state, in a pushed commit or in the working tree. Written by
# \`make hooks\`; do not edit it. It calls the make target of the push gate, which stays across the versions of kit.
cd "$(git rev-parse --show-toplevel)" || exit 1
exec make --no-print-directory push-gate-hook
`;
export const COMMIT_MSG_CONTENT = `#!/bin/sh
# The commit-msg hook. Git runs it with the file of the message being committed as its argument, before each commit, an amend
# included. The message checks of the commit rules refuse a message with the footer of an AI tool or another rule break (K380).
# Written by \`make hooks\`; do not edit it. It calls the make target of the check, which stays across the versions of kit.
cd "$(git rev-parse --show-toplevel)" || exit 1
exec make --no-print-directory commit-msg-hook MESSAGE="$1"
`;
export const PREPARE_COMMIT_MSG_CONTENT = `#!/bin/sh
# The prepare-commit-msg hook. Git runs it before each commit with the file of the message, the source of the message and, for an
# amend or a commit of another commit, the sha of that commit. The commit-msg check reads the index against the parent of an amended
# commit, so the hook records the amend (K380-2). Written by \`make hooks\`; do not edit it. It calls the make target of the record,
# which stays across the versions of kit.
cd "$(git rev-parse --show-toplevel)" || exit 1
exec make --no-print-directory prepare-commit-msg-hook SOURCE="$2" SHA="$3"
`;

/** The hooks that kit writes into every checkout, with their content. */
const KIT_HOOKS = [
  { file: PRE_COMMIT, content: PRE_COMMIT_CONTENT },
  { file: PRE_MERGE_COMMIT, content: PRE_MERGE_COMMIT_CONTENT },
  { file: PRE_PUSH, content: PRE_PUSH_CONTENT },
  { file: COMMIT_MSG, content: COMMIT_MSG_CONTENT },
  { file: PREPARE_COMMIT_MSG, content: PREPARE_COMMIT_MSG_CONTENT },
];

// The merges of the files that every row changes (K354): the lines of a changelog and the rows of a checklist are independent, so
// their Korean twins merge with the driver kit-twin of twin-merge.mts, which writes the marker of the merged English file. The
// English changelog merges with the driver kit-changelog, the union with its Unreleased entries newest first (K354-1), and the
// English checklist with the driver kit-checklist, which merges its task rows by their ID (K354-3). .git/info/attributes holds the
// lines, so no tracked file of a repository changes.
export const MERGE_ATTRIBUTES = ['CHANGELOG.md merge=kit-changelog', 'CHANGELOG.ko.md merge=kit-twin', 'docs/plans/*/checklist.md merge=kit-checklist', 'docs/plans/*/checklist.ko.md merge=kit-twin'];

// Each driver as git runs it, in the top of the work tree: the make target of the drivers, which stays across the versions of kit as
// the hooks do, and runs twin-merge of the kit of the checkout, which tells the two by the path.
const DRIVER = 'make --no-print-directory twin-merge MERGE="%O %A %B %P"';
const DRIVERS = [
  { name: 'kit-twin', description: 'kit: the union of a Korean twin with the marker of its merged English file (K354)' },
  { name: 'kit-changelog', description: 'kit: the union of a changelog with its Unreleased entries newest first (K354-1)' },
  { name: 'kit-checklist', description: 'kit: the merge of a checklist with its task rows merged by their ID (K354-3)' },
];

/** The pattern of an attributes line, which a later line of the same pattern and attribute overrides. */
const patternOf = (line: string) => line.split(/\s+/)[0];

/** The attributes file of the repository of `root`, which every worktree of it reads. */
const attributesFile = (root: string) => path.resolve(root, gitResult(root, 'rev-parse', '--git-path', 'info/attributes').stdout.trim());

/** The value of the git configuration `key` of `root`, or '' when it is not set. */
function configValue(root: string, key: string) {
  const run = gitResult(root, 'config', '--get', key);
  if (run.error) throw run.error;
  // git config exits with 1 when the key is not set.
  return run.status === 0 ? run.stdout.trim() : '';
}

/** Why the merges of K354 are not declared in `root`, with the fix, or null. */
export function mergeIssue(root: string) {
  const file = attributesFile(root);
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const absent = MERGE_ATTRIBUTES.filter(line => !lines.includes(line));
  if (absent.length) return `${path.relative(root, file)} lacks ${absent.join(', ')}; run make hooks`;
  for (const { name } of DRIVERS) if (configValue(root, `merge.${name}.driver`) !== DRIVER) return `the merge driver ${name} is not ${DRIVER}; run make hooks`;
  return null;
}

/**
 * Declares the merges of K354 in `root`: the missing lines of .git/info/attributes, in place of a line that gives the same pattern
 * another merge (as CHANGELOG.md merge=union before K354-1), and the drivers; returns what it changed.
 */
export function installMerges(root: string): string[] {
  const changes: string[] = [];
  const file = attributesFile(root);
  const lines = (existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n').filter(line => line !== '');
  const absent = MERGE_ATTRIBUTES.filter(line => !lines.includes(line));
  if (absent.length) {
    const replaced = new Set(absent.map(patternOf));
    const kept = lines.filter(line => !(replaced.has(patternOf(line)) && /\bmerge=/.test(line)));
    writeAtomic(file, `${[...kept, ...absent].join('\n')}\n`);
    changes.push(`${path.relative(root, file)}: ${absent.join(', ')} added`);
  }
  for (const [key, value] of DRIVERS.flatMap(({ name, description }) => [[`merge.${name}.name`, description], [`merge.${name}.driver`, DRIVER]] as const)) {
    if (configValue(root, key) === value) continue;
    const run = gitResult(root, 'config', key, value);
    if (run.status !== 0) throw new Error(`git config ${key} failed in ${root}: ${run.stderr.trim()}`);
    changes.push(`${key} set`);
  }
  return changes;
}

/** Why the pre-commit hook cannot run in the checkout `root`, with the fix, or null when config/generated.json exists (K362). */
function configIssue(root: string) {
  if (existsSync(path.join(root, CONFIG))) return null;
  return `${CONFIG} does not exist, and the pre-commit hook needs it; add ${CONFIG} (its schema is scripts/kit/schema/generated.schema.json), then run make hooks`;
}

function configuredHooksPath(root: string) {
  const run = gitResult(root, 'config', 'core.hooksPath');
  if (run.error) throw run.error;
  // git config exits with 1 when the key is not set.
  return run.status === 0 ? run.stdout.trim() : '';
}

/** Why a hook of the checkout `root` is not installed, with the fix, or null when every hook of `hooks` is installed. */
export function hooksIssue(root: string, hooks: string[] = loadConfig(root).hooks) {
  const missing = configIssue(root);
  if (missing) return missing;
  const configured = configuredHooksPath(root);
  if (configured !== HOOKS_PATH) {
    return `core.hooksPath is ${configured ? `"${configured}"` : 'not set'}, not ${HOOKS_PATH}, so Git does not run the hooks; run make hooks`;
  }
  const files = [...KIT_HOOKS.map(hook => hook.file), ...hooks.map(name => `${HOOKS_PATH}/${name}`)];
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return `${file} does not exist; restore it from Git and run make hooks`;
    if ((statSync(absolute).mode & 0o100) === 0) return `${file} is not executable, so Git does not run it; run make hooks`;
  }
  for (const { file, content } of KIT_HOOKS) {
    if (readFileSync(path.join(root, file), 'utf8') !== content) {
      return `${file} differs from the hook of scripts/kit/git-hooks.mts; run make hooks and commit the file`;
    }
  }
  return mergeIssue(root);
}

/**
 * Installs the hooks of the checkout `root`: sets core.hooksPath, writes each kit hook that differs, and makes each listed
 * hook that exists executable. Returns the lines of what it changed, empty when nothing changed.
 */
export function installHooks(root: string, hooks: string[] = loadConfig(root).hooks) {
  const missing = configIssue(root);
  if (missing) throw new Error(missing);
  const changes: string[] = [];
  const configured = configuredHooksPath(root);
  if (configured !== HOOKS_PATH) {
    const run = gitResult(root, 'config', 'core.hooksPath', HOOKS_PATH);
    if (run.status !== 0) throw new Error(`git config core.hooksPath ${HOOKS_PATH} failed in ${root}: ${run.stderr.trim()}`);
    changes.push(`core.hooksPath set to ${HOOKS_PATH} (was ${configured || 'not set'})`);
  }
  for (const { file, content } of KIT_HOOKS) {
    const absolute = path.join(root, file);
    if (!existsSync(absolute) || readFileSync(absolute, 'utf8') !== content) {
      writeAtomic(absolute, content, { mode: 0o755 });
      changes.push(`${file} written`);
    }
  }
  for (const name of hooks) {
    const file = path.join(root, HOOKS_PATH, name);
    if (existsSync(file) && (statSync(file).mode & 0o100) === 0) {
      chmodSync(file, statSync(file).mode | 0o755);
      changes.push(`${HOOKS_PATH}/${name} made executable`);
    }
  }
  changes.push(...installMerges(root));
  return changes;
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [mode, ...rest] = process.argv.slice(2);
  if ((mode !== 'install' && mode !== 'check') || rest.length > 0) {
    console.error('Usage: node scripts/kit/git-hooks.mts install | check');
    process.exitCode = 2;
  } else {
    if (mode === 'install') {
      const changes = installHooks(root);
      for (const change of changes) console.log(`[git-hooks] ${change}`);
      if (changes.length === 0) console.log('[git-hooks] nothing to change');
    }
    const issue = hooksIssue(root);
    if (issue) console.error(`[git-hooks] the hooks are not installed: ${issue}`);
    else console.log(`[git-hooks] the hooks ${loadConfig(root).hooks.join(', ')} are installed: core.hooksPath is ${HOOKS_PATH}`);
    process.exitCode = issue ? 1 : 0;
  }
}
