// A recipe of make starts a tool of the checkout by its absolute path, never by its bare name (K171): make 3.81 looks up a
// recipe line without shell syntax on the PATH that make started with, not on the PATH that kit.mk exports, so a bare `node`
// ran the node of the machine. kit.mk names each tool that its recipes start by a variable of its absolute path (NODE, NPM,
// ALINT); a repository's own recipes use them, or another absolute path. The tools of the checkout are the wrappers that
// the bootstrap and install-tools write into var/tools/bin and the commands of the tools of mise.toml.
//
// The recipes are read from the database that GNU make prints (makeDatabase of owner-check.mts), as written, before make
// expands them. Each command of a line counts: the first word of the line and of each part after &&, ||, ;, |, ( and {,
// after the prefixes @, - and +, $(ONLINE) and the variable assignments before the command.
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

/** The command words of the recipe line `line`. */
export function commandWords(line: string): string[] {
  // A reference of make, $(NAME), is one word: its parentheses are no subshell. $(ONLINE) only prefixes the command.
  const references: string[] = [];
  const masked = line.replace(/\$\([^()]*\)/g, (reference) => {
    references.push(reference);
    return `\0${references.length - 1}\0`;
  });
  const unmask = (word: string): string => word.replace(/\0(\d+)\0/g, (_, index: string) => references[Number(index)] ?? '');
  return masked.split(/&&|\|\||[;|(){}]/).flatMap((part) => {
    const words = part.trim().replace(/^[@+-]+/, '').trim().split(/\s+/).filter(Boolean).map(unmask);
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
