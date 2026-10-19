#!/usr/bin/env node
// The Claude Code PreToolUse hook of every repository that takes kit (.claude/settings.json, vendored from
// claude/settings.json). It reads the hook input on stdin and refuses, with exit status 2 and the reason on stderr, a Bash
// command that runs a suite, a whole test runtime without a selection, or sets the variable that marks a CI run; the
// suite runs only in CI (ci-only.mts), and locally only the unit tests that own a change run.
//
//   node scripts/kit/claude-hook.mts < <hook input JSON>
//
// The commands of a suite refuse outside CI themselves; the hook refuses them before they start and also refuses the
// test runners that a recipe or an agent calls without kit's runner. A path of a test file is resolved from the working
// directory of the hook, the project directory, so a file named after a `cd` is judged from there.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './paths.mts';
import { isJsonObject } from './bootstrap/files.mts';
import { commandParts } from './recipe-tools.mts';
import { isFile, selects } from './test-selection.mts';

// The make targets of kit that run a suite or a group of its targets.
const SUITE_TARGETS = new Set(['check', 'ci', 'ci-targets', 'check-run', 'rerun-failed', 'owner-check']);
// The variables whose value marks a CI run.
const CI_MARKERS = new Set(['GITHUB_ACTIONS', 'CI']);
// The words that run the command after them.
const PREFIXES = new Set(['time', 'nice', 'command', 'exec', 'npx']);
// The make options that take the next word as their value.
const MAKE_VALUED = new Set(['-C', '-f', '--file', '--makefile', '-j', '--jobs', '-I', '-o', '-W']);

const SUITE = 'runs only in CI (GITHUB_ACTIONS=true); locally run the unit tests that own the change by their file or a name filter';

const assigned = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
const marker = (word: string) => CI_MARKERS.has(word.slice(0, word.indexOf('=')));

/** The refusal of a test runner `program` with `args` that selects no test, or null. */
function runnerRefusal(program: string, args: string[], isFileAt: (file: string) => boolean): string | null {
  const [first, second] = args;
  const run = (tool: string, rest: string[], how: string) => selects(tool, rest, isFileAt) ? null : `${[program, ...args].join(' ')} runs a whole runtime without a selection, which ${SUITE}: ${how}`;
  if (program === 'go' && first === 'test') return run('go', args.slice(1), 'add -run <pattern>');
  if (program === 'cargo' && first === 'test') return run('cargo', args.slice(1), 'add a test name filter or --test <target>');
  if (program === 'cargo' && first === 'nextest' && second === 'run') return run('cargo', args.slice(2), 'add a test name filter or --test <target>');
  if (program === 'phpunit') return run('phpunit', args, 'add --filter <pattern> or a test file');
  if (program === 'php' && first !== undefined && path.basename(first) === 'phpunit') return run('phpunit', args.slice(1), 'add --filter <pattern> or a test file');
  if (program === 'node' && args.includes('--test')) return run('node', args.filter(arg => arg !== '--test'), 'name the test files or add --test-name-pattern <pattern>');
  if (program === 'vitest') return run('vitest', args, 'name the test files or add -t <pattern>');
  if (/^python3?(\.\d+)?$/.test(program) && first === '-m' && (second === 'unittest' || second === 'pytest')) return run('python', args.slice(2), 'name the test ids or add -k <pattern>');
  if (program === 'pytest') return run('python', args, 'name the test ids or add -k <pattern>');
  return null;
}

/** The refusal of a make command with `args`, or null. */
function makeRefusal(args: string[]): string | null {
  const targets: string[] = [];
  const variables = new Set<string>();
  let value = false;
  for (const arg of args) {
    if (value) value = false;
    else if (MAKE_VALUED.has(arg)) value = true;
    else if (arg.startsWith('-')) continue;
    else if (assigned(arg)) variables.add(arg.slice(0, arg.indexOf('=')));
    else targets.push(arg);
  }
  const suite = targets.find(target => SUITE_TARGETS.has(target));
  if (suite) return `make ${suite} ${SUITE}`;
  if (targets.includes('parity-check') && !variables.has('UNITS')) return `make parity-check without UNITS ${SUITE}: name the units with UNITS="<id>..."`;
  return null;
}

/** The refusal of one simple command, its `words`, or null. */
function commandRefusal(words: string[], isFileAt: (file: string) => boolean): string | null {
  let rest = words;
  if (rest[0] === 'export' && rest.slice(1).some(word => assigned(word) && marker(word))) return `${rest.join(' ')} sets the variable that marks a CI run; a suite ${SUITE}`;
  if (rest[0] === 'env') rest = rest.slice(1).filter(word => !word.startsWith('-'));
  for (let head = rest[0]; head !== undefined && assigned(head); head = rest[0]) {
    if (marker(head)) return `${head} sets the variable that marks a CI run; a suite ${SUITE}`;
    rest = rest.slice(1);
  }
  for (let head = rest[0]; head !== undefined && PREFIXES.has(head); head = rest[0]) rest = rest.slice(1);
  const [command, ...args] = rest;
  if (command === undefined) return null;
  const program = path.basename(command);
  return program === 'make' ? makeRefusal(args) : runnerRefusal(program, args, isFileAt);
}

/** The refusal of the Bash command `command`, or null when the hook allows it. */
export function refusal(command: string, isFileAt: (file: string) => boolean = isFile): string | null {
  for (const words of commandParts(command)) {
    const refused = commandRefusal(words, isFileAt);
    if (refused) return refused;
  }
  return null;
}

if (isMain(import.meta.url)) {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error) {
    console.error(`[kit claude-hook] refuse: the hook input on stdin is no JSON (${error instanceof Error ? error.message : String(error)})`);
    process.exit(2);
  }
  const tool = isJsonObject(input) && input.tool_name === 'Bash' && isJsonObject(input.tool_input) ? input.tool_input : null;
  const command = tool?.command;
  const refused = typeof command === 'string' ? refusal(command) : null;
  if (refused) {
    console.error(`[kit claude-hook] refuse: ${refused}`);
    process.exit(2);
  }
}
