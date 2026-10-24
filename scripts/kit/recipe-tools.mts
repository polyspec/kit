// A recipe of make starts a tool of the checkout by its absolute path, never by its bare name (K171): make 3.81 looks up a
// recipe line without shell syntax on the PATH that make started with, not on the PATH that kit.mk exports, so a bare `node`
// ran the node of the machine. kit.mk names each tool that its recipes start by a variable of its absolute path (NODE, NPM,
// ALINT); a repository's own recipes use them, or another absolute path. The tools of the checkout are the wrappers that
// the bootstrap and install-tools write into var/tools/bin and the commands of the tools of mise.toml.
//
// The recipes are read from the database that GNU make prints (makeDatabase of owner-check.mts), as written, before make
// expands them, and split into words by the quoting rules of the POSIX shell with shell-quote, so an operator inside quotes
// is text (K179, K184). Each command of a line counts: the first word of the line and of each part after &&, ||, ;, |, ( and {, after the prefixes
// @, - and +, $(ONLINE) and the variable assignments before the command.
import { MISE_WRAPPER, NODE_WRAPPER } from './bootstrap/install-mise.mts';
import { NPM_WRAPPERS } from './bootstrap/install-npm.mts';
import { PHP_LINT_WRAPPERS } from './install-php-lint.mts';
import { PHPUNIT_WRAPPERS } from './install-phpunit.mts';
import { parse } from 'shell-quote';
import { type MakeDatabase } from './owner-check.mts';
import { MISE_TOOLS } from './toolchain-mise.mts';

/** The commands of the tools of a checkout, which a recipe must not start by their bare names. */
export const CHECKOUT_TOOLS: ReadonlySet<string> = new Set([
  NODE_WRAPPER, MISE_WRAPPER, ...Object.keys(NPM_WRAPPERS), ...Object.keys(PHPUNIT_WRAPPERS), ...Object.keys(PHP_LINT_WRAPPERS),
  ...Object.values(MISE_TOOLS).map(tool => tool.command),
]);

// The control operators of shell-quote that end a command and start the next one (POSIX shell, 2.9 Shell Commands); a
// redirection operator only takes the word after it.
const CONTROL = new Set(['&&', '||', ';', ';;', ';&', ';;&', '&', '|', '|&', '(', ')', '<(', '>(']);
// A reference of make, $(NAME), possibly nested, which make expands before the shell reads the line.
const REFERENCE = /\$\(([^()]*)\)/g;
const PLACEHOLDER_NAME = 'KIT_MAKE_REFERENCE_';
const PLACEHOLDER = new RegExp(String.raw`\$\{${PLACEHOLDER_NAME}(\d+)\}`, 'g');
const SHELL_PARAMETER_PLACEHOLDER_NAME = 'KIT_SHELL_PARAMETER_';

// The rounds of expansion of a reference whose value holds references, as make expands them recursively.
const MAX_EXPANSION = 16;

/** The closing brace of a shell parameter expansion, respecting nested expansions, quotes and command substitutions. */
function shellParameterEnd(text: string, start: number): number {
  let depth = 1;
  let commandDepth = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '$' && text[index + 1] === '(') {
      commandDepth += 1;
      index += 1;
      continue;
    }
    if (commandDepth > 0) {
      if (char === '(') commandDepth += 1;
      else if (char === ')') commandDepth -= 1;
      continue;
    }
    if (char === '$' && text[index + 1] === '{') {
      depth += 1;
      index += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Masks shell parameter expansions so shell-quote can split their words without parsing expansion operators as syntax. */
function maskShellParameters(text: string): { text: string; name: string; values: string[] } {
  let name = SHELL_PARAMETER_PLACEHOLDER_NAME;
  while (text.includes(name)) name += '_';
  const values: string[] = [];
  const output: string[] = [];
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (escaped) {
      output.push(char ?? '');
      escaped = false;
      index += 1;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      output.push(char);
      escaped = true;
      index += 1;
      continue;
    }
    if (quote === "'") {
      output.push(char ?? '');
      if (char === "'") quote = undefined;
      index += 1;
      continue;
    }
    if ((char === "'" || char === '"') && quote === undefined) {
      quote = char;
      output.push(char);
      index += 1;
      continue;
    }
    if (char === '"' && quote === '"') {
      quote = undefined;
      output.push(char);
      index += 1;
      continue;
    }
    if (char === '$' && text[index + 1] === '{') {
      const end = shellParameterEnd(text, index + 2);
      if (end >= 0) {
        const expansion = text.slice(index, end + 1);
        if (!new RegExp(`^\\$\\{${PLACEHOLDER_NAME}\\d+\\}$`).test(expansion)) {
          output.push(`${name}${values.push(expansion) - 1}`);
        } else {
          output.push(expansion);
        }
        index = end + 1;
        continue;
      }
    }
    output.push(char ?? '');
    index += 1;
  }
  return { text: output.join(''), name, values };
}

