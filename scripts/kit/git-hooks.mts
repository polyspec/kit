#!/usr/bin/env node
// The tracked Git hooks of a checkout. Git runs the hooks of `core.hooksPath`; a checkout sets it to `.githooks`, which
// holds the hooks that config/checklist.json lists. The hooks `pre-commit`, `pre-push` and `commit-msg` belong to kit: `pre-commit`
// refuses a staged generated path through `make staged-generated-hook`, `pre-push` runs the push gate through `make push-gate-hook`,
// and `commit-msg` runs the message checks of make commit on every commit, an amend included, through `make commit-msg-hook`;
// each has the content of its constant, so every checkout holds the same file. The other hooks belong to the repository.
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
export const PRE_COMMIT = `${HOOKS_PATH}/pre-commit`;
export const COMMIT_MSG = `${HOOKS_PATH}/commit-msg`;
export const PRE_COMMIT_CONTENT = `#!/bin/sh
# The pre-commit hook. Git runs it before each commit. The generated-file check refuses a staged path with a generated segment
# (AGENTS.md "Generated files") that config/generated.json does not declare an exception, and names the path. Written by
# \`make hooks\`; do not edit it. It calls the make target of the check, which stays across the versions of kit.
cd "$(git rev-parse --show-toplevel)" || exit 1
exec make --no-print-directory staged-generated-hook
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

/** The hooks that kit writes into every checkout, with their content. */
const KIT_HOOKS = [
  { file: PRE_COMMIT, content: PRE_COMMIT_CONTENT },
  { file: PRE_PUSH, content: PRE_PUSH_CONTENT },
  { file: COMMIT_MSG, content: COMMIT_MSG_CONTENT },
];

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
  return null;
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
