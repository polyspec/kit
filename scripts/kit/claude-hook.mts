#!/usr/bin/env node
// The Claude Code PreToolUse hook of every repository that takes kit (.claude/settings.json, vendored from
// claude/settings.json). It reads the hook input on stdin and refuses, with exit status 2 and the reason on stderr, a Bash
// command that runs a suite, a whole test runtime without a selection, or sets the variable that marks a CI run (the suite
// runs only in CI, ci-only.mts, and locally only the unit tests that own a change run, K240); a Bash command that skips the
// Git hooks or changes their path (K248); a Bash command that waits, with a sleep or in a loop that sleeps or polls for a
// process or a file (K386); and, in a consumer repository, an edit of a file
// that kit vendors, which `make kit-sync` writes (K248).
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
import { copiesOf, INSTALLED, isSource } from './kit-check.mts';
import { readNpmManifest } from './manifests.mts';
import { existsSync } from 'node:fs';
import { commandParts, expandMake, makeArguments } from './recipe-tools.mts';
import { makeDatabase, type MakeDatabase } from './owner-check.mts';
import { isFile, runnerWords, selects } from './test-selection.mts';

// The make targets of kit that run a suite or a group of its targets.
const SUITE_TARGETS = new Set(['check', 'ci', 'ci-targets', 'check-run', 'rerun-failed', 'owner-check']);
// The variables whose value marks a CI run.
const CI_MARKERS = new Set(['GITHUB_ACTIONS', 'CI']);
// The words that run the command after them.
const PREFIXES = new Set(['time', 'nice', 'command', 'exec', 'npx']);
// The commands that poll for a process or a file, which a loop repeats until it finds it.
const POLLS = new Set(['pgrep', 'pidof', 'ls']);

const SUITE = 'runs only in CI (GITHUB_ACTIONS=true); locally run the unit tests that own the change by their file or a name filter';
const HOOKS = 'skips the Git hooks, which enforce the rules at the commit and the push; commit and push with the hooks';
// The Git commands whose hooks --no-verify skips.
const VERIFIED = new Set(['commit', 'push', 'merge', 'am', 'rebase']);
// The tools of Claude Code that change a file, by the field that names it.
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const assigned = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
const marker = (word: string) => CI_MARKERS.has(word.slice(0, word.indexOf('=')));

// The way to select tests of each runner of test-selection.mts, which a refusal names as its fix.
const SELECT: Record<string, string> = {
  go: 'add -run <pattern>',
  cargo: 'add a test name filter or --test <target>',
  phpunit: 'add --filter <pattern> or a test file',
  node: 'name the test files or add --test-name-pattern <pattern>',
  vitest: 'name the test files or add -t <pattern>',
  python: 'name the test ids or add -k <pattern>',
};

/** The refusal of `command`, which runs the runner `tool` of test-selection.mts with `args`, when they select no test. */
function selection(command: string[], tool: string, args: string[], isFileAt: (file: string) => boolean): string | null {
  return selects(tool, args, isFileAt) ? null : `${command.join(' ')} runs a whole runtime without a selection, which ${SUITE}: ${SELECT[tool] ?? 'select the tests'}`;
}

