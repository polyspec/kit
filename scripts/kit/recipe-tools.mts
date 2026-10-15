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
const PLACEHOLDER = /\$\{KIT_MAKE_REFERENCE_(\d+)\}/g;

/**
 * The words of each command of the recipe line `line`, split by the quoting rules of the POSIX shell with the parse of
 * shell-quote: a quoted string is one word with its quotes removed, and an operator or a blank inside quotes is text of the
 * word, so `echo "a|node"` is one command. Each reference of make, which the shell never sees, stays one word as written.
 */
function commandParts(line: string): string[][] {
  const references: string[] = [];
  let text = line;
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(REFERENCE, reference => `\${KIT_MAKE_REFERENCE_${references.push(reference) - 1}}`);
  }
  const restore = (word: string): string => word.replace(PLACEHOLDER, (_, index: string) => restore(references[Number(index)] ?? ''));
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

/** The command words of the recipe line `line`. */
export function commandWords(line: string): string[] {
  return commandParts(line).flatMap((part) => {
    // The prefixes @, - and + of make precede the command; $(ONLINE) and the variable assignments only prefix it.
    const words = part.map((word, index) => (index === 0 ? word.replace(/^[@+-]+/, '') : word)).filter(Boolean);
    // { and } are reserved words of the shell where a command starts (2.4 Reserved Words), and no command.
    while (words[0] === '{' || words[0] === '}') words.shift();
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
