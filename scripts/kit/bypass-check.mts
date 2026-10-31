#!/usr/bin/env node
// The check that no tracked test, script or Makefile bypasses a gate (`make bypass-check`, K308): P6 forbids lowering a standard
// to pass, and these three bypass a gate without a trace:
//   1. setting the CI identity (GITHUB_ACTIONS, CI) outside .github/workflows: a local run impersonates CI to pass the guard that
//      keeps a suite out of a local run;
//   2. make -o, --old-file or --assume-old naming a gate of kit-gates: the gate is treated as up to date and never runs;
//   3. --no-verify: a Git hook is skipped.
// A TypeScript or JavaScript file is read with its parser (script-ast.mts), so the CI identity is an object property or an
// assignment in its code; a command or a flag inside a string is data (K954). The tools and tests of kit itself are checked
// like any repository's, since they hold strings of the commands they test. Each finding names the file, the line and the bypass.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { trackedFiles } from './tracked-files.mts';
import { kitGates } from './kit-gates.mts';
import { calleeName, isNode, parseScript, SCRIPT_FILE, type ScriptNode, walk } from './script-ast.mts';

// The files that are read: tests, scripts, Makefiles and Git hooks; the workflows are the one place that CI is named.
const READ = /^(?:tests\/|scripts\/|\.githooks\/|Makefile$|.*\.mk$|.*\/Makefile$)/;

// A CI identity variable set to a value: a shell assignment, an object property, or an assignment to process.env or env.
const CI_IDENTITY = /\b(?:GITHUB_ACTIONS|CI)\b(?:['"]?\s*[:=]\s*['"]?(?:true|1|yes)\b|\s*\]?\s*=\s*['"]?(?:true|1|yes)\b)/;
const BYPASS_FLAGS = /\s(?:-o|--old-file|--assume-old)(?:=|\s+)([A-Za-z0-9_.-]+)/g;

const CI_VALUE = /^(?:true|1|yes)$/;

// The name of a property key or a member, a string or an identifier that is not computed; undefined for another key.
function keyName(key: unknown, computed: boolean): string | undefined {
  if (!isNode(key)) return undefined;
  if (key.type === 'Identifier') return !computed && typeof key.name === 'string' ? key.name : undefined;
  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}

// The value of a literal as text, such as 'true' for true; undefined for another node.
const literalText = (node: unknown): string | undefined => (isNode(node) && node.type === 'Literal' && node.regex === undefined ? String(node.value) : undefined);

// The CI identity that a script puts into a process environment or into process.env (K954): an object with a CI key that is the
// env of an options object, or a variable of such an object spread or named as env, or an assignment to process.env. An object
// that a pure function takes as an argument, such as ciRefusal(command, { GITHUB_ACTIONS: 'true' }), is data, not an environment.
function ciIdentityFindings(file: string, text: string): string[] {
  const { program } = parseScript(file, text);
  const found: string[] = [];
  const report = (node: ScriptNode) => found.push(`${file}:${text.slice(0, node.start).split('\n').length}: sets the CI identity outside a workflow; a local run never impersonates CI`);
  const sets = (object: ScriptNode): boolean => properties(object).some(property => property.type === 'Property' && CI_IDENTITY_NAME.test(keyName(property.key, property.computed === true) ?? '') && CI_VALUE.test(literalText(property.value) ?? ''));
  // The variables that hold an object with the CI identity, by name.
  const identities = new Set<string>();
  walk(program, node => {
    if (node.type === 'VariableDeclarator' && isNode(node.id) && node.id.type === 'Identifier' && typeof node.id.name === 'string' && isNode(node.init) && node.init.type === 'ObjectExpression' && sets(node.init)) identities.add(node.id.name);
  });
  // The env option of the options of a call that spawns a process.
  walk(program, node => {
    if (node.type === 'CallExpression' && SPAWNERS.has(calleeName(node.callee).split('.').pop() ?? '')) {
      for (const options of Array.isArray(node.arguments) ? node.arguments.filter(isNode) : []) {
        if (options.type !== 'ObjectExpression') continue;
        for (const property of properties(options)) {
          if (property.type !== 'Property' || keyName(property.key, property.computed === true) !== 'env' || !isNode(property.value)) continue;
          const value = property.value;
          if (value.type === 'Identifier' && typeof value.name === 'string' && identities.has(value.name)) report(property);
          if (value.type === 'ObjectExpression') {
            if (sets(value)) report(value);
            for (const entry of properties(value)) if (entry.type === 'SpreadElement' && isNode(entry.argument) && entry.argument.type === 'Identifier' && identities.has(String(entry.argument.name))) report(entry);
          }
        }
      }
    } else if (node.type === 'AssignmentExpression' && isNode(node.left) && node.left.type === 'MemberExpression' && calleeName(node.left.object) === 'process.env') {
      const name = keyName(node.left.property, node.left.computed === true);
      if (name !== undefined && CI_IDENTITY_NAME.test(name) && CI_VALUE.test(literalText(node.right) ?? '')) report(node);
    }
  });
  return found;
}

// The properties of an object literal, or none.
const properties = (object: ScriptNode): ScriptNode[] => (Array.isArray(object.properties) ? object.properties.filter(isNode) : []);

const CI_IDENTITY_NAME = /^(?:GITHUB_ACTIONS|CI)$/;
// The functions that start a process with an environment of its own (K954).
const SPAWNERS = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);

/** The findings of the file `file` with the text `text`; `gates` are the gates of kit-gates. */
export function bypassFindings(file: string, text: string, gates: readonly string[]): string[] {
  if (!READ.test(file)) return [];
  if (SCRIPT_FILE.test(file)) return ciIdentityFindings(file, text);
  return text.split('\n').flatMap((line, index) => {
    const found: string[] = [];
    const code = line.replace(/^\s*(?:\/\/|#).*$/, '');
    const where = `${file}:${index + 1}`;
    if (CI_IDENTITY.test(code)) found.push(`${where}: sets the CI identity outside a workflow; a local run never impersonates CI`);
    if (/\bmake\b/.test(code)) {
      for (const match of code.matchAll(BYPASS_FLAGS)) {
        if (gates.includes(match[1] ?? '')) found.push(`${where}: make ${(match[0] ?? '').trim()} treats the gate ${match[1]} as up to date and never runs it`);
      }
    }
    if (/--no-verify\b/.test(code)) found.push(`${where}: --no-verify skips a Git hook`);
    return found;
  });
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  // The gates are those of the kit.mk that the Makefile includes, which in a consumer is the kit.mk of the installed kit (K357-1).
  let gates: string[];
  try {
    gates = [...kitGates(root)];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[bypass-check] ${error.message}`);
    process.exit(2);
  }
  const found = trackedFiles(root).flatMap(file => bypassFindings(file, readFileSync(path.join(root, file), 'utf8'), gates));
  for (const line of found) console.error(`[bypass-check] ${line}`);
  if (found.length) {
    console.error(`[bypass-check] ${found.length} bypasses of a gate; a gate runs, and its finding is fixed`);
    process.exit(1);
  }
  console.log('[bypass-check] no test, script or Makefile impersonates CI, assumes a gate up to date or skips a hook');
}