/** `text` with the variables of make expanded from `variables`; a function call or an unknown variable stays as written. */
export function expandMake(text: string, variables: ReadonlyMap<string, string>): string {
  let result = text.replaceAll('$(MAKE)', 'make').replaceAll('${MAKE}', 'make');
  for (let round = 0; round < MAX_EXPANSION; round += 1) {
    const next = result.replace(/\$[({]([A-Za-z_][A-Za-z0-9_]*)[)}]/g, (reference, name: string) => variables.get(name) ?? reference);
    if (next === result) break;
    result = next;
  }
  return result;
}

/**
 * The words of each command of the recipe line `line`, split by the quoting rules of the POSIX shell with the parse of
 * shell-quote: a quoted string is one word with its quotes removed, and an operator or a blank inside quotes is text of the
 * word, so `echo "a|node"` is one command. Each reference of make, which the shell never sees, stays one word as written.
 */
export function commandParts(line: string): string[][] {
  // A placeholder of the line itself would be read as a reference of make: one beyond the references lost its word, one
  // within them took the word of another (K187).
  if (line.includes(PLACEHOLDER_NAME)) {
    throw new Error(`recipe line \`${line}\` already contains ${PLACEHOLDER_NAME}, the placeholder that recipe-tools puts in place of a make reference; rename that variable`);
  }
  const references: string[] = [];
  let text = line;
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(REFERENCE, reference => `\${${PLACEHOLDER_NAME}${references.push(reference) - 1}}`);
  }
  const shellParameters = maskShellParameters(text);
  text = shellParameters.text;
  const shellParameterPlaceholder = new RegExp(String.raw`${shellParameters.name}(\d+)`, 'g');
  const restore = (word: string): string => {
    const restored = word.replace(PLACEHOLDER, (placeholder, index: string) => {
      const reference = references[Number(index)];
      // Each placeholder left is one that the loop above wrote, since the line had none of its own.
      if (reference === undefined) throw new Error(`recipe-tools wrote ${placeholder} for no reference of make in \`${line}\``);
      return restore(reference);
    });
    return restored.replace(shellParameterPlaceholder, (placeholder, index: string) => {
      const parameter = shellParameters.values[Number(index)];
      if (parameter === undefined) throw new Error(`recipe-tools wrote ${placeholder} for no shell parameter in \`${line}\``);
      return `\${${parameter}}`;
    });
  };
  const parts: string[][] = [[]];
  let redirection = false;
  for (const entry of parse(text, key => `\${${key}}`)) {
    if (typeof entry === 'string' || 'pattern' in entry) {
      if (!redirection) parts[parts.length - 1]?.push(restore(typeof entry === 'string' ? entry : entry.pattern));
      redirection = false;
    } else if ('op' in entry) {
      redirection = !CONTROL.has(entry.op);
      if (!redirection) parts.push([]);
    }
  }
  return parts;
}

