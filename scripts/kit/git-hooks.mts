#!/usr/bin/env node
// The Git hooks and the merge drivers of a checkout (`make hooks`). kit writes no hook (K1053) and fixes no folder, attribute or
// driver (K1099): the caller declares them as arguments, and the tool installs or checks exactly those. A hook is a tracked file of
// the repository under the folder of --hooks-path; install points core.hooksPath at that folder and makes each hook of --hook
// executable. Each --merge '<pattern>=<driver>' is a line of .git/info/attributes, and each --driver '<name>=<command>' the command
// that git runs for the driver <name>.
//
//   node scripts/kit/git-hooks.mts install|check [--hooks-path <folder>] [--hook <name>]... [--merge <pattern>=<driver>]...
//                                                [--driver <name>=<command>]...
//   install   sets core.hooksPath, makes each hook executable and declares the merges and the drivers, then checks; a second run
//             changes nothing
//   check     fails while a declared hook, merge or driver is not installed
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isMain, repositoryRoot } from './paths.mts';
import { writeAtomic } from './bootstrap/files.mts';
import { git, gitAnswer, gitResult } from './git.mts';

/** What the caller declares (K1099): the hooks folder and its hooks, the merge attributes and the commands of their drivers. */
export type HookDeclaration = {
  hooksPath?: string | undefined;
  hooks: string[];
  merges: { pattern: string; driver: string }[];
  drivers: { name: string; command: string }[];
};

/** The attributes line of a merge. */
const attributeLine = ({ pattern, driver }: { pattern: string; driver: string }) => `${pattern} merge=${driver}`;

/** The pattern of an attributes line, which a later line of the same pattern and attribute overrides. */
const patternOf = (line: string) => line.split(/\s+/)[0];

/** The attributes file of the repository of `root`, which every worktree of it reads. */
const attributesFile = (root: string) => path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/attributes').trim());

/** The value of the git configuration `key` of `root`, or '' when it is not set. */
function configValue(root: string, key: string) {
  // git config exits with 1 when the key is not set, and with another status, as 3 for a file it cannot read, on an error (K1158).
  return gitAnswer(root, 'config', '--get', key)?.trim() ?? '';
}

/** Why the declared merges or drivers are not installed in `root`, with the fix, or null. */
export function mergeIssue(root: string, declaration: Pick<HookDeclaration, 'merges' | 'drivers'>) {
  const file = attributesFile(root);
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const absent = declaration.merges.map(attributeLine).filter(line => !lines.includes(line));
  if (absent.length) return `${path.relative(root, file)} lacks ${absent.join(', ')}; run make hooks`;
  for (const { name, command } of declaration.drivers) if (configValue(root, `merge.${name}.driver`) !== command) return `the merge driver ${name} is not ${command}; run make hooks`;
  return null;
}

/**
 * Declares the merges of `declaration` in `root`: the missing lines of .git/info/attributes, in place of a line that gives the same
 * pattern another merge (as CHANGELOG.md merge=union before K354-1), and the drivers; returns what it changed.
 */
export function installMerges(root: string, declaration: Pick<HookDeclaration, 'merges' | 'drivers'>): string[] {
  const changes: string[] = [];
  const file = attributesFile(root);
  const lines = (existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n').filter(line => line !== '');
  const absent = declaration.merges.map(attributeLine).filter(line => !lines.includes(line));
  if (absent.length) {
    const replaced = new Set(absent.map(patternOf));
    const kept = lines.filter(line => !(replaced.has(patternOf(line)) && /\bmerge=/.test(line)));
    writeAtomic(file, `${[...kept, ...absent].join('\n')}\n`);
    changes.push(`${path.relative(root, file)}: ${absent.join(', ')} added`);
  }
  for (const [key, value] of declaration.drivers.flatMap(({ name, command }) => [[`merge.${name}.name`, name], [`merge.${name}.driver`, command]] as const)) {
    if (configValue(root, key) === value) continue;
    const run = gitResult(root, 'config', key, value);
    if (run.status !== 0) throw new Error(`git config ${key} failed in ${root}: ${run.stderr.trim()}`);
    changes.push(`${key} set`);
  }
  return changes;
}

function configuredHooksPath(root: string) {
  // As configValue (K1158).
  return gitAnswer(root, 'config', 'core.hooksPath')?.trim() ?? '';
}

/** The hooks folder of `declaration`; a hook needs one, since the tool reads it there. */
function hooksFolder(declaration: HookDeclaration) {
  if (declaration.hooks.length > 0 && declaration.hooksPath === undefined) throw new Error(`--hook ${declaration.hooks.join(', ')} needs --hooks-path, the folder that holds the hooks`);
  return declaration.hooksPath;
}

/** Why a declared hook, merge or driver of the checkout `root` is not installed, with the fix, or null when every one is. */
export function hooksIssue(root: string, declaration: HookDeclaration) {
  const folder = hooksFolder(declaration);
  if (folder !== undefined) {
    const configured = configuredHooksPath(root);
    if (configured !== folder) return `core.hooksPath is ${configured ? `"${configured}"` : 'not set'}, not ${folder}, so Git does not run the hooks; run make hooks`;
    for (const name of declaration.hooks) {
      const absolute = path.join(root, folder, name);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) return `${folder}/${name} does not exist; restore it from Git and run make hooks`;
      if ((statSync(absolute).mode & 0o100) === 0) return `${folder}/${name} is not executable, so Git does not run it; run make hooks`;
    }
  }
  return mergeIssue(root, declaration);
}