/** The refusal of a test runner `program` with `args` that selects no test, or null. */
function runnerRefusal(program: string, args: string[], isFileAt: (file: string) => boolean): string | null {
  const [first, second] = args;
  const command = [program, ...args];
  if (program === 'cargo' && first?.startsWith('+')) return runnerRefusal(program, args.slice(1), isFileAt);
  if (program === 'go' && first === 'test') return selection(command, 'go', args.slice(1), isFileAt);
  if (program === 'cargo' && first === 'test') return selection(command, 'cargo', args.slice(1), isFileAt);
  if (program === 'cargo' && first === 'nextest' && second === 'run') return selection(command, 'cargo', args.slice(2), isFileAt);
  if (program === 'phpunit') return selection(command, 'phpunit', args, isFileAt);
  if (program === 'php' && first !== undefined && path.basename(first) === 'phpunit') return selection(command, 'phpunit', args.slice(1), isFileAt);
  if (program === 'node') {
    const separator = args.indexOf('--');
    const nodeArgs = separator === -1 ? args : args.slice(0, separator);
    if (nodeArgs.includes('--test')) return selection(command, 'node', nodeArgs.filter(arg => arg !== '--test'), isFileAt);
  }
  if (program === 'vitest') return selection(command, 'vitest', args, isFileAt);
  if (/^python3?(\.\d+)?$/.test(program) && first === '-m' && (second === 'unittest' || second === 'pytest')) return selection(command, 'python', args.slice(2), isFileAt);
  if (program === 'pytest') return selection(command, 'python', args, isFileAt);
  // run-tests.mts <runner> [<options>] [--] <args> runs the runner over the arguments after its options in its --cwd, so it needs
  // their selection there (K249-3, K353-2).
  if (program === 'node' && first !== undefined && second !== undefined && /(?:^|\/)run-tests\.m[jt]s$/.test(first)) {
    const { options, args: toolArgs } = runnerWords(args.slice(2));
    const cwd = options.findLast(([flag]) => flag === '--cwd')?.[1] ?? '.';
    return selection(command, second, toolArgs, file => isFileAt(path.isAbsolute(file) ? file : path.join(cwd, file)));
  }
  // A node wrapper may forward a command after --; apply the same runner selection rules to that declared command.
  if (program === 'node') {
    const separator = args.indexOf('--');
    if (separator !== -1) {
      const [forwarded, ...forwardedArgs] = args.slice(separator + 1);
      if (forwarded !== undefined) return runnerRefusal(path.basename(forwarded), forwardedArgs, isFileAt);
    }
  }
  return null;
}

/** What a refusal reads besides the command: whether a word names a file, and the database of the Makefile of the root. */
type Context = { isFileAt: (file: string) => boolean; make: () => MakeDatabase | undefined };

/** The refusal of the first command that the target `target` runs, through its prerequisites and recipes, or null. */
function recipeRefusal(target: string, database: MakeDatabase, assignments: ReadonlyMap<string, string>, context: Context, seen: Set<string>): string | null {
  if (seen.has(target)) return null;
  seen.add(target);
  const rule = database.targets.get(target);
  if (!rule) return null;
  for (const prerequisite of rule.prerequisites) {
    const refused = recipeRefusal(prerequisite, database, assignments, context, seen);
    if (refused) return refused;
  }
  const variables = new Map([...database.variables, ...assignments]);
  for (const line of expandMake(rule.recipe, variables).split('\n')) {
    // @, - and + are the prefixes of make that a recipe line may start with; the shell never sees them.
    const command = line.replace(/^[\s@+-]+/, '');
    const refused = command ? refusalIn(command, context, seen) : null;
    if (refused) return refused;
  }
  return null;
}

/**
 * The refusal of a make command with `args`, or null: a suite target of kit, a full parity-check, and a target whose recipes
 * or prerequisites, in the database of the Makefile, run a command that the hook refuses, such as the suite of a repository's
 * own Makefile (K249-3).
 */