/** The words of the command part `part` from its command on: no prefix of make, reserved brace, $(ONLINE) or variable assignment. */
function commandOf(part: readonly string[]): string[] {
  // The prefixes @, - and + of make precede the command; $(ONLINE) and the variable assignments only prefix it.
  const words = part.map((word, index) => (index === 0 ? word.replace(/^[@+-]+/, '') : word)).filter(Boolean);
  // { and } are reserved words of the shell where a command starts (2.4 Reserved Words), and no command.
  while (words[0] === '{' || words[0] === '}') words.shift();
  const start = words.findIndex(word => word !== '$(ONLINE)' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  return start === -1 ? [] : words.slice(start);
}

/** The command words of the recipe line `line`. */
export function commandWords(line: string): string[] {
  return commandParts(line).flatMap((part) => {
    const command = commandOf(part)[0];
    return command === undefined ? [] : [command];
  });
}

/** One finding for each recipe line of `make` that starts a tool of the checkout by its bare name. */
export function bareToolFindings(make: MakeDatabase): string[] {
  return [...make.targets].flatMap(([target, { recipe }]) => recipe.split('\n').flatMap(line => commandWords(line)
    .filter(word => CHECKOUT_TOOLS.has(word))
    .map(word => `make target ${target} starts ${word} by its bare name: \`${line.trim()}\`; make 3.81 looks it up on the PATH that make started with, so it runs the ${word} of the machine. Fix: start it by its absolute path, such as $(NODE) of kit.mk for node`)));
}

// The last segment of a path, as the shell looks a command up by it.
const baseName = (word: string): string => word.slice(word.lastIndexOf('/') + 1);

// The commands that run the command after them: env with its assignments and options, exec and command.
const PREFIXES = new Set(['env', 'exec', 'command']);
// The options of env that take the next word as their value.
const ENV_VALUED = new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']);
// A shell that runs its -c string, with -c alone or in combined flags such as -ec.
const SHELL = /^(?:ba|z|da)?sh$/;
const SHELL_STRING = /^-[a-z]*c[a-z]*$/;
const PHPUNIT = /^phpunit(?:\.phar)?$/;

/** Whether the command `words` starts PHPUnit: PHPUnit itself, a php interpreter that runs it, or either behind env, exec, command or sh -c. */
function startsPhpunit(words: readonly string[]): boolean {
  let rest = [...words];
  while (rest.length > 0 && PREFIXES.has(baseName(rest[0] ?? ''))) {
    rest = rest.slice(1);
    while (rest.length > 0 && ((rest[0] ?? '').startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0] ?? ''))) rest = rest.slice(ENV_VALUED.has(rest[0] ?? '') ? 2 : 1);
  }
  const command = baseName(rest[0] ?? '');
  if (SHELL.test(command)) {
    const flag = rest.findIndex(word => SHELL_STRING.test(word));
    const script = flag === -1 ? undefined : rest[flag + 1];
    return script !== undefined && commandParts(script).some(part => startsPhpunit(commandOf(part)));
  }
  return PHPUNIT.test(command) || (/^php[0-9.]*$/.test(command) && rest.slice(1).some(word => PHPUNIT.test(baseName(word))));
}

/** One finding for each recipe command of `make` that starts PHPUnit outside run-tests. */
// run-tests gives each test its timeout and stops the process group of the tool when a test outlives it (K371), with SIGKILL
// after a grace period, so a test that waits inside a C call, such as a lock wait of libpq that retries its poll on EINTR,
// still ends at its timeout (K436). A recipe that starts PHPUnit itself has no limit, and such a test sleeps until someone
// ends it. The lines are read with the variables of make expanded, so a variable that holds the command counts.
export function testRunnerFindings(make: MakeDatabase): string[] {
  return [...make.targets].flatMap(([target, { recipe }]) => recipe.split('\n').flatMap(line => commandParts(expandMake(line, make.variables))
    .filter(part => startsPhpunit(commandOf(part)))
    .map(() => `make target ${target} starts PHPUnit outside run-tests: \`${line.trim()}\`; a test that hangs there has no time limit. Fix: run it as $(RUN_TESTS) phpunit [--php-extension <file>] -- <arguments>, which stops a test at its timeout`)));
}

// The options of make that take the next word as their value.
const MAKE_VALUED = new Set(['-C', '-f', '--file', '--makefile', '-j', '--jobs', '-I', '-o', '-W']);

/** The targets and the variable assignments of the arguments `args` of a make command. */
export function makeArguments(args: readonly string[]): { targets: string[]; assignments: Map<string, string> } {
  const targets: string[] = [];
  const assignments = new Map<string, string>();
  let value = false;
  for (const arg of args) {
    if (value) value = false;
    else if (MAKE_VALUED.has(arg)) value = true;
    else if (arg.startsWith('-')) continue;
    else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) assignments.set(arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1));
    else targets.push(arg);
  }
  return { targets, assignments };
}
