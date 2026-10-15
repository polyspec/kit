// A recipe of make starts a tool of the checkout by its absolute path, never by its bare name (K171): make 3.81 looks up a
// recipe line without shell syntax on the PATH that make started with, not on the PATH that kit.mk exports, so a bare `node`
// ran the node of the machine. kit.mk names each tool that its recipes start by a variable of its absolute path (NODE, NPM,
// ALINT); a repository's own recipes use them, or another absolute path. The tools of the checkout are the wrappers that
// the bootstrap and install-tools write into var/tools/bin and the commands of the tools of mise.toml.
//
// The recipes are read from the database that GNU make prints (makeDatabase of owner-check.mts), as written, before make
// expands them, and split into words by the quoting rules of the POSIX shell, so an operator inside quotes is text (K179).
// Each command of a line counts: the first word of the line and of each part after &&, ||, ;, |, ( and {, after the prefixes
// @, - and +, $(ONLINE) and the variable assignments before the command.
import { MISE_WRAPPER, NODE_WRAPPER } from './bootstrap/install-mise.mts';
import { NPM_WRAPPERS } from './bootstrap/install-npm.mts';
import { PHP_LINT_WRAPPERS } from './install-php-lint.mts';
import { PHPUNIT_WRAPPERS } from './install-phpunit.mts';
import { type MakeDatabase } from './owner-check.mts';
import { MISE_TOOLS } from './toolchain-mise.mts';

/** The commands of the tools of a checkout, which a recipe must not start by their bare names. */
export const CHECKOUT_TOOLS: ReadonlySet<string> = new Set([
  NODE_WRAPPER, MISE_WRAPPER, ...Object.keys(NPM_WRAPPERS), ...Object.keys(PHPUNIT_WRAPPERS), ...Object.keys(PHP_LINT_WRAPPERS),
  ...Object.values(MISE_TOOLS).map(tool => tool.command),
]);

// The control operators that end a command, outside quotes; the longest one at a position is the operator (POSIX shell,
// 2.3 Token Recognition and 2.9 Shell Commands).
const OPERATORS = ['&&', '||', ';', '|', '(', ')', '{', '}'];
// A reference of make, $(NAME), is one word: its parentheses are no subshell.
const REFERENCE = /\$\([^()]*\)/y;

/**
 * The words of each command of the recipe line `line`, split by the quoting rules of the POSIX shell (2.2 Quoting): a
 * single-quoted string is literal; in a double-quoted one a backslash escapes $, `, ", a backslash and a newline; outside
 * quotes a backslash escapes the next character; and the quotes are removed from the word. An operator or a blank inside
 * quotes is text of the word, so `echo "a|node"` is one command.
 */
function commandParts(line: string): string[][] {
  const parts: string[][] = [[]];
  let word: string | undefined;
  const add = (text: string): void => { word = (word ?? '') + text; };
  const end = (): void => {
    if (word !== undefined) parts[parts.length - 1]?.push(word);
    word = undefined;
  };
  for (let index = 0; index < line.length;) {
    const character = line.charAt(index);
    REFERENCE.lastIndex = index;
    const reference = REFERENCE.exec(line)?.[0];
    const operator = OPERATORS.find(candidate => line.startsWith(candidate, index));
    if (reference !== undefined) {
      add(reference);
      index += reference.length;
    } else if (character === "'") {
      const close = line.indexOf("'", index + 1);
      const stop = close < 0 ? line.length : close;
      add(line.slice(index + 1, stop));
      index = stop + 1;
    } else if (character === '"') {
      let text = '';
      for (index += 1; index < line.length && line.charAt(index) !== '"'; index += 1) {
        if (line.charAt(index) === '\\' && index + 1 < line.length && '$`"\\\n'.includes(line.charAt(index + 1))) index += 1;
        text += line.charAt(index);
      }
      add(text);
      index += 1;
    } else if (character === '\\') {
      add(line.charAt(index + 1));
      index += 2;
    } else if (/\s/.test(character)) {
      end();
      index += 1;
    } else if (operator !== undefined) {
      end();
      parts.push([]);
      index += operator.length;
    } else {
      add(character);
      index += 1;
    }
  }
  end();
  return parts;
}

/** The command words of the recipe line `line`. */
export function commandWords(line: string): string[] {
  return commandParts(line).flatMap((part) => {
    // The prefixes @, - and + of make precede the command; $(ONLINE) and the variable assignments only prefix it.
    const words = part.map((word, index) => (index === 0 ? word.replace(/^[@+-]+/, '') : word)).filter(Boolean);
    const command = words.find(word => word !== '$(ONLINE)' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    return command === undefined ? [] : [command];
  });
}

/** One finding for each recipe line of `make` that starts a tool of the checkout by its bare name. */
export function bareToolFindings(make: MakeDatabase): string[] {
  return [...make.targets].flatMap(([target, { recipe }]) => recipe.split('\n').flatMap(line => commandWords(line)
    .filter(word => CHECKOUT_TOOLS.has(word))
    .map(word => `make target ${target} starts ${word} by its bare name: \`${line.trim()}\`; make 3.81 looks it up on the PATH that make started with, so it runs the ${word} of the machine. Fix: start it by its absolute path, such as $(NODE) of kit.mk for node`)));
}