function makeRefusal(args: string[], context: Context, seen: Set<string>): string | null {
  const { targets, assignments } = makeArguments(args);
  const variables = new Set(assignments.keys());
  // ci-targets checks completed checklists before the explicit final run starts.
  if (targets.length === 1 && targets[0] === 'ci-targets' && assignments.get('FINAL_RUN') === '1') return null;
  const suite = targets.find(target => SUITE_TARGETS.has(target));
  if (suite) return `make ${suite} ${SUITE}`;
  if (targets.includes('parity-check') && !variables.has('UNITS')) return `make parity-check without UNITS ${SUITE}: name the units with UNITS="<id>..."`;
  // The suites and a test target of a runtime without its name filter run every test (runtime-targets.mts, K244).
  // make test runs test-<runtime> of every runtime without CASES (K246).
  const suiteTarget = targets.find(target => target === 'test' || target === 'test-integration' || target === 'test-conformance');
  if (suiteTarget) return `make ${suiteTarget} ${SUITE}`;
  const runtime = targets.find(target => /^test-(?:go|js|php|php-ext|python|rust|ts)$/.test(target));
  if (runtime && !variables.has('CASES')) return `make ${runtime} without CASES ${SUITE}: name the cases with CASES=<pattern>`;
  const database = context.make();
  if (!database) return null;
  for (const target of targets) {
    const refused = recipeRefusal(target, database, assignments, context, seen);
    if (refused) return `make ${target} runs ${refused}`;
  }
  return null;
}

/** The refusal of a git command with `args` that skips the Git hooks or changes their path, or null. */
function gitRefusal(args: string[]): string | null {
  for (const [index, arg] of args.entries()) {
    if ((arg === '-c' && args[index + 1]?.startsWith('core.hooksPath=')) || arg.startsWith('-ccore.hooksPath=')) return `git -c core.hooksPath ${HOOKS}`;
  }
  const words = args.filter((arg, index) => !arg.startsWith('-') && args[index - 1] !== '-c');
  const [command] = words;
  if (command === 'config' && args.includes('core.hooksPath')) {
    const value = words[words.indexOf('core.hooksPath') + 1];
    if (args.includes('--unset') || args.includes('--unset-all') || (value !== undefined && value !== '.githooks')) return `git config core.hooksPath ${HOOKS}`;
  }
  if (command !== undefined && VERIFIED.has(command)) {
    // -n of git commit is --no-verify, also inside a group of short options such as -anm.
    const short = command === 'commit' && args.some(arg => /^-[a-zA-Z]+$/.test(arg) && arg.includes('n'));
    if (args.includes('--no-verify') || short) return `git ${command} --no-verify ${HOOKS}`;
  }
  return null;
}

/** The refusal of a command that waits: `what` names it, and the message gives the alternatives to waiting. */
function waitRefusal(what: string): string {
  return `${what}, which has no known end: run one foreground command bounded by its own work and its timeout, or a run in the background that notifies at its end`;
}

/**
 * The simple commands of each loop of `parts` with the kind of their innermost loop: the condition of a while or until loop and the
 * body of every loop (K386, K386-1).
 */
function loopCommands(parts: string[][]): { kind: string; words: string[] }[] {
  const found: { kind: string; words: string[] }[] = [];
  const kinds: string[] = [];
  for (const words of parts) {
    const head = words[0] ?? '';
    if (head === 'for' || head === 'while' || head === 'until') {
      kinds.push(head);
      if (head !== 'for' && words.length > 1) found.push({ kind: head, words: words.slice(1) });
    } else if (head === 'done') kinds.pop();
    else {
      const kind = kinds.at(-1);
      const body = head === 'do' ? words.slice(1) : words;
      if (kind !== undefined && body.length > 0) found.push({ kind, words: body });
    }
  }
  return found;
}

/** The program and arguments of the simple command `words`, after its negation, env and prefix words. */
function programOf(words: string[]): { program: string | undefined; args: string[] } {
  let rest = words;
  while (rest[0] !== undefined && (rest[0] === '!' || rest[0] === 'env' || rest[0].startsWith('-') || assigned(rest[0]) || PREFIXES.has(rest[0]))) rest = rest.slice(1);
  const [command, ...args] = rest;
  return { program: command === undefined ? undefined : path.basename(command), args };
}

/** Whether the simple command `words` sleeps, which waits in a loop of any kind. */
const sleeps = (words: string[]) => programOf(words).program === 'sleep';

/**
 * Whether the simple command `words` polls for a process or a file, which waits only in a while or until loop: their condition can wait
 * on a state, while a for loop over a list ends with its list (K386-1).
 */
