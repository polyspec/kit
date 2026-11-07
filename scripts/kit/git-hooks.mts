#!/usr/bin/env node
// The Git hooks and the merge drivers of a checkout (`make hooks`). kit writes no hook (K1053): the hooks of a repository are its own
// tracked files under `.githooks`, which config/checklist.json lists; make hooks points core.hooksPath at `.githooks` when the list
// names one, and makes each listed hook executable. make hooks also declares the merges of the changelogs and checklists (K354): a
// union, and the driver kit-twin for their Korean twins.
//
//   node scripts/kit/git-hooks.mts install   set core.hooksPath when a hook is listed, make each listed hook executable and
//                                            declare the merges, then check; a second run changes nothing
//   node scripts/kit/git-hooks.mts check     fail while a listed hook or a merge is not installed
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './checklist.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { gitResult } from './git.mts';

const HOOKS_PATH = '.githooks';
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

function configuredHooksPath(root: string) {
  const run = gitResult(root, 'config', 'core.hooksPath');
  if (run.error) throw run.error;
  // git config exits with 1 when the key is not set.
  return run.status === 0 ? run.stdout.trim() : '';
}

/** Why a hook of the checkout `root` is not installed, with the fix, or null when every hook of `hooks` and every merge is. */
export function hooksIssue(root: string, hooks: string[] = loadConfig(root).hooks) {
  if (hooks.length > 0) {
    const configured = configuredHooksPath(root);
    if (configured !== HOOKS_PATH) return `core.hooksPath is ${configured ? `"${configured}"` : 'not set'}, not ${HOOKS_PATH}, so Git does not run the hooks; run make hooks`;
  }
  for (const name of hooks) {
    const absolute = path.join(root, HOOKS_PATH, name);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return `${HOOKS_PATH}/${name} does not exist; restore it from Git and run make hooks`;
    if ((statSync(absolute).mode & 0o100) === 0) return `${HOOKS_PATH}/${name} is not executable, so Git does not run it; run make hooks`;
  }
  return mergeIssue(root);
}

/**
 * Installs the hooks of the checkout `root`: sets core.hooksPath when `hooks` names one, makes each listed hook that exists executable
 * and declares the merges. Returns the lines of what it changed, empty when nothing changed.
 */
export function installHooks(root: string, hooks: string[] = loadConfig(root).hooks) {
  const changes: string[] = [];
  const configured = configuredHooksPath(root);
  if (hooks.length > 0 && configured !== HOOKS_PATH) {
    const run = gitResult(root, 'config', 'core.hooksPath', HOOKS_PATH);
    if (run.status !== 0) throw new Error(`git config core.hooksPath ${HOOKS_PATH} failed in ${root}: ${run.stderr.trim()}`);
    changes.push(`core.hooksPath set to ${HOOKS_PATH} (was ${configured || 'not set'})`);
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
    else console.log('[git-hooks] the listed hooks and the merges are installed');
    process.exitCode = issue ? 1 : 0;
  }
}
