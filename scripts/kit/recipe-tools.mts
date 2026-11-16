// The words of make recipes and command lines (K171, K179, K184): the expansion of the variables of make, the command parts of a
// line split by the quoting rules of the POSIX shell with shell-quote, so an operator inside quotes is text, and the targets
// and assignments of the arguments of a make command. The hook, the rules check, land and the owner check read commands with
// them; kit judges no recipe of a repository with them (K1051).
import { parse } from 'shell-quote';

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

/**
 * `text` with the variables of make expanded from `variables`, as make expands a recipe: a variable, a variable whose name holds
 * another reference (`$(CI_TARGETS_$(1))`), `$(call name,args)` with its arguments as $(1), $(2) and so on, and
 * `$(foreach var,list,text)` and `$(if condition,then,else)` (K1260). Another function call, such as `$(shell …)`, and an unknown variable stay as written; `$$`
 * stays, since make gives it to the shell as one `$`.
 */
export function expandMake(text: string, variables: ReadonlyMap<string, string>): string {
  return expandText(text.replaceAll('$(MAKE)', 'make').replaceAll('${MAKE}', 'make'), variables, 0);
}

/** The index of the bracket that closes the one at `open` in `text`, or -1. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}' };
  const stack: string[] = [];
  for (let index = open; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '(' || char === '{') stack.push(pairs[char] ?? '');
    else if (char === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

/** The arguments of a function call of make: `text` split at each comma outside a bracket. */
function callArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '(' || char === '{') depth += 1;
    else if (char === ')' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function expandText(text: string, variables: ReadonlyMap<string, string>, depth: number): string {
  if (depth > MAX_EXPANSION) return text;
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char !== '$') { result += char; continue; }
    if (next === '$') { result += '$$'; index += 1; continue; }
    if (next !== '(' && next !== '{') { result += char; continue; }
    const end = closing(text, index + 1);
    if (end < 0) { result += text.slice(index); break; }
    const reference = text.slice(index, end + 1);
    result += expandReference(reference, text.slice(index + 2, end), variables, depth);
    index = end;
  }
  return result;
}

function expandReference(reference: string, inner: string, variables: ReadonlyMap<string, string>, depth: number): string {
  const call = /^call\s+([\s\S]*)$/.exec(inner);
  if (call) {
    const [name = '', ...args] = callArguments(call[1] ?? '').map(part => expandText(part, variables, depth + 1));
    const body = variables.get(name.trim());
    if (body === undefined) return reference;
    const bound = new Map(variables);
    args.forEach((value, position) => bound.set(String(position + 1), value));
    return expandText(body, bound, depth + 1);
  }
  const each = /^foreach\s+([\s\S]*)$/.exec(inner);
  if (each) {
    const [name = '', list = '', body = ''] = callArguments(each[1] ?? '');
    const words = expandText(list, variables, depth + 1).split(/\s+/).filter(Boolean);
    const variable = expandText(name, variables, depth + 1).trim();
    return words.map(word => expandText(body, new Map([...variables, [variable, word]]), depth + 1)).join(' ');
  }
  // $(if condition,then,else): the condition is empty only when it expands to blanks; one that holds an unknown reference counts as
  // true, since the check reads what a recipe can reach.
  const branch = /^if\s+([\s\S]*)$/.exec(inner);
  if (branch) {
    const [condition = '', then = '', otherwise = ''] = callArguments(branch[1] ?? '');
    return expandText(expandText(condition, variables, depth + 1).trim() === '' ? otherwise : then, variables, depth + 1);
  }
  // Another function of make keeps its text; a name has no blank, comma or colon.
  if (/[\s,:]/.test(inner.replace(/\$[({][^)}]*[)}]/g, ''))) return reference;
  const name = expandText(inner, variables, depth + 1);
  if (name === 'MAKE') return 'make';
  const value = variables.get(name);
  return value === undefined ? reference : expandText(value, variables, depth + 1);
}

/**
 * `text` without the file descriptor number of each redirection: shell-quote reads `2>&1` as the word 2, the operator >& and the
 * word 1, and the 2, written against the operator, is no argument of the command (POSIX shell, 2.7 Redirection). A number that a
 * blank parts from the operator, as in `echo 2 > f`, is a word and stays; quoted text is left as it is (K984).
 */
function withoutRedirectionNumbers(text: string): string {
  let result = '';
  let quote: string | undefined;
  // Whether the last character was escaped: an escaped blank or operator joins its word and starts no new one.
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    // A backslash escapes the next character outside single quotes (2.2.1, 2.2.3), so an escaped quote ends no quoting.
    if (quote !== "'" && char === '\\') {
      result += text.slice(index, index + 2);
      index += 1;
      escaped = true;
      continue;
    }
    const afterBreak = index === 0 || (!escaped && /[\s;&|()]/.test(text.charAt(index - 1)));
    escaped = false;
    if (quote === undefined && (char === "'" || char === '"')) quote = char;
    else if (char === quote) quote = undefined;
    else if (quote === undefined && /\d/.test(char) && afterBreak) {
      const number = /^\d+(?=[<>])/.exec(text.slice(index));
      if (number) {
        index += number[0].length - 1;
        continue;
      }
    }
    result += char;
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
      return parameter;
    });
  };
  const parts: string[][] = [[]];
  let redirection = false;
  for (const entry of parse(withoutRedirectionNumbers(text), key => `\${${key}}`)) {
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

// The options of make that take the next word as their value.
const MAKE_VALUED = new Set(['-C', '--directory', '-f', '--file', '--makefile', '-j', '--jobs', '-I', '-o', '-W']);

/**
 * The targets and the variable assignments of the arguments `args` of a make command, with the folder of its -C or --directory
 * and the file of its -f, --file or --makefile as written, without quotes (K1064).
 */
export function makeArguments(args: readonly string[]): { targets: string[]; assignments: Map<string, string>; directory?: string; file?: string } {
  const targets: string[] = [];
  const assignments = new Map<string, string>();
  const found: { directory?: string; file?: string } = {};
  const note = (option: string, value: string) => {
    const bare = value.replace(/^(["'])(.*)\1$/, '$2');
    if (option === '-C' || option === '--directory') found.directory = bare;
    else if (option === '-f' || option === '--file' || option === '--makefile') found.file = bare;
  };
  let valued: string | undefined;
  for (const arg of args) {
    if (valued !== undefined) {
      note(valued, arg);
      valued = undefined;
    } else if (MAKE_VALUED.has(arg)) valued = arg;
    else if (arg.startsWith('-')) {
      const attached = /^(--directory|--file|--makefile)=(.*)$/.exec(arg) ?? /^(-[Cf])(.+)$/.exec(arg);
      if (attached?.[1] !== undefined) note(attached[1], attached[2] ?? '');
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) assignments.set(arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1));
    else targets.push(arg);
  }
  return { targets, assignments, ...found };
}