/**
 * Installs what `declaration` names in the checkout `root`: sets core.hooksPath to its hooks folder, makes each hook that exists
 * executable and declares the merges and the drivers. Returns the lines of what it changed, empty when nothing changed.
 */
export function installHooks(root: string, declaration: HookDeclaration) {
  const changes: string[] = [];
  const folder = hooksFolder(declaration);
  if (folder !== undefined) {
    const configured = configuredHooksPath(root);
    if (configured !== folder) {
      const run = gitResult(root, 'config', 'core.hooksPath', folder);
      if (run.status !== 0) throw new Error(`git config core.hooksPath ${folder} failed in ${root}: ${run.stderr.trim()}`);
      changes.push(`core.hooksPath set to ${folder} (was ${configured || 'not set'})`);
    }
    for (const name of declaration.hooks) {
      const file = path.join(root, folder, name);
      if (existsSync(file) && (statSync(file).mode & 0o100) === 0) {
        chmodSync(file, statSync(file).mode | 0o755);
        changes.push(`${folder}/${name} made executable`);
      }
    }
  }
  changes.push(...installMerges(root, declaration));
  return changes;
}

/** The pair `<left>=<right>` of the argument `value` of `option`, split at the `at` sign: the first for a driver, the last for a merge. */
function pair(option: string, value: string, at: 'first' | 'last') {
  const index = at === 'first' ? value.indexOf('=') : value.lastIndexOf('=');
  if (index <= 0 || index === value.length - 1) throw new Error(`${option} ${JSON.stringify(value)} is no <name>=<value>`);
  return [value.slice(0, index), value.slice(index + 1)] as const;
}

/** The declaration of the arguments `args` (K1099). */
export function declarationOf(args: string[]): HookDeclaration {
  const { values } = parseArgs({ args, options: { 'hooks-path': { type: 'string' }, hook: { type: 'string', multiple: true }, merge: { type: 'string', multiple: true }, driver: { type: 'string', multiple: true } } });
  return {
    hooksPath: values['hooks-path'],
    hooks: values.hook ?? [],
    merges: (values.merge ?? []).map(value => { const [pattern, driver] = pair('--merge', value, 'last'); return { pattern, driver }; }),
    drivers: (values.driver ?? []).map(value => { const [name, command] = pair('--driver', value, 'first'); return { name, command }; }),
  };
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [mode, ...rest] = process.argv.slice(2);
  // A call that declares nothing is a usage error (K1099): kit names no folder, hook, merge or driver of its own.
  if ((mode !== 'install' && mode !== 'check') || rest.length === 0) {
    console.error('Usage: node scripts/kit/git-hooks.mts install | check [--hooks-path <folder>] [--hook <name>]... [--merge <pattern>=<driver>]... [--driver <name>=<command>]...');
    process.exitCode = 2;
  } else {
    try {
      const declaration = declarationOf(rest);
      if (mode === 'install') {
        const changes = installHooks(root, declaration);
        for (const change of changes) console.log(`[git-hooks] ${change}`);
        if (changes.length === 0) console.log('[git-hooks] nothing to change');
      }
      const issue = hooksIssue(root, declaration);
      if (issue) console.error(`[git-hooks] the hooks are not installed: ${issue}`);
      else console.log('[git-hooks] the declared hooks and merges are installed');
      process.exitCode = issue ? 1 : 0;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error(`[git-hooks] ${error.message}`);
      process.exitCode = 2;
    }
  }
}