function polls(words: string[]): boolean {
  const { program, args } = programOf(words);
  if (program === undefined) return false;
  if (POLLS.has(program)) return true;
  if (program === 'test') return ['-e', '-f', '-d'].includes(args[0] ?? '');
  return program === '[' && args[0] === '-e';
}

// The shells whose -c runs a script that the hook reads (K528).
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);

/** The script of the arguments `args` of a shell: the word after its -c flag, alone or combined as in -lc, or undefined without one. */
function shellScript(args: string[]): string | undefined {
  const flag = args.findIndex(word => /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
  return flag === -1 ? undefined : args[flag + 1];
}

/** The refusal of one simple command, its `words`, or null. */
function commandRefusal(words: string[], context: Context, seen: Set<string>): string | null {
  const { isFileAt } = context;
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
  // K528: the script of a shell's -c is one word of the command; it is read as a command of its own, with every rule.
  const script = SHELLS.has(program) ? shellScript(args) : undefined;
  if (script !== undefined) return refusalIn(script, context, seen);
  if (program === 'sleep') return waitRefusal(`${words.join(' ')} waits`);
  if (program === 'make') return makeRefusal(args, context, seen);
  if (program === 'git') return gitRefusal(args);
  return runnerRefusal(program, args, isFileAt);
}

/** The refusal of the Bash command `command` in `context`, or null; `seen` holds the make targets already read. */
function refusalIn(command: string, context: Context, seen: Set<string>): string | null {
  const parts = commandParts(command);
  if (loopCommands(parts).some(({ kind, words }) => sleeps(words) || (kind !== 'for' && polls(words)))) return waitRefusal(`${command} sleeps or polls in a loop`);
  for (const words of parts) {
    const refused = commandRefusal(words, context, seen);
    if (refused) return refused;
  }
  return null;
}

/**
 * The refusal of the Bash command `command`, or null when the hook allows it. `make` gives the database of the Makefile of
 * the root, which a make command is followed through; without it a make command is read by its targets alone.
 */
export function refusal(command: string, isFileAt: (file: string) => boolean = isFile, make: () => MakeDatabase | undefined = () => undefined): string | null {
  return refusalIn(command, { isFileAt, make }, new Set());
}

/**
 * The refusal of the tool call `input` in the repository `root`, or null: a Bash command by `refusal`, and an edit of a file
 * that kit vendors. kit itself is the source of the copies and edits them; a consumer without the installed package has no
 * known copies, and its kit-check names a changed copy.
 */
export function toolRefusal(input: unknown, root: string): string | null {
  if (!isJsonObject(input) || !isJsonObject(input.tool_input)) return null;
  const tool = input.tool_name;
  if (tool === 'Bash') {
    let database: MakeDatabase | undefined;
    return typeof input.tool_input.command === 'string' ? refusal(input.tool_input.command, isFile, () => (database ??= makeDatabase(root))) : null;
  }
  if (typeof tool !== 'string' || !EDITS.has(tool)) return null;
  const file = input.tool_input.file_path ?? input.tool_input.notebook_path;
  if (typeof file !== 'string' || isSource(root) || !existsSync(path.join(root, INSTALLED, 'package.json'))) return null;
  const relative = path.relative(root, path.resolve(root, file));
  const copy = copiesOf(readNpmManifest(root, `${INSTALLED}/package.json`)).find(item => item.file === relative);
  return copy ? `kit vendors ${relative}; change it in kit and write it with make kit-sync` : null;
}

if (isMain(import.meta.url)) {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error) {
    console.error(`[kit claude-hook] refuse: the hook input on stdin is no JSON (${error instanceof Error ? error.message : String(error)})`);
    process.exit(2);
  }
  const refused = toolRefusal(input, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (refused) {
    console.error(`[kit claude-hook] refuse: ${refused}`);
    process.exit(2);
  }
}
